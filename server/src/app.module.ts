import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FileModule } from './file/file.module';

@Module({
  imports: [
    // MongooseModule.forRoot('mongodb://localhost:27017/wf-upload'),
    FileModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
