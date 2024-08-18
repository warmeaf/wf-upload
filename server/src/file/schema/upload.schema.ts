import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export interface BaseChunk {
  hash: string; // 分片的hash值
  index: number; // 分片在文件中的索引
}

@Schema()
export class UploadDocument extends Document {
  @Prop()
  token: string;

  @Prop()
  chunk: BaseChunk[];
}

export const UploadSchema = SchemaFactory.createForClass(UploadDocument);