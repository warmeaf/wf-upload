import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export interface BaseChunk {
  hash: string; // 分片的hash值
  index: number; // 分片在文件中的索引
}

@Schema()
export class FileDocument extends Document {
  @Prop()
  token: string;

  @Prop()
  name: string;

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
