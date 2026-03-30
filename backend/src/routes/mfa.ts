import { Router, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../config/database';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { recoveryCodeService } from '../services/mfa-service';
import { TotpRateLimiter } from '../lib/totp-rate-limiter';
import { createMfaLimiter } from '../middleware/rate-limit-factory';
import { emailService } from '../services/email-service';
import { validateRequest } from '../utils/validation';
import { RateLimitError, UnauthorizedError, NotFoundError, ForbiddenError } from '../errors';

const router = Router();
const totpRateLimiter = new TotpRateLimiter();
router.use(authenticate);

const notifySchema = z.object({
  event: z.enum(['enrolled', 'disabled']),
});

const require2faSchema = z.object({
  required: z.boolean(),
});

/**
 * POST /api/2fa/recovery-codes/generate
 */
router.post('/2fa/recovery-codes/generate', createMfaLimiter(), async (req: AuthenticatedRequest, res: Response) => {
  const codes = await recoveryCodeService.generate(req.user!.id);
  res.status(201).json({ success: true, data: { codes } });
});

/**
 * POST /api/2fa/recovery-codes/verify
 */
router.post('/2fa/recovery-codes/verify', createMfaLimiter(), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { code } = validateRequest(z.object({ code: z.string().min(1) }), req.body);

  if (totpRateLimiter.isLocked(userId)) {
    throw new RateLimitError('Too many failed attempts. Please try again later.');
  }

  const valid = await recoveryCodeService.verify(userId, code);
  if (!valid) {
    totpRateLimiter.recordFailure(userId);
    if (totpRateLimiter.isLocked(userId)) {
      throw new RateLimitError('Too many failed attempts. Please try again later.');
    }
    throw new UnauthorizedError('Invalid or already-used recovery code');
  }

  totpRateLimiter.reset(userId);
  res.json({ success: true });
});

/**
 * DELETE /api/2fa/recovery-codes
 */
router.delete('/2fa/recovery-codes', async (req: AuthenticatedRequest, res: Response) => {
  await recoveryCodeService.invalidateAll(req.user!.id);
  res.json({ success: true });
});

/**
 * POST /api/2fa/notify
 */
router.post('/2fa/notify', async (req: AuthenticatedRequest, res: Response) => {
  const { event } = validateRequest(notifySchema, req.body);
  const recipientEmail = req.user!.email;

  const subject = event === 'enrolled' ? '2FA Enabled on your SYNCRO account' : '2FA Disabled on your SYNCRO account';
  const bodyText = event === 'enrolled'
    ? 'Two-factor authentication has been successfully enabled on your SYNCRO account.'
    : 'Two-factor authentication has been disabled on your SYNCRO account. If you did not make this change, please contact support immediately.';

  emailService.sendSimpleEmail(recipientEmail, subject, bodyText).catch(() => {});
  res.json({ success: true });
});

/**
 * PUT /api/teams/:teamId/require-2fa
 */
router.put('/teams/:teamId/require-2fa', async (req: AuthenticatedRequest, res: Response) => {
  const { required } = validateRequest(require2faSchema, req.body);
  const { teamId } = req.params;

  const { data: team, error: teamErr } = await supabase.from('teams').select('id, owner_id').eq('id', teamId).maybeSingle();
  if (teamErr || !team) throw new NotFoundError('Team not found');
  if (team.owner_id !== req.user!.id) throw new ForbiddenError('Only the team owner can change 2FA enforcement');

  const { error: updateErr } = await supabase
    .from('teams')
    .update({
      require_2fa: required,
      require_2fa_set_at: required ? new Date().toISOString() : null,
    })
    .eq('id', teamId);

  if (updateErr) throw updateErr;

  res.json({ success: true, data: { teamId, require2fa: required } });
});

export default router;
