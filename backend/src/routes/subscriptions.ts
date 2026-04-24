import { Router, Response } from "express";
import { z } from "zod";
import { giftCardService } from "../services/gift-card-service";
import { idempotencyService } from "../services/idempotency";
import {
  authenticate,
  AuthenticatedRequest,
  requireScope,
} from "../middleware/auth";
import {
  validateSubscriptionOwnership,
  validateBulkSubscriptionOwnership,
} from "../middleware/ownership";
import logger from "../config/logger";
import { SUPPORTED_CURRENCIES } from "../constants/currencies";

const router: Router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────

function getParam(param: string | string[] | undefined): string | null {
  if (!param || Array.isArray(param)) return null;
  return param;
}

// ─── Validation ──────────────────────────────────────────────────────────

const safeUrlSchema = z
  .string()
  .url("Must be a valid URL")
  .refine((val) => {
    try {
      const { protocol } = new URL(val);
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  });

const createSubscriptionSchema = z.object({
  name: z.string().min(1),
  price: z.number(),
  billing_cycle: z.enum(["monthly", "yearly", "quarterly"]),
  currency: z
    .string()
    .refine(
      (val) => (SUPPORTED_CURRENCIES as readonly string[]).includes(val),
      {
        message: `Currency must be one of: ${SUPPORTED_CURRENCIES.join(", ")}`,
      },
    )
    .optional(),
  renewal_url: safeUrlSchema.optional(),
  website_url: safeUrlSchema.optional(),
  logo_url: safeUrlSchema.optional(),
});

const updateSubscriptionSchema = z
  .object({
    renewal_url: safeUrlSchema.optional(),
    website_url: safeUrlSchema.optional(),
    logo_url: safeUrlSchema.optional(),
  })
  .passthrough();

// ─── Middleware ──────────────────────────────────────────────────────────

router.use(authenticate);

// ─── Routes ──────────────────────────────────────────────────────────────

// GET list
router.get(
  "/",
  requireScope("subscriptions:read"),
  async (req: AuthenticatedRequest, res: Response) => {
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
          error instanceof Error
            ? error.message
            : "Failed to list subscriptions",
      });
    }
  },
);

// GET single
router.get(
  "/:id",
  requireScope("subscriptions:read"),
  validateSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = getParam(req.params.id);
      if (!id)
        return res.status(400).json({ success: false, error: "Invalid id" });

      const subscription = await subscriptionService.getSubscription(
        req.user!.id,
        id,
      );

      res.json({ success: true, data: subscription });
    } catch (error) {
      logger.error("Get subscription error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to get subscription" });
    }
  },
);

// CREATE
router.post(
  "/",
  requireScope("subscriptions:write"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const validation = createSubscriptionSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          error: validation.error.errors.map((e) => e.message).join(", "),
        });
      }

      const result = await subscriptionService.createSubscription(
        req.user!.id,
        validation.data,
      );

      res.status(201).json({ success: true, data: result.subscription });
    } catch (error) {
      logger.error("Create subscription error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to create subscription" });
    }
  },
);

// UPDATE
router.patch(
  "/:id",
  requireScope("subscriptions:write"),
  validateSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = getParam(req.params.id);
      if (!id)
        return res.status(400).json({ success: false, error: "Invalid id" });

      const validation = updateSubscriptionSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          error: validation.error.errors.map((e) => e.message).join(", "),
        });
      }

      const result = await subscriptionService.updateSubscription(
        req.user!.id,
        id,
        validation.data,
      );

      res.json({ success: true, data: result.subscription });
    } catch (error) {
      logger.error("Update subscription error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to update subscription" });
    }
  },
);

// DELETE
router.delete(
  "/:id",
  requireScope("subscriptions:write"),
  validateSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = getParam(req.params.id);
      if (!id)
        return res.status(400).json({ success: false, error: "Invalid id" });

      const result = await subscriptionService.cancelSubscription(
        req.user!.id,
        id,
      );

      res.json({
        success: true,
        message: "Subscription deleted",
      });
    } catch (error) {
      logger.error("Delete subscription error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to delete subscription" });
    }
  },
);

// BULK
router.post(
  "/bulk",
  validateBulkSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { operation, ids, data } = req.body;

      const results = [];
      const errors = [];

      for (const id of ids) {
        try {
          let result;
          if (operation === "delete") {
            result = await subscriptionService.cancelSubscription(
              req.user!.id,
              id,
            );
          } else if (operation === "update") {
            result = await subscriptionService.updateSubscription(
              req.user!.id,
              id,
              data,
            );
          }
          results.push({ id, success: true, result });
        } catch (e) {
          errors.push({ id, error: String(e) });
        }
      }

      res.json({ success: errors.length === 0, results, errors });
    } catch (error) {
      logger.error("Bulk error:", error);
      res.status(500).json({ success: false });
    }
  },
);

export default router;
