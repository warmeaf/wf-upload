import {
  Controller,
  Head,
  Post,
  Res,
  Inject,
  Headers,
  Body,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { Express, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { UniqueCodeService } from '../unique-code/unique-code.service';
import type { Chunk, BaseHeader } from './file.dto';

@Controller('file')
export class FileController {
  constructor() {}

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
  patchHash(@Res() response: Response, @Body() body): void {
    const { token, hash, type } = body;
    const vaid = this.uniqueCodeService.verifyUniqueCode(token);
    if (vaid) {
      if (type === 'chunk') {
        response.status(200).send({
          hasFile: false,
        });
      } else {
        response.status(200).send({
          hasFile: false,
          rest: [[200, 300]],
        });
      }
    } else {
      response.status(403).send();
    }
  }

  // 上传分片
  @Post('uploadChunk')
  @UseInterceptors(FileInterceptor('blob'))
  uploadChunk(
    @Res() response: Response,
    @Body() chunk: Chunk,
    @UploadedFile() blob: Express.Multer.File,
  ): void {
    // console.log('uploadChunk', chunk);
    // console.log('uploadChunk', blob);
    response.status(200).send({
      status: 'ok',
    });
  }

  // 合并文件
  @Head('mergeFile')
  mergeFile(@Res() response: Response, @Headers() headers: BaseHeader): void {
    const token = headers['upload-file-token'];
    const vaid = this.uniqueCodeService.verifyUniqueCode(token);
    if (vaid) {
      response.status(200).send();
    } else {
      response.status(403).send();
    }
  }
}
