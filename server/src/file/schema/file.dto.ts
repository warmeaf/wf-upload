import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import type { BaseChunk } from '../type';

@Schema()
export class FileDocument extends Document {
  @Prop()
  token: string;

  @Prop()
  name: string;

  /**
   * 文件的 hash 值'
   */
  @Prop()
  hash: string;

  @Prop()
  size: string;

  @Prop()
  type: string;

  @Prop()
  chunksLength: number;

  @Prop()
  chunks: BaseChunk[];

  @Prop()
  url: string;
}

export const FileSchema = SchemaFactory.createForClass(FileDocument);
