import { Module } from '@nestjs/common';
import { FileController } from './file.controller';
import { FileService } from './file.service';
import { UniqueCodeService } from '../unique-code/unique-code.service';

@Module({
  controllers: [FileController],
  providers: [FileService, UniqueCodeService],
})
export class FileModule {}
