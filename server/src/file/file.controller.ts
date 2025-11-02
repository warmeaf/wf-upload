import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
  Logger,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { Express } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { UniqueCodeService } from '../unique-code/unique-code.service';
import { FileService } from './file.service';
import {
  CreateFileDto,
  PatchHashDto,
  UploadChunkDto,
  MergeFileDto,
} from './file.dto';
import {
  CreateFileResponse,
  PatchHashResponse,
  UploadChunkResponse,
  MergeFileResponse,
} from './response.types';

@Controller('file')
export class FileController {
  private readonly logger = new Logger(FileController.name);

  constructor(private readonly fileService: FileService) {}

  @Inject(UniqueCodeService)
  private uniqueCodeService: UniqueCodeService;

  /**
   * 1. 会话创建 (/file/create)
   * 为新文件初始化上传会话
   */
  @Post('create')
  async create(@Body() body: CreateFileDto): Promise<CreateFileResponse> {
    try {
      // 生成唯一token
      const token = this.uniqueCodeService.generateUniqueCode();
      if (!token) {
        throw new HttpException(
          'Failed to generate token',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      const { fileName, fileType, fileSize, chunksLength } = body;

      // 在数据库中创建文件记录
      await this.fileService.createFile(
        token,
        fileName,
        fileType,
        fileSize,
        chunksLength,
      );

      this.logger.log(
        `File session created: fileName=${fileName}, fileSize=${fileSize}, chunksLength=${chunksLength}, token=${token}`,
      );

      return {
        code: 200,
        token,
      };
    } catch (error) {
      this.logger.error(
        `Failed to create file session: ${error.message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * 2. 分块/文件状态检查 (/file/patchHash)
   * 检查特定分块或整个文件是否已存在于服务器上
   */
  @Post('patchHash')
  async patchHash(@Body() body: PatchHashDto): Promise<PatchHashResponse> {
    try {
      const { token, hash, isChunk } = body;

      // 验证token
      const valid = this.uniqueCodeService.verifyUniqueCode(token);
      if (!valid) {
        throw new HttpException('Invalid token', HttpStatus.BAD_REQUEST);
      }

      let exists = false;

      if (isChunk) {
        // 检查分块是否存在
        exists = await this.fileService.checkChunkExists(hash);
        this.logger.log(`Chunk hash check: hash=${hash}, exists=${exists}`);
      } else {
        // 检查文件是否存在
        exists = await this.fileService.checkFileExists(hash);
        this.logger.log(`File hash check: hash=${hash}, exists=${exists}`);
      }

      return {
        code: 200,
        exists,
      };
    } catch (error) {
      this.logger.error(`Failed to check hash: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * 3. 分块上传 (/file/uploadChunk)
   * 上传单个文件分块
   */
  @Post('uploadChunk')
  @UseInterceptors(FileInterceptor('chunk'))
  async uploadChunk(
    @Body() body: UploadChunkDto,
    @UploadedFile() chunk: Express.Multer.File,
  ): Promise<UploadChunkResponse> {
    try {
      const { token, hash } = body;

      // 验证token
      const valid = this.uniqueCodeService.verifyUniqueCode(token);
      if (!valid) {
        throw new HttpException('Invalid token', HttpStatus.BAD_REQUEST);
      }

      if (!chunk || !chunk.buffer) {
        throw new HttpException(
          'No chunk data provided',
          HttpStatus.BAD_REQUEST,
        );
      }

      // 保存分块数据
      await this.fileService.saveChunk(chunk.buffer, hash);

      this.logger.log(
        `Chunk uploaded: token=${token}, hash=${hash}, size=${chunk.buffer.length}`,
      );

      return {
        code: 200,
        success: true,
      };
    } catch (error) {
      this.logger.error(`Failed to upload chunk: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * 4. 文件合并 (/file/merge)
   * 文件上传的最后步骤，合并所有分块
   */
  @Post('merge')
  async merge(@Body() body: MergeFileDto): Promise<MergeFileResponse> {
    try {
      const { token, fileHash, fileName, chunksLength, chunks } = body;

      // 验证token
      const valid = this.uniqueCodeService.verifyUniqueCode(token);
      if (!valid) {
        throw new HttpException('Invalid token', HttpStatus.BAD_REQUEST);
      }

      // 验证分块数量
      if (chunks.length !== chunksLength) {
        throw new HttpException(
          `Chunks count mismatch: expected ${chunksLength}, got ${chunks.length}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      // 更新文件记录并生成URL
      const url = await this.fileService.updateFileForMerge(
        token,
        fileHash,
        fileName,
        chunks,
      );

      this.logger.log(
        `File merged successfully: token=${token}, fileHash=${fileHash}, url=${url}`,
      );

      return {
        code: 200,
        url,
      };
    } catch (error) {
      this.logger.error(`Failed to merge file: ${error.message}`, error);
      throw error;
    }
  }
}
