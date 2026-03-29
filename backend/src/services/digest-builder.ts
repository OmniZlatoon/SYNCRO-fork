import nodemailer from 'nodemailer';
import { supabase } from '../config/database';
import logger from '../config/logger';
import { buildDigestEmailHtml, buildDigestEmailText } from './digest-template';
import type { MonthlyDigestSummary, DigestAuditRecord } from '../types/digest';

export class DigestEmailService {
  private transporter: nodemailer.Transporter;
  private fromEmail: string;
  private dashboardUrl: string;

  constructor() {
    this.fromEmail   = process.env.EMAIL_FROM     ?? 'noreply@synchro.app';
    this.dashboardUrl = process.env.FRONTEND_URL  ?? 'https://app.syncro.ai';

    if (process.env.SMTP_HOST) {
      this.transporter = nodemailer.createTransport({
        host:   process.env.SMTP_HOST,
        port:   parseInt(process.env.SMTP_PORT ?? '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER     ?? '',
          pass: process.env.SMTP_PASSWORD ?? '',
        },
      });
    } else {
      // Development fallback — logs message JSON to console
      this.transporter = nodemailer.createTransport({ jsonTransport: true });
      logger.warn('DigestEmailService: SMTP not configured, using mock transporter.');
    }
  }

  /**
   * Send the monthly digest email to a user and record the result in the audit log.
   */
  async sendMonthlyDigest(
    recipientEmail: string,
    summary: MonthlyDigestSummary,
    digestType: 'monthly' | 'test' = 'monthly',
  ): Promise<{ success: boolean; error?: string }> {
    const subject = `Your SYNCRO Monthly Summary — ${summary.periodLabel}`;

    try {
      const info = await this.transporter.sendMail({
        from:    this.fromEmail,
        to:      recipientEmail,
        subject,
        html:    buildDigestEmailHtml(summary, this.dashboardUrl),
        text:    buildDigestEmailText(summary, this.dashboardUrl),
      });

      logger.info(`Monthly digest sent to ${recipientEmail}`, {
        messageId: info.messageId,
        userId:    summary.userId,
        period:    summary.periodLabel,
        digestType,
      });

      await this.writeAuditRecord({
        userId:       summary.userId,
        digestType,
        periodLabel:  summary.periodLabel,
        status:       'sent',
        errorMessage: null,
      });

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to send monthly digest to ${recipientEmail}:`, err);

      await this.writeAuditRecord({
        userId:       summary.userId,
        digestType,
        periodLabel:  summary.periodLabel,
        status:       'failed',
        errorMessage: message,
      });

      return { success: false, error: message };
    }
  }

  // ─── Audit ────────────────────────────────────────────────────────────────

  private async writeAuditRecord(record: {
    userId:       string;
    digestType:   'monthly' | 'test';
    periodLabel:  string;
    status:       'sent' | 'failed' | 'skipped';
    errorMessage: string | null;
  }): Promise<void> {
    const { error } = await supabase.from('digest_audit_log').insert({
      user_id:       record.userId,
      digest_type:   record.digestType,
      period_label:  record.periodLabel,
      status:        record.status,
      error_message: record.errorMessage,
      sent_at:       new Date().toISOString(),
    });

    if (error) {
      logger.error('Failed to write digest audit record:', error);
    }
  }

  /**
   * Retrieve the audit history for a user (newest first, capped at 24 records).
   */
  async getAuditHistory(userId: string, limit = 24): Promise<DigestAuditRecord[]> {
    const { data, error } = await supabase
      .from('digest_audit_log')
      .select('*')
      .eq('user_id', userId)
      .order('sent_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch digest audit history:', error);
      return [];
    }

    return (data ?? []).map((r) => ({
      id:           r.id,
      userId:       r.user_id,
      digestType:   r.digest_type,
      periodLabel:  r.period_label,
      status:       r.status,
      errorMessage: r.error_message ?? null,
      sentAt:       r.sent_at,
    }));
  }
}

export const digestEmailService = new DigestEmailService();