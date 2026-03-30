import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { supabase } from '../config/database';
import { authenticate, AuthenticatedRequest, requireScope } from '../middleware/auth';
import { validateRequest } from '../utils/validation';
import { NotFoundError, BadRequestError } from '../errors';

const router = Router();
router.use(authenticate);

const VALID_SCOPES = ['subscriptions:read', 'subscriptions:write', 'webhooks:write', 'analytics:read'] as const;

const createApiKeySchema = z.object({
  name: z.string().min(1, 'Service name is required').max(100),
  scopes: z.union([
    z.array(z.enum(VALID_SCOPES)),
    z.string().transform((val) => val.split(',').map((s) => s.trim()) as any[]),
  ]).refine((val) => val.length > 0, { message: 'At least one valid scope is required' }),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateApiKey(): { key: string; hash: string } {
  const key = `sk_${crypto.randomBytes(32).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return { key, hash };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/api-keys
 */
router.post('/', requireScope('subscriptions:write'), async (req: AuthenticatedRequest, res: Response) => {
  const { name, scopes } = validateRequest(createApiKeySchema, req.body);
  const { key, hash } = generateApiKey();

  const { error } = await supabase.from('api_keys').insert([
    {
      user_id: req.user!.id,
      service_name: name,
      key_hash: hash,
      scopes,
      revoked: false,
      last_used_at: null,
      request_count: 0,
    },
  ]);

  if (error) throw error;

  res.status(201).json({ success: true, key, scopes });
});

/**
 * GET /api/api-keys
 */
router.get('/', requireScope('subscriptions:read'), async (req: AuthenticatedRequest, res: Response) => {
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, service_name, scopes, revoked, created_at, updated_at, last_used_at, request_count')
    .eq('user_id', req.user!.id)
    .order('created_at', { ascending: false });

  if (error) throw error;

  res.json({ success: true, data });
});

/**
 * DELETE /api/api-keys/:id
 * Revoke an API key
 */
router.delete('/:id', requireScope('subscriptions:write'), async (req: AuthenticatedRequest, res: Response) => {
  const { data: existingKey, error: fetchError } = await supabase
    .from('api_keys')
    .select('id')
    .eq('id', req.params.id)
    .eq('user_id', req.user!.id)
    .maybeSingle();

  if (fetchError || !existingKey) {
    throw new NotFoundError('API key not found');
  }

  const { error } = await supabase
    .from('api_keys')
    .update({ revoked: true, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', req.user!.id);

  if (error) throw error;

  res.json({ success: true, message: 'API key revoked' });
});

/**
 * GET /api/api-keys/:id/usage
 */
router.get('/:id/usage', requireScope('subscriptions:read'), async (req: AuthenticatedRequest, res: Response) => {
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, service_name, scopes, revoked, created_at, updated_at, last_used_at, request_count')
    .eq('id', req.params.id)
    .eq('user_id', req.user!.id)
    .maybeSingle();

  if (error || !data) {
    throw new NotFoundError('API key not found');
  }

  res.json({ success: true, data });
});

export default router;
