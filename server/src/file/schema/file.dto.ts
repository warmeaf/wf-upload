import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// 分块信息接口
export interface ChunkInfo {
  index: number; // 分块的序列号
  hash: string; // 分块的哈希值
}

@Schema()
export class FileDocument extends Document {
  @Prop({ required: true })
  token: string;

  @Prop({ required: true })
  fileName: string;

  @Prop({ required: true })
  fileType: string;

  @Prop({ required: true })
  fileSize: number;

  @Prop({ required: true })
  chunksLength: number;

  @Prop({ default: '' })
  fileHash: string;

  @Prop({
    type: [
      {
        index: { type: Number, required: true },
        hash: { type: String, required: true },
      },
    ],
    default: [],
  })
  chunks: ChunkInfo[];

  @Prop({ default: '' })
  url: string;
}

export const FileSchema = SchemaFactory.createForClass(FileDocument);
