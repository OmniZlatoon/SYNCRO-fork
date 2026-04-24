import { Router, Response } from 'express';
import { z } from 'zod';
import { simulationService } from '../services/simulation-service';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import logger from '../config/logger';
import { simulationQuerySchema } from '../schemas/simulation';

const router: Router = Router();

// All routes require authentication
router.use(authenticate);

const simulationQuerySchema = z.object({
  days: z.preprocess((val) => parseInt(val as string, 10), z.number().int().min(1).max(365)).default(30),
  balance: z.preprocess((val) => val === undefined ? undefined : parseFloat(val as string), z.number().optional()),
});

/**
 * GET /api/simulation
 * Generate a billing simulation
 */
router.get(
  '/',
  validate(simulationQuerySchema, 'query'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { days, balance } = req.query as any;

      const result = await simulationService.generateSimulation(
        req.user!.id,
        days,
        balance,
      );

      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Simulation generation error:', error);

      if (error instanceof Error && error.message.includes('must be between')) {
        return res.status(400).json({ success: false, error: error.message });
      }

      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate simulation',
      });
    }
  },
);

export default router;
