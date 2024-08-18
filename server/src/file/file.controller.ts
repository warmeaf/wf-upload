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

@Controller('file')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Inject(UniqueCodeService)
  private uniqueCodeService: UniqueCodeService;

  // 创建文件
  @Post('create')
  async create(@Res() response: Response, @Body() body): Promise<any> {
    const token = this.uniqueCodeService.generateUniqueCode();
    const { name, size, type, chunksLength } = body;

    await this.fileService.createFile(token, name, size, type, chunksLength);
    response.setHeader('upload-file-token', token);
    return response.status(200).json({
      status: 'ok',
    });
  }

  // hash 校验
  @Post('patchHash')
  async patchHash(@Res() response: Response, @Body() body): Promise<any> {
    const { token, hash, type } = body;
    const valid = this.uniqueCodeService.verifyUniqueCode(token);
    if (!valid) {
      return response.status(403).send();
    }

    if (type === 'chunk') {
      const exists = await this.fileService.patchHashChunk(hash);
      return response.status(200).json({ hasFile: exists });
    } else if (type === 'file') {
      // TODO 检查是否存在整个文件的 hash
      // 如果不存在就把整个文件的 hash 存储起来
      return response.status(200).json({
        hasFile: false,
        rest: [[200, 300]],
      });
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
    await this.fileService.updateChunk(chunk.token, chunk.hash, chunk.index);
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

    return {
      status: 'ok',
      url: 'fsadgasg',
    };
  }
}
