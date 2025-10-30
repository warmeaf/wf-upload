/**
 * 后端API响应类型定义
 * 与前端types.ts保持一致
 */

// ============ 基础响应类型 ============

export interface BaseResponse {
  status: 'ok' | 'error';
}

export interface ErrorResponse extends BaseResponse {
  status: 'error';
  message: string;
}

// ============ API响应类型 ============

// POST /file/create
export interface CreateFileResponse extends BaseResponse {
  status: 'ok';
  token: string;
}

// POST /file/patchHash
export interface PatchHashChunkResponse extends BaseResponse {
  status: 'ok';
  hasChunk: boolean;
}

export interface PatchHashFileResponse extends BaseResponse {
  status: 'ok';
  hasFile: boolean;
  url?: string;
}

export type PatchHashResponse =
  | PatchHashChunkResponse
  | PatchHashFileResponse
  | ErrorResponse;

// POST /file/uploadChunk
export interface UploadChunkResponse extends BaseResponse {
  status: 'ok';
}

// POST /file/merge
export interface MergeFileResponse extends BaseResponse {
  status: 'ok';
  url: string;
  message?: string;
}

export interface MergeFileErrorResponse extends BaseResponse {
  status: 'error';
  url: '';
  message: string;
}

export type MergeResponse = MergeFileResponse | MergeFileErrorResponse;
