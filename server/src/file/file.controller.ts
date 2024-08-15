import {
  Controller,
  Head,
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
import type { Chunk } from './file.dto';
import { FileService } from './file.service';

@Controller('file')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Inject(UniqueCodeService)
  private uniqueCodeService: UniqueCodeService;

  // 创建文件
  @Head('create')
  create(@Res() response: Response): void {
    const token = this.uniqueCodeService.generateUniqueCode();
    response.setHeader('upload-file-token', token);
    response.status(200).send();
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
      console.log('exists', exists);
      return response.status(200).json({ hasFile: exists });
    } else {
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
    @Body() chunk: Chunk,
    @UploadedFile() blob: Express.Multer.File,
  ): Promise<any> {
    await this.fileService.saveChunk(blob.buffer, chunk.hash);
    response.status(200).send({
      status: 'ok',
    });
  }

  // 合并文件
  @Post('merge')
  mergeFile(@Body() body: { token: string }): {
    status: string;
    url: string;
  } {
    const { token } = body;
    const vaid = this.uniqueCodeService.verifyUniqueCode(token);
    return {
      status: 'ok',
      url: 'fsadgasg',
    };
  }
}
