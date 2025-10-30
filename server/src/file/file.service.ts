import {
  Injectable,
  NotFoundException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Readable, PassThrough } from 'stream';
import { pipeline } from 'stream/promises';
import { FileDocument } from './schema/file.dto';
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

  private async findFileByHash(hash: string): Promise<FileDocument> {
    const file = await this.fileModel.findOne({ fileHash: hash }).exec();
    if (!file) {
      throw new NotFoundException(`File with hash ${hash} not found`);
    }
    return file;
  }

  private async findFileByToken(token: string): Promise<FileDocument> {
    const file = await this.fileModel.findOne({ token }).exec();
    if (!file) {
      throw new NotFoundException(`File with token ${token} not found`);
    }
    return file;
  }

  private async getChunkBuffer(hash: string): Promise<Buffer> {
    // 根据 chunkId 从数据库或其他存储中获取分片数据
    const chunk = await this.fileChunkModel.findOne({ hash });
    if (!chunk || !chunk.chunk) {
      throw new NotFoundException(`chunk with hash ${hash} not found`);
    }
    return Buffer.from(chunk.chunk.buffer);
  }

  async saveChunk(chunk: Buffer, hash: string): Promise<FileChunkDocument> {
    const startTime = Date.now();
    try {
      // 检查分片是否已存在，避免重复存储
      const existingChunk = await this.fileChunkModel.findOne({ hash }).exec();
      if (existingChunk) {
        this.logger.log(`Chunk already exists, skipping save: ${hash}`);
        return existingChunk;
      }

      const fileChunk = new this.fileChunkModel({ chunk, hash });
      const result = await fileChunk.save();

      const duration = Date.now() - startTime;
      this.logger.log(
        `Chunk saved successfully: ${hash}, size: ${chunk.length}, duration: ${duration}ms`,
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `Failed to save chunk: ${hash}, duration: ${duration}ms`,
        error,
      );
      throw new InternalServerErrorException(`Failed to save chunk: ${hash}`);
    }
  }

  async checkChunkExists(hash: string): Promise<boolean> {
    const count = await this.fileChunkModel.countDocuments({ hash }).limit(1);
    return count > 0;
  }

  async checkFileExists(hash: string): Promise<boolean> {
    const count = await this.fileModel
      .countDocuments({ fileHash: hash })
      .limit(1);
    return count > 0;
  }

  async getFileByUrl(url: string) {
    return await this.fileModel.findOne({
      url,
    });
  }

  async getFileByHash(hash: string) {
    return this.findFileByHash(hash);
  }

  async deleteFileByToken(token: string) {
    await this.fileModel.deleteOne({ token }).exec();
  }

  async updateFileHash(token: string, hash: string) {
    const file = await this.findFileByToken(token);
    file.fileHash = hash;
    return file.save();
  }

  async isFileComplete(hash: string): Promise<boolean> {
    const startTime = Date.now();
    try {
      const file = await this.findFileByHash(hash);

      if (!file.chunks || file.chunks.length === 0) {
        this.logger.warn(`File has no chunks: hash=${hash}`);
        return false;
      }

      const isComplete = file.chunksLength === file.chunks.length;
      const duration = Date.now() - startTime;

      this.logger.log(
        `File completeness check: hash=${hash}, chunks=${file.chunks.length}/${file.chunksLength}, complete=${isComplete}, duration: ${duration}ms`,
      );

      return isComplete;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `Failed to check file completeness: hash=${hash}, duration: ${duration}ms`,
        error,
      );
      return false;
    }
  }

  async generateAndSetFileUrl(hash: string) {
    const startTime = Date.now();
    try {
      const file = await this.findFileByHash(hash);
      const { fileHash, name } = file;

      const index = name.lastIndexOf('.');
      const str = `_${fileHash.slice(0, 16)}`;
      const url = name.slice(0, index) + str + name.slice(index);

      file.url = url;
      const result = await file.save();

      const duration = Date.now() - startTime;
      this.logger.log(
        `File URL generated: hash=${hash}, url=${url}, duration: ${duration}ms`,
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `Failed to generate file URL: hash=${hash}, duration: ${duration}ms`,
        error,
      );
      throw error;
    }
  }

  async addMissingChunks(hash: string): Promise<void> {
    const startTime = Date.now();
    try {
      const file = await this.findFileByHash(hash);
      const { chunksLength, chunks } = file;

      // 1. 找出缺失的分片索引
      const missingIndexes = [];
      for (let i = 0; i < chunksLength; i++) {
        if (!chunks.some((chunk) => chunk.index === i)) {
          missingIndexes.push(i);
        }
      }

      if (missingIndexes.length > 0) {
        this.logger.log(
          `Found ${missingIndexes.length} missing chunks for hash=${hash}, indexes: [${missingIndexes.join(', ')}]`,
        );

        // 2. 查找其他具有相同 fileHash 且分片集合完整的文件记录
        const completeFile = await this.fileModel.findOne({
          fileHash: hash,
          $expr: { $eq: [{ $size: '$chunks' }, '$chunksLength'] },
        });

        if (completeFile) {
          // 3. 从完整文件中获取缺失的分片信息
          const missingChunks = completeFile.chunks.filter((chunk) =>
            missingIndexes.includes(chunk.index),
          );

          if (missingChunks.length > 0) {
            // 4. 将缺失的分片添加到当前文件
            await this.fileModel.updateOne(
              { fileHash: hash },
              { $push: { chunks: { $each: missingChunks } } },
            );

            const duration = Date.now() - startTime;
            this.logger.log(
              `Successfully added ${missingChunks.length} missing chunks from complete file for hash=${hash}, duration: ${duration}ms`,
            );
          } else {
            this.logger.warn(
              `Complete file found but no matching chunks for missing indexes: hash=${hash}`,
            );
          }
        } else {
          this.logger.warn(
            `No complete file found with same hash=${hash}, cannot recover missing chunks`,
          );
        }
      } else {
        const duration = Date.now() - startTime;
        this.logger.log(
          `No missing chunks found for hash=${hash}, duration: ${duration}ms`,
        );
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `Failed to add missing chunks for hash=${hash}, duration: ${duration}ms`,
        error,
      );
      throw error;
    }
  }

  async createFile(
    token: string,
    name: string,
    size: number,
    type: string,
    chunksLength: number,
    fileHash: string = '',
    chunks: [] = [],
    url: string = '',
  ): Promise<FileDocument> {
    const fileChunk = new this.fileModel({
      token,
      name,
      size,
      type,
      chunksLength,
      fileHash,
      chunks,
      url,
    });
    return fileChunk.save();
  }

  async addChunkToFile(
    token: string,
    hash: string,
    index: number,
  ): Promise<FileDocument> {
    const startTime = Date.now();
    try {
      // 检查分片是否已经添加到文件中，避免重复
      const existingFile = await this.fileModel
        .findOne({
          token,
          'chunks.hash': hash,
        })
        .exec();

      if (existingFile) {
        this.logger.log(
          `Chunk already added to file: token=${token}, hash=${hash}`,
        );
        return existingFile;
      }

      const updatedFile = await this.fileModel
        .findOneAndUpdate(
          { token },
          { $push: { chunks: { hash, index, uploadedAt: new Date() } } },
          { new: true },
        )
        .exec();

      if (!updatedFile) {
        throw new NotFoundException(`File with token ${token} not found`);
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Chunk added to file: token=${token}, hash=${hash}, index=${index}, duration: ${duration}ms`,
      );

      return updatedFile;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `Failed to add chunk to file: token=${token}, hash=${hash}, duration: ${duration}ms`,
        error,
      );
      throw error;
    }
  }

  async getFileStream(
    url: string,
    rangeStart?: number,
    rangeEnd?: number,
  ): Promise<PassThrough> {
    // 根据 URL 查找文件，只获取 chunks 与 size 字段，并使用 lean() 返回普通 JavaScript 对象
    const file = await this.fileModel
      .findOne({ url }, { chunks: 1, size: 1 })
      .lean();
    if (!file) {
      // 如果文件不存在，抛出 NotFoundException
      throw new NotFoundException(`File with url ${url} not found`);
    }
    // 获取文件的 chunks 数组
    const fileChunks = file.chunks;
    const totalSize = file.size;
    // 创建一个 PassThrough 流，用于后续数据传输
    const passThrough = new PassThrough();

    // 对 chunks 数组按 index 排序
    const sortedChunks = fileChunks.sort((a, b) => a.index - b.index);
    // console.log(sortedChunks);

    // 定义一个异步生成器函数，用于逐个获取并生成 chunk 数据
    const streamChunks = async function* () {
      let fileOffset = 0; // 当前分片在文件中的起始偏移量
      for (const chunk of sortedChunks) {
        // 根据 chunk 的 hash 获取对应的 buffer
        const buffer = await this.getChunkBuffer(chunk.hash);
        const chunkStart = fileOffset;
        const chunkEnd = fileOffset + buffer.length - 1;

        if (
          typeof rangeStart === 'number' &&
          typeof rangeEnd === 'number' &&
          rangeStart >= 0 &&
          rangeEnd >= rangeStart &&
          totalSize > 0
        ) {
          // 与请求区间求交集
          if (chunkEnd < rangeStart) {
            // 当前分片在请求范围前面，跳过
            fileOffset += buffer.length;
            continue;
          }
          if (chunkStart > rangeEnd) {
            // 当前分片在请求范围后面，提前结束
            break;
          }
          const sliceStart = Math.max(0, rangeStart - chunkStart);
          const sliceEnd = Math.min(buffer.length - 1, rangeEnd - chunkStart);
          // 仅输出区间内的数据
          yield buffer.subarray(sliceStart, sliceEnd + 1);
        } else {
          // 未指定范围，输出整个分片
          yield buffer;
        }
        fileOffset += buffer.length;
      }
    }.bind(this); // 绑定 this 上下文

    // 使用 pipeline 将生成的 chunks 数据流式传输到 passThrough
    pipeline(Readable.from(streamChunks()), passThrough).catch((err) => {
      // 如果管道操作失败，记录错误并销毁 passThrough 流
      console.error('Pipeline failed', err);
      passThrough.destroy(err);
    });

    // 返回 passThrough 流
    return passThrough;
  }
}
