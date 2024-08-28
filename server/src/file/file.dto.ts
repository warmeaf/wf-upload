import {
  IsString,
  IsNumber,
  IsInt,
  Min,
  IsEnum,
  IsNotEmpty,
} from 'class-validator';

// 自定义装饰器
function IsRequiredString(message: string) {
  return function (target: any, key: string) {
    IsString({ message: `${message}必须是字符串` })(target, key);
    IsNotEmpty({ message: `${message}不能为空` })(target, key);
  };
}

export class CreateFileDto {
  @IsRequiredString('文件名')
  name: string;

  @IsNumber({}, { message: '文件大小必须是数字' })
  @Min(0, { message: '文件大小不能小于0' })
  size: number;

  @IsRequiredString('文件类型')
  type: string;

  @IsInt({ message: '分片数量必须是整数' })
  @Min(1, { message: '分片数量必须大于等于1' })
  chunksLength: number;
}

export class PatchHashDto {
  @IsRequiredString('令牌')
  token: string;

  @IsRequiredString('哈希值')
  hash: string;

  @IsEnum(['chunk', 'file'], { message: '类型必须是 "chunk" 或 "file"' })
  type: 'chunk' | 'file';
}

export class UploadChunkDto {
  @IsRequiredString('令牌')
  token: string;

  @IsRequiredString('哈希值')
  hash: string;

  @IsNotEmpty()
  index: string;
}

export class MergeFileDto {
  @IsRequiredString('令牌')
  token: string;

  @IsRequiredString('哈希值')
  hash: string;
}
