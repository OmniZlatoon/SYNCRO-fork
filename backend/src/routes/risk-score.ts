/**
 * Risk Score API Routes
 */

import express, { Response, Router } from "express";
import { riskDetectionService } from "../services/risk-detection/risk-detection-service";
import { riskNotificationService } from "../services/risk-detection/risk-notification-service";
import { authenticate, AuthenticatedRequest } from "../middleware/auth";
import logger from "../config/logger";

const router: Router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

/**
 * GET /api/risk-score/:subscriptionId
 */
router.get("/:subscriptionId", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rawSubscriptionId = req.params.subscriptionId;

    if (!rawSubscriptionId || Array.isArray(rawSubscriptionId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid subscriptionId",
      });
    }

    const subscriptionId = rawSubscriptionId;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
      });
    }

    const riskScore = await riskDetectionService.getRiskScore(subscriptionId, userId);

    return res.status(200).json({
      success: true,
      data: {
        subscription_id: riskScore.subscription_id,
        risk_level: riskScore.risk_level,
        risk_factors: riskScore.risk_factors,
        last_calculated_at: riskScore.last_calculated_at,
      },
    });
  } catch (error) {
    logger.error("Error fetching risk score:", error);

    if (error instanceof Error && error.message.includes("not found")) {
      return res.status(404).json({
        success: false,
        error: "Risk score not found",
      });
    }

    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * GET /api/risk-score
 */
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
      });
    }

    const riskScores = await riskDetectionService.getUserRiskScores(userId);

    return res.status(200).json({
      success: true,
      data: riskScores.map((score) => ({
        subscription_id: score.subscription_id,
        risk_level: score.risk_level,
        risk_factors: score.risk_factors,
        last_calculated_at: score.last_calculated_at,
      })),
      total: riskScores.length,
    });
  } catch (error) {
    logger.error("Error fetching user risk scores:", error);

    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * POST /api/risk-score/recalculate
 */
router.post("/recalculate", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
      });
    }

    logger.info("Manual risk recalculation triggered", { user_id: userId });

    const result = await riskDetectionService.recalculateAllRisks();

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error("Error in manual risk recalculation:", error);

    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * POST /api/risk-score/:subscriptionId/calculate
 */
router.post("/:subscriptionId/calculate", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rawSubscriptionId = req.params.subscriptionId;

    if (!rawSubscriptionId || Array.isArray(rawSubscriptionId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid subscriptionId",
      });
    }

    const subscriptionId = rawSubscriptionId;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
      });
    }

    const assessment = await riskDetectionService.computeRiskLevel(subscriptionId);

    const riskScore = await riskDetectionService.saveRiskScore(assessment, userId);

    return res.status(200).json({
      success: true,
      data: {
        subscription_id: riskScore.subscription_id,
        risk_level: riskScore.risk_level,
        risk_factors: riskScore.risk_factors,
        last_calculated_at: riskScore.last_calculated_at,
      },
    });
  } catch (error) {
    logger.error("Error calculating risk score:", error);

    if (error instanceof Error && error.message.includes("not found")) {
      return res.status(404).json({
        success: false,
        error: "Subscription not found",
      });
    }

    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

export default router;