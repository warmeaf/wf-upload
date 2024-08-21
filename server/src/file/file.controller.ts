import {
  Controller,
  Post,
  Res,
  Inject,
  Body,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { Express, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { UniqueCodeService } from '../unique-code/unique-code.service';
import type { UploadChunk } from './type';
import { FileService } from './file.service';

interface FileBody {
  name: string;
  size: number;
  type: string;
  chunksLength: number;
}

interface PatchHashBody {
  token: string;
  hash: string;
  type: 'chunk' | 'file';
}

@Controller('file')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Inject(UniqueCodeService)
  private uniqueCodeService: UniqueCodeService;

  // 创建文件
  @Post('create')
  async create(@Body() body: FileBody): Promise<{
    status: string;
    token: string;
  }> {
    const token = this.uniqueCodeService.generateUniqueCode();
    if (!token) {
      return {
        status: 'error',
        token: '',
      };
    }
    const { name, size, type, chunksLength } = body;

    await this.fileService.createFile(token, name, size, type, chunksLength);
    return {
      status: 'ok',
      token,
    };
  }

  // hash 校验
  @Post('patchHash')
  async patchHash(@Body() body: PatchHashBody): Promise<any> {
    const { token, hash, type } = body;
    const valid = this.uniqueCodeService.verifyUniqueCode(token);
    if (!valid) {
      return {
        status: 'error',
      };
    }

    if (type === 'chunk') {
      const exists = await this.fileService.checkChunkHash(hash);
      return { status: 'ok', hasFile: exists };
    } else if (type === 'file') {
      const isHasFile = await this.fileService.checkFileHah(hash);
      if (isHasFile) {
        await this.fileService.deleteFile(token);
      }
      return {
        status: 'ok',
        hasFile: isHasFile,
        rest: [[200, 300]],
      };
    }
  }

  // 上传分片
  @Post('uploadChunk')
  @UseInterceptors(FileInterceptor('blob'))
  async uploadChunk(
    @Res() response: Response,
    @Body() chunk: UploadChunk,
    @UploadedFile() blob: Express.Multer.File,
  ): Promise<any> {
    await this.fileService.saveChunk(blob.buffer, chunk.hash);
    await this.fileService.pushFileChunks(
      chunk.token,
      chunk.hash,
      parseInt(chunk.index),
    );
    return response.status(200).json({
      status: 'ok',
    });
  }

  // 合并文件
  @Post('merge')
  async mergeFile(@Body() body: { token: string; hash: string }): Promise<{
    status: string;
    url: string;
  }> {
    const { token, hash } = body;

    await this.fileService.setFileHash(token, hash);
    const valid = await this.fileService.checkFileChunksLength(hash);
    if (valid) {
      await this.fileService.setUrl(hash);
      return {
        status: 'ok',
        url: '',
      };
    } else {
      // 表示这个文件上传之前中断过（比如上传过程中页面被刷新了）
      // 根据 index 检查缺失部分的 hash，把缺失部分的 hash 补回来
      await this.fileService.completeFileChunks(hash);
      return {
        status: 'ok',
        url: '文件 chunk 补完整了',
      };
    }
  }
}
