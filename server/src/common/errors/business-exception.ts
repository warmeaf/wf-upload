import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode, ErrorMessages } from './error-codes.enum';

/**
 * 业务异常类
 * 统一处理业务逻辑错误，包含错误码和错误消息
 */
export class BusinessException extends HttpException {
  public readonly errorCode: ErrorCode;
  public readonly customMessage?: string;

  constructor(
    errorCode: ErrorCode,
    httpStatus: HttpStatus = HttpStatus.BAD_REQUEST,
    customMessage?: string,
  ) {
    const message = customMessage || ErrorMessages[errorCode];
    super(
      {
        errorCode,
        message,
      },
      httpStatus,
    );
    this.errorCode = errorCode;
    this.customMessage = customMessage;
  }

  /**
   * 创建内部服务器错误
   */
  static internalServerError(
    errorCode: ErrorCode = ErrorCode.INTERNAL_SERVER_ERROR,
    customMessage?: string,
  ): BusinessException {
    return new BusinessException(
      errorCode,
      HttpStatus.INTERNAL_SERVER_ERROR,
      customMessage,
    );
  }

  /**
   * 创建参数错误
   */
  static invalidParameter(
    errorCode: ErrorCode = ErrorCode.INVALID_PARAMETER,
    customMessage?: string,
  ): BusinessException {
    return new BusinessException(
      errorCode,
      HttpStatus.BAD_REQUEST,
      customMessage,
    );
  }
}

