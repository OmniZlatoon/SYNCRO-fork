import { supabase } from '../config/database';
import logger from '../config/logger';
import { buildMonthlySummary } from "./monthly-summary";
import { digestEmailService } from './digest-email-service';
import type { UserDigestPreferences } from '../types/digest';

export class DigestService {

  // ─── Preferences ──────────────────────────────────────────────────────────

  async getDigestPreferences(userId: string): Promise<UserDigestPreferences> {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('digest_enabled, digest_day, include_year_to_date, updated_at')
      .eq('user_id', userId)
      .single();

    const defaults: UserDigestPreferences = {
      userId,
      digestEnabled:     false,
      digestDay:         1,
      includeYearToDate: true,
      updatedAt:         new Date().toISOString(),
    };

    if (error || !data) return defaults;

    return {
      userId,
      digestEnabled:     data.digest_enabled     ?? false,
      digestDay:         data.digest_day          ?? 1,
      includeYearToDate: data.include_year_to_date ?? true,
      updatedAt:         data.updated_at           ?? new Date().toISOString(),
    };
  }

  async updateDigestPreferences(
    userId: string,
    updates: Partial<Omit<UserDigestPreferences, 'userId' | 'updatedAt'>>,
  ): Promise<UserDigestPreferences> {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.digestEnabled     !== undefined) dbUpdates.digest_enabled      = updates.digestEnabled;
    if (updates.digestDay         !== undefined) dbUpdates.digest_day           = updates.digestDay;
    if (updates.includeYearToDate !== undefined) dbUpdates.include_year_to_date = updates.includeYearToDate;

    const { error } = await supabase
      .from('user_preferences')
      .upsert({ user_id: userId, ...dbUpdates });

    if (error) {
      logger.error('Failed to update digest preferences:', error);
      throw error;
    }

    return this.getDigestPreferences(userId);
  }

  // ─── Single user dispatch ──────────────────────────────────────────────────

  async sendDigestForUser(
    userId: string,
    digestType: 'monthly' | 'test' = 'monthly',
  ): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
    try {
      const prefs = await this.getDigestPreferences(userId);

      if (digestType === 'monthly' && !prefs.digestEnabled) {
        logger.debug(`Digest skipped for user ${userId} — digest_enabled=false`);
        return { success: true, skipped: true };
      }

      const summary = await buildMonthlySummary(userId);

      if (!summary.userEmail) {
        logger.warn(`No email address found for user ${userId}, skipping digest`);
        return { success: false, error: 'No email address on file' };
      }

      return digestEmailService.sendMonthlyDigest(summary.userEmail, summary, digestType);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`sendDigestForUser failed for ${userId}:`, err);
      return { success: false, error: message };
    }
  }

  // ─── Batch run (called from cron) ─────────────────────────────────────────

  async runMonthlyDigest(): Promise<{
    total: number;
    sent: number;
    skipped: number;
    failed: number;
  }> {
    logger.info('Starting monthly digest run');

    const result = { total: 0, sent: 0, skipped: 0, failed: 0 };

    // Fetch all users who have digest enabled (handle via pagination to be safe)
    const PAGE = 200;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: prefs, error } = await supabase
        .from('user_preferences')
        .select('user_id')
        .eq('digest_enabled', true)
        .range(offset, offset + PAGE - 1);

      if (error) {
        logger.error('Failed to fetch digest-enabled users:', error);
        break;
      }

      if (!prefs || prefs.length === 0) {
        hasMore = false;
        break;
      }

      result.total += prefs.length;

      for (const row of prefs) {
        const outcome = await this.sendDigestForUser(row.user_id, 'monthly');
        if (outcome.skipped) {
          result.skipped++;
        } else if (outcome.success) {
          result.sent++;
        } else {
          result.failed++;
        }
      }

      offset  += PAGE;
      hasMore  = prefs.length === PAGE;
    }

    logger.info('Monthly digest run complete', result);
    return result;
  }
}

export const digestService = new DigestService();