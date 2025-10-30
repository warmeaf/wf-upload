import {
  IsInt,
  IsNumber,
  Min,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateFileDto {
  @IsString({ message: '文件名必须是字符串' })
  @IsNotEmpty({ message: '文件名不能为空' })
  name: string;

  @Transform(({ value }) => Number(value))
  @IsNumber({}, { message: '文件大小必须是数字' })
  @Min(0, { message: '文件大小不能小于0' })
  size: number;

  @IsString({ message: '文件类型必须是字符串' })
  @IsNotEmpty({ message: '文件类型不能为空' })
  type: string;

  @Transform(({ value }) => parseInt(value, 10))
  @IsInt({ message: '分片数量必须是整数' })
  @Min(1, { message: '分片数量必须大于等于1' })
  chunksLength: number;

  @IsOptional()
  @IsString({ message: '哈希值必须是字符串' })
  hash?: string;
}

export class PatchHashDto {
  @IsString({ message: 'token必须是字符串' })
  @IsNotEmpty({ message: 'token不能为空' })
  token: string;

  @IsString({ message: '哈希值必须是字符串' })
  @IsNotEmpty({ message: '哈希值不能为空' })
  hash: string;

  @IsEnum(['chunk', 'file'], { message: '类型必须是 "chunk" 或 "file"' })
  type: 'chunk' | 'file';
}

export class UploadChunkDto {
  @IsString({ message: 'token必须是字符串' })
  @IsNotEmpty({ message: 'token不能为空' })
  token: string;

  @IsString({ message: '哈希值必须是字符串' })
  @IsNotEmpty({ message: '哈希值不能为空' })
  hash: string;

  @IsString({ message: '分片索引必须是字符串' })
  @IsNotEmpty({ message: '分片索引不能为空' })
  index: string;
}

export class MergeFileDto {
  @IsString({ message: 'token必须是字符串' })
  @IsNotEmpty({ message: 'token不能为空' })
  token: string;

  @IsString({ message: '哈希值必须是字符串' })
  @IsNotEmpty({ message: '哈希值不能为空' })
  hash: string;
}
