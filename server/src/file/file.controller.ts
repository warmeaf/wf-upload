import {
  Controller,
  Head,
  Post,
  Res,
  Inject,
  Headers,
  Body,
} from '@nestjs/common';
import { Response } from 'express';
import { UniqueCodeService } from '../unique-code/unique-code.service';
import type { Chunk, BaseHeader, PatchHashHeader } from './file.dto';

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
  @Head('patchHash')
  patchHash(
    @Res() response: Response,
    @Headers() headers: PatchHashHeader,
  ): void {
    const token = headers['upload-file-token'];
    const vaid = this.uniqueCodeService.verifyUniqueCode(token);
    if (vaid) {
      response.status(200).send();
    } else {
      response.status(403).send();
    }
  }

  // 上传分片
  @Post('uploadChunk')
  uploadChunk(@Body() chunk: Chunk, @Headers() headers: BaseHeader): void {
    const token = headers['upload-file-token'];
    const vaid = this.uniqueCodeService.verifyUniqueCode(token);
    console.log(vaid);
    console.log(chunk.blob);
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
