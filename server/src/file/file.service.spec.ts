import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FileService } from './file.service';
import { FileDocument, ChunkInfo } from './schema/file.dto';
import { FileChunkDocument } from './schema/fileChunk.dto';
import { InternalServerErrorException } from '@nestjs/common';

describe('FileService', () => {
  let service: FileService;
  let fileModel: Model<FileDocument>;
  let fileChunkModel: Model<FileChunkDocument>;

  // Mock file model
  const mockFileModel = jest.fn().mockImplementation(function (data: any) {
    this.token = data.token;
    this.fileName = data.fileName;
    this.fileType = data.fileType;
    this.fileSize = data.fileSize;
    this.chunksLength = data.chunksLength;
    this.fileHash = data.fileHash;
    this.chunks = data.chunks;
    this.url = data.url;
    this.save = jest.fn().mockResolvedValue(this);
    return this;
  }) as any;

  mockFileModel.updateOne = jest.fn();
  mockFileModel.countDocuments = jest.fn();

  // Mock file chunk model
  const mockFileChunkModel = jest.fn().mockImplementation(function (data: any) {
    this.chunk = data.chunk;
    this.hash = data.hash;
    this.save = jest.fn().mockResolvedValue(this);
    return this;
  }) as any;

  mockFileChunkModel.findOne = jest.fn();
  mockFileChunkModel.countDocuments = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileService,
        {
          provide: getModelToken(FileDocument.name),
          useValue: mockFileModel,
        },
        {
          provide: getModelToken(FileChunkDocument.name),
          useValue: mockFileChunkModel,
        },
      ],
    }).compile();

    service = module.get<FileService>(FileService);
    fileModel = module.get<Model<FileDocument>>(
      getModelToken(FileDocument.name),
    );
    fileChunkModel = module.get<Model<FileChunkDocument>>(
      getModelToken(FileChunkDocument.name),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createFile', () => {
    it('should create a file document', async () => {
      const token = 'test-token';
      const fileName = 'test.txt';
      const fileType = 'text/plain';
      const fileSize = 1024;
      const chunksLength = 5;

      const mockFileInstance = {
        token,
        fileName,
        fileType,
        fileSize,
        chunksLength,
        fileHash: '',
        chunks: [],
        url: '',
        save: jest.fn().mockResolvedValue({
          token,
          fileName,
          fileType,
          fileSize,
          chunksLength,
          fileHash: '',
          chunks: [],
          url: '',
        }),
      };

      mockFileModel.mockReturnValue(mockFileInstance as any);

      const result = await service.createFile(
        token,
        fileName,
        fileType,
        fileSize,
        chunksLength,
      );

      expect(mockFileModel).toHaveBeenCalledWith({
        token,
        fileName,
        fileType,
        fileSize,
        chunksLength,
        fileHash: '',
        chunks: [],
        url: '',
      });
      expect(mockFileInstance.save).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.token).toBe(token);
      expect(result.fileName).toBe(fileName);
    });

    it('should create file with correct properties', async () => {
      const token = 'test-token-123';
      const fileName = 'document.pdf';
      const fileType = 'application/pdf';
      const fileSize = 2048;
      const chunksLength = 10;

      const mockFileInstance = {
        token,
        fileName,
        fileType,
        fileSize,
        chunksLength,
        fileHash: '',
        chunks: [],
        url: '',
        save: jest.fn().mockResolvedValue({
          token,
          fileName,
          fileType,
          fileSize,
          chunksLength,
          fileHash: '',
          chunks: [],
          url: '',
        }),
      };

      mockFileModel.mockReturnValue(mockFileInstance as any);

      const result = await service.createFile(
        token,
        fileName,
        fileType,
        fileSize,
        chunksLength,
      );

      expect(mockFileModel).toHaveBeenCalledWith({
        token,
        fileName,
        fileType,
        fileSize,
        chunksLength,
        fileHash: '',
        chunks: [],
        url: '',
      });
      expect(mockFileInstance.save).toHaveBeenCalled();
      expect(result.token).toBe(token);
      expect(result.fileName).toBe(fileName);
      expect(result.fileType).toBe(fileType);
      expect(result.fileSize).toBe(fileSize);
      expect(result.chunksLength).toBe(chunksLength);
    });
  });

  describe('checkChunkExists', () => {
    it('should return true when chunk exists', async () => {
      const hash = 'test-hash-123';
      mockFileChunkModel.countDocuments.mockReturnValue({
        limit: jest.fn().mockResolvedValue(1),
      });

      const result = await service.checkChunkExists(hash);

      expect(result).toBe(true);
      expect(mockFileChunkModel.countDocuments).toHaveBeenCalledWith({ hash });
    });

    it('should return false when chunk does not exist', async () => {
      const hash = 'non-existent-hash';
      mockFileChunkModel.countDocuments.mockReturnValue({
        limit: jest.fn().mockResolvedValue(0),
      });

      const result = await service.checkChunkExists(hash);

      expect(result).toBe(false);
    });
  });

  describe('checkFileExists', () => {
    it('should return true when file exists', async () => {
      const hash = 'file-hash-123';
      mockFileModel.countDocuments.mockReturnValue({
        limit: jest.fn().mockResolvedValue(1),
      });

      const result = await service.checkFileExists(hash);

      expect(result).toBe(true);
      expect(mockFileModel.countDocuments).toHaveBeenCalledWith({
        fileHash: hash,
      });
    });

    it('should return false when file does not exist', async () => {
      const hash = 'non-existent-file-hash';
      mockFileModel.countDocuments.mockReturnValue({
        limit: jest.fn().mockResolvedValue(0),
      });

      const result = await service.checkFileExists(hash);

      expect(result).toBe(false);
    });
  });

  describe('saveChunk', () => {
    it('should save a new chunk', async () => {
      const chunk = Buffer.from('test chunk data');
      const hash = 'chunk-hash-123';

      mockFileChunkModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const mockChunkInstance = {
        chunk,
        hash,
        save: jest.fn().mockResolvedValue({ chunk, hash }),
      };

      mockFileChunkModel.mockReturnValue(mockChunkInstance as any);

      await service.saveChunk(chunk, hash);

      expect(mockFileChunkModel.findOne).toHaveBeenCalledWith({ hash });
      expect(mockFileChunkModel).toHaveBeenCalledWith({ chunk, hash });
      expect(mockChunkInstance.save).toHaveBeenCalled();
    });

    it('should skip saving if chunk already exists', async () => {
      const chunk = Buffer.from('test chunk data');
      const hash = 'existing-chunk-hash';

      const existingChunk = { chunk, hash };
      mockFileChunkModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(existingChunk),
      });

      await service.saveChunk(chunk, hash);

      expect(mockFileChunkModel.findOne).toHaveBeenCalledWith({ hash });
    });

    it('should throw InternalServerErrorException on save error', async () => {
      const chunk = Buffer.from('test chunk data');
      const hash = 'chunk-hash-error';

      mockFileChunkModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const mockChunkInstance = {
        chunk,
        hash,
        save: jest.fn().mockRejectedValue(new Error('Database error')),
      };

      mockFileChunkModel.mockReturnValue(mockChunkInstance as any);

      await expect(service.saveChunk(chunk, hash)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('updateFileForMerge', () => {
    it('should update file and return URL', async () => {
      const token = 'test-token';
      const fileHash = 'file-hash-123';
      const fileName = 'test.txt';
      const chunks: ChunkInfo[] = [
        { index: 0, hash: 'chunk-0' },
        { index: 1, hash: 'chunk-1' },
      ];

      mockFileModel.updateOne.mockResolvedValue({
        acknowledged: true,
        modifiedCount: 1,
      });

      const result = await service.updateFileForMerge(
        token,
        fileHash,
        fileName,
        chunks,
      );

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result).toContain(fileHash);
      expect(mockFileModel.updateOne).toHaveBeenCalledWith(
        { token },
        {
          fileHash,
          chunks,
          url: expect.any(String),
        },
      );
    });

    it('should generate correct URL format', async () => {
      const token = 'test-token';
      const fileHash = 'abc123';
      const fileName = 'document.pdf';
      const chunks: ChunkInfo[] = [];

      mockFileModel.updateOne.mockResolvedValue({
        acknowledged: true,
        modifiedCount: 1,
      });

      const result = await service.updateFileForMerge(
        token,
        fileHash,
        fileName,
        chunks,
      );

      expect(result).toBe('document_abc123.pdf');
    });

    it('should handle filename without extension', async () => {
      const token = 'test-token';
      const fileHash = 'xyz789';
      const fileName = 'noextension';
      const chunks: ChunkInfo[] = [];

      mockFileModel.updateOne.mockResolvedValue({
        acknowledged: true,
        modifiedCount: 1,
      });

      const result = await service.updateFileForMerge(
        token,
        fileHash,
        fileName,
        chunks,
      );

      expect(result).toBe('noextension_xyz789');
    });

    it('should throw InternalServerErrorException on update error', async () => {
      const token = 'test-token';
      const fileHash = 'file-hash';
      const fileName = 'test.txt';
      const chunks: ChunkInfo[] = [];

      mockFileModel.updateOne.mockRejectedValue(new Error('Database error'));

      await expect(
        service.updateFileForMerge(token, fileHash, fileName, chunks),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
