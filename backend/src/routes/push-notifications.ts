import { Router, Response } from 'express';
import { supabase } from '../config/database';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import logger from '../config/logger';

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /api/notifications/push/subscribe:
 *   post:
 *     tags: [Push Notifications]
 *     summary: Save a browser push subscription
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [endpoint, keys]
 *             properties:
 *               endpoint: { type: string, format: uri }
 *               keys:
 *                 type: object
 *                 required: [p256dh, auth]
 *                 properties:
 *                   p256dh: { type: string }
 *                   auth: { type: string }
 *               userAgent: { type: string }
 *     responses:
 *       201:
 *         description: Subscription saved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     endpoint: { type: string }
 *                     createdAt: { type: string, format: date-time }
 *       400:
 *         description: Missing or invalid fields
 *       401:
 *         description: Unauthorized
 */
router.post('/subscribe', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { endpoint, keys, userAgent } = req.body as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
      userAgent?: string;
    };

    if (!endpoint || typeof endpoint !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing or invalid endpoint' });
    }
    if (!keys?.p256dh || typeof keys.p256dh !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing or invalid p256dh key' });
    }
    if (!keys?.auth || typeof keys.auth !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing or invalid auth key' });
    }

    const { data, error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          user_id: userId,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          user_agent: userAgent ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,endpoint' },
      )
      .select('id, endpoint, created_at')
      .single();

    if (error) {
      logger.error('Failed to save push subscription:', error);
      return res.status(500).json({ success: false, error: 'Failed to save subscription' });
    }

    logger.info('Push subscription saved', { userId, subscriptionId: data.id });

    return res.status(201).json({
      success: true,
      data: { id: data.id, endpoint: data.endpoint, createdAt: data.created_at },
    });
  } catch (err) {
    logger.error('Push subscribe error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * @openapi
 * /api/notifications/push/unsubscribe:
 *   delete:
 *     tags: [Push Notifications]
 *     summary: Remove a push subscription
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               endpoint: { type: string, description: "Omit to remove all subscriptions" }
 *     responses:
 *       200:
 *         description: Removed
 *       401:
 *         description: Unauthorized
 */
router.delete('/unsubscribe', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { endpoint } = req.body as { endpoint?: string };

    let query = supabase.from('push_subscriptions').delete().eq('user_id', userId);

    if (endpoint && typeof endpoint === 'string') {
      query = query.eq('endpoint', endpoint);
    }

    const { error } = await query;

    if (error) {
      logger.error('Failed to remove push subscription:', error);
      return res.status(500).json({ success: false, error: 'Failed to remove subscription' });
    }

    logger.info('Push subscription(s) removed', { userId });
    return res.json({ success: true });
  } catch (err) {
    logger.error('Push unsubscribe error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * @openapi
 * /api/notifications/push/status:
 *   get:
 *     tags: [Push Notifications]
 *     summary: Check if user has an active push subscription
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Subscription status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     subscribed: { type: boolean }
 *                     count: { type: integer }
 *       401:
 *         description: Unauthorized
 */
router.get('/status', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { count, error } = await supabase
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      logger.error('Failed to check push subscription status:', error);
      return res.status(500).json({ success: false, error: 'Failed to check status' });
    }

    return res.json({ success: true, data: { subscribed: (count ?? 0) > 0, count: count ?? 0 } });
  } catch (err) {
    logger.error('Push status error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;