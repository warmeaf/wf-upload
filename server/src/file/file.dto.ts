import { Schema, model, Document } from 'mongoose';

export type HashType = 'file' | 'chunk';
export interface BaseHeader {
  'upload-file-token': string;
}
export interface PatchHashHeader extends BaseHeader {
  'Upload-File-Hash': string;
  'Upload-File-Type': HashType;
}

export interface Chunk {
  blob: Blob; // 分片的二进制数据
  start: number; // 分片的起始位置
  end: number; // 分片的结束位置
  hash: string; // 分片的hash值
  index: number; // 分片在文件中的索引
}

export interface FileChunkDocument extends Document {
  chunk: Buffer;
  hash: string;
}

export const FileChunkSchema = new Schema<FileChunkDocument>({
  chunk: { type: Buffer, required: true },
  hash: { type: String, required: true },
});

export const FileChunk = model<FileChunkDocument>('FileChunk', FileChunkSchema);
