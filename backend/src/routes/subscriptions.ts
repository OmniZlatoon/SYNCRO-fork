import { Router, Response } from "express";
import { z } from "zod";
import { subscriptionService } from "../services/subscription-service";
import { giftCardService } from "../services/gift-card-service";
import { idempotencyService } from "../services/idempotency";
import { authenticate, AuthenticatedRequest } from "../middleware/auth";
import {
  validateSubscriptionOwnership,
  validateBulkSubscriptionOwnership,
} from "../middleware/ownership";
import logger from "../config/logger";

function getParam(param: string | string[] | undefined): string | null {
  if (!param || Array.isArray(param)) return null;
  return param;
}

// Zod schema for URL fields — only http/https allowed
const safeUrlSchema = z
  .string()
  .url("Must be a valid URL")
  .refine(
    (val) => {
      try {
        const { protocol } = new URL(val);
        return protocol === "http:" || protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "URL must use http or https protocol" },
  );

// Validation schema for subscription create input
const createSubscriptionSchema = z.object({
  name: z.string().min(1),
  price: z.number(),
  billing_cycle: z.enum(["monthly", "yearly", "quarterly"]),
  renewal_url: safeUrlSchema.optional(),
  website_url: safeUrlSchema.optional(),
  logo_url: safeUrlSchema.optional(),
});

// Validation schema for subscription update input
const updateSubscriptionSchema = z
  .object({
    renewal_url: safeUrlSchema.optional(),
    website_url: safeUrlSchema.optional(),
    logo_url: safeUrlSchema.optional(),
  })
  .passthrough();

const router: Router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/subscriptions
 * List user's subscriptions with optional filtering
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
 */
router.get(
  "/:id",
  validateSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const subscription = await subscriptionService.getSubscription(
        req.user!.id,
        Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
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
  },
);

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

    // Validate URL fields
    const urlValidation = createSubscriptionSchema.safeParse(req.body);
    if (!urlValidation.success) {
      return res.status(400).json({
        success: false,
        error: urlValidation.error.errors.map((e) => e.message).join(", "),
      });
    }

    // Create subscription
    const result = await subscriptionService.createSubscription(
      req.user!.id,
      req.body,
      idempotencyKey || undefined,
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
 */
router.patch(
  "/:id",
  validateSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
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
          error: urlValidation.error.errors.map((e) => e.message).join(", "),
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
          error instanceof Error
            ? error.message
            : "Failed to update subscription",
      });
    }
  },
);

/**
 * DELETE /api/subscriptions/:id
 * Delete subscription
 */
router.delete(
  "/:id",
  validateSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await subscriptionService.cancelSubscription(
        req.user!.id,
        Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
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
  },
);

/**
 * POST /api/subscriptions/:id/attach-gift-card
 * Attach gift card info to a subscription
 */
router.post(
  "/:id/attach-gift-card",
  validateSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const subscriptionId = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;
      if (!subscriptionId) {
        return res
          .status(400)
          .json({ success: false, error: "Subscription ID required" });
      }
      const { giftCardHash, provider } = req.body;

      if (!giftCardHash || !provider) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: giftCardHash, provider",
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
          result.error?.includes("not found") ||
          result.error?.includes("access denied")
            ? 404
            : 400;
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
      logger.error("Attach gift card error:", error);
      res.status(500).json({
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to attach gift card",
      });
    }
  },
);

/**
 * POST /api/subscriptions/:id/retry-sync
 * Retry blockchain sync for a subscription
 * Enforces cooldown period to prevent rapid repeated attempts
 */
router.post(
  "/:id/retry-sync",
  validateSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
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
      const errorMessage =
        error instanceof Error ? error.message : "Failed to retry sync";

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
  },
);

/**
 * GET /api/subscriptions/:id/cooldown-status
 * Check if a subscription can be retried or if cooldown is active
 */
router.get(
  "/:id/cooldown-status",
  validateSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    const id = getParam(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Invalid subscription id",
      });
    }
    try {
      const cooldownStatus = await subscriptionService.checkRenewalCooldown(id);

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
        error:
          error instanceof Error
            ? error.message
            : "Failed to check cooldown status",
      });
    }
  },
);

// Helper function to extract wait time from error message
function extractWaitTime(message: string): number {
  const match = message.match(/wait (\d+) seconds/);
  return match ? parseInt(match[1], 10) : 60;
}

/**
 * POST /api/subscriptions/:id/cancel
 * Cancel subscription with blockchain sync
 */
router.post(
  "/:id/cancel",
  validateSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    const id = getParam(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Invalid subscription id",
      });
    }
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
        id,
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
  },
);

/**
 * POST /api/subscriptions/bulk
 * Bulk operations (delete, update status, etc.)
 */
router.post(
  "/bulk",
  validateBulkSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
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
              result = await subscriptionService.cancelSubscription(
                req.user!.id,
                id,
              );
              break;
            case "update":
              if (!data) throw new Error("Update data required");
              result = await subscriptionService.updateSubscription(
                req.user!.id,
                id,
                data,
              );
              break;
            default:
              throw new Error(`Unknown operation: ${operation}`);
          }
          results.push({ id, success: true, result });
        } catch (error) {
          errors.push({
            id,
            error: error instanceof Error ? error.message : String(error),
          });
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
        error:
          error instanceof Error
            ? error.message
            : "Failed to perform bulk operation",
      });
    }
  },
);

export default router;
