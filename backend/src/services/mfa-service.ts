import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { supabase } from '../config/database';
import logger from '../config/logger';

const BCRYPT_COST = 12;
const CODE_COUNT = 10;

export class RecoveryCodeService {
  /**
   * Generate 10 unique recovery codes for a user.
   * Hashes each with bcrypt (cost 12) and bulk-inserts into recovery_codes.
   * Returns the plain-text codes (shown to the user exactly once).
   */
  async generate(userId: string): Promise<string[]> {
    const plainCodes: string[] = Array.from({ length: CODE_COUNT }, () =>
      crypto.randomBytes(10).toString('hex')
    );

    const hashed = await Promise.all(
      plainCodes.map((code) => bcrypt.hash(code, BCRYPT_COST))
    );

    const rows = hashed.map((code_hash: string) => ({ user_id: userId, code_hash }));

    const { error } = await supabase.from('recovery_codes').insert(rows);

    if (error) {
      logger.error('Failed to insert recovery codes:', error);
      throw new Error(`Failed to store recovery codes: ${error.message}`);
    }

    return plainCodes;
  }

  /**
   * Verify a plain-text recovery code against stored hashes for the user.
   * On match, marks the code as used (sets used_at = now()).
   * Returns true if a valid unused code matched, false otherwise.
   */
  async verify(userId: string, code: string): Promise<boolean> {
    const { data: rows, error } = await supabase
      .from('recovery_codes')
      .select('id, code_hash')
      .eq('user_id', userId)
      .is('used_at', null);

    if (error) {
      logger.error('Failed to fetch recovery codes:', error);
      return false;
    }

    if (!rows || rows.length === 0) {
      return false;
    }

    for (const row of rows) {
      const match = await bcrypt.compare(code, row.code_hash);
      if (match) {
        const { error: updateError } = await supabase
          .from('recovery_codes')
          .update({ used_at: new Date().toISOString() })
          .eq('id', row.id);

        if (updateError) {
          logger.error('Failed to mark recovery code as used:', updateError);
        }

        return true;
      }
    }

    return false;
  }

  /**
   * Delete all recovery codes for a user (called when 2FA is disabled).
   */
  async invalidateAll(userId: string): Promise<void> {
    const { error } = await supabase
      .from('recovery_codes')
      .delete()
      .eq('user_id', userId);

    if (error) {
      logger.error('Failed to delete recovery codes:', error);
      throw new Error(`Failed to invalidate recovery codes: ${error.message}`);
    }
  }
}

export const recoveryCodeService = new RecoveryCodeService();
