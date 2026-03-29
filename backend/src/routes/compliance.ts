import { Router, Request, Response } from 'express';
import archiver from 'archiver';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { complianceService } from '../services/compliance-service';
import { supabase } from '../config/database';
import logger from '../config/logger';
import { RateLimiterFactory } from '../middleware/rate-limit-factory';

const router = Router();

// ─── XSS Helper ──────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Rate limiters ────────────────────────────────────────────────────────────

const exportRateLimit = RateLimiterFactory.createCustomLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1,
  message: { error: 'Export rate limit exceeded. Try again in 1 hour.' },
  keyGenerator: (req: any) => req.user?.id || req.ip,
  endpointType: 'data-export',
});

// ─── HTML Renderers ──────────────────────────────────────────────────────────

const BASE_STYLE = `
  body { margin: 0; padding: 40px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f9fafb; color: #111827; }
  .card { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 40px 32px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  h1 { margin: 0 0 8px; font-size: 22px; font-weight: 700; }
  p { margin: 0 0 24px; font-size: 15px; color: #4b5563; line-height: 1.5; }
  .btn { display: inline-block; padding: 10px 24px; background: #6366f1; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; text-decoration: none; }
  .btn:hover { background: #4f46e5; }
  .success-icon { font-size: 40px; margin-bottom: 16px; }
  .error-msg { color: #dc2626; font-size: 14px; margin-top: 8px; }
`;

function renderConfirmPage(token: string, emailType: string): string {
  const friendlyType = escapeHtml(emailType.replace(/_/g, ' '));
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title>
<style>${BASE_STYLE}</style></head>
<body>
  <div class="card">
    <h1>Unsubscribe</h1>
    <p>You are about to unsubscribe from <strong>${friendlyType}</strong> emails. Click the button below to confirm.</p>
    <form method="POST" action="/api/compliance/unsubscribe">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <button type="submit" class="btn">Confirm Unsubscribe</button>
    </form>
  </div>
</body>
</html>`;
}

function renderSuccessPage(emailType: string): string {
  const friendlyType = escapeHtml(emailType.replace(/_/g, ' '));
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title>
<style>${BASE_STYLE}</style></head>
<body>
  <div class="card">
    <div class="success-icon">✓</div>
    <h1>You've been unsubscribed</h1>
    <p>You will no longer receive <strong>${friendlyType}</strong> emails from us. This change may take a short time to take effect.</p>
    <p style="margin-bottom:0;font-size:13px;color:#9ca3af;">If you unsubscribed by mistake, you can update your email preferences from your account settings.</p>
  </div>
</body>
</html>`;
}

function renderErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Error</title>
<style>${BASE_STYLE}</style></head>
<body>
  <div class="card">
    <h1>Something went wrong</h1>
    <p class="error-msg">${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

// ─── Token-based auth helper ─────────────────────────────────────────────────

/**
 * Resolve user ID from either a token query/body param (HMAC unsubscribe token)
 * or from standard Bearer/cookie session auth.
 * Returns null if neither is valid.
 */
async function resolveUserFromTokenOrSession(
  req: Request,
  token?: string,
): Promise<string | null> {
  if (token) {
    const result = complianceService.verifyUnsubscribeToken(token);
    if (result.valid && result.userId) {
      return result.userId;
    }
    return null;
  }

  // Fall back to session auth
  const authHeader = req.headers.authorization;
  let sessionToken: string | null = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    sessionToken = authHeader.substring(7);
  } else if ((req as any).cookies?.authToken) {
    sessionToken = (req as any).cookies.authToken;
  }

  if (!sessionToken) return null;

  const { data: { user }, error } = await supabase.auth.getUser(sessionToken);
  if (error || !user) return null;
  return user.id;
}

// ─── Data Export ─────────────────────────────────────────────────────────────

/**
 * GET /api/compliance/export
 * Auth required. Streams a ZIP archive containing the user's data.
 */
