import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FileDocument, ChunkInfo } from './schema/file.dto';
import { FileChunkDocument } from './schema/fileChunk.dto';

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    @InjectModel(FileChunkDocument.name)
    private fileChunkModel: Model<FileChunkDocument>,
    @InjectModel(FileDocument.name)
    private fileModel: Model<FileDocument>,
  ) {}

  /**
   * 1. 创建文件上传会话
   */
  async createFile(
    token: string,
    fileName: string,
    fileType: string,
    fileSize: number,
    chunksLength: number,
  ): Promise<FileDocument> {
    const file = new this.fileModel({
      token,
      fileName,
      fileType,
      fileSize,
      chunksLength,
      fileHash: '',
      chunks: [],
      url: '',
    });
    return file.save();
  }

  /**
   * 2. 检查分块是否存在
   */
  async checkChunkExists(hash: string): Promise<boolean> {
    const count = await this.fileChunkModel.countDocuments({ hash }).limit(1);
    return count > 0;
  }

  /**
   * 2. 检查文件是否存在
   */
  async checkFileExists(hash: string): Promise<boolean> {
    const count = await this.fileModel
      .countDocuments({ fileHash: hash })
      .limit(1);
    return count > 0;
  }

  /**
   * 3. 保存分块数据
   */
  async saveChunk(chunk: Buffer, hash: string): Promise<void> {
    try {
      // 检查分块是否已存在，避免重复存储
      const existingChunk = await this.fileChunkModel.findOne({ hash }).exec();
      if (existingChunk) {
        this.logger.log(`Chunk already exists, skipping save: ${hash}`);
        return;
      }

      const fileChunk = new this.fileChunkModel({ chunk, hash });
      await fileChunk.save();

      this.logger.log(
        `Chunk saved successfully: ${hash}, size: ${chunk.length}`,
      );
    } catch (error) {
      this.logger.error(`Failed to save chunk: ${hash}`, error);
      throw new InternalServerErrorException(`Failed to save chunk: ${hash}`);
    }
  }

  /**
   * 4. 更新文件记录 - 合并时使用
   */
  async updateFileForMerge(
    token: string,
    fileHash: string,
    fileName: string,
    chunks: ChunkInfo[],
  ): Promise<string> {
    try {
      // 生成文件URL
      const index = fileName.lastIndexOf('.');
      const hashSuffix = `_${fileHash}`;
      const url =
        index === -1
          ? fileName + hashSuffix
          : fileName.slice(0, index) + hashSuffix + fileName.slice(index);

      // 更新文件记录
      await this.fileModel.updateOne(
        { token },
        {
          fileHash,
          chunks,
          url,
        },
      );

      this.logger.log(`File merge completed: token=${token}, url=${url}`);
      return url;
    } catch (error) {
      this.logger.error(
        `Failed to update file for merge: token=${token}`,
        error,
      );
      throw new InternalServerErrorException('File merge failed');
    }
  }
}
