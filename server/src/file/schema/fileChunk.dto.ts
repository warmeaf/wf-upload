import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class FileChunkDocument extends Document {
  @Prop()
  chunk: Buffer;

  @Prop()
  hash: string;
}

export const FileChunkSchema = SchemaFactory.createForClass(FileChunkDocument);
