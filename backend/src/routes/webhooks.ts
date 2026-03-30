import { Router, Response } from 'express';
import { z } from 'zod';
import { webhookService } from '../services/webhook-service';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validateRequest } from '../utils/validation';

const router = Router();
router.use(authenticate);

const webhookEventSchema = z.enum([
  'subscription.renewal_due',
  'subscription.renewed',
  'subscription.renewal_failed',
  'subscription.cancelled',
  'subscription.risk_score_changed',
  'reminder.sent'
]);

const createWebhookSchema = z.object({
  url: z
    .string()
    .max(2000, 'URL must not exceed 2000 characters')
    .url('Must be a valid URL')
    .refine(
      (val) => { try { const { protocol } = new URL(val); return protocol === 'http:' || protocol === 'https:'; } catch { return false; } },
      { message: 'URL must use http or https protocol' }
    ),
  events: z.array(webhookEventSchema).min(1, 'At least one event type is required').max(6, 'Maximum 6 event types per webhook'),
  description: z.string().max(255, 'Description must not exceed 255 characters').optional(),
});

const updateWebhookSchema = createWebhookSchema.partial().extend({
  enabled: z.boolean().optional(),
});

/**
 * POST /api/webhooks
 */
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const validatedData = validateRequest(createWebhookSchema, req.body);
  const webhook = await webhookService.registerWebhook(req.user!.id, validatedData);
  res.status(201).json({ success: true, data: webhook });
});

/**
 * GET /api/webhooks
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const webhooks = await webhookService.listWebhooks(req.user!.id);
  res.json({ success: true, data: webhooks });
});

/**
 * PUT /api/webhooks/:id
 */
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const validatedData = validateRequest(updateWebhookSchema, req.body);
  const webhook = await webhookService.updateWebhook(req.user!.id, req.params.id, validatedData);
  res.json({ success: true, data: webhook });
});

/**
 * DELETE /api/webhooks/:id
 */
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  await webhookService.deleteWebhook(req.user!.id, req.params.id);
  res.json({ success: true, message: 'Webhook deleted' });
});

/**
 * POST /api/webhooks/:id/test
 */
router.post('/:id/test', async (req: AuthenticatedRequest, res: Response) => {
  const delivery = await webhookService.triggerTestEvent(req.user!.id, req.params.id);
  res.json({ success: true, data: delivery });
});

/**
 * GET /api/webhooks/:id/deliveries
 */
router.get('/:id/deliveries', async (req: AuthenticatedRequest, res: Response) => {
  const deliveries = await webhookService.getDeliveries(req.user!.id, req.params.id);
  res.json({ success: true, data: deliveries });
});

export default router;
