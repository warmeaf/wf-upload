import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class UniqueCodeService {
  private readonly secretKey = 'fdsagasg'; // 替换为你的密钥

  generateUniqueCode(): string {
    const uuid = uuidv4();
    const payload = { uuid };
    const token = jwt.sign(payload, this.secretKey, { expiresIn: '1h' });
    return token;
  }

  verifyUniqueCode(token: string): boolean {
    try {
      jwt.verify(token, this.secretKey);
      return true;
    } catch (error) {
      return false;
    }
  }
}
