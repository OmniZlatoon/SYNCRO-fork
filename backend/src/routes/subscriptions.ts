import { Router, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { subscriptionService } from '../services/subscription-service';
import { giftCardService } from '../services/gift-card-service';
import { idempotencyService } from '../services/idempotency';
import { notificationPreferenceService } from '../services/notification-preference-service';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validateSubscriptionOwnership, validateBulkSubscriptionOwnership } from '../middleware/ownership';
import { auditService } from '../services/audit-service';
import { previewImport, commitImport, CSV_TEMPLATE } from '../services/csv-import-service';
import logger from '../config/logger';
import { SUPPORTED_CURRENCIES } from '../constants/currencies';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 }, // 1 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are accepted'));
    }
  },
});

// ── Zod schemas ───────────────────────────────────────────────────────────────

// URL fields — only http/https allowed
const safeUrlSchema = z
  .string()
  .url('Must be a valid URL')
  .refine(
    (val) => {
      try {
        const { protocol } = new URL(val);
        return protocol === 'http:' || protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'URL must use http or https protocol' },
  );

const createSubscriptionSchema = z.object({
  name: z.string().min(1),
  price: z.number(),
  billing_cycle: z.enum(['monthly', 'yearly', 'quarterly']),
  currency: z.string()
    .refine(
      (val) => (SUPPORTED_CURRENCIES as readonly string[]).includes(val),
      { message: `Currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}` }
    )
    .optional(),
  renewal_url: safeUrlSchema.optional(),
  website_url: safeUrlSchema.optional(),
  logo_url: safeUrlSchema.optional(),
});

const updateSubscriptionSchema = z.object({
  renewal_url: safeUrlSchema.optional(),
  website_url: safeUrlSchema.optional(),
  logo_url: safeUrlSchema.optional(),
}).passthrough();

const notificationPreferencesSchema = z.object({
  reminder_days_before: z
    .array(z.number().int().min(1).max(365))
    .min(1)
    .max(10)
    .optional(),
  channels: z
    .array(z.enum(['email', 'push', 'telegram', 'slack']))
    .min(1)
    .optional(),
  muted: z.boolean().optional(),
  muted_until: z.string().datetime({ offset: true }).nullable().optional(),
  custom_message: z.string().max(500).nullable().optional(),
});

const snoozeSchema = z.object({
  until: z.string().datetime({ offset: true }),
});

// ── Router ────────────────────────────────────────────────────────────────────

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/subscriptions
 * List user's subscriptions with optional filtering
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, category, limit, offset } = req.query as Record<string, unknown>;

    const allowedStatuses = new Set(['active','expired','cancelled','paused','trial']);
    const normalizedStatus =
      typeof status === 'string' && allowedStatuses.has(status) ? (status as any) : undefined;
    const normalizedCategory = typeof category === 'string' ? category : undefined;
    const lim = typeof limit === 'string' ? parseInt(limit) : undefined;
    const off = typeof offset === 'string' ? parseInt(offset) : undefined;

    const result = await subscriptionService.listSubscriptions(req.user!.id, {
      status: normalizedStatus,
      category: normalizedCategory,
      limit: lim,
      offset: off,
    });

    res.json({
      success: true,
      data: result.subscriptions,
      pagination: { total: result.total, limit: lim, offset: off },
    });
  } catch (error) {
    logger.error('List subscriptions error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list subscriptions',
    });
  }
});

/**
 * GET /api/subscriptions/:id
 * Get single subscription by ID
 */
router.get('/:id', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const subscription = await subscriptionService.getSubscription(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    );

    res.json({ success: true, data: subscription });
  } catch (error) {
    logger.error('Get subscription error:', error);
    const statusCode =
      error instanceof Error && error.message.includes('not found') ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get subscription',
    });
  }
});

