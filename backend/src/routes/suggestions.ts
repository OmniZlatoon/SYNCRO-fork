import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { suggestionService, SuggestionType } from '../services/suggestion-service';
import logger from '../config/logger';

const router = Router();

/**
 * GET /api/suggestions
 * Returns money-saving suggestions for the authenticated user.
 */
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const suggestions = await suggestionService.generateSuggestions(req.user!.id);
    res.json({ suggestions });
  } catch (error) {
    logger.error('Failed to generate suggestions', { error });
    res.status(500).json({ error: 'Failed to generate suggestions' });
  }
});

const dismissSchema = z.object({
  subscriptionId: z.string().uuid(),
  suggestionType: z.enum([
    'switch_to_annual',
    'unused_subscription',
    'duplicate_service',
    'plan_downgrade',
  ]),
});

/**
 * POST /api/suggestions/dismiss
 * Dismisses a suggestion for 30 days.
 * Body: { subscriptionId: string, suggestionType: SuggestionType }
 */
router.post('/dismiss', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const parsed = dismissSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  try {
    await suggestionService.dismissSuggestion(
      req.user!.id,
      parsed.data.subscriptionId,
      parsed.data.suggestionType as SuggestionType,
    );
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to dismiss suggestion', { error });
    res.status(500).json({ error: 'Failed to dismiss suggestion' });
  }
});

export default router;
