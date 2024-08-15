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
  async uploadChunk(
    @Res() response: Response,
    @Body() chunk: Chunk,
    @UploadedFile() blob: Express.Multer.File,
  ): Promise<any> {
    // console.log('uploadChunk', chunk);
    // console.log('uploadChunk', blob);
    // TODO 存储分片数据
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