/**
 * POST /api/subscriptions
 * Create new subscription with idempotency support
 */
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'] as string;
    const requestHash = idempotencyService.hashRequest(req.body);

    if (idempotencyKey) {
      const idempotencyCheck = await idempotencyService.checkIdempotency(
        idempotencyKey,
        req.user!.id,
        requestHash,
      );

      if (idempotencyCheck.isDuplicate && idempotencyCheck.cachedResponse) {
        logger.info('Returning cached response for idempotent request', {
          idempotencyKey,
          userId: req.user!.id,
        });
        return res
          .status(idempotencyCheck.cachedResponse.status)
          .json(idempotencyCheck.cachedResponse.body);
      }
    }

    const { name, price, billing_cycle } = req.body;
    if (!name || price === undefined || !billing_cycle) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, price, billing_cycle',
      });
    }

    const urlValidation = createSubscriptionSchema.safeParse(req.body);
    if (!urlValidation.success) {
      return res.status(400).json({
        success: false,
        error: urlValidation.error.errors.map((e) => e.message).join(', '),
      });
    }

    const result = await subscriptionService.createSubscription(
      req.user!.id,
      req.body,
      idempotencyKey || undefined,
    );

    const responseBody = {
      success: true,
      data: result.subscription,
      blockchain: {
        synced: result.syncStatus === 'synced',
        transactionHash: result.blockchainResult?.transactionHash,
        error: result.blockchainResult?.error,
      },
    };

    const statusCode = result.syncStatus === 'failed' ? 207 : 201;

    if (idempotencyKey) {
      await idempotencyService.storeResponse(
        idempotencyKey,
        req.user!.id,
        requestHash,
        statusCode,
        responseBody,
      );
    }

    res.status(statusCode).json(responseBody);
  } catch (error) {
    logger.error('Create subscription error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create subscription',
    });
  }
});

/**
 * PATCH /api/subscriptions/:id
 * Update subscription with optimistic locking
 */
router.patch('/:id', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'] as string;
    const requestHash = idempotencyService.hashRequest(req.body);

    if (idempotencyKey) {
      const idempotencyCheck = await idempotencyService.checkIdempotency(
        idempotencyKey,
        req.user!.id,
        requestHash,
      );

      if (idempotencyCheck.isDuplicate && idempotencyCheck.cachedResponse) {
        return res
          .status(idempotencyCheck.cachedResponse.status)
          .json(idempotencyCheck.cachedResponse.body);
      }
    }

    const expectedVersion = req.headers['if-match'] as string;

    const urlValidation = updateSubscriptionSchema.safeParse(req.body);
    if (!urlValidation.success) {
      return res.status(400).json({
        success: false,
        error: urlValidation.error.errors.map((e) => e.message).join(', '),
      });
    }

    const result = await subscriptionService.updateSubscription(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
      req.body,
      expectedVersion ? parseInt(expectedVersion) : undefined,
    );

    const responseBody = {
      success: true,
      data: result.subscription,
      blockchain: {
        synced: result.syncStatus === 'synced',
        transactionHash: result.blockchainResult?.transactionHash,
        error: result.blockchainResult?.error,
      },
    };

    const statusCode = result.syncStatus === 'failed' ? 207 : 200;

    if (idempotencyKey) {
      await idempotencyService.storeResponse(
        idempotencyKey,
        req.user!.id,
        requestHash,
        statusCode,
        responseBody,
      );
    }

    res.status(statusCode).json(responseBody);
  } catch (error) {
    logger.error('Update subscription error:', error);
    const statusCode =
      error instanceof Error && error.message.includes('not found') ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update subscription',
    });
  }
});

/**
 * DELETE /api/subscriptions/:id
 * Delete subscription
 */
router.delete('/:id', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await subscriptionService.deleteSubscription(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    );

    const responseBody = {
      success: true,
      message: 'Subscription deleted',
      blockchain: {
        synced: result.syncStatus === 'synced',
        transactionHash: result.blockchainResult?.transactionHash,
        error: result.blockchainResult?.error,
      },
    };

    const statusCode = result.syncStatus === 'failed' ? 207 : 200;
    res.status(statusCode).json(responseBody);
  } catch (error) {
    logger.error('Delete subscription error:', error);
    const statusCode =
      error instanceof Error && error.message.includes('not found') ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete subscription',
    });
  }
});

