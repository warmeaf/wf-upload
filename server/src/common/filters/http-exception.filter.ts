import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { BusinessException } from '../errors/business-exception';
import { ErrorCode } from '../errors/error-codes.enum';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string;
    let errorCode: ErrorCode | undefined;

    if (exception instanceof BusinessException) {
      // 业务异常，使用统一的错误码格式
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse() as {
        errorCode: ErrorCode;
        message: string;
      };
      errorCode = exceptionResponse.errorCode;
      message = exceptionResponse.message;
    } else if (exception instanceof HttpException) {
      // NestJS标准异常
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        message = (exceptionResponse as any).message || exception.message;
        // 如果异常响应中包含errorCode，使用它
        errorCode = (exceptionResponse as any).errorCode;
      } else {
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      // 普通错误
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = exception.message;
      errorCode = ErrorCode.INTERNAL_SERVER_ERROR;
    } else {
      // 未知错误
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
      errorCode = ErrorCode.INTERNAL_SERVER_ERROR;
    }

    // 记录错误日志
    this.logger.error(
      `HTTP Exception: ${request.method} ${request.url} - Status: ${status} - ErrorCode: ${errorCode} - Message: ${message}`,
      exception instanceof Error ? exception.stack : exception,
    );

    // 对于文件相关的API，返回统一的错误格式（包含错误码）
    if (request.url.startsWith('/file/')) {
      response.status(status).json({
        code: status,
        errorCode: errorCode || ErrorCode.INTERNAL_SERVER_ERROR,
        message: message,
      });
    } else {
      // 其他API使用NestJS标准错误格式（包含错误码）
      response.status(status).json({
        statusCode: status,
        errorCode: errorCode || ErrorCode.INTERNAL_SERVER_ERROR,
        timestamp: new Date().toISOString(),
        path: request.url,
        message: message,
      });
    }
  }
}
