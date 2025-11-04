import { Test, TestingModule } from '@nestjs/testing';
import { UniqueCodeService } from './unique-code.service';
import * as jwt from 'jsonwebtoken';

describe('UniqueCodeService', () => {
  let service: UniqueCodeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UniqueCodeService],
    }).compile();

    service = module.get<UniqueCodeService>(UniqueCodeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateUniqueCode', () => {
    it('should generate a valid JWT token', () => {
      const token = service.generateUniqueCode();

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('should generate different tokens on each call', () => {
      const token1 = service.generateUniqueCode();
      const token2 = service.generateUniqueCode();

      expect(token1).not.toBe(token2);
    });

    it('should generate a token that can be verified', () => {
      const token = service.generateUniqueCode();
      const isValid = service.verifyUniqueCode(token);

      expect(isValid).toBe(true);
    });

    it('should generate tokens with valid JWT structure', () => {
      const token = service.generateUniqueCode();
      const parts = token.split('.');

      expect(parts.length).toBe(3); // JWT has 3 parts: header.payload.signature
    });
  });

  describe('verifyUniqueCode', () => {
    it('should return true for a valid token', () => {
      const token = service.generateUniqueCode();
      const isValid = service.verifyUniqueCode(token);

      expect(isValid).toBe(true);
    });

    it('should return false for an invalid token', () => {
      const invalidToken = 'invalid.token.here';
      const isValid = service.verifyUniqueCode(invalidToken);

      expect(isValid).toBe(false);
    });

    it('should return false for an empty string', () => {
      const isValid = service.verifyUniqueCode('');

      expect(isValid).toBe(false);
    });

    it('should return false for a malformed token', () => {
      const malformedToken = 'not.a.valid.jwt.token.structure';
      const isValid = service.verifyUniqueCode(malformedToken);

      expect(isValid).toBe(false);
    });

    it('should return false for a token signed with different secret', () => {
      const differentSecretToken = jwt.sign(
        { uuid: 'test' },
        'different-secret',
        { expiresIn: '1h' },
      );
      const isValid = service.verifyUniqueCode(differentSecretToken);

      expect(isValid).toBe(false);
    });

    it('should return false for an expired token', () => {
      const expiredToken = jwt.sign({ uuid: 'test' }, 'fdsagasg', {
        expiresIn: '-1h', // Expired 1 hour ago
      });
      const isValid = service.verifyUniqueCode(expiredToken);

      expect(isValid).toBe(false);
    });
  });
});

