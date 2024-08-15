import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FileController } from './file.controller';
import { FileService } from './file.service';
import { UniqueCodeService } from '../unique-code/unique-code.service';
import { FileChunk, FileChunkSchema } from './file.dto';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FileChunk.name, schema: FileChunkSchema, collection: 'chunks' },
    ]),
  ],
  controllers: [FileController],
  providers: [FileService, UniqueCodeService],
})
export class FileModule {}
