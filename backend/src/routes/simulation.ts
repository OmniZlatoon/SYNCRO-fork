import { Router, Response } from 'express';
import { z } from 'zod';
import { simulationService } from '../services/simulation-service';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validateRequest } from '../utils/validation';

const router = Router();
router.use(authenticate);

const simulationQuerySchema = z.object({
  days: z.preprocess((val) => parseInt(val as string, 10), z.number().int().min(1).max(365)).default(30),
  balance: z.preprocess((val) => val === undefined ? undefined : parseFloat(val as string), z.number().optional()),
});

/**
 * GET /api/simulation
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const { days, balance } = validateRequest(simulationQuerySchema, req.query);

  const result = await simulationService.generateSimulation(
    req.user!.id,
    days,
    balance
  );

  res.json({
    success: true,
    data: result,
  });
});

export default router;
