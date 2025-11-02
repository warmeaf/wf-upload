import {
  IsInt,
  IsNumber,
  Min,
  IsString,
  IsNotEmpty,
  IsBoolean,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

// 分块信息DTO
export class ChunkDto {
  @IsInt({ message: '分块索引必须是整数' })
  @Min(0, { message: '分块索引不能小于0' })
  index: number;

  @IsString({ message: '分块哈希值必须是字符串' })
  @IsNotEmpty({ message: '分块哈希值不能为空' })
  hash: string;
}

// 1. 会话创建 (/file/create)
export class CreateFileDto {
  @IsString({ message: '文件名必须是字符串' })
  @IsNotEmpty({ message: '文件名不能为空' })
  fileName: string;

  @IsString({ message: '文件类型必须是字符串' })
  @IsNotEmpty({ message: '文件类型不能为空' })
  fileType: string;

  @Transform(({ value }) => Number(value))
  @IsNumber({}, { message: '文件大小必须是数字' })
  @Min(0, { message: '文件大小不能小于0' })
  fileSize: number;

  @Transform(({ value }) => parseInt(value, 10))
  @IsInt({ message: '分块数量必须是整数' })
  @Min(1, { message: '分块数量必须大于等于1' })
  chunksLength: number;
}

// 2. 分块/文件状态检查 (/file/patchHash)
export class PatchHashDto {
  @IsString({ message: 'token必须是字符串' })
  @IsNotEmpty({ message: 'token不能为空' })
  token: string;

  @IsString({ message: '哈希值必须是字符串' })
  @IsNotEmpty({ message: '哈希值不能为空' })
  hash: string;

  @IsBoolean({ message: 'isChunk必须是布尔值' })
  isChunk: boolean;
}

// 3. 分块上传 (/file/uploadChunk)
export class UploadChunkDto {
  @IsString({ message: 'token必须是字符串' })
  @IsNotEmpty({ message: 'token不能为空' })
  token: string;

  @IsString({ message: '分块哈希值必须是字符串' })
  @IsNotEmpty({ message: '分块哈希值不能为空' })
  hash: string;
}

// 4. 文件合并 (/file/merge)
export class MergeFileDto {
  @IsString({ message: 'token必须是字符串' })
  @IsNotEmpty({ message: 'token不能为空' })
  token: string;

  @IsString({ message: '文件哈希值必须是字符串' })
  @IsNotEmpty({ message: '文件哈希值不能为空' })
  fileHash: string;

  @IsString({ message: '文件名必须是字符串' })
  @IsNotEmpty({ message: '文件名不能为空' })
  fileName: string;

  @Transform(({ value }) => parseInt(value, 10))
  @IsInt({ message: '分块数量必须是整数' })
  @Min(1, { message: '分块数量必须大于等于1' })
  chunksLength: number;

  @IsArray({ message: 'chunks必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => ChunkDto)
  chunks: ChunkDto[];
}
