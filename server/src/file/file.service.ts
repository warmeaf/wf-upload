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
}
