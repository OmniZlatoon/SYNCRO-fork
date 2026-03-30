import express, { Response } from 'express';
import { z } from 'zod';
import { riskDetectionService } from '../services/risk-detection/risk-detection-service';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validateRequest } from '../utils/validation';
import { NotFoundError } from '../errors';

const router = express.Router();
router.use(authenticate);

const subscriptionParamSchema = z.object({
  subscriptionId: z.string().uuid(),
});

/**
 * GET /api/risk-score/:subscriptionId
 */
router.get('/:subscriptionId', async (req: AuthenticatedRequest, res: Response) => {
  const { subscriptionId } = validateRequest(subscriptionParamSchema, req.params);
  const userId = req.user!.id;

  const riskScore = await riskDetectionService.getRiskScore(subscriptionId, userId);

  res.json({
    success: true,
    data: {
      subscription_id: riskScore.subscription_id,
      risk_level: riskScore.risk_level,
      risk_factors: riskScore.risk_factors,
      last_calculated_at: riskScore.last_calculated_at,
    },
  });
});

/**
 * GET /api/risk-score
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const riskScores = await riskDetectionService.getUserRiskScores(userId);

  res.json({
    success: true,
    data: riskScores.map(score => ({
      subscription_id: score.subscription_id,
      risk_level: score.risk_level,
      risk_factors: score.risk_factors,
      last_calculated_at: score.last_calculated_at,
    })),
    total: riskScores.length,
  });
});

/**
 * POST /api/risk-score/recalculate
 */
router.post('/recalculate', async (req: AuthenticatedRequest, res: Response) => {
  // TODO: Add admin check (e.g., req.user.role === 'admin')
  const result = await riskDetectionService.recalculateAllRisks();

  res.json({
    success: true,
    data: result,
  });
});

/**
 * POST /api/risk-score/:subscriptionId/calculate
 */
router.post('/:subscriptionId/calculate', async (req: AuthenticatedRequest, res: Response) => {
  const { subscriptionId } = validateRequest(subscriptionParamSchema, req.params);
  const userId = req.user!.id;

  const assessment = await riskDetectionService.computeRiskLevel(subscriptionId);
  const riskScore = await riskDetectionService.saveRiskScore(assessment, userId);

  res.json({
    success: true,
    data: {
      subscription_id: riskScore.subscription_id,
      risk_level: riskScore.risk_level,
      risk_factors: riskScore.risk_factors,
      last_calculated_at: riskScore.last_calculated_at,
    },
  });
});

export default router;