router.get('/export', authenticate, exportRateLimit, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  try {
    const data = await complianceService.gatherUserData(userId);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="syncro-data-export-${Date.now()}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (err) => {
      logger.error('Archiver error during export:', err);
      // Headers already sent; cannot send a JSON error response here
    });

    archive.pipe(res);

    // 8 JSON files
    archive.append(JSON.stringify(data.profile, null, 2), { name: 'profile.json' });
    archive.append(JSON.stringify(data.subscriptions, null, 2), { name: 'subscriptions.json' });
    archive.append(JSON.stringify(data.notifications, null, 2), { name: 'notifications.json' });
    archive.append(JSON.stringify(data.auditLogs, null, 2), { name: 'audit_logs.json' });
    archive.append(JSON.stringify(data.preferences, null, 2), { name: 'preferences.json' });
    archive.append(JSON.stringify(data.emailAccounts, null, 2), { name: 'email_accounts.json' });
    archive.append(JSON.stringify(data.teams, null, 2), { name: 'teams.json' });
    archive.append(JSON.stringify(data.blockchainLogs, null, 2), { name: 'blockchain_logs.json' });

    // README
    const readme = [
      'Syncro — Personal Data Export',
      '==============================',
      `Generated: ${new Date().toISOString()}`,
      `User ID: ${userId}`,
      '',
      'Files included:',
      '  profile.json        — Your account profile',
      '  subscriptions.json  — All subscription records',
      '  notifications.json  — Notification history',
      '  audit_logs.json     — Account activity log',
      '  preferences.json    — User preferences and email settings',
      '  email_accounts.json — Connected email accounts',
      '  teams.json          — Team membership records',
      '  blockchain_logs.json — On-chain contract events and renewal approvals',
      '',
      'For questions or deletion requests, contact support.',
    ].join('\n');

    archive.append(readme, { name: 'README.txt' });

    await archive.finalize();

    // Log to audit_logs after stream completes
    await supabase.from('audit_logs').insert({
      user_id: userId,
      action: 'data_export',
      resource_type: 'account',
      resource_id: userId,
      metadata: { exported_at: new Date().toISOString() },
    });

    logger.info(`Data export completed for user ${userId}`);
  } catch (error) {
    logger.error('Data export error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export data',
      });
    }
  }
});

// ─── Account Deletion ─────────────────────────────────────────────────────────

/**
 * POST /api/compliance/account/delete
 * Auth required. Schedules account deletion in 30 days.
 */
router.post('/account/delete', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  try {
    const { reason } = req.body;
    const result = await complianceService.requestDeletion(userId, reason);
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to request deletion';
    if (message.includes('already pending')) {
      return res.status(409).json({ success: false, error: message });
    }
    logger.error('Account deletion request error:', error);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/compliance/account/delete/cancel
 * Auth required. Cancels a pending account deletion.
 */
router.post('/account/delete/cancel', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  try {
    const result = await complianceService.cancelDeletion(userId);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Cancel deletion error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel deletion',
    });
  }
});

/**
 * GET /api/compliance/account/deletion-status
 * Auth required. Returns deletion request status.
 */
router.get('/account/deletion-status', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  try {
    const status = await complianceService.getDeletionStatus(userId);
    res.json({ success: true, data: status });
  } catch (error) {
    logger.error('Deletion status error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get deletion status',
    });
  }
});

// ─── Unsubscribe (no auth — accessed from email links) ───────────────────────

/**
 * GET /api/compliance/unsubscribe?token=...
 * Verifies HMAC token. Does NOT mutate state. Renders HTML confirmation page.
 */
router.get('/unsubscribe', async (req: Request, res: Response) => {
  const token = req.query.token as string | undefined;

  if (!token) {
    res.status(400).send(renderErrorPage('Missing unsubscribe token.'));
    return;
  }

  const result = complianceService.verifyUnsubscribeToken(token);
  if (!result.valid || !result.emailType) {
    res.status(400).send(renderErrorPage('This unsubscribe link is invalid or has expired.'));
    return;
  }

  res.send(renderConfirmPage(token, result.emailType));
});

/**
 * POST /api/compliance/unsubscribe
 * Verifies token from body, updates user_preferences.email_opt_ins.
 */
