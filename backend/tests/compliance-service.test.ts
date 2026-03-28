import { ComplianceService } from '../src/services/compliance-service';

// Set test secret before importing
process.env.UNSUBSCRIBE_SECRET = 'test-secret-key-for-hmac-signing';

describe('ComplianceService', () => {
  let service: ComplianceService;

  beforeEach(() => {
    service = new ComplianceService();
  });

  describe('HMAC Unsubscribe Tokens', () => {
    it('should generate a valid token', () => {
      const token = service.generateUnsubscribeToken('user-123', 'reminders');
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('should verify a valid token', () => {
      const token = service.generateUnsubscribeToken('user-123', 'reminders');
      const result = service.verifyUnsubscribeToken(token);
      expect(result).toEqual({
        valid: true,
        userId: 'user-123',
        emailType: 'reminders',
      });
    });

    it('should reject a tampered token', () => {
      const token = service.generateUnsubscribeToken('user-123', 'reminders');
      const tampered = token.slice(0, -5) + 'XXXXX';
      const result = service.verifyUnsubscribeToken(tampered);
      expect(result).toEqual({ valid: false });
    });

    it('should reject an expired token', () => {
      const token = service.generateUnsubscribeToken('user-123', 'reminders', Date.now() - 91 * 24 * 60 * 60 * 1000);
      const result = service.verifyUnsubscribeToken(token);
      expect(result).toEqual({ valid: false });
    });

    it('should accept a token within 90-day expiry', () => {
      const token = service.generateUnsubscribeToken('user-123', 'reminders', Date.now() - 89 * 24 * 60 * 60 * 1000);
      const result = service.verifyUnsubscribeToken(token);
      expect(result).toEqual({
        valid: true,
        userId: 'user-123',
        emailType: 'reminders',
      });
    });

    it('should reject a malformed token', () => {
      const result = service.verifyUnsubscribeToken('not-a-real-token');
      expect(result).toEqual({ valid: false });
    });
  });
});
