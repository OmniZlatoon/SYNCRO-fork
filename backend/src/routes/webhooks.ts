import { Router, Response } from 'express';
import { webhookService } from '../services/webhook-service';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import logger from '../config/logger';
import { createWebhookSchema, updateWebhookSchema } from '../schemas/webhook';

const router: Router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * POST /api/webhooks
 */
router.post('/', validate(createWebhookSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const webhook = await webhookService.registerWebhook(req.user!.id, req.body);
    res.status(201).json({ success: true, data: webhook });
  } catch (error) {
    logger.error('Create webhook error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create webhook',
    });
  }
});

/**
 * GET /api/webhooks
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const webhooks = await webhookService.listWebhooks(req.user!.id);
    res.json({ success: true, data: webhooks });
  } catch (error) {
    logger.error('List webhooks error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list webhooks',
    });
  }
});

/**
 * PUT /api/webhooks/:id
 */
router.put('/:id', validate(updateWebhookSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const webhook = await webhookService.updateWebhook(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
      req.body,
    );
    res.json({ success: true, data: webhook });
  } catch (error) {
    logger.error('Update webhook error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update webhook',
    });
  }
});

/**
 * DELETE /api/webhooks/:id
 */
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    await webhookService.deleteWebhook(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    );
    res.json({ success: true, message: 'Webhook deleted' });
  } catch (error) {
    logger.error('Delete webhook error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete webhook',
    });
  }
});

/**
 * POST /api/webhooks/:id/test
 */
router.post('/:id/test', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const delivery = await webhookService.triggerTestEvent(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    );
    res.json({ success: true, data: delivery });
  } catch (error) {
    logger.error('Test webhook error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to trigger test event',
    });
  }
});

/**
 * GET /api/webhooks/:id/deliveries
 */
router.get('/:id/deliveries', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const deliveries = await webhookService.getDeliveries(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    );
    res.json({ success: true, data: deliveries });
  } catch (error) {
    logger.error('Get deliveries error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch deliveries',
    });
  }
});

export default router;