/**
 * POST /api/subscriptions/:id/attach-gift-card
 * Attach gift card info to a subscription
 */
router.post('/:id/attach-gift-card', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const subscriptionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!subscriptionId) {
      return res.status(400).json({ success: false, error: 'Subscription ID required' });
    }

    const { giftCardHash, provider } = req.body;
    if (!giftCardHash || !provider) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: giftCardHash, provider',
      });
    }

    const result = await giftCardService.attachGiftCard(
      req.user!.id,
      subscriptionId,
      giftCardHash,
      provider,
    );

    if (!result.success) {
      const statusCode =
        result.error?.includes('not found') || result.error?.includes('access denied') ? 404 : 400;
      return res.status(statusCode).json({ success: false, error: result.error });
    }

    res.status(201).json({
      success: true,
      data: result.data,
      blockchain: {
        transactionHash: result.blockchainResult?.transactionHash,
        error: result.blockchainResult?.error,
      },
    });
  } catch (error) {
    logger.error('Attach gift card error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to attach gift card',
    });
  }
});

/**
 * POST /api/subscriptions/:id/retry-sync
 * Retry blockchain sync — enforces cooldown period
 */
router.post('/:id/retry-sync', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await subscriptionService.retryBlockchainSync(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    );

    res.json({
      success: result.success,
      transactionHash: result.transactionHash,
      error: result.error,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to retry sync';

    if (errorMessage.includes('Cooldown period active')) {
      logger.warn('Retry sync rejected due to cooldown:', errorMessage);
      return res.status(429).json({
        success: false,
        error: errorMessage,
        retryAfter: extractWaitTime(errorMessage),
      });
    }

    logger.error('Retry sync error:', error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/subscriptions/:id/cooldown-status
 * Check cooldown status for a subscription
 */
router.get('/:id/cooldown-status', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const cooldownStatus = await subscriptionService.checkRenewalCooldown(req.params.id);
    const cooldownStatus = await subscriptionService.checkRenewalCooldown(
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    );

    res.json({
      success: true,
      canRetry: cooldownStatus.canRetry,
      isOnCooldown: cooldownStatus.isOnCooldown,
      timeRemainingSeconds: cooldownStatus.timeRemainingSeconds,
      message: cooldownStatus.message,
    });
  } catch (error) {
    logger.error('Cooldown status check error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to check cooldown status',
    });
  }
});

/**
 * POST /api/subscriptions/:id/cancel
 * Cancel subscription with blockchain sync
 */
router.post('/:id/cancel', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'] as string;
    const requestHash = idempotencyService.hashRequest(req.body);

    if (idempotencyKey) {
      const idempotencyCheck = await idempotencyService.checkIdempotency(
        idempotencyKey,
        req.user!.id,
        requestHash,
      );

      if (idempotencyCheck.isDuplicate && idempotencyCheck.cachedResponse) {
        return res
          .status(idempotencyCheck.cachedResponse.status)
          .json(idempotencyCheck.cachedResponse.body);
      }
    }

    const result = await subscriptionService.cancelSubscription(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    );

    const responseBody = {
      success: true,
      data: result.subscription,
      blockchain: {
        synced: result.syncStatus === 'synced',
        transactionHash: result.blockchainResult?.transactionHash,
        error: result.blockchainResult?.error,
      },
    };

    const statusCode = result.syncStatus === 'failed' ? 207 : 200;

    if (idempotencyKey) {
      await idempotencyService.storeResponse(
        idempotencyKey,
        req.user!.id,
        requestHash,
        statusCode,
        responseBody,
      );
    }

    res.status(statusCode).json(responseBody);
  } catch (error) {
    logger.error('Cancel subscription error:', error);
    const statusCode =
      error instanceof Error && error.message.includes('not found') ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel subscription',
    });
  }
});

/**
 * POST /api/subscriptions/:id/pause
 * Pause subscription — skips reminders, risk scoring, and projected spend
 * Body: { resumeAt?: string (ISO date), reason?: string }
 */
/**
 * POST /api/subscriptions/:id/pause
 * Pause subscription — skips reminders, risk scoring, and projected spend
 * Body: { resumeAt?: string (ISO date), reason?: string }
 */
router.post("/:id/pause", validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const requestHash = idempotencyService.hashRequest(req.body);

    if (idempotencyKey) {
      const idempotencyCheck = await idempotencyService.checkIdempotency(
        idempotencyKey,
        req.user!.id,
        requestHash,
      );

      if (idempotencyCheck.isDuplicate && idempotencyCheck.cachedResponse) {
        return res
          .status(idempotencyCheck.cachedResponse.status)
          .json(idempotencyCheck.cachedResponse.body);
      }
    }

    const pauseSchema = z.object({
      resumeAt: z.string().datetime({ offset: true }).optional(),
      reason: z.string().max(500).optional(),
    });

    const validation = pauseSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: validation.error.errors.map((e) => e.message).join(", "),
      });
    }

    const { resumeAt, reason } = validation.data;

    if (resumeAt && new Date(resumeAt) <= new Date()) {
      return res.status(400).json({
        success: false,
        error: "resumeAt must be a future date",
      });
    }

    const result = await subscriptionService.pauseSubscription(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
      resumeAt,
      reason,
    );

    const responseBody = {
      success: true,
      data: result.subscription,
      blockchain: {
        synced: result.syncStatus === "synced",
        transactionHash: result.blockchainResult?.transactionHash,
        error: result.blockchainResult?.error,
      },
    };

    const statusCode = result.syncStatus === "failed" ? 207 : 200;

    if (idempotencyKey) {
      await idempotencyService.storeResponse(
        idempotencyKey,
        req.user!.id,
        requestHash,
        statusCode,
        responseBody,
      );
    }

    res.status(statusCode).json(responseBody);
  } catch (error) {
    logger.error("Pause subscription error:", error);
    const statusCode =
      error instanceof Error && error.message.includes("not found") ? 404
      : error instanceof Error && error.message.includes("already paused") ? 409
      : 500;
    res.status(statusCode).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to pause subscription",
    });
  }
});

/**
 * POST /api/subscriptions/:id/resume
 * Resume a paused subscription — re-enables reminders and risk scoring
 */
router.post("/:id/resume", validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const requestHash = idempotencyService.hashRequest(req.body);

    if (idempotencyKey) {
      const idempotencyCheck = await idempotencyService.checkIdempotency(
        idempotencyKey,
        req.user!.id,
        requestHash,
      );

      if (idempotencyCheck.isDuplicate && idempotencyCheck.cachedResponse) {
        return res
          .status(idempotencyCheck.cachedResponse.status)
          .json(idempotencyCheck.cachedResponse.body);
      }
    }

    const result = await subscriptionService.resumeSubscription(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    );

    const responseBody = {
      success: true,
      data: result.subscription,
      blockchain: {
        synced: result.syncStatus === "synced",
        transactionHash: result.blockchainResult?.transactionHash,
        error: result.blockchainResult?.error,
      },
    };

    const statusCode = result.syncStatus === "failed" ? 207 : 200;

    if (idempotencyKey) {
      await idempotencyService.storeResponse(
        idempotencyKey,
        req.user!.id,
        requestHash,
        statusCode,
        responseBody,
      );
    }

    res.status(statusCode).json(responseBody);
  } catch (error) {
    logger.error("Resume subscription error:", error);
    const statusCode =
      error instanceof Error && error.message.includes("not found") ? 404
      : error instanceof Error && error.message.includes("not paused") ? 409
      : 500;
    res.status(statusCode).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to resume subscription",
    });
  }
});

/**
 * POST /api/subscriptions/bulk
 * Bulk operations (delete, update status, etc.)
 */
