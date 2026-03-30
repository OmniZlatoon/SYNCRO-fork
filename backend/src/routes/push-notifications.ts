import { Router, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../config/database';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validateRequest } from '../utils/validation';

const router = Router();
router.use(authenticate);

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().optional(),
});

/**
 * POST /api/notifications/push/subscribe
 */
router.post('/subscribe', async (req: AuthenticatedRequest, res: Response) => {
  const { endpoint, keys, userAgent } = validateRequest(subscribeSchema, req.body);
  const userId = req.user!.id;

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

  if (error) throw error;

  res.status(201).json({
    success: true,
    data: { id: data.id, endpoint: data.endpoint, createdAt: data.created_at },
  });
});

/**
 * DELETE /api/notifications/push/unsubscribe
 */
router.delete('/unsubscribe', async (req: AuthenticatedRequest, res: Response) => {
  const { endpoint } = req.body as { endpoint?: string };
  const userId = req.user!.id;

  let query = supabase.from('push_subscriptions').delete().eq('user_id', userId);
  if (endpoint && typeof endpoint === 'string') {
    query = query.eq('endpoint', endpoint);
  }

  const { error } = await query;
  if (error) throw error;

  res.json({ success: true });
});

/**
 * GET /api/notifications/push/status
 */
router.get('/status', async (req: AuthenticatedRequest, res: Response) => {
  const { count, error } = await supabase
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.user!.id);

  if (error) throw error;

  res.json({ success: true, data: { subscribed: (count ?? 0) > 0, count: count ?? 0 } });
});

export default router;