import { Router, Response } from "express";
import { subscriptionService } from "../services/subscription-service";
import { idempotencyService } from "../services/idempotency";
import { authenticate, AuthenticatedRequest } from "../middleware/auth";
import {
  validateSubscriptionOwnership,
  validateBulkSubscriptionOwnership,
} from "../middleware/ownership";
import logger from "../config/logger";

const router = Router();

// All routes require authentication
router.use(authenticate);
import * as bip39 from 'bip39';

/**
 * @openapi
 * /api/subscriptions:
 *   get:
 *     tags: [Subscriptions]
 *     summary: List subscriptions
 *     description: Returns all subscriptions for the authenticated user with optional filtering.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, cancelled, expired] }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: List of subscriptions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Subscription' }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, category, limit, offset } = req.query;

    const result = await subscriptionService.listSubscriptions(req.user!.id, {
      status: status as string | undefined,
      category: category as string | undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
    });

    res.json({
      success: true,
      data: result.subscriptions,
      pagination: {
        total: result.total,
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
      },
    });
  } catch (error) {
    logger.error("List subscriptions error:", error);
    res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to list subscriptions",
    });
  }
});

/**
 * GET /api/subscriptions/:id
 * Get single subscription by ID
 * @openapi
 * /api/subscriptions/{id}:
 *   get:
 *     tags: [Subscriptions]
 *     summary: Get a subscription
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Subscription object
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Subscription' }
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not found
 */
router.get("/:id", validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const subscription = await subscriptionService.getSubscription(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    );

    res.json({
      success: true,
      data: subscription,
    });
  } catch (error) {
    logger.error("Get subscription error:", error);
    const statusCode =
      error instanceof Error && error.message.includes("not found")
        ? 404
        : 500;
    res.status(statusCode).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to get subscription",
    });
  }
});

/**
 * GET /api/subscriptions/:id/price-history
 * Get price history for a subscription
 */
router.get("/:id/price-history", validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const history = await subscriptionService.getPriceHistory(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    );

    res.json({
      success: true,
      data: history,
    });
  } catch (error) {
    logger.error("Get price history error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get price history",
    });
  }
});

/**
 * POST /api/subscriptions
 * Create new subscription with idempotency support
 * @openapi
 * /api/subscriptions:
 *   post:
 *     tags: [Subscriptions]
 *     summary: Create a subscription
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         schema: { type: string }
 *         description: Optional key to prevent duplicate submissions
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, price, billing_cycle]
 *             properties:
 *               name: { type: string, example: Netflix }
 *               price: { type: number, example: 15.99 }
 *               billing_cycle: { type: string, enum: [monthly, yearly, quarterly] }
 *               renewal_url: { type: string, format: uri }
 *               website_url: { type: string, format: uri }
 *               logo_url: { type: string, format: uri }
 *     responses:
 *       201:
 *         description: Subscription created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Subscription' }
 *                 blockchain: { $ref: '#/components/schemas/BlockchainResult' }
 *       207:
 *         description: Created but blockchain sync failed
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const requestHash = idempotencyService.hashRequest(req.body);

    // Check idempotency if key provided
    if (idempotencyKey) {
      const idempotencyCheck = await idempotencyService.checkIdempotency(
        idempotencyKey,
        req.user!.id,
        requestHash,
      );

      if (idempotencyCheck.isDuplicate && idempotencyCheck.cachedResponse) {
        logger.info("Returning cached response for idempotent request", {
          idempotencyKey,
          userId: req.user!.id,
        });

        return res
          .status(idempotencyCheck.cachedResponse.status)
          .json(idempotencyCheck.cachedResponse.body);
      }
    }

    // Validate input
    const { name, price, billing_cycle } = req.body;
    if (!name || price === undefined || !billing_cycle) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: name, price, billing_cycle",
      });
    }

    // Validate URL fields
    const urlValidation = createSubscriptionSchema.safeParse(req.body);
    if (!urlValidation.success) {
      return res.status(400).json({
        success: false,
        error: urlValidation.error.errors.map((e) => e.message).join(', '),
      });
    }

    // Create subscription
    const result = await subscriptionService.createSubscription(
      req.user!.id,
      req.body,
      idempotencyKey || undefined
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

    const statusCode = result.syncStatus === "failed" ? 207 : 201;

    // Store idempotency record if key provided
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
    logger.error("Create subscription error:", error);
    res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create subscription",
    });
  }
});

/**
 * PATCH /api/subscriptions/:id
 * Update subscription with optimistic locking
 * @openapi
 * /api/subscriptions/{id}:
 *   patch:
 *     tags: [Subscriptions]
 *     summary: Update a subscription
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: Idempotency-Key
 *         schema: { type: string }
 *       - in: header
 *         name: If-Match
 *         schema: { type: string }
 *         description: Expected version for optimistic locking
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               price: { type: number }
 *               billing_cycle: { type: string, enum: [monthly, yearly, quarterly] }
 *               renewal_url: { type: string, format: uri }
 *               website_url: { type: string, format: uri }
 *               logo_url: { type: string, format: uri }
 *     responses:
 *       200:
 *         description: Updated subscription
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Subscription' }
 *                 blockchain: { $ref: '#/components/schemas/BlockchainResult' }
 *       207:
 *         description: Updated but blockchain sync failed
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not found
 */
router.patch("/:id", validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const requestHash = idempotencyService.hashRequest(req.body);

    // Check idempotency if key provided
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

    const expectedVersion = req.headers["if-match"] as string;

    // Validate URL fields
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
        synced: result.syncStatus === "synced",
        transactionHash: result.blockchainResult?.transactionHash,
        error: result.blockchainResult?.error,
      },
    };

    const statusCode = result.syncStatus === "failed" ? 207 : 200;

    // Store idempotency record if key provided
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
    logger.error("Update subscription error:", error);
    const statusCode =
      error instanceof Error && error.message.includes("not found")
        ? 404
        : 500;
    res.status(statusCode).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to update subscription",
    });
  }
});

/**
 * DELETE /api/subscriptions/:id
 * Delete subscription
 * @openapi
 * /api/subscriptions/{id}:
 *   delete:
 *     tags: [Subscriptions]
 *     summary: Delete a subscription
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Deleted
 *       207:
 *         description: Deleted but blockchain sync failed
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not found
 */
router.delete("/:id", validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await subscriptionService.deleteSubscription(
    const result = await subscriptionService.cancelSubscription(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    );

    const responseBody = {
      success: true,
      message: "Subscription deleted",
      blockchain: {
        synced: result.syncStatus === "synced",
        transactionHash: result.blockchainResult?.transactionHash,
        error: result.blockchainResult?.error,
      },
    };

    const statusCode = result.syncStatus === "failed" ? 207 : 200;

    res.status(statusCode).json(responseBody);
  } catch (error) {
    logger.error("Delete subscription error:", error);
    const statusCode =
      error instanceof Error && error.message.includes("not found")
        ? 404
        : 500;
    res.status(statusCode).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to delete subscription",
    });
  }
});

/**
 * POST /api/subscriptions/:id/attach-gift-card
 * Attach gift card info to a subscription
 * @openapi
 * /api/subscriptions/{id}/attach-gift-card:
 *   post:
 *     tags: [Subscriptions]
 *     summary: Attach a gift card to a subscription
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [giftCardHash, provider]
 *             properties:
 *               giftCardHash: { type: string }
 *               provider: { type: string }
 *     responses:
 *       201:
 *         description: Gift card attached
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Subscription not found
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
      provider
    );

    if (!result.success) {
      const statusCode = result.error?.includes('not found') || result.error?.includes('access denied') ? 404 : 400;
      return res.status(statusCode).json({
        success: false,
        error: result.error,
      });
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
 * Retry blockchain sync for a subscription
 * Enforces cooldown period to prevent rapid repeated attempts
 * @openapi
 * /api/subscriptions/{id}/retry-sync:
 *   post:
 *     tags: [Subscriptions]
 *     summary: Retry blockchain sync for a subscription
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Sync result
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Cooldown period active
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 error: { type: string }
 *                 retryAfter: { type: integer, description: Seconds to wait }
 */
router.post("/:id/retry-sync", validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await subscriptionService.retryBlockchainSync(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    );

    res.json({
      success: result.success,
      transactionHash: result.transactionHash,
      error: result.error,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed to retry sync";
    
    // Check if it's a cooldown error
    if (errorMessage.includes("Cooldown period active")) {
      logger.warn("Retry sync rejected due to cooldown:", errorMessage);
      return res.status(429).json({
        success: false,
        error: errorMessage,
        retryAfter: extractWaitTime(errorMessage),
      });
    }
    
    logger.error("Retry sync error:", error);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * GET /api/subscriptions/:id/cooldown-status
 * Check if a subscription can be retried or if cooldown is active
 * @openapi
 * /api/subscriptions/{id}/cooldown-status:
 *   get:
 *     tags: [Subscriptions]
 *     summary: Check retry cooldown status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Cooldown status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 canRetry: { type: boolean }
 *                 isOnCooldown: { type: boolean }
 *                 timeRemainingSeconds: { type: integer, nullable: true }
 *                 message: { type: string }
 *       401:
 *         description: Unauthorized
 */
router.get("/:id/cooldown-status", validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const cooldownStatus = await subscriptionService.checkRenewalCooldown(
      req.params.id,
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
    logger.error("Cooldown status check error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to check cooldown status",
    });
  }
});

// Helper function to extract wait time from error message
function extractWaitTime(message: string): number {
  const match = message.match(/wait (\d+) seconds/);
  return match ? parseInt(match[1], 10) : 60;
export function generateMnemonic(): string {
  return bip39.generateMnemonic(128);
}

/**
 * POST /api/subscriptions/:id/trial/convert
 * Mark a trial as intentionally converted to paid ("Keep My Subscription").
 * Logs the conversion event and updates the subscription status.
 */
router.post('/:id/trial/convert', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const subId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const { data: sub, error: fetchErr } = await (await import('../config/database')).supabase
      .from('subscriptions')
      .select('*')
      .eq('id', subId)
      .eq('user_id', req.user!.id)
      .single();

    if (fetchErr || !sub) {
      return res.status(404).json({ success: false, error: 'Subscription not found' });
    }

    if (!sub.is_trial) {
      return res.status(400).json({ success: false, error: 'Subscription is not a trial' });
    }

    const db = (await import('../config/database')).supabase;

    // Update subscription: mark as active paid subscription
    await db.from('subscriptions').update({
      is_trial: false,
      status: 'active',
      price: sub.trial_converts_to_price ?? sub.price_after_trial ?? sub.price,
      updated_at: new Date().toISOString(),
    }).eq('id', subId);

    // Log conversion event
    await db.from('trial_conversion_events').insert({
      subscription_id: subId,
      user_id: req.user!.id,
      outcome: 'converted',
      conversion_type: 'intentional',
      saved_by_syncro: false,
      converted_price: sub.trial_converts_to_price ?? sub.price_after_trial ?? sub.price,
    });

    res.json({ success: true, message: 'Trial converted to paid subscription' });
  } catch (error) {
    logger.error('Trial convert error:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to convert trial' });
  }
});

/**
 * POST /api/subscriptions/:id/trial/cancel
 * Cancel a trial before auto-charge. Counts toward "Saved by SYNCRO" metric.
 */
router.post('/:id/trial/cancel', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const subId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { acted_on_reminder_days } = req.body;

    const db = (await import('../config/database')).supabase;

    const { data: sub, error: fetchErr } = await db
      .from('subscriptions')
      .select('*')
      .eq('id', subId)
      .eq('user_id', req.user!.id)
      .single();

    if (fetchErr || !sub) {
      return res.status(404).json({ success: false, error: 'Subscription not found' });
    }

    if (!sub.is_trial) {
      return res.status(400).json({ success: false, error: 'Subscription is not a trial' });
    }

    // Cancel the subscription
    await db.from('subscriptions').update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', subId);

    // Log cancellation — saved_by_syncro = true when credit card was on file
    await db.from('trial_conversion_events').insert({
      subscription_id: subId,
      user_id: req.user!.id,
      outcome: 'cancelled',
      conversion_type: 'intentional',
      saved_by_syncro: sub.credit_card_required === true,
      acted_on_reminder_days: acted_on_reminder_days ?? null,
    });

    res.json({ success: true, message: 'Trial cancelled successfully' });
  } catch (error) {
    logger.error('Trial cancel error:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to cancel trial' });
  }
});

/**
 * GET /api/subscriptions/trials/saved-metric
 * Returns the "Saved by SYNCRO" count — trials cancelled before auto-charge.
 */
router.get('/trials/saved-metric', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = (await import('../config/database')).supabase;

    const { count, error } = await db
      .from('trial_conversion_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.user!.id)
      .eq('saved_by_syncro', true);

    if (error) throw error;

    res.json({ success: true, savedCount: count ?? 0 });
  } catch (error) {
    logger.error('Saved metric error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch saved metric' });
  }
});

/**
 * POST /api/subscriptions/:id/cancel
 * Cancel subscription with blockchain sync
 * @openapi
 * /api/subscriptions/{id}/cancel:
 *   post:
 *     tags: [Subscriptions]
 *     summary: Cancel a subscription
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: Idempotency-Key
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Cancelled
 *       207:
 *         description: Cancelled but blockchain sync failed
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not found
 * Generates a standard BIP39 12-word mnemonic phrase.
export function generateMnemonic(): string {
  return bip39.generateMnemonic(128);
 * Validates a given mnemonic phrase (must be 12 words).
 */
router.get("/:id", validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const subscription = await subscriptionService.getSubscription(
      req.user!.id,
      req.params.id,
    );

    res.json({
      success: true,
      data: subscription,
    });
  } catch (error) {
    logger.error("Get subscription error:", error);
router.post("/:id/cancel", validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const requestHash = idempotencyService.hashRequest(req.body);
    // Check idempotency if key provided
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
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    const responseBody = {
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
    logger.error("Cancel subscription error:", error);
    const statusCode =
      error instanceof Error && error.message.includes("not found")
        ? 404
        : 500;
    res.status(statusCode).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to get subscription",
        error instanceof Error
          ? error.message
          : "Failed to cancel subscription",
    });
export function validateMnemonic(mnemonic: string): boolean {
  if (!mnemonic || typeof mnemonic !== 'string') {
    return false;
  }

/**
 * POST /api/subscriptions
 * Create new subscription with idempotency support
 */
router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const requestHash = idempotencyService.hashRequest(req.body);

    // Check idempotency if key provided
    if (idempotencyKey) {
      const idempotencyCheck = await idempotencyService.checkIdempotency(
        idempotencyKey,
        req.user!.id,
        requestHash,
      );

      if (idempotencyCheck.isDuplicate && idempotencyCheck.cachedResponse) {
        logger.info("Returning cached response for idempotent request", {
          idempotencyKey,
          userId: req.user!.id,
        });

        return res
          .status(idempotencyCheck.cachedResponse.status)
          .json(idempotencyCheck.cachedResponse.body);
      }
    }

    // Validate input
    const { name, price, billing_cycle } = req.body;
    if (!name || price === undefined || !billing_cycle) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: name, price, billing_cycle",
      });
    }

    // Create subscription
    const result = await subscriptionService.createSubscription(
      req.user!.id,
      req.body,
      idempotencyKey,
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

    const statusCode = result.syncStatus === "failed" ? 207 : 201;

    // Store idempotency record if key provided
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
    logger.error("Create subscription error:", error);
    res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create subscription",
 * POST /api/subscriptions/bulk
 * Bulk operations (delete, update status, etc.)
router.post("/bulk", validateBulkSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
    const { operation, ids, data } = req.body;
    if (!operation || !ids || !Array.isArray(ids)) {
        error: "Missing required fields: operation, ids",
    const results = [];
    const errors = [];
 * @openapi
 * /api/subscriptions/bulk:
 *   post:
 *     tags: [Subscriptions]
 *     summary: Bulk operations on subscriptions
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [operation, ids]
 *             properties:
 *               operation: { type: string, enum: [delete, update] }
 *               ids:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *               data:
 *                 type: object
 *                 description: Required when operation is "update"
 *     responses:
 *       200:
 *         description: Bulk operation results
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
    for (const id of ids) {
      try {
        let result;
        switch (operation) {
          case "delete":
            result = await subscriptionService.cancelSubscription(req.user!.id, id);
            result = await subscriptionService.deleteSubscription(req.user!.id, id);
            break;
          case "update":
            if (!data) throw new Error("Update data required");
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
    logger.error("Bulk operation error:", error);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to perform bulk operation",
    });
  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 12) {
    return false;
  }

/**
 * PATCH /api/subscriptions/:id
 * Update subscription with optimistic locking
 */
router.patch("/:id", validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const requestHash = idempotencyService.hashRequest(req.body);

    // Check idempotency if key provided
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

    const expectedVersion = req.headers["if-match"] as string;

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
        synced: result.syncStatus === "synced",
        transactionHash: result.blockchainResult?.transactionHash,
        error: result.blockchainResult?.error,
      },
    };

    const statusCode = result.syncStatus === "failed" ? 207 : 200;

    // Store idempotency record if key provided
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
    logger.error("Update subscription error:", error);
    const statusCode =
      error instanceof Error && error.message.includes("not found")
        ? 404
        : 500;
    res.status(statusCode).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to update subscription",
    });
  }
});

