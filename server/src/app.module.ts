import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FileModule } from './file/file.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // 让 ConfigModule 成为全局模块
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`, // 根据 NODE_ENV 加载对应的 .env 文件
    }),
    MongooseModule.forRoot('mongodb://localhost:27017/wf-upload'),
    FileModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
