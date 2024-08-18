import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FileController } from './file.controller';
import { FileService } from './file.service';
import { UniqueCodeService } from '../unique-code/unique-code.service';
import { FileDocument, FileSchema } from './schema/file.dto';
import { FileChunkDocument, FileChunkSchema } from './schema/fileChunk.dto';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FileDocument.name, schema: FileSchema, collection: 'file' },
      {
        name: FileChunkDocument.name,
        schema: FileChunkSchema,
        collection: 'chunks',
      },
    ]),
  ],
  controllers: [FileController],
  providers: [FileService, UniqueCodeService],
})
export class FileModule {}
