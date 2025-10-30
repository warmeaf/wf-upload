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
  Logger,
  HttpStatus,
  HttpException,
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
import {
  CreateFileResponse,
  PatchHashResponse,
  MergeResponse,
} from './response.types';

@Controller('file')
export class FileController {
  private readonly logger = new Logger(FileController.name);

  constructor(private readonly fileService: FileService) {}

  @Inject(UniqueCodeService)
  private uniqueCodeService: UniqueCodeService;

  // 创建文件
  @Post('create')
  async create(@Body() body: CreateFileDto): Promise<CreateFileResponse> {
    const startTime = Date.now();
    try {
      const token = this.uniqueCodeService.generateUniqueCode();
      if (!token) {
        this.logger.error('Failed to generate unique token');
        throw new HttpException(
          'Failed to generate token',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
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

      const duration = Date.now() - startTime;
      this.logger.log(
        `File created: name=${name}, size=${size}, chunks=${chunksLength}, token=${token}, duration: ${duration}ms`,
      );

      return {
        status: 'ok',
        token,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `Failed to create file: name=${body.name}, duration: ${duration}ms`,
        error,
      );
      throw error;
    }
  }

  // hash 校验
  @Post('patchHash')
  async patchHash(@Body() body: PatchHashDto): Promise<PatchHashResponse> {
    const startTime = Date.now();
    try {
      const { token, hash, type } = body;

      const valid = this.uniqueCodeService.verifyUniqueCode(token);
      if (!valid) {
        this.logger.warn(`Invalid token for patchHash: ${token}`);
        return {
          status: 'error',
          message: 'Invalid token',
        };
      }

      if (type === 'chunk') {
        const exists = await this.fileService.checkChunkExists(hash);
        const duration = Date.now() - startTime;
        this.logger.log(
          `Chunk hash check: hash=${hash}, exists=${exists}, duration: ${duration}ms`,
        );

        return { status: 'ok', hasChunk: exists };
      } else if (type === 'file') {
        let url = '';
        const isHasFile = await this.fileService.checkFileExists(hash);
        if (isHasFile) {
          await this.fileService.deleteFileByToken(token);
          const file = await this.fileService.getFileByHash(hash);
          url = file.url;
        }

        const duration = Date.now() - startTime;
        this.logger.log(
          `File hash check: hash=${hash}, exists=${isHasFile}, url=${url}, duration: ${duration}ms`,
        );

        return {
          status: 'ok',
          hasFile: isHasFile,
          url,
        };
      } else {
        this.logger.warn(`Invalid type for patchHash: ${type}`);
        return {
          status: 'error',
          message: 'Invalid type',
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `Failed to check hash: hash=${body.hash}, type=${body.type}, duration: ${duration}ms`,
        error,
      );
      return {
        status: 'error',
        message: 'Hash check failed',
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
    const startTime = Date.now();
    try {
      if (!blob || !blob.buffer) {
        this.logger.error(
          `No blob provided for chunk upload: token=${chunk.token}, hash=${chunk.hash}`,
        );
        return response.status(400).json({
          status: 'error',
          message: 'No file data provided',
        });
      }

      await this.fileService.saveChunk(blob.buffer, chunk.hash);
      await this.fileService.addChunkToFile(
        chunk.token,
        chunk.hash,
        Number(chunk.index),
      );

      const duration = Date.now() - startTime;
      this.logger.log(
        `Chunk uploaded: token=${chunk.token}, hash=${chunk.hash}, index=${chunk.index}, size=${blob.buffer.length}, duration: ${duration}ms`,
      );

      return response.status(200).json({
        status: 'ok',
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `Failed to upload chunk: token=${chunk.token}, hash=${chunk.hash}, duration: ${duration}ms`,
        error,
      );
      return response.status(500).json({
        status: 'error',
        message: 'Chunk upload failed',
      });
    }
  }

  // 合并文件
  @Post('merge')
  async mergeFile(@Body() body: MergeFileDto): Promise<MergeResponse> {
    const startTime = Date.now();
    try {
      const { token, hash } = body;
      let url = '';

      this.logger.log(`File merge started: token=${token}, hash=${hash}`);

      await this.fileService.updateFileHash(token, hash);
      const valid = await this.fileService.isFileComplete(hash);

      if (valid) {
        await this.fileService.generateAndSetFileUrl(hash);
        const file = await this.fileService.getFileByHash(hash);
        url = file.url;

        const duration = Date.now() - startTime;
        this.logger.log(
          `File merged successfully: hash=${hash}, url=${url}, duration: ${duration}ms`,
        );

        return {
          status: 'ok',
          url,
        };
      } else {
        // 表示这个文件上传之前中断过（比如上传过程中页面被刷新了）
        // 查找已存储的相同文件 hash 的记录，如果该记录中的分片集合完整则补充到当前会话的分片集合
        await this.fileService.addMissingChunks(hash);
        await this.fileService.generateAndSetFileUrl(hash);
        const file = await this.fileService.getFileByHash(hash);
        url = file.url;

        const duration = Date.now() - startTime;
        this.logger.log(
          `File merge completed with missing chunks recovered: hash=${hash}, url=${url}, duration: ${duration}ms`,
        );

        return {
          status: 'ok',
          url,
          message: 'Completed with missing chunks recovered',
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `Failed to merge file: token=${body.token}, hash=${body.hash}, duration: ${duration}ms`,
        error,
      );
      return {
        status: 'error',
        url: '',
        message: 'File merge failed',
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
