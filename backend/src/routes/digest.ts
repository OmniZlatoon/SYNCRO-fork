import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { adminAuth } from '../middleware/admin';
import { digestService } from '../services/digest-service';
import { digestEmailService } from '../services/digest-email-service';
import logger from '../config/logger';

const router = Router();

// ─── User-facing routes (authenticated) ──────────────────────────────────────

router.use(authenticate);

/**
 * GET /api/digest/preferences
 * Fetch the authenticated user's digest settings.
 */
router.get('/preferences', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const prefs = await digestService.getDigestPreferences(userId);
    return res.json({ success: true, data: prefs });
  } catch (err) {
    logger.error('GET /digest/preferences error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch preferences' });
  }
});

/**
 * PATCH /api/digest/preferences
 * Update digest settings (opt-in, digest day, year-to-date toggle).
 *
 * Body: { digestEnabled?, digestDay?, includeYearToDate? }
 */
router.patch('/preferences', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { digestEnabled, digestDay, includeYearToDate } = req.body;

    if (digestDay !== undefined) {
      const day = Number(digestDay);
      if (!Number.isInteger(day) || day < 1 || day > 28) {
        return res.status(400).json({
          success: false,
          error: 'digestDay must be an integer between 1 and 28',
        });
      }
    }

    const updated = await digestService.updateDigestPreferences(userId, {
      ...(digestEnabled     !== undefined && { digestEnabled }),
      ...(digestDay         !== undefined && { digestDay: Number(digestDay) }),
      ...(includeYearToDate !== undefined && { includeYearToDate }),
    });

    return res.json({ success: true, data: updated });
  } catch (err) {
    logger.error('PATCH /digest/preferences error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update preferences' });
  }
});

/**
 * POST /api/digest/test
 * Immediately send a digest preview to the authenticated user.
 * Rate-limited: one test email per hour (tracked via audit log).
 */
router.post('/test', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    // Basic rate-limit: max 1 test per hour
    const history = await digestEmailService.getAuditHistory(userId, 5);
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentTests = history.filter(
      (h) => h.digestType === 'test' && new Date(h.sentAt).getTime() > oneHourAgo,
    );

    if (recentTests.length > 0) {
      return res.status(429).json({
        success: false,
        error:   'A test digest was already sent in the last hour. Please try again later.',
      });
    }

    const outcome = await digestService.sendDigestForUser(userId, 'test');

    if (!outcome.success) {
      return res.status(500).json({ success: false, error: outcome.error });
    }

    return res.json({ success: true, message: 'Test digest sent successfully.' });
  } catch (err) {
    logger.error('POST /digest/test error:', err);
    return res.status(500).json({ success: false, error: 'Failed to send test digest' });
  }
});

/**
 * GET /api/digest/history
 * Return the last 24 digest send records for the user.
 */
router.get('/history', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const history = await digestEmailService.getAuditHistory(userId);
    return res.json({ success: true, data: history });
  } catch (err) {
    logger.error('GET /digest/history error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch digest history' });
  }
});

// ─── Admin routes ─────────────────────────────────────────────────────────────

/**
 * POST /api/digest/admin/run
 * Manually trigger the monthly digest run for all opted-in users.
 * Admin only.
 */
router.post('/admin/run', adminAuth, async (_req, res: Response) => {
  try {
    const result = await digestService.runMonthlyDigest();
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error('POST /digest/admin/run error:', err);
    return res.status(500).json({ success: false, error: 'Digest run failed' });
  }
});

export default router;