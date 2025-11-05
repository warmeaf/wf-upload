/**
 * 统一错误码枚举
 * 定义系统中所有可能的错误码
 */
export enum ErrorCode {
  // ============ 通用错误 1000-1999 ============
  INTERNAL_SERVER_ERROR = 1000,
  INVALID_PARAMETER = 1001,
  MISSING_PARAMETER = 1002,
  UNAUTHORIZED = 1003,
  FORBIDDEN = 1004,

  // ============ 文件上传相关错误 2000-2999 ============
  FILE_SESSION_CREATE_FAILED = 2000,
  TOKEN_GENERATION_FAILED = 2001,
  INVALID_TOKEN = 2002,
  FILE_NOT_FOUND = 2003,
  CHUNK_NOT_FOUND = 2004,
  CHUNK_SAVE_FAILED = 2005,
  FILE_MERGE_FAILED = 2006,
  CHUNKS_COUNT_MISMATCH = 2007,
  NO_CHUNK_DATA = 2008,
  FILE_HASH_CHECK_FAILED = 2009,
  CHUNK_HASH_CHECK_FAILED = 2010,
}

/**
 * 错误码对应的错误消息映射
 */
export const ErrorMessages: Record<ErrorCode, string> = {
  [ErrorCode.INTERNAL_SERVER_ERROR]: 'Internal server error',
  [ErrorCode.INVALID_PARAMETER]: 'Invalid parameter',
  [ErrorCode.MISSING_PARAMETER]: 'Missing required parameter',
  [ErrorCode.UNAUTHORIZED]: 'Unauthorized',
  [ErrorCode.FORBIDDEN]: 'Forbidden',

  [ErrorCode.FILE_SESSION_CREATE_FAILED]: 'Failed to create file session',
  [ErrorCode.TOKEN_GENERATION_FAILED]: 'Failed to generate token',
  [ErrorCode.INVALID_TOKEN]: 'Invalid token',
  [ErrorCode.FILE_NOT_FOUND]: 'File not found',
  [ErrorCode.CHUNK_NOT_FOUND]: 'Chunk not found',
  [ErrorCode.CHUNK_SAVE_FAILED]: 'Failed to save chunk',
  [ErrorCode.FILE_MERGE_FAILED]: 'File merge failed',
  [ErrorCode.CHUNKS_COUNT_MISMATCH]: 'Chunks count mismatch',
  [ErrorCode.NO_CHUNK_DATA]: 'No chunk data provided',
  [ErrorCode.FILE_HASH_CHECK_FAILED]: 'Failed to check file hash',
  [ErrorCode.CHUNK_HASH_CHECK_FAILED]: 'Failed to check chunk hash',
};

