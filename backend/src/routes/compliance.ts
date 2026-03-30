import { Router, Request, Response } from 'express';
import archiver from 'archiver';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { complianceService } from '../services/compliance-service';
import { supabase } from '../config/database';
import logger from '../config/logger';
import { RateLimiterFactory } from '../middleware/rate-limit-factory';
import { BadRequestError, NotFoundError, ConflictError, UnauthorizedError } from '../errors';

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

// ─── HTML Renderers (Static) ──────────────────────────────────────────────────

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
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title><style>${BASE_STYLE}</style></head><body><div class="card"><h1>Unsubscribe</h1><p>You are about to unsubscribe from <strong>${friendlyType}</strong> emails. Click the button below to confirm.</p><form method="POST" action="/api/compliance/unsubscribe"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit" class="btn">Confirm Unsubscribe</button></form></div></body></html>`;
}

function renderSuccessPage(emailType: string): string {
  const friendlyType = escapeHtml(emailType.replace(/_/g, ' '));
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title><style>${BASE_STYLE}</style></head><body><div class="card"><div class="success-icon">✓</div><h1>You've been unsubscribed</h1><p>You will no longer receive <strong>${friendlyType}</strong> emails from us.</p></div></body></html>`;
}

function renderErrorPage(message: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Error</title><style>${BASE_STYLE}</style></head><body><div class="card"><h1>Something went wrong</h1><p class="error-msg">${escapeHtml(message)}</p></div></body></html>`;
}

// ─── Token-based auth helper ─────────────────────────────────────────────────

async function resolveUserFromTokenOrSession(req: Request, token?: string): Promise<string | null> {
  if (token) {
    const result = complianceService.verifyUnsubscribeToken(token);
    return result.valid && result.userId ? result.userId : null;
  }

  const authHeader = req.headers.authorization;
  let sessionToken: string | null = null;
  if (authHeader?.startsWith('Bearer ')) {
    sessionToken = authHeader.substring(7);
  } else if ((req as any).cookies?.authToken) {
    sessionToken = (req as any).cookies.authToken;
  }
  if (!sessionToken) return null;

  const { data: { user }, error } = await supabase.auth.getUser(sessionToken);
  return error || !user ? null : user.id;
}

// ─── Data Export ─────────────────────────────────────────────────────────────

router.get('/export', authenticate, exportRateLimit, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const data = await complianceService.gatherUserData(userId);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="syncro-data-export-${Date.now()}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => logger.error('Archiver error:', err));
  archive.pipe(res);

  // Append data files
  archive.append(JSON.stringify(data.profile, null, 2), { name: 'profile.json' });
  archive.append(JSON.stringify(data.subscriptions, null, 2), { name: 'subscriptions.json' });
  archive.append(JSON.stringify(data.notifications, null, 2), { name: 'notifications.json' });
  archive.append(JSON.stringify(data.auditLogs, null, 2), { name: 'audit_logs.json' });
  archive.append(JSON.stringify(data.preferences, null, 2), { name: 'preferences.json' });
  archive.append(JSON.stringify(data.emailAccounts, null, 2), { name: 'email_accounts.json' });
  archive.append(JSON.stringify(data.teams, null, 2), { name: 'teams.json' });
  archive.append(JSON.stringify(data.blockchainLogs, null, 2), { name: 'blockchain_logs.json' });

  await archive.finalize();

  await supabase.from('audit_logs').insert({
    user_id: userId,
    action: 'data_export',
    resource_type: 'account',
    resource_id: userId,
    metadata: { exported_at: new Date().toISOString() },
  });
});

// ─── Account Deletion ─────────────────────────────────────────────────────────

router.post('/account/delete', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await complianceService.requestDeletion(req.user!.id, req.body.reason);
    res.json({ success: true, data: result });
  } catch (error: any) {
    if (error.message?.includes('already pending')) throw new ConflictError(error.message);
    throw error;
  }
});

router.post('/account/delete/cancel', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const result = await complianceService.cancelDeletion(req.user!.id);
  res.json({ success: true, data: result });
});

router.get('/account/deletion-status', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const status = await complianceService.getDeletionStatus(req.user!.id);
  res.json({ success: true, data: status });
});

// ─── Unsubscribe ──────────────────────────────────────────────────────────────

router.get('/unsubscribe', async (req: Request, res: Response) => {
  const token = req.query.token as string | undefined;
  if (!token) return res.status(400).send(renderErrorPage('Missing unsubscribe token.'));

  const result = complianceService.verifyUnsubscribeToken(token);
  if (!result.valid || !result.emailType) return res.status(400).send(renderErrorPage('Invalid link.'));

  res.send(renderConfirmPage(token, result.emailType));
});

router.post('/unsubscribe', async (req: Request, res: Response) => {
  const token = req.body.token as string | undefined;
  if (!token) return res.status(400).send(renderErrorPage('Missing unsubscribe token.'));

  const result = complianceService.verifyUnsubscribeToken(token);
  if (!result.valid || !result.userId || !result.emailType) return res.status(400).send(renderErrorPage('Invalid link.'));

  const { data: prefs } = await supabase.from('user_preferences').select('email_opt_ins').eq('user_id', result.userId).single();
  const currentOptIns = (prefs?.email_opt_ins as Record<string, boolean>) || {};
  const updated = { ...currentOptIns, [result.emailType]: false };

  const { error } = await supabase.from('user_preferences').upsert({ user_id: result.userId, email_opt_ins: updated }, { onConflict: 'user_id' });
  if (error) throw error;

  res.send(renderSuccessPage(result.emailType));
});

// ─── Email Preferences API ────────────────────────────────────────────────────

const KNOWN_OPT_IN_KEYS = ['reminders', 'marketing', 'updates', 'digests'] as const;

router.get('/email-preferences', async (req: Request, res: Response) => {
  const token = req.query.token as string | undefined;
  const userId = await resolveUserFromTokenOrSession(req, token);
  if (!userId) throw new UnauthorizedError();

  const { data: prefs, error } = await supabase.from('user_preferences').select('email_opt_ins').eq('user_id', userId).maybeSingle();
  if (error) throw error;

  res.json({ success: true, data: { email_opt_ins: prefs?.email_opt_ins ?? {} } });
});

router.patch('/email-preferences', async (req: Request, res: Response) => {
  const token = req.body.token as string | undefined;
  const userId = await resolveUserFromTokenOrSession(req, token);
  if (!userId) throw new UnauthorizedError();

  const updates: Record<string, boolean> = {};
  for (const key of KNOWN_OPT_IN_KEYS) {
    if (typeof req.body[key] === 'boolean') updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) throw new BadRequestError(`Allowed keys: ${KNOWN_OPT_IN_KEYS.join(', ')}`);

  const { data: prefs } = await supabase.from('user_preferences').select('email_opt_ins').eq('user_id', userId).single();
  const currentOptIns = (prefs?.email_opt_ins as Record<string, boolean>) || {};
  const merged = { ...currentOptIns, ...updates };

  const { data, error } = await supabase.from('user_preferences').upsert({ user_id: userId, email_opt_ins: merged }, { onConflict: 'user_id' }).select('email_opt_ins').single();
  if (error) throw error;

  res.json({ success: true, data: { email_opt_ins: data?.email_opt_ins ?? merged } });
});

export default router;
