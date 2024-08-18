import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FileController } from './file.controller';
import { FileService } from './file.service';
import { UniqueCodeService } from '../unique-code/unique-code.service';
import { FileDocument, FileSchema } from './schema/file.dto';
import { FileChunkDocument, FileChunkSchema } from './schema/fileChunk.dto';
import { UploadDocument, UploadSchema } from './schema/upload.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FileDocument.name, schema: FileSchema, collection: 'file' },
      {
        name: FileChunkDocument.name,
        schema: FileChunkSchema,
        collection: 'chunks',
      },
      {
        name: UploadDocument.name,
        schema: UploadSchema,
        collection: 'file',
      },
    ]),
  ],
  controllers: [FileController],
  providers: [FileService, UniqueCodeService],
})
export class FileModule {}