/**
 * DELETE /api/subscriptions/:id
 * Delete subscription
 */
router.delete("/:id", validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await subscriptionService.deleteSubscription(
      req.user!.id,
      req.params.id,
    );

    const responseBody = {
      success: true,
      message: "Subscription deleted",
      blockchain: {
        synced: result.syncStatus === "synced",
        transactionHash: result.blockchainResult?.transactionHash,
        error: result.blockchainResult?.error,
      },
    };

    const statusCode = result.syncStatus === "failed" ? 207 : 200;

    res.status(statusCode).json(responseBody);
  } catch (error) {
    logger.error("Delete subscription error:", error);
    const statusCode =
      error instanceof Error && error.message.includes("not found")
        ? 404
        : 500;
    res.status(statusCode).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to delete subscription",
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
      provider
    );

    if (!result.success) {
      const statusCode = result.error?.includes('not found') || result.error?.includes('access denied') ? 404 : 400;
      return res.status(statusCode).json({
        success: false,
        error: result.error,
      });
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
 * Retry blockchain sync for a subscription
 */
router.post("/:id/retry-sync", validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await subscriptionService.retryBlockchainSync(
      req.user!.id,
      req.params.id,
    );

    res.json({
      success: result.success,
      transactionHash: result.transactionHash,
      error: result.error,
    });
  } catch (error) {
    logger.error("Retry sync error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to retry sync",
    });
  }
});

/**
 * POST /api/subscriptions/:id/cancel
 * Cancel subscription with blockchain sync
 */
router.post("/:id/cancel", validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const requestHash = idempotencyService.hashRequest(req.body);

    // Check idempotency if key provided
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
      req.params.id,
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
    logger.error("Cancel subscription error:", error);
    const statusCode =
      error instanceof Error && error.message.includes("not found")
        ? 404
        : 500;
    res.status(statusCode).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to cancel subscription",
    });
  }
});

/**
 * POST /api/subscriptions/bulk
 * Bulk operations (delete, update status, etc.)
 */
router.post("/bulk", validateBulkSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { operation, ids, data } = req.body;

    if (!operation || !ids || !Array.isArray(ids)) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: operation, ids",
      });
    }

    const results = [];
    const errors = [];

    for (const id of ids) {
      try {
        let result;
        switch (operation) {
          case "delete":
            result = await subscriptionService.deleteSubscription(req.user!.id, id);
            break;
          case "update":
            if (!data) throw new Error("Update data required");
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
    logger.error("Bulk operation error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to perform bulk operation",
    });
  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 12) {
    return false;
  }
});

export default router;
  return bip39.validateMnemonic(words.join(' '));
}
