import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { FileController } from './file.controller';
import { FileService } from './file.service';
import { UniqueCodeService } from '../unique-code/unique-code.service';
import {
  CreateFileDto,
  PatchHashDto,
  UploadChunkDto,
  MergeFileDto,
} from './file.dto';

describe('FileController', () => {
  let controller: FileController;
  let fileService: FileService;
  let uniqueCodeService: UniqueCodeService;

  const mockFileService = {
    createFile: jest.fn(),
    checkChunkExists: jest.fn(),
    checkFileExists: jest.fn(),
    saveChunk: jest.fn(),
    updateFileForMerge: jest.fn(),
  };

  const mockUniqueCodeService = {
    generateUniqueCode: jest.fn(),
    verifyUniqueCode: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FileController],
      providers: [
        {
          provide: FileService,
          useValue: mockFileService,
        },
        {
          provide: UniqueCodeService,
          useValue: mockUniqueCodeService,
        },
      ],
    }).compile();

    controller = module.get<FileController>(FileController);
    fileService = module.get<FileService>(FileService);
    uniqueCodeService = module.get<UniqueCodeService>(UniqueCodeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a file session successfully', async () => {
      const createFileDto: CreateFileDto = {
        fileName: 'test.txt',
        fileType: 'text/plain',
        fileSize: 1024,
        chunksLength: 5,
      };

      const mockToken = 'generated-token-123';
      mockUniqueCodeService.generateUniqueCode.mockReturnValue(mockToken);
      mockFileService.createFile.mockResolvedValue({
        token: mockToken,
        fileName: createFileDto.fileName,
      });

      const result = await controller.create(createFileDto);

      expect(result).toEqual({
        code: 200,
        token: mockToken,
      });
      expect(mockUniqueCodeService.generateUniqueCode).toHaveBeenCalled();
      expect(mockFileService.createFile).toHaveBeenCalledWith(
        mockToken,
        createFileDto.fileName,
        createFileDto.fileType,
        createFileDto.fileSize,
        createFileDto.chunksLength,
      );
    });

    it('should throw HttpException when token generation fails', async () => {
      const createFileDto: CreateFileDto = {
        fileName: 'test.txt',
        fileType: 'text/plain',
        fileSize: 1024,
        chunksLength: 5,
      };

      mockUniqueCodeService.generateUniqueCode.mockReturnValue(null);

      await expect(controller.create(createFileDto)).rejects.toThrow(
        HttpException,
      );
      await expect(controller.create(createFileDto)).rejects.toThrow(
        'Failed to generate token',
      );
    });

    it('should throw error when fileService.createFile fails', async () => {
      const createFileDto: CreateFileDto = {
        fileName: 'test.txt',
        fileType: 'text/plain',
        fileSize: 1024,
        chunksLength: 5,
      };

      const mockToken = 'generated-token-123';
      mockUniqueCodeService.generateUniqueCode.mockReturnValue(mockToken);
      mockFileService.createFile.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(controller.create(createFileDto)).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('patchHash', () => {
    it('should check chunk hash and return exists=true', async () => {
      const patchHashDto: PatchHashDto = {
        token: 'valid-token',
        hash: 'chunk-hash-123',
        isChunk: true,
      };

      mockUniqueCodeService.verifyUniqueCode.mockReturnValue(true);
      mockFileService.checkChunkExists.mockResolvedValue(true);

      const result = await controller.patchHash(patchHashDto);

      expect(result).toEqual({
        code: 200,
        exists: true,
      });
      expect(mockUniqueCodeService.verifyUniqueCode).toHaveBeenCalledWith(
        patchHashDto.token,
      );
      expect(mockFileService.checkChunkExists).toHaveBeenCalledWith(
        patchHashDto.hash,
      );
    });

    it('should check file hash and return exists=false', async () => {
      const patchHashDto: PatchHashDto = {
        token: 'valid-token',
        hash: 'file-hash-123',
        isChunk: false,
      };

      mockUniqueCodeService.verifyUniqueCode.mockReturnValue(true);
      mockFileService.checkFileExists.mockResolvedValue(false);

      const result = await controller.patchHash(patchHashDto);

      expect(result).toEqual({
        code: 200,
        exists: false,
      });
      expect(mockFileService.checkFileExists).toHaveBeenCalledWith(
        patchHashDto.hash,
      );
    });

    it('should throw HttpException for invalid token', async () => {
      const patchHashDto: PatchHashDto = {
        token: 'invalid-token',
        hash: 'hash-123',
        isChunk: true,
      };

      mockUniqueCodeService.verifyUniqueCode.mockReturnValue(false);

      await expect(controller.patchHash(patchHashDto)).rejects.toThrow(
        HttpException,
      );
      await expect(controller.patchHash(patchHashDto)).rejects.toThrow(
        'Invalid token',
      );
    });

    it('should throw error when checkChunkExists fails', async () => {
      const patchHashDto: PatchHashDto = {
        token: 'valid-token',
        hash: 'chunk-hash-123',
        isChunk: true,
      };

      mockUniqueCodeService.verifyUniqueCode.mockReturnValue(true);
      mockFileService.checkChunkExists.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(controller.patchHash(patchHashDto)).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('uploadChunk', () => {
    const createMockFile = (overrides?: Partial<Express.Multer.File>): Express.Multer.File => {
      return {
        fieldname: 'chunk',
        originalname: 'chunk',
        encoding: '7bit',
        mimetype: 'application/octet-stream',
        size: 1024,
        buffer: Buffer.from('chunk data'),
        destination: '',
        filename: '',
        path: '',
        stream: null as any,
        ...overrides,
      } as Express.Multer.File;
    };

    it('should upload chunk successfully', async () => {
      const uploadChunkDto: UploadChunkDto = {
        token: 'valid-token',
        hash: 'chunk-hash-123',
      };

      const mockChunk = createMockFile();

      mockUniqueCodeService.verifyUniqueCode.mockReturnValue(true);
      mockFileService.saveChunk.mockResolvedValue(undefined);

      const result = await controller.uploadChunk(uploadChunkDto, mockChunk);

      expect(result).toEqual({
        code: 200,
        success: true,
      });
      expect(mockUniqueCodeService.verifyUniqueCode).toHaveBeenCalledWith(
        uploadChunkDto.token,
      );
      expect(mockFileService.saveChunk).toHaveBeenCalledWith(
        mockChunk.buffer,
        uploadChunkDto.hash,
      );
    });

    it('should throw HttpException for invalid token', async () => {
      const uploadChunkDto: UploadChunkDto = {
        token: 'invalid-token',
        hash: 'chunk-hash-123',
      };

      const mockChunk = createMockFile();

      mockUniqueCodeService.verifyUniqueCode.mockReturnValue(false);

      await expect(
        controller.uploadChunk(uploadChunkDto, mockChunk),
      ).rejects.toThrow(HttpException);
      await expect(
        controller.uploadChunk(uploadChunkDto, mockChunk),
      ).rejects.toThrow('Invalid token');
    });

    it('should throw HttpException when no chunk data provided', async () => {
      const uploadChunkDto: UploadChunkDto = {
        token: 'valid-token',
        hash: 'chunk-hash-123',
      };

      mockUniqueCodeService.verifyUniqueCode.mockReturnValue(true);

      await expect(
        controller.uploadChunk(uploadChunkDto, null),
      ).rejects.toThrow(HttpException);
      await expect(
        controller.uploadChunk(uploadChunkDto, null),
      ).rejects.toThrow('No chunk data provided');
    });

    it('should throw HttpException when chunk has no buffer', async () => {
      const uploadChunkDto: UploadChunkDto = {
        token: 'valid-token',
        hash: 'chunk-hash-123',
      };

      const mockChunk = createMockFile({ buffer: undefined as any });

      mockUniqueCodeService.verifyUniqueCode.mockReturnValue(true);

      await expect(
        controller.uploadChunk(uploadChunkDto, mockChunk),
      ).rejects.toThrow(HttpException);
      await expect(
        controller.uploadChunk(uploadChunkDto, mockChunk),
      ).rejects.toThrow('No chunk data provided');
    });

    it('should throw error when saveChunk fails', async () => {
      const uploadChunkDto: UploadChunkDto = {
        token: 'valid-token',
        hash: 'chunk-hash-123',
      };

      const mockChunk = createMockFile();

      mockUniqueCodeService.verifyUniqueCode.mockReturnValue(true);
      mockFileService.saveChunk.mockRejectedValue(new Error('Save failed'));

      await expect(
        controller.uploadChunk(uploadChunkDto, mockChunk),
      ).rejects.toThrow('Save failed');
    });
  });

  describe('merge', () => {
    it('should merge file successfully', async () => {
      const mergeFileDto: MergeFileDto = {
        token: 'valid-token',
        fileHash: 'file-hash-123',
        fileName: 'test.txt',
        chunksLength: 2,
        chunks: [
          { index: 0, hash: 'chunk-0' },
          { index: 1, hash: 'chunk-1' },
        ],
      };

      const mockUrl = 'test_file-hash-123.txt';
      mockUniqueCodeService.verifyUniqueCode.mockReturnValue(true);
      mockFileService.updateFileForMerge.mockResolvedValue(mockUrl);

      const result = await controller.merge(mergeFileDto);

      expect(result).toEqual({
        code: 200,
        url: mockUrl,
      });
      expect(mockUniqueCodeService.verifyUniqueCode).toHaveBeenCalledWith(
        mergeFileDto.token,
      );
      expect(mockFileService.updateFileForMerge).toHaveBeenCalledWith(
        mergeFileDto.token,
        mergeFileDto.fileHash,
        mergeFileDto.fileName,
        mergeFileDto.chunks,
      );
    });

    it('should throw HttpException for invalid token', async () => {
      const mergeFileDto: MergeFileDto = {
        token: 'invalid-token',
        fileHash: 'file-hash-123',
        fileName: 'test.txt',
        chunksLength: 2,
        chunks: [
          { index: 0, hash: 'chunk-0' },
          { index: 1, hash: 'chunk-1' },
        ],
      };

      mockUniqueCodeService.verifyUniqueCode.mockReturnValue(false);

      await expect(controller.merge(mergeFileDto)).rejects.toThrow(
        HttpException,
      );
      await expect(controller.merge(mergeFileDto)).rejects.toThrow(
        'Invalid token',
      );
    });

    it('should throw HttpException when chunks count mismatch', async () => {
      const mergeFileDto: MergeFileDto = {
        token: 'valid-token',
        fileHash: 'file-hash-123',
        fileName: 'test.txt',
        chunksLength: 3,
        chunks: [
          { index: 0, hash: 'chunk-0' },
          { index: 1, hash: 'chunk-1' },
        ],
      };

      mockUniqueCodeService.verifyUniqueCode.mockReturnValue(true);

      await expect(controller.merge(mergeFileDto)).rejects.toThrow(
        HttpException,
      );
      await expect(controller.merge(mergeFileDto)).rejects.toThrow(
        'Chunks count mismatch',
      );
    });

    it('should throw error when updateFileForMerge fails', async () => {
      const mergeFileDto: MergeFileDto = {
        token: 'valid-token',
        fileHash: 'file-hash-123',
        fileName: 'test.txt',
        chunksLength: 2,
        chunks: [
          { index: 0, hash: 'chunk-0' },
          { index: 1, hash: 'chunk-1' },
        ],
      };

      mockUniqueCodeService.verifyUniqueCode.mockReturnValue(true);
      mockFileService.updateFileForMerge.mockRejectedValue(
        new Error('Merge failed'),
      );

      await expect(controller.merge(mergeFileDto)).rejects.toThrow(
        'Merge failed',
      );
    });
  });
});

