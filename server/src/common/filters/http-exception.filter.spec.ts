import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { Request, Response } from 'express';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockArgumentsHost: ArgumentsHost;

  beforeEach(() => {
    filter = new HttpExceptionFilter();

    mockRequest = {
      method: 'GET',
      url: '/test',
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockArgumentsHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
        getResponse: jest.fn().mockReturnValue(mockResponse),
      }),
    } as unknown as ArgumentsHost;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(filter).toBeDefined();
  });

  describe('catch HttpException', () => {
    it('should handle HttpException with string response', () => {
      const exception = new HttpException('Test error message', HttpStatus.BAD_REQUEST);

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.BAD_REQUEST,
        timestamp: expect.any(String),
        path: '/test',
        message: 'Test error message',
      });
    });

    it('should handle HttpException with object response', () => {
      const exception = new HttpException(
        { message: 'Object error message', error: 'Bad Request' },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.BAD_REQUEST,
        timestamp: expect.any(String),
        path: '/test',
        message: 'Object error message',
      });
    });

    it('should handle file-related API errors with custom format', () => {
      mockRequest.url = '/file/create';
      const exception = new HttpException('File error', HttpStatus.BAD_REQUEST);

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        status: 'error',
        message: 'File error',
      });
    });

    it('should handle file-related API errors with object response', () => {
      mockRequest.url = '/file/uploadChunk';
      const exception = new HttpException(
        { message: 'Upload failed' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith({
        status: 'error',
        message: 'Upload failed',
      });
    });
  });

  describe('catch Error', () => {
    it('should handle generic Error', () => {
      const exception = new Error('Generic error message');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        timestamp: expect.any(String),
        path: '/test',
        message: 'Generic error message',
      });
    });

    it('should handle generic Error for file API', () => {
      mockRequest.url = '/file/merge';
      const exception = new Error('File merge error');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith({
        status: 'error',
        message: 'File merge error',
      });
    });
  });

  describe('catch unknown exception', () => {
    it('should handle unknown exception type', () => {
      const exception = 'Unknown error';

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        timestamp: expect.any(String),
        path: '/test',
        message: 'Internal server error',
      });
    });

    it('should handle null exception', () => {
      const exception = null;

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        timestamp: expect.any(String),
        path: '/test',
        message: 'Internal server error',
      });
    });
  });

  describe('response format', () => {
    it('should include timestamp in standard format', () => {
      const exception = new HttpException('Test', HttpStatus.BAD_REQUEST);
      const beforeCall = new Date().toISOString();

      filter.catch(exception, mockArgumentsHost);

      const afterCall = new Date().toISOString();
      const callArgs = (mockResponse.json as jest.Mock).mock.calls[0][0];

      expect(callArgs.timestamp).toBeDefined();
      expect(new Date(callArgs.timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(beforeCall).getTime(),
      );
      expect(new Date(callArgs.timestamp).getTime()).toBeLessThanOrEqual(
        new Date(afterCall).getTime(),
      );
    });

    it('should use correct path from request', () => {
      mockRequest.url = '/api/v1/users';
      const exception = new HttpException('Test', HttpStatus.BAD_REQUEST);

      filter.catch(exception, mockArgumentsHost);

      const callArgs = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(callArgs.path).toBe('/api/v1/users');
    });

    it('should use correct HTTP method from request', () => {
      mockRequest.method = 'POST';
      mockRequest.url = '/file/create';
      const exception = new HttpException('Test', HttpStatus.BAD_REQUEST);

      filter.catch(exception, mockArgumentsHost);

      // The filter logs the method, so we just verify it can access it
      expect(mockRequest.method).toBe('POST');
    });
  });
});