router.post('/bulk', validateBulkSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { operation, ids, data } = req.body;

    if (!operation || !ids || !Array.isArray(ids)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: operation, ids',
      });
    }

    const results = [];
    const errors = [];

    for (const id of ids) {
      try {
        let result;
        switch (operation) {
          case 'delete':
            result = await subscriptionService.deleteSubscription(req.user!.id, id);
            break;
          case 'update':
            if (!data) throw new Error('Update data required');
            result = await subscriptionService.updateSubscription(req.user!.id, id, data);
            break;
          default:
            throw new Error(`Unknown operation: ${operation}`);
        }
        results.push({ id, success: true, result });
      } catch (error) {
        errors.push({ id, error: error instanceof Error ? error.message : String(error) });
      }
    }

    res.json({
      success: errors.length === 0,
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    logger.error('Bulk operation error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to perform bulk operation',
    });
  }
});

/**
 * PATCH /api/subscriptions/:id/notification-preferences
 * Create or update per-subscription notification preferences
 */
router.patch(
  '/:id/notification-preferences',
  validateSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const validation = notificationPreferencesSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          error: validation.error.errors.map((e) => e.message).join(', '),
        });
      }

      const subscriptionId = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;

      const preferences = await notificationPreferenceService.upsertPreferences(
        subscriptionId,
        validation.data,
      );

      res.json({ success: true, data: preferences });
    } catch (error) {
      logger.error('Update notification preferences error:', error);
      res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to update notification preferences',
      });
    }
  },
);

/**
 * POST /api/subscriptions/:id/snooze
 * Mute reminders for a subscription until a specific date
 */
router.post(
  '/:id/snooze',
  validateSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const validation = snoozeSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          error: validation.error.errors.map((e) => e.message).join(', '),
        });
      }

      const subscriptionId = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;

      const preferences = await notificationPreferenceService.snooze(
        subscriptionId,
        validation.data.until,
      );

      res.json({
        success: true,
        data: preferences,
        message: `Reminders snoozed until ${validation.data.until}`,
      });
    } catch (error) {
      logger.error('Snooze subscription error:', error);

      const isValidationError =
        error instanceof Error &&
        (error.message.includes('Invalid snooze date') ||
          error.message.includes('must be in the future'));

      res.status(isValidationError ? 400 : 500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to snooze subscription',
      });
    }
  },
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractWaitTime(message: string): number {
  const match = message.match(/wait (\d+) seconds/);
  return match ? parseInt(match[1], 10) : 60;
}

// ─── CSV Import ─────────────────────────────────────────────────────────────

/**
 * GET /api/subscriptions/import/template
 * Download the CSV template.
 */
router.get('/import/template', authenticate, (_req: AuthenticatedRequest, res: Response) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="syncro-import-template.csv"');
  res.send(CSV_TEMPLATE);
});

/**
 * POST /api/subscriptions/import
 * Preview (default) or commit (commit=true) a CSV import.
 *
 * Query params:
 *   commit=true        — save valid rows instead of just previewing
 *   skip_dupes=false   — import duplicates anyway (default: skip)
 */
router.post(
  '/import',
  authenticate,
  upload.single('file'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No CSV file uploaded' });
      }

      const isCommit = req.query.commit === 'true';
      const skipDupes = req.query.skip_dupes !== 'false';

      // Always preview first (validates + deduplicates)
      const preview = await previewImport(req.file.buffer, userId);

      if (!isCommit) {
        return res.status(200).json({ success: true, data: { preview } });
      }

      // Commit
      const result = await commitImport(preview.rows, userId, skipDupes);

      // Log to audit trail
      await auditService.insertEntry({
        userId,
        action: 'csv_import',
        resourceType: 'subscription',
        metadata: {
          imported: result.imported,
          skipped: result.skipped,
          errors: result.errors,
          filename: req.file.originalname,
        },
      });

      logger.info('CSV import committed', { userId, ...result });

      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Import failed';
      logger.error('CSV import error:', error);
      return res.status(400).json({ success: false, error: message });
    }
  },
);

export default router;