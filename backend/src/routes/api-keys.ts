import { Router, Response } from 'express';
import crypto from 'crypto';
import { supabase } from '../config/database';
import { authenticate, AuthenticatedRequest, requireScope } from '../middleware/auth';
import logger from '../config/logger';

const router = Router();

// All endpoints are for authenticated users (JWT or API key edit rights via user auth).
router.use(authenticate);

const VALID_SCOPES = new Set(["subscriptions:read", "subscriptions:write", "webhooks:write", "analytics:read"]);

function normalizeScopes(scopes: unknown): string[] {
  if (Array.isArray(scopes)) {
    return scopes
      .map((scope) => String(scope || '').trim())
      .filter((scope) => scope && VALID_SCOPES.has(scope));
  }

  if (typeof scopes === 'string') {
    return scopes
      .split(',')
      .map((scope) => scope.trim())
      .filter((scope) => scope && VALID_SCOPES.has(scope));
  }

  return [];
}

function generateApiKey(): { key: string; hash: string } {
  const key = `sk_${crypto.randomBytes(32).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return { key, hash };
}

router.post('/', requireScope('subscriptions:write'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { name, scopes } = req.body || {};

    const serviceName = String(name || 'default').trim();
    if (!serviceName) {
      return res.status(400).json({ error: 'service name is required' });
    }

    const normalizedScopes = normalizeScopes(scopes);
    if (normalizedScopes.length === 0) {
      return res.status(400).json({ error: 'at least one valid scope is required' });
    }

    const { key, hash } = generateApiKey();

    let insertResult: any;
    try {
      insertResult = await supabase.from('api_keys').insert([
        {
          user_id: req.user.id,
          service_name: serviceName,
          key_hash: hash,
          scopes: normalizedScopes,
          revoked: false,
          last_used_at: null,
          request_count: 0,
        },
      ]);
    } catch (dbError) {
      logger.error('insert call threw', dbError);
      throw dbError;
    }

    const error = (insertResult as any).error;

    if (error) {
      logger.error('Failed to create API key', { error });
      return res.status(500).json({ error: 'Failed to create API key' });
    }

    console.log('about to send success response');
    return res.status(201).json({ success: true, key, scopes: normalizedScopes });
  } catch (error) {
    logger.error('Create API key error:', error);
    console.error('Create API key error:', error);
    return res.status(500).json({ error: String(error) || 'Internal server error' });
  }
});

router.get('/', requireScope('subscriptions:read'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data, error } = await supabase
      .from('api_keys')
      .select('id, service_name, scopes, revoked, created_at, updated_at, last_used_at, request_count')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Failed to list API keys', { error });
      return res.status(500).json({ error: 'Failed to list API keys' });
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('List API keys error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', requireScope('subscriptions:write'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const keyId = req.params.id;

    const { data: existingKey, error: fetchError } = await supabase
      .from('api_keys')
      .select('id')
      .eq('id', keyId)
      .eq('user_id', req.user.id)
      .single();

    if (fetchError || !existingKey) {
      return res.status(404).json({ error: 'API key not found' });
    }

    const { error } = await supabase
      .from('api_keys')
      .update({ revoked: true, updated_at: new Date().toISOString() })
      .eq('id', keyId)
      .eq('user_id', req.user.id);

    if (error) {
      logger.error('Failed to revoke API key', { error });
      return res.status(500).json({ error: 'Failed to revoke API key' });
    }

    return res.json({ success: true });
  } catch (error) {
    logger.error('Revoke API key error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/usage', requireScope('subscriptions:read'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const keyId = req.params.id;

    const { data, error } = await supabase
      .from('api_keys')
      .select('id, service_name, scopes, revoked, created_at, updated_at, last_used_at, request_count')
      .eq('id', keyId)
      .eq('user_id', req.user.id)
      .single();

    if (error || !data) {
      logger.error('Failed to fetch API key usage', { error });
      return res.status(404).json({ error: 'API key not found' });
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('API key usage error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
