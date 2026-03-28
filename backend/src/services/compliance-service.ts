import crypto from 'crypto';
import { supabase } from '../config/database';
import logger from '../config/logger';

interface TokenVerificationResult {
  valid: boolean;
  userId?: string;
  emailType?: string;
}

const TOKEN_EXPIRY_DAYS = 90;

export class ComplianceService {
  private getSecret(): string {
    const secret = process.env.UNSUBSCRIBE_SECRET;
    if (!secret) {
      throw new Error('UNSUBSCRIBE_SECRET environment variable is required');
    }
    return secret;
  }

  generateUnsubscribeToken(userId: string, emailType: string, timestamp?: number): string {
    const ts = timestamp ?? Date.now();
    const payload = Buffer.from(JSON.stringify({ userId, emailType, ts })).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.getSecret())
      .update(payload)
      .digest('base64url');
    return `${payload}.${signature}`;
  }

  verifyUnsubscribeToken(token: string): TokenVerificationResult {
    try {
      const [payload, signature] = token.split('.');
      if (!payload || !signature) {
        return { valid: false };
      }

      const expectedSignature = crypto
        .createHmac('sha256', this.getSecret())
        .update(payload)
        .digest('base64url');

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        return { valid: false };
      }

      const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
      const { userId, emailType, ts } = data;

      const ageMs = Date.now() - ts;
      const maxAgeMs = TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
      if (ageMs > maxAgeMs) {
        return { valid: false };
      }

      return { valid: true, userId, emailType };
    } catch {
      return { valid: false };
    }
  }
}

export const complianceService = new ComplianceService();
