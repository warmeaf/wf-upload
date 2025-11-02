/**
 * 后端API响应类型定义
 * 严格按照README文档中的API响应格式定义
 */

// ============ 基础响应类型 ============

export interface BaseResponse {
  code: number;
}

// ============ API响应类型 ============

// 1. POST /file/create - 会话创建响应
export interface CreateFileResponse extends BaseResponse {
  code: 200;
  token: string;
}

// 2. POST /file/patchHash - 分块/文件状态检查响应
export interface PatchHashResponse extends BaseResponse {
  code: 200;
  exists: boolean;
}

// 3. POST /file/uploadChunk - 分块上传响应
export interface UploadChunkResponse extends BaseResponse {
  code: 200;
  success: boolean;
}

// 4. POST /file/merge - 文件合并响应
export interface MergeFileResponse extends BaseResponse {
  code: 200;
  url: string;
}
