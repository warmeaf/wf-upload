import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FileChunk, FileChunkDocument } from './file.dto';

@Injectable()
export class FileService {
  constructor(
    @InjectModel(FileChunk.name)
    private fileChunkModel: Model<FileChunkDocument>,
  ) {}

  async saveChunk(chunk: Buffer, hash: string): Promise<FileChunkDocument> {
    const fileChunk = new this.fileChunkModel({ chunk, hash });
    return fileChunk.save();
  }
}
