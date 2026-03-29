import { Router, Response } from 'express';
import { supabase } from '../config/database';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { recoveryCodeService } from '../services/mfa-service';
import { TotpRateLimiter } from '../lib/totp-rate-limiter';
import { createMfaLimiter } from '../middleware/rate-limit-factory';
import { emailService } from '../services/email-service';
import logger from '../config/logger';

const router = Router();
const totpRateLimiter = new TotpRateLimiter();

// Apply authenticate middleware to all routes
router.use(authenticate);

/**
 * @openapi
 * /api/2fa/recovery-codes/generate:
 *   post:
 *     tags: [2FA]
 *     summary: Generate 10 recovery codes
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Recovery codes generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     codes:
 *                       type: array
 *                       items: { type: string }
 *       401:
 *         description: Unauthorized
 */
router.post('/2fa/recovery-codes/generate', async (req: AuthenticatedRequest, res: Response) => {
// ---------------------------------------------------------------------------
// POST /api/2fa/recovery-codes/generate
// Generate 10 recovery codes for the authenticated user
// ---------------------------------------------------------------------------
router.post('/2fa/recovery-codes/generate', createMfaLimiter(), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const codes = await recoveryCodeService.generate(userId);
    res.status(201).json({ success: true, data: { codes } });
  } catch (error) {
    logger.error('POST /api/2fa/recovery-codes/generate error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate recovery codes',
    });
  }
});

/**
 * @openapi
 * /api/2fa/recovery-codes/verify:
 *   post:
 *     tags: [2FA]
 *     summary: Verify a recovery code (rate-limited)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string }
 *     responses:
 *       200:
 *         description: Code valid
 *       400:
 *         description: code is required
 *       401:
 *         description: Invalid or already-used recovery code
 *       429:
 *         description: Too many failed attempts
 */
router.post('/2fa/recovery-codes/verify', async (req: AuthenticatedRequest, res: Response) => {
// ---------------------------------------------------------------------------
// POST /api/2fa/recovery-codes/verify
// Verify a recovery code — rate-limited per session
// ---------------------------------------------------------------------------
router.post('/2fa/recovery-codes/verify', createMfaLimiter(), async (req: AuthenticatedRequest, res: Response) => {
  const sessionId = req.user!.id;

  if (totpRateLimiter.isLocked(sessionId)) {
    return res.status(429).json({
      success: false,
      error: 'Too many failed attempts. Please try again later.',
    });
  }

  try {
    const { code } = req.body as { code?: string };

    if (!code) {
      return res.status(400).json({ success: false, error: 'code is required' });
    }

    const valid = await recoveryCodeService.verify(req.user!.id, code);

    if (!valid) {
      totpRateLimiter.recordFailure(sessionId);

      // Re-check after recording — may have just hit the threshold
      if (totpRateLimiter.isLocked(sessionId)) {
        return res.status(429).json({
          success: false,
          error: 'Too many failed attempts. Please try again later.',
        });
      }

      return res.status(401).json({ success: false, error: 'Invalid or already-used recovery code' });
    }

    totpRateLimiter.reset(sessionId);
    res.json({ success: true });
  } catch (error) {
    logger.error('POST /api/2fa/recovery-codes/verify error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to verify recovery code',
    });
  }
});

/**
 * @openapi
 * /api/2fa/recovery-codes:
 *   delete:
 *     tags: [2FA]
 *     summary: Invalidate all recovery codes
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All codes invalidated
 *       401:
 *         description: Unauthorized
 */
router.delete('/2fa/recovery-codes', async (req: AuthenticatedRequest, res: Response) => {
  try {
    await recoveryCodeService.invalidateAll(req.user!.id);
    res.json({ success: true });
  } catch (error) {
    logger.error('DELETE /api/2fa/recovery-codes error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to invalidate recovery codes',
    });
  }
});

/**
 * @openapi
 * /api/2fa/notify:
 *   post:
 *     tags: [2FA]
 *     summary: Send a 2FA lifecycle notification email
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [event]
 *             properties:
 *               event: { type: string, enum: [enrolled, disabled] }
 *     responses:
 *       200:
 *         description: Notification queued
 *       400:
 *         description: Invalid event value
 *       401:
 *         description: Unauthorized
 */
router.post('/2fa/notify', async (req: AuthenticatedRequest, res: Response) => {
  const { event } = req.body as { event?: 'enrolled' | 'disabled' };

  if (!event || (event !== 'enrolled' && event !== 'disabled')) {
    return res.status(400).json({ success: false, error: "event must be 'enrolled' or 'disabled'" });
  }

  const recipientEmail = req.user!.email;
  const subject =
    event === 'enrolled'
      ? '2FA Enabled on your SYNCRO account'
      : '2FA Disabled on your SYNCRO account';

  const bodyText =
    event === 'enrolled'
      ? 'Two-factor authentication has been successfully enabled on your SYNCRO account.'
      : 'Two-factor authentication has been disabled on your SYNCRO account. If you did not make this change, please contact support immediately.';

  // Fire-and-forget — email failures must not block the response
  emailService
    .sendSimpleEmail(recipientEmail, subject, bodyText)
    .catch((err: unknown) => logger.error('2FA notification email failed:', err));

  res.json({ success: true });
});

/**
 * @openapi
 * /api/teams/{teamId}/require-2fa:
 *   put:
 *     tags: [2FA]
 *     summary: Set team 2FA enforcement policy (owner only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [required]
 *             properties:
 *               required: { type: boolean }
 *     responses:
 *       200:
 *         description: Policy updated
 *       400:
 *         description: required must be boolean
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Only team owner can change this
 *       404:
 *         description: Team not found
 */
router.put('/teams/:teamId/require-2fa', async (req: AuthenticatedRequest, res: Response) => {
  const { teamId } = req.params;
  const { required } = req.body as { required?: boolean };

  if (typeof required !== 'boolean') {
    return res.status(400).json({ success: false, error: 'required (boolean) is required' });
  }

  try {
    // Verify the authenticated user is the owner of this team
    const { data: team, error: teamErr } = await supabase
      .from('teams')
      .select('id, owner_id')
      .eq('id', teamId)
      .single();

    if (teamErr || !team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    if (team.owner_id !== req.user!.id) {
      return res.status(403).json({ success: false, error: 'Only the team owner can change 2FA enforcement' });
    }

    const { error: updateErr } = await supabase
      .from('teams')
      .update({
        require_2fa: required,
        require_2fa_set_at: required ? new Date().toISOString() : null,
      })
      .eq('id', teamId);

    if (updateErr) throw updateErr;

    res.json({ success: true, data: { teamId, require2fa: required } });
  } catch (error) {
    logger.error('PUT /api/teams/:teamId/require-2fa error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update team 2FA enforcement',
    });
  }
});

export default router;
