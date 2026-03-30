import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { adminAuth } from '../middleware/admin';
import { digestService } from '../services/digest-service';
import { digestEmailService } from '../services/digest-email-service';
import { validateRequest } from '../utils/validation';
import { BadRequestError, RateLimitError } from '../errors';

const router: Router = Router();

// ─── User-facing routes (authenticated) ──────────────────────────────────────
router.use(authenticate);

const updateDigestPreferencesSchema = z.object({
  digestEnabled: z.boolean().optional(),
  digestDay: z.number().int().min(1).max(28).optional(),
  includeYearToDate: z.boolean().optional(),
});

/**
 * GET /api/digest/preferences
 */
router.get('/preferences', async (req: AuthenticatedRequest, res: Response) => {
  const prefs = await digestService.getDigestPreferences(req.user!.id);
  res.json({ success: true, data: prefs });
});

/**
 * PATCH /api/digest/preferences
 */
router.patch('/preferences', async (req: AuthenticatedRequest, res: Response) => {
  const validatedData = validateRequest(updateDigestPreferencesSchema, req.body);
  const updated = await digestService.updateDigestPreferences(req.user!.id, validatedData);
  res.json({ success: true, data: updated });
});

/**
 * POST /api/digest/test
 */
router.post('/test', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  // Basic rate-limit: max 1 test per hour
  const history = await digestEmailService.getAuditHistory(userId, 5);
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const recentTests = history.filter(
    (h) => h.digestType === 'test' && new Date(h.sentAt).getTime() > oneHourAgo
  );

  if (recentTests.length > 0) {
    throw new RateLimitError('A test digest was already sent in the last hour.');
  }

  const outcome = await digestService.sendDigestForUser(userId, 'test');
  if (!outcome.success) {
    throw new BadRequestError(outcome.error || 'Failed to send test digest');
  }

  res.json({ success: true, message: 'Test digest sent successfully.' });
});

/**
 * GET /api/digest/history
 */
router.get('/history', async (req: AuthenticatedRequest, res: Response) => {
  const history = await digestEmailService.getAuditHistory(req.user!.id);
  res.json({ success: true, data: history });
});

// ─── Admin routes ─────────────────────────────────────────────────────────────

/**
 * POST /api/digest/admin/run
 */
router.post('/admin/run', adminAuth, async (_req, res: Response) => {
  const result = await digestService.runMonthlyDigest();
  res.json({ success: true, data: result });
});

export default router;