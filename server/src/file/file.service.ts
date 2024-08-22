import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Readable, PassThrough } from 'stream';
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

  async saveChunk(chunk: Buffer, hash: string): Promise<FileChunkDocument> {
    const fileChunk = new this.fileChunkModel({ chunk, hash });
    return fileChunk.save();
  }

  async checkChunkHash(hash: string): Promise<boolean> {
    const exists = await this.fileChunkModel.exists({ hash });
    return Boolean(exists);
  }

  async checkFileHah(hash: string) {
    const file = await this.fileModel.findOne({ fileHash: hash }).exec();
    if (file) {
      return true;
    } else {
      return false;
    }
  }

  async getFileByUrl(url: string) {
    return await this.fileModel.findOne({
      url,
    });
  }

  async deleteFile(token: string) {
    await this.fileModel.deleteOne({ token }).exec();
  }

  async setFileHash(token: string, hash: string) {
    const file = await this.fileModel.findOne({ token }).exec();

    if (!file) {
      return null; // 或者抛出错误，根据实际情况决定
    }

    file.fileHash = hash;

    return file.save();
  }

  async checkFileChunksLength(hash: string): Promise<Boolean | null> {
    const file = await this.fileModel.findOne({ fileHash: hash }).exec();
    if (!file) {
      return null; // 或者抛出错误，根据实际情况决定
    }

    return file.chunksLength === file.chunks.length;
  }

  async setUrl(hash: string) {
    const file = await this.fileModel.findOne({ fileHash: hash }).exec();
    if (!file) {
      return null; // 或者抛出错误，根据实际情况决定
    }
    const { fileHash, name } = file;
    const index = name.lastIndexOf('.');
    const str = `_${fileHash.slice(0, 16)}`;
    const url = name.slice(0, index) + str + name.slice(index);
    file.url = url;

    return file.save();
  }

  async completeFileChunks(hash: string) {
    const file = await this.fileModel.findOne({ fileHash: hash }).exec();
    const { chunksLength, chunks } = file;
    for (let i = 0, len = chunksLength; i < len; i++) {
      const hasChunk = chunks.find((chunk) => chunk.index == i);
      if (!hasChunk) {
        file.chunks.push({ hash, index: i });
        file.save();
      }
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

  async pushFileChunks(
    token: string,
    hash: string,
    index: number,
  ): Promise<FileDocument | null> {
    const file = await this.fileModel.findOne({ token }).exec();

    if (!file) {
      return null; // 或者抛出错误，根据实际情况决定
    }

    file.chunks.push({ hash, index });

    return file.save();
  }

  async getFileStream(url: string) {
    const file = await this.fileModel.findOne({ url });
    const fileChunks = file.chunks;
    const passThrough = new PassThrough();

    const sortedChunks = fileChunks.sort((a, b) => a.index - b.index);
    // console.log(sortedChunks);

    // 逐个顺序处理分片
    this.streamChunksSequentially({ sortedChunks, passThrough }).then(() => {
      passThrough.end(); // 所有分片流完成后结束流
    });

    return passThrough;
  }

  private async streamChunksSequentially(payload): Promise<void> {
    const { sortedChunks, passThrough } = payload;
    for (const chunk of sortedChunks) {
      const buffer = await this.getChunkBuffer(chunk.hash);
      const chunkStream = this.bufferToStream(buffer);

      // 等待当前分片流结束再处理下一个分片
      await new Promise<void>((resolve) => {
        // console.log('run', chunk.index);
        chunkStream.pipe(passThrough, { end: false });
        chunkStream.on('end', resolve);
      });
    }
  }

  private async getChunkBuffer(hash: string): Promise<Buffer> {
    // 根据 chunkId 从数据库或其他存储中获取分片数据
    const chunk = await this.fileChunkModel.findOne({ hash });
    if (!chunk || !chunk.chunk) {
      throw new Error('Chunk not found');
    }
    return Buffer.from(chunk.chunk.buffer);
  }

  private bufferToStream(buffer: Buffer): Readable {
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null); // 表示流的结束
    return readable;
  }
}
