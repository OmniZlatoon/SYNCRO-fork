import { supabase } from "../config/database";
import { blockchainService } from "./blockchain-service";
import { renewalCooldownService } from "./renewal-cooldown-service";
import { analyticsService } from "./analytics-service";
import { webhookService } from "./webhook-service";
import logger from "../config/logger";
import { DatabaseTransaction } from "../utils/transaction";
import type {
  Subscription,
  SubscriptionCreateInput,
  SubscriptionUpdateInput,
  ListSubscriptionsOptions,
  ListSubscriptionsResult,
} from "../types/subscription";

export interface BlockchainSyncResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
}

export interface SubscriptionSyncResult {
  subscription: Subscription;
  blockchainResult?: BlockchainSyncResult;
  syncStatus: "synced" | "partial" | "failed";
}

/**
 * Subscription service with blockchain sync and transaction management
 */
export class SubscriptionService {
  async createSubscription(
    userId: string,
    input: SubscriptionCreateInput,
    idempotencyKey?: string,
  ): Promise<SubscriptionSyncResult> {
    return await DatabaseTransaction.execute(async (client) => {
      try {
        const { data: subscription, error: dbError } = await client
          .from("subscriptions")
          .insert({
            user_id: userId,
            name: input.name,
            provider: input.provider || input.name,
            price: input.price,
            currency: input.currency || 'USD',
            billing_cycle: input.billing_cycle,
            status: input.status || "active",
            next_billing_date: input.next_billing_date || null,
            category: input.category || null,
            logo_url: input.logo_url || null,
            website_url: input.website_url || null,
            renewal_url: input.renewal_url || null,
            notes: input.notes || null,
            visibility: input.visibility || "private",
            tags: input.tags || [],
            email_account_id: input.email_account_id || null,
            updated_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (dbError) {
          throw new Error(`Database error: ${dbError.message}`);
        }

        // Attempt blockchain sync (non-blocking)
        let blockchainResult;
        let syncStatus: "synced" | "partial" | "failed" = "synced";

        try {
          blockchainResult = await blockchainService.syncSubscription(
            userId,
            subscription.id,
            "create",
            subscription,
          );

          if (!blockchainResult.success) {
            syncStatus = "partial";
            logger.warn("Blockchain sync failed for subscription creation", {
              subscriptionId: subscription.id,
              error: blockchainResult.error,
            });
          }
        } catch (blockchainError) {
          syncStatus = "partial";
          logger.error("Blockchain sync error (non-fatal):", blockchainError);
          blockchainResult = {
            success: false,
            error:
              blockchainError instanceof Error
                ? blockchainError.message
                : String(blockchainError),
          };
        }

        // Trigger budget check (don't let it block response)
        analyticsService.checkBudgetThreshold(userId).catch(e => 
          logger.error('Background budget check failed:', e)
        );

        return {
          subscription,
          blockchainResult,
          syncStatus,
        };
      } catch (error) {
        logger.error("Subscription creation failed:", error);
        throw error;
      }
    });
  }

  /**
   * Delete subscription with blockchain sync
   * Soft delete: sets status to 'deleted' and removes reminders
   */
  async deleteSubscription(
    userId: string,
    subscriptionId: string,
  ): Promise<SubscriptionSyncResult> {
    return await DatabaseTransaction.execute(async (client) => {
      try {
        // 1. Verify ownership and get subscription details
        const { data: existing, error: fetchError } = await client
          .from("subscriptions")
          .select("*")
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .single();

        if (fetchError || !existing) {
          throw new Error("Subscription not found or access denied");
        }

        // If already deleted, return early
        if (existing.status === "deleted") {
          return {
            subscription: existing as Subscription,
            syncStatus: "synced",
          };
        }

        // 2. Soft delete - update status to deleted
        const { data: subscription, error: updateError } = await client
        // Trigger budget check
        analyticsService.checkBudgetThreshold(userId).catch(e => 
          logger.error('Background budget check failed:', e)
        );

        return {
          subscription,
          blockchainResult,
          syncStatus,
        };
      } catch (error) {
        logger.error("Subscription update failed:", error);
        throw error;
      }
    });
  }

  async cancelSubscription(
    userId: string,
    subscriptionId: string,
  ): Promise<SubscriptionSyncResult> {
    return await DatabaseTransaction.execute(async (client) => {
      try {
        const { data: subscription, error: fetchError } = await client
          .from("subscriptions")
          .select("*")
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .single();

        if (fetchError || !subscription) {
          throw new Error("Subscription not found or access denied");
        }

        if (subscription.status === "cancelled") {
          throw new Error("Subscription already cancelled");
        }

        const { data: updatedSubscription, error: updateError } = await client
          .from("subscriptions")
          .update({
            status: "deleted",
            deleted_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .select()
          .single();

        if (updateError) {
          throw new Error(`Delete failed: ${updateError.message}`);
        }

        // 3. Cancel all pending reminders for this subscription
        const { error: reminderError } = await client
          .from("reminder_schedules")
        let blockchainResult;
        let syncStatus: "synced" | "partial" | "failed" = "synced";

        try {
          blockchainResult = await blockchainService.syncSubscription(
            userId,
            subscriptionId,
            "cancel",
            updatedSubscription,
          );

          if (!blockchainResult.success) {
            syncStatus = "partial";
            logger.warn("Blockchain sync failed for subscription cancellation", {
              subscriptionId,
              error: blockchainResult.error,
            });
          }
        } catch (blockchainError) {
          syncStatus = "partial";
          logger.error("Blockchain sync error (non-fatal):", blockchainError);
          blockchainResult = {
            success: false,
            error:
              blockchainError instanceof Error
                ? blockchainError.message
                : String(blockchainError),
          };
        }

        return {
          subscription: updatedSubscription,
          blockchainResult,
          syncStatus,
        };
      } catch (error) {
        logger.error("Subscription cancellation failed:", error);
        throw error;
      }
    });
  }

  // Delete subscription with blockchain sync
  /**
   * Delete subscription with blockchain sync
   */
  async deleteSubscription(
    userId: string,
    subscriptionId: string,
  ): Promise<SubscriptionSyncResult> {
    return await DatabaseTransaction.execute(async (client) => {
      try {
        const { data: subscription, error: fetchError } = await client
          .from("subscriptions")
          .select("*")
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .single();

        if (fetchError || !subscription) {
          throw new Error("Subscription not found or access denied");
        }

        const { error: deleteError } = await client
          .from("subscriptions")
          .delete()
          .eq("subscription_id", subscriptionId);

        if (reminderError) {
          logger.warn("Failed to delete reminders during subscription deletion", {
            subscriptionId,
            error: reminderError.message,
          });
          // Don't throw - reminders cleanup failure shouldn't block deletion
        }

        // 4. Sync to blockchain (non-fatal if it fails)
        let blockchainResult;
        let syncStatus: "synced" | "partial" | "failed" = "synced";

        try {
          blockchainResult = await blockchainService.syncSubscription(
            userId,
            subscriptionId,
            "cancel",
            "delete",
            subscription,
          );

          if (!blockchainResult.success) {
            syncStatus = "partial";
            logger.warn("Blockchain sync failed for subscription deletion", {
              subscriptionId,
              error: blockchainResult.error,
            });
          }
        } catch (blockchainError) {
          syncStatus = "partial";
          logger.error("Blockchain sync error during deletion (non-fatal):", blockchainError);
          blockchainResult = {
            success: false,
            error:
              blockchainError instanceof Error
                ? blockchainError.message
                : String(blockchainError),
          };
        }

        // 5. Log audit event
        logger.info("Subscription deleted", {
          subscriptionId,
          userId,
          syncStatus,
        });
        // Trigger budget check
        analyticsService.checkBudgetThreshold(userId).catch(e => 
          logger.error('Background budget check failed:', e)
        );

        return {
          subscription,
          blockchainResult,
          syncStatus,
        };
      } catch (error) {
        logger.error("Subscription deletion failed:", error);
        throw error;
      }
    });
  }

  async pauseSubscription(
    userId: string,
    subscriptionId: string,
    resumeAt?: string,
    reason?: string,
  ): Promise<SubscriptionSyncResult> {
    return await DatabaseTransaction.execute(async (client) => {
      // 1. Fetch and verify ownership
      const { data: subscription, error: fetchError } = await client
        .from("subscriptions")
        .select("*")
        .eq("id", subscriptionId)
        .eq("user_id", userId)
        .single();

      if (fetchError || !subscription) {
        throw new Error("Subscription not found or access denied");
      }

      // 2. Guard: can only pause an active subscription
      if (subscription.status === "paused") {
        throw new Error("Subscription is already paused");
      }
      if (subscription.status === "cancelled") {
        throw new Error("Cannot pause a cancelled subscription");
      }

      // 3. Write to DB
      const { data: updatedSubscription, error: updateError } = await client
        .from("subscriptions")
        .update({
          status: "paused",
          paused_at: new Date().toISOString(),
          resume_at: resumeAt ?? null,
          pause_reason: reason ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", subscriptionId)
        .eq("user_id", userId)
        .select()
        .single();

      if (updateError) {
        throw new Error(`Pause failed: ${updateError.message}`);
      }

      // 4. Sync to blockchain (non-fatal if it fails)
      let blockchainResult;
      let syncStatus: "synced" | "partial" | "failed" = "synced";

      try {
        blockchainResult = await blockchainService.syncSubscription(
          userId,
          subscriptionId,
          "pause",         // blockchain service will call pause() on the contract
          updatedSubscription,
        );

        if (!blockchainResult.success) {
          syncStatus = "partial";
          logger.warn("Blockchain sync failed for subscription pause", {
            subscriptionId,
            error: blockchainResult.error,
          });
        }
      } catch (blockchainError) {
        syncStatus = "partial";
        logger.error("Blockchain sync error (non-fatal):", blockchainError);
        blockchainResult = {
          success: false,
          error: blockchainError instanceof Error
            ? blockchainError.message
            : String(blockchainError),
        };
      }

      return {
        subscription: updatedSubscription,
        blockchainResult,
        syncStatus,
      };
    });
  }

  async resumeSubscription(
    userId: string,
    subscriptionId: string,
  ): Promise<SubscriptionSyncResult> {
    return await DatabaseTransaction.execute(async (client) => {
      // 1. Fetch and verify ownership
      const { data: subscription, error: fetchError } = await client
        .from("subscriptions")
        .select("*")
        .eq("id", subscriptionId)
        .eq("user_id", userId)
        .single();

      if (fetchError || !subscription) {
        throw new Error("Subscription not found or access denied");
      }

      // 2. Guard: can only resume a paused subscription
      if (subscription.status !== "paused") {
        throw new Error("Subscription is not paused");
      }

      // 3. Write to DB — clear all pause fields, restore active
      const { data: updatedSubscription, error: updateError } = await client
        .from("subscriptions")
        .update({
          status: "active",
          paused_at: null,
          resume_at: null,
          pause_reason: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", subscriptionId)
        .eq("user_id", userId)
        .select()
        .single();

      if (updateError) {
        throw new Error(`Resume failed: ${updateError.message}`);
      }

      // 4. Sync to blockchain (non-fatal if it fails)
      let blockchainResult;
      let syncStatus: "synced" | "partial" | "failed" = "synced";

      try {
        blockchainResult = await blockchainService.syncSubscription(
          userId,
          subscriptionId,
          "unpause",       // blockchain service will call unpause() on the contract
          updatedSubscription,
        );

        if (!blockchainResult.success) {
          syncStatus = "partial";
          logger.warn("Blockchain sync failed for subscription resume", {
            subscriptionId,
            error: blockchainResult.error,
          });
        }
      } catch (blockchainError) {
        syncStatus = "partial";
        logger.error("Blockchain sync error (non-fatal):", blockchainError);
        blockchainResult = {
          success: false,
          error: blockchainError instanceof Error
            ? blockchainError.message
            : String(blockchainError),
        };
      }

      return {
        subscription: updatedSubscription,
        blockchainResult,
        syncStatus,
      };
    });
  }

  // Get subscription by ID (with ownership check)
        // 1. Fetch and verify ownership
        const { data: subscription, error: fetchError } = await client
          .from("subscriptions")
          .select("*")
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .single();
        if (fetchError || !subscription) {
          throw new Error("Subscription not found or access denied");
        // 2. Guard: can only pause an active subscription
        if (subscription.status === "paused") {
          throw new Error("Subscription is already paused");
        if (subscription.status === "cancelled") {
          throw new Error("Cannot pause a cancelled subscription");
        // 3. Write to DB
        const { data: updatedSubscription, error: updateError } = await client
          .from("subscriptions")
          .update({
            status: "paused",
            paused_at: new Date().toISOString(),
            resume_at: resumeAt ?? null,
            pause_reason: reason ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .select()
          .single();
        if (updateError) {
          throw new Error(`Pause failed: ${updateError.message}`);
        // 4. Sync to blockchain (non-fatal if it fails)
        let blockchainResult;
        let syncStatus: "synced" | "partial" | "failed" = "synced";
        try {
          blockchainResult = await blockchainService.syncSubscription(
            userId,
            "pause",         // blockchain service will call pause() on the contract
            updatedSubscription,
          );
          if (!blockchainResult.success) {
            syncStatus = "partial";
            logger.warn("Blockchain sync failed for subscription pause", {
              subscriptionId,
              error: blockchainResult.error,
            });
          }
        } catch (blockchainError) {
          logger.error("Blockchain sync error (non-fatal):", blockchainError);
          blockchainResult = {
            success: false,
            error: blockchainError instanceof Error
              ? blockchainError.message
              : String(blockchainError),
          };
        return {
          subscription: updatedSubscription,
          blockchainResult,
          syncStatus,
      } catch (error) {
        logger.error("Pause failed:", error);
        throw error;
      }
    });

  async resumeSubscription(
    userId: string,
    subscriptionId: string,
  ): Promise<SubscriptionSyncResult> {
    return await DatabaseTransaction.execute(async (client) => {
      try {
        // 1. Fetch and verify ownership
        const { data: subscription, error: fetchError } = await client
          .from("subscriptions")
          .select("*")
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .single();
        if (fetchError || !subscription) {
          throw new Error("Subscription not found or access denied");
        // 2. Guard: can only resume a paused subscription
        if (subscription.status !== "paused") {
          throw new Error("Subscription is not paused");
        // 3. Write to DB — clear all pause fields, restore active
        const { data: updatedSubscription, error: updateError } = await client
          .from("subscriptions")
          .update({
            status: "active",
            paused_at: null,
            resume_at: null,
            pause_reason: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .select()
          .single();
        if (updateError) {
          throw new Error(`Resume failed: ${updateError.message}`);
        // 4. Sync to blockchain (non-fatal if it fails)
        let blockchainResult;
        let syncStatus: "synced" | "partial" | "failed" = "synced";
        try {
          blockchainResult = await blockchainService.syncSubscription(
            userId,
            "unpause",       // blockchain service will call unpause() on the contract
            updatedSubscription,
          );
          if (!blockchainResult.success) {
            syncStatus = "partial";
            logger.warn("Blockchain sync failed for subscription resume", {
              subscriptionId,
              error: blockchainResult.error,
            });
          }
        } catch (blockchainError) {
          logger.error("Blockchain sync error (non-fatal):", blockchainError);
          blockchainResult = {
            success: false,
            error: blockchainError instanceof Error
              ? blockchainError.message
              : String(blockchainError),
          };
        return {
          subscription: updatedSubscription,
          blockchainResult,
          syncStatus,
      } catch (error) {
        logger.error("Resume failed:", error);
        throw error;
      }
    });

  /**
   * Get subscription by ID (with ownership check)
   */
  async getSubscription(userId: string, subscriptionId: string): Promise<Subscription> {
    const { data: subscription, error } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("id", subscriptionId)
      .eq("user_id", userId)
      .single();

    if (error || !subscription) {
      throw new Error("Subscription not found or access denied");
    }

    return subscription;

  // List user's subscriptions with cursor-based pagination
  /**
   * List user's subscriptions with optional filtering
   */
  async listSubscriptions(
    userId: string,
    options: ListSubscriptionsOptions = {},
  ): Promise<ListSubscriptionsResult> {
    const limit = Math.min(options.limit ?? 20, 100);

    let query = supabase
      .from("subscriptions")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit + 1);

    if (options.status) {
      query = query.eq("status", options.status);
    }

    if (options.category) {
      query = query.eq("category", options.category);
    }

    if (options.cursor) {
      try {
        const decoded = JSON.parse(
          Buffer.from(options.cursor, "base64").toString("utf-8"),
        );
        if (!decoded.created_at) {
          throw new Error("Invalid cursor: missing created_at");
        }
        query = query.lt("created_at", decoded.created_at);
      } catch {
        throw new Error("Invalid pagination cursor");
      }
    }

    const { data: rows, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch subscriptions: ${error.message}`);
    }

    // Fetch latest price change for each subscription
    const enhancedSubscriptions = await Promise.all(
      (subscriptions || []).map(async (sub) => {
        const { data: priceHistory } = await supabase
          .from("subscription_price_history")
          .select("*")
          .eq("subscription_id", sub.id)
          .order("changed_at", { ascending: false })
          .limit(1);

        return {
          ...sub,
          latest_price_change: priceHistory && priceHistory.length > 0 ? priceHistory[0] : null,
        };
      })
    );

    return {
      subscriptions: enhancedSubscriptions,
      total: count || 0,
    const hasMore = (rows?.length ?? 0) > limit;
    const subscriptions = hasMore ? rows!.slice(0, limit) : (rows ?? []);
    // Build next cursor from the last item in the page
    const nextCursor =
      hasMore && subscriptions.length > 0
        ? Buffer.from(
          JSON.stringify({
            created_at: subscriptions[subscriptions.length - 1].created_at,
          }),
        ).toString("base64")
        : null;
      subscriptions,
      total: count ?? 0,
      hasMore,
      nextCursor,
    };

  /**
   * Check if a renewal can be attempted based on cooldown period.
   * Returns cooldown status without enforcing it.
   */
  async checkRenewalCooldown(
    subscriptionId: string,
  ): Promise<{
    canRetry: boolean;
    isOnCooldown: boolean;
    timeRemainingSeconds: number;
    message: string;
  }> {
    try {
      const cooldownStatus = await renewalCooldownService.checkCooldown(subscriptionId);

      return {
        canRetry: cooldownStatus.canRetry,
        isOnCooldown: cooldownStatus.isOnCooldown,
        timeRemainingSeconds: cooldownStatus.timeRemainingSeconds,
        message: cooldownStatus.canRetry
          ? "Renewal can be attempted"
          : `Cooldown period active. Please wait ${cooldownStatus.timeRemainingSeconds} seconds before retrying.`,
      };
    } catch (error) {
      logger.error("Error checking renewal cooldown:", error);
      throw error;
    }

  /**
   * Retry blockchain sync for a subscription with cooldown enforcement.
   * Enforces minimum time gap between renewal attempts to prevent network spam.
   */
  async retryBlockchainSync(
    userId: string,
    subscriptionId: string,
    forceBypass: boolean = false,
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    try {
      // Check cooldown unless forcing bypass (admin operations)
      if (!forceBypass) {
        const cooldownStatus = await renewalCooldownService.checkCooldown(subscriptionId);

        if (cooldownStatus.isOnCooldown) {
          const error = `Cooldown period active. Please wait ${cooldownStatus.timeRemainingSeconds} seconds before retrying.`;
          logger.warn("Renewal attempt rejected due to cooldown", {
            subscription_id: subscriptionId,
            time_remaining_seconds: cooldownStatus.timeRemainingSeconds,
          });
          throw new Error(error);
        }
      }

      const subscription = await this.getSubscription(userId, subscriptionId);

      // Record the attempt before making the call
      await renewalCooldownService.recordRenewalAttempt(
        subscriptionId,
        false, // Assume failure initially
        "Attempt in progress",
        "retry",
      );

      const result = await blockchainService.syncSubscription(
        userId,
        subscriptionId,
        "update",
        subscription,
      );

      // Update the attempt status based on result
      if (result.success) {
        await renewalCooldownService.recordRenewalAttempt(
          subscriptionId,
          true,
          undefined,
          "retry",
        );
      } else {
        await renewalCooldownService.recordRenewalAttempt(
          subscriptionId,
          false,
          result.error || "Blockchain sync failed",
          "retry",
        );
      }

      return result;
    } catch (error) {
      // Record the failed attempt
      try {
        await renewalCooldownService.recordRenewalAttempt(
          subscriptionId,
          false,
          error instanceof Error ? error.message : String(error),
          "retry",
        );
      } catch (logError) {
        logger.warn("Failed to log renewal attempt:", logError);
      }

      logger.error("Renewal retry failed:", error);
      throw error;
    }
  }

  /**
   * Get price history for a subscription
   */
  async getPriceHistory(
    userId: string,
    subscriptionId: string
  ): Promise<any[]> {
    const { data, error } = await supabase
      .from("subscription_price_history")
      .select("*")
      .eq("subscription_id", subscriptionId)
      .eq("user_id", userId)
      .order("changed_at", { ascending: false });

    if (error) {
      logger.error("Failed to fetch price history:", error);
      throw new Error(`Failed to fetch price history: ${error.message}`);
    }

    return data || [];
  }
}

export const subscriptionService = new SubscriptionService();
