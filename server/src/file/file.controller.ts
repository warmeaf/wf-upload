import {
  Controller,
  Post,
  Get,
  Res,
  Param,
  Inject,
  Body,
  UseInterceptors,
  UploadedFile,
  Req,
} from '@nestjs/common';
import { Express, Response, Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { UniqueCodeService } from '../unique-code/unique-code.service';
import { FileService } from './file.service';
import {
  CreateFileDto,
  PatchHashDto,
  UploadChunkDto,
  MergeFileDto,
} from './file.dto';

@Controller('file')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Inject(UniqueCodeService)
  private uniqueCodeService: UniqueCodeService;

  // 创建文件
  @Post('create')
  async create(@Body() body: CreateFileDto): Promise<{
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
    const { name, size, type, chunksLength, hash } = body;

    await this.fileService.createFile(
      token,
      name,
      size,
      type,
      chunksLength,
      hash || '',
    );
    return {
      status: 'ok',
      token,
    };
  }

  // hash 校验
  @Post('patchHash')
  async patchHash(@Body() body: PatchHashDto): Promise<any> {
    const { token, hash, type } = body;
    const valid = this.uniqueCodeService.verifyUniqueCode(token);
    if (!valid) {
      return {
        status: 'error',
      };
    }

    if (type === 'chunk') {
      const exists = await this.fileService.checkChunkExists(hash);
      return { status: 'ok', hasFile: exists };
    } else if (type === 'file') {
      let url = '';
      const isHasFile = await this.fileService.checkFileExists(hash);
      if (isHasFile) {
        await this.fileService.deleteFileByToken(token);
        const file = await this.fileService.getFileByHash(hash);
        url = file.url;
      }
      return {
        status: 'ok',
        hasFile: isHasFile,
        url,
      };
    }
  }

  // 上传分片
  @Post('uploadChunk')
  @UseInterceptors(FileInterceptor('blob'))
  async uploadChunk(
    @Res() response: Response,
    @Body() chunk: UploadChunkDto,
    @UploadedFile() blob: Express.Multer.File,
  ): Promise<any> {
    await this.fileService.saveChunk(blob.buffer, chunk.hash);
    await this.fileService.addChunkToFile(
      chunk.token,
      chunk.hash,
      Number(chunk.index),
    );
    return response.status(200).json({
      status: 'ok',
    });
  }

  // 合并文件
  @Post('merge')
  async mergeFile(@Body() body: MergeFileDto): Promise<{
    status: string;
    url: string;
  }> {
    const { token, hash } = body;
    let url = '';

    await this.fileService.updateFileHash(token, hash);
    const valid = await this.fileService.isFileComplete(hash);
    if (valid) {
      await this.fileService.generateAndSetFileUrl(hash);
      const file = await this.fileService.getFileByHash(hash);
      url = file.url;
      return {
        status: 'ok',
        url,
      };
    } else {
      // 表示这个文件上传之前中断过（比如上传过程中页面被刷新了）
      // 根据 index 检查缺失部分的 hash，把缺失部分的 hash 补回来
      await this.fileService.addMissingChunks(hash);
      const file = await this.fileService.getFileByHash(hash);
      url = file.url;
      return {
        status: 'ok',
        url,
      };
    }
  }

  // 下载文件
  @Get(':url')
  async streamFile(
    @Param('url') url: string,
    @Res() res: Response,
    // 获取请求对象以读取 Range 头
    @Req() req: Request,
  ) {
    url = encodeURIComponent(url);
    const file = await this.fileService.getFileByUrl(decodeURIComponent(url));
    if (!file) {
      res.status(404).send({
        msg: '服务器没有该文件',
      });
    }

    const disp = `attachment; filename*=UTF-8''${url};`;
    const len = file.size;

    // 解析 Range 请求头以支持断点续传
    const range = req.headers['range'];
    if (typeof range === 'string') {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      let start = 0;
      let end = len - 1;
      if (match) {
        if (match[1] !== '') start = Math.max(0, parseInt(match[1], 10));
        if (match[2] !== '') end = Math.min(len - 1, parseInt(match[2], 10));
      }
      if (Number.isNaN(start) || start < 0) start = 0;
      if (Number.isNaN(end) || end < start) end = len - 1;

      const stream = await this.fileService.getFileStream(
        decodeURIComponent(url),
        start,
        end,
      );

      res.status(206);
      res.setHeader('Content-Disposition', disp);
      res.setHeader('Content-Type', 'binary/octet-stream');
      res.setHeader('Content-Range', `bytes ${start}-${end}/${len}`);
      res.setHeader('Content-Length', end - start + 1);
      res.setHeader('Accept-Ranges', 'bytes');

      // 将文件流通过管道响应给客户端
      stream.pipe(res);
    } else {
      const stream = await this.fileService.getFileStream(
        decodeURIComponent(url),
      );
      res.setHeader('Content-Disposition', disp);
      res.setHeader('Content-Type', 'binary/octet-stream');
      res.setHeader('content-length', len);
      res.setHeader('Accept-Ranges', 'bytes');

      // 将文件流通过管道响应给客户端
      stream.pipe(res);
    }
  }
}
