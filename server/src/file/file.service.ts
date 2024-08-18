import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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

  async patchHashChunk(hash: string): Promise<boolean> {
    const exists = await this.fileChunkModel.exists({ hash });
    return Boolean(exists);
  }

  async setFileHash(token: string, hash: string) {
    const file = await this.fileModel.findOne({ token }).exec();

    if (!file) {
      return null; // 或者抛出错误，根据实际情况决定
    }

    file.hash = hash;

    return file.save();
  }

  async createFile(
    token: string,
    name: string,
    size: string,
    type: string,
    chunksLength: number,
    hash: string = '',
    chunks: [] = [],
    url: string = '',
  ) {
    const fileChunk = new this.fileModel({
      token,
      name,
      size,
      type,
      chunksLength,
      hash,
      chunks,
      url,
    });
    return fileChunk.save();
  }

  async updateChunk(token: string, hash: string, index: number) {
    const file = await this.fileModel.findOne({ token }).exec();

    if (!file) {
      return null; // 或者抛出错误，根据实际情况决定
    }

    file.chunks.push({ hash, index });

    return file.save();
  }
}
