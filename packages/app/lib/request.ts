import type { Chunk } from "./chunk";
import { ChunkSplitor } from "./ChunkSplitor";
import { MultiThreadSplitor } from "./MutilThreadSplitor";
import { Task, TaskQueue } from "@wf-upload/utils";
import { EventEmitter } from "@wf-upload/utils";

export interface RequestStrategy {
  // 文件创建请求，返回token
  createFile(file: File): Promise<string>;
  // 分片上传请求
  uploadChunk(chunk: Chunk): Promise<void>;
  // 文件合并请求，返回文件url
  mergeFile(token: string): Promise<string>;
  // hash校验请求
  patchHash<T extends "file" | "chunk">(
    token: string,
    hash: string,
    type: T
  ): Promise<
    T extends "file"
      ? { hasFile: boolean }
      : { hasFile: boolean; rest: number[]; url: string }
  >;
}

export class DefaultRequestStrategy implements RequestStrategy {
  // 文件创建请求，返回token
  async createFile(file: File): Promise<string> {
    // 发送文件创建请求
    // 这里应该实现实际的文件创建逻辑
    console.log("Creating file:", file.name);
    return "upload-token-" + Math.random().toString(36).slice(2, 9);
  }

  // 分片上传请求
  async uploadChunk(chunk: Chunk): Promise<void> {
    // 发送分片上传请求
    // 这里应该实现实际的分片上传逻辑
    console.log("Uploading chunk:", chunk.index);
  }

  // 文件合并请求，返回文件url
  async mergeFile(token: string): Promise<string> {
    // 发送文件合并请求
    // 这里应该实现实际的文件合并逻辑
    console.log("Merging file with token:", token);
    return "https://example.com/merged-file-" + token;
  }

  // hash校验请求
  async patchHash<T extends "file" | "chunk">(
    token: string,
    hash: string,
    type: T
  ): Promise<
    T extends "file"
      ? { hasFile: boolean; rest: number[]; url: string }
      : { hasFile: boolean; rest: number[]; url: string }
  > {
    // 发送hash校验请求
    // 这里应该实现实际的hash校验逻辑
    console.log("Checking hash:", hash, "for", type, token);
    if (type === "file") {
      return { hasFile: false } as any;
    } else {
      return { hasFile: false, rest: [], url: "" } as any;
    }
  }
}

export class UploadController extends EventEmitter<"end"> {
  private requestStrategy: RequestStrategy;
  private splitStrategy: ChunkSplitor;
  private taskQueue: TaskQueue;
  private file: File;
  private token: string;

  constructor(
    file: File,
    requestStrategy?: RequestStrategy,
    splitStrategy?: ChunkSplitor
  ) {
    super();
    this.file = file;
    this.requestStrategy = requestStrategy || new DefaultRequestStrategy();
    this.splitStrategy =
      splitStrategy || new MultiThreadSplitor(this.file, 1024 * 1024 * 5);
    this.taskQueue = new TaskQueue();
    this.token = "";
  }

  async init() {
    this.token = await this.requestStrategy.createFile(this.file);
    console.log("token", this.token);
    this.splitStrategy.on("chunks", this.handleChunks.bind(this));
    this.splitStrategy.on("wholeHash", this.handleWholeHash.bind(this));
  }

  private handleChunks(chunks: Chunk[]) {
    console.log("chunks", chunks);
    chunks.forEach((chunk) => {
      this.taskQueue.addAndStart(new Task(this.uploadChunk.bind(this), chunk));
    });
  }

  private async uploadChunk(chunk: Chunk) {
    // return new Promise((resolve) => {
    //   setTimeout(() => {
    //     console.log(chunk.hash);
    //     resolve(1);
    //   }, 2000);
    // });
    const resp = await this.requestStrategy.patchHash(
      this.token,
      chunk.hash,
      "chunk"
    );
    if (resp.hasFile) {
      return;
    }
    await this.requestStrategy.uploadChunk(chunk);
  }

  private async handleWholeHash(hash: string) {
    console.log("wholeHash", hash);
    const resp = await this.requestStrategy.patchHash<"file">(
      this.token,
      hash,
      "file"
    );
    if (resp.hasFile) {
      this.emit("end", resp);
    }
  }

  async start() {
    await this.init();
    this.splitStrategy.split();
  }
}
