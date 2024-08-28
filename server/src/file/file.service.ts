import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Readable, PassThrough } from 'stream';
import { pipeline } from 'stream/promises';
import { FileDocument } from './schema/file.dto';
import { FileChunkDocument } from './schema/fileChunk.dto';

@Injectable()
export class FileService {
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
    const fileChunk = new this.fileChunkModel({ chunk, hash });
    return fileChunk.save();
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
    const file = await this.findFileByHash(hash);
    return file.chunksLength === file.chunks.length;
  }

  async generateAndSetFileUrl(hash: string) {
    const file = await this.findFileByHash(hash);
    const { fileHash, name } = file;
    const index = name.lastIndexOf('.');
    const str = `_${fileHash.slice(0, 16)}`;
    const url = name.slice(0, index) + str + name.slice(index);
    file.url = url;
    return file.save();
  }

  async addMissingChunks(hash: string): Promise<void> {
    const file = await this.findFileByHash(hash);
    const { chunksLength, chunks } = file;

    const missingChunks = [];
    for (let i = 0; i < chunksLength; i++) {
      if (!chunks.some((chunk) => chunk.index === i)) {
        missingChunks.push({ hash, index: i });
      }
    }

    if (missingChunks.length > 0) {
      await this.fileModel.updateOne(
        { fileHash: hash },
        { $push: { chunks: { $each: missingChunks } } },
      );
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
    const updatedFile = await this.fileModel
      .findOneAndUpdate(
        { token },
        { $push: { chunks: { hash, index } } },
        { new: true },
      )
      .exec();

    if (!updatedFile) {
      throw new NotFoundException(`File with token ${token} not found`);
    }

    return updatedFile;
  }

  async getFileStream(url: string): Promise<PassThrough> {
    // 根据 URL 查找文件，只获取 chunks 字段，并使用 lean() 返回普通 JavaScript 对象
    const file = await this.fileModel.findOne({ url }, { chunks: 1 }).lean();
    if (!file) {
      // 如果文件不存在，抛出 NotFoundException
      throw new NotFoundException(`File with url ${url} not found`);
    }
    // 获取文件的 chunks 数组
    const fileChunks = file.chunks;
    // 创建一个 PassThrough 流，用于后续数据传输
    const passThrough = new PassThrough();

    // 对 chunks 数组按 index 排序
    const sortedChunks = fileChunks.sort((a, b) => a.index - b.index);
    // console.log(sortedChunks);

    // 定义一个异步生成器函数，用于逐个获取并生成 chunk 数据
    const streamChunks = async function* () {
      for (const chunk of sortedChunks) {
        // 根据 chunk 的 hash 获取对应的 buffer
        const buffer = await this.getChunkBuffer(chunk.hash);
        yield buffer;
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