router.post('/unsubscribe', async (req: Request, res: Response) => {
  const token = req.body.token as string | undefined;

  if (!token) {
    res.status(400).send(renderErrorPage('Missing unsubscribe token.'));
    return;
  }

  const result = complianceService.verifyUnsubscribeToken(token);
  if (!result.valid || !result.userId || !result.emailType) {
    res.status(400).send(renderErrorPage('This unsubscribe link is invalid or has expired.'));
    return;
  }

  try {
    const { data: prefs } = await supabase
      .from('user_preferences')
      .select('email_opt_ins')
      .eq('user_id', result.userId)
      .single();

    const currentOptIns: Record<string, boolean> = (prefs?.email_opt_ins as Record<string, boolean>) || {};
    const updated = { ...currentOptIns, [result.emailType]: false };

    const { error } = await supabase
      .from('user_preferences')
      .upsert({ user_id: result.userId, email_opt_ins: updated }, { onConflict: 'user_id' });

    if (error) {
      logger.error('Unsubscribe DB update error:', error);
      res.status(500).send(renderErrorPage('Failed to update preferences. Please try again.'));
      return;
    }

    logger.info(`User ${result.userId} unsubscribed from ${result.emailType}`);
    res.send(renderSuccessPage(result.emailType));
  } catch (error) {
    logger.error('Unsubscribe error:', error);
    res.status(500).send(renderErrorPage('An unexpected error occurred. Please try again.'));
  }
});

// ─── Email Preferences API (dual auth: token OR session) ─────────────────────

const KNOWN_OPT_IN_KEYS = ['reminders', 'marketing', 'updates', 'digests'] as const;
type OptInKey = typeof KNOWN_OPT_IN_KEYS[number];

/**
 * GET /api/compliance/email-preferences
 * Returns current email_opt_ins. Accepts ?token=... or Bearer/cookie auth.
 */
router.get('/email-preferences', async (req: Request, res: Response) => {
  const token = req.query.token as string | undefined;
  const userId = await resolveUserFromTokenOrSession(req, token);

  if (!userId) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  try {
    const { data: prefs, error } = await supabase
      .from('user_preferences')
      .select('email_opt_ins')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    res.json({ success: true, data: { email_opt_ins: prefs?.email_opt_ins ?? {} } });
  } catch (error) {
    logger.error('Get email preferences error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get email preferences',
    });
  }
});

/**
 * PATCH /api/compliance/email-preferences
 * Updates email_opt_ins. Accepts token in body or Bearer/cookie auth.
 * Only allows known keys: reminders, marketing, updates, digests.
 */
router.patch('/email-preferences', async (req: Request, res: Response) => {
  const token = req.body.token as string | undefined;
  const userId = await resolveUserFromTokenOrSession(req, token);

  if (!userId) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  // Extract only known keys from the request body (strip token field and unknown keys)
  const updates: Partial<Record<OptInKey, boolean>> = {};
  for (const key of KNOWN_OPT_IN_KEYS) {
    if (key in req.body && typeof req.body[key] === 'boolean') {
      updates[key] = req.body[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({
      success: false,
      error: `No valid keys provided. Allowed keys: ${KNOWN_OPT_IN_KEYS.join(', ')}`,
    });
    return;
  }

  try {
    const { data: prefs } = await supabase
      .from('user_preferences')
      .select('email_opt_ins')
      .eq('user_id', userId)
      .single();

    const currentOptIns: Record<string, boolean> = (prefs?.email_opt_ins as Record<string, boolean>) || {};
    const merged = { ...currentOptIns, ...updates };

    const { data, error } = await supabase
      .from('user_preferences')
      .upsert({ user_id: userId, email_opt_ins: merged }, { onConflict: 'user_id' })
      .select('email_opt_ins')
      .single();

    if (error) {
      throw error;
    }

    res.json({ success: true, data: { email_opt_ins: data?.email_opt_ins ?? merged } });
  } catch (error) {
    logger.error('Update email preferences error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update email preferences',
    });
  }
});

export default router;
