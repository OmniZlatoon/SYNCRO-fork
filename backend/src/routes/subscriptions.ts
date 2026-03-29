import * as bip39 from 'bip39';

/**
 * Generates a standard BIP39 12-word mnemonic phrase.
 */
export function generateMnemonic(): string {
  return bip39.generateMnemonic(128);
}

/**
 * POST /api/subscriptions/:id/trial/convert
 * Mark a trial as intentionally converted to paid ("Keep My Subscription").
 * Logs the conversion event and updates the subscription status.
 */
router.post('/:id/trial/convert', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const subId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const { data: sub, error: fetchErr } = await (await import('../config/database')).supabase
      .from('subscriptions')
      .select('*')
      .eq('id', subId)
      .eq('user_id', req.user!.id)
      .single();

    if (fetchErr || !sub) {
      return res.status(404).json({ success: false, error: 'Subscription not found' });
    }

    if (!sub.is_trial) {
      return res.status(400).json({ success: false, error: 'Subscription is not a trial' });
    }

    const db = (await import('../config/database')).supabase;

    // Update subscription: mark as active paid subscription
    await db.from('subscriptions').update({
      is_trial: false,
      status: 'active',
      price: sub.trial_converts_to_price ?? sub.price_after_trial ?? sub.price,
      updated_at: new Date().toISOString(),
    }).eq('id', subId);

    // Log conversion event
    await db.from('trial_conversion_events').insert({
      subscription_id: subId,
      user_id: req.user!.id,
      outcome: 'converted',
      conversion_type: 'intentional',
      saved_by_syncro: false,
      converted_price: sub.trial_converts_to_price ?? sub.price_after_trial ?? sub.price,
    });

    res.json({ success: true, message: 'Trial converted to paid subscription' });
  } catch (error) {
    logger.error('Trial convert error:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to convert trial' });
  }
});

/**
 * POST /api/subscriptions/:id/trial/cancel
 * Cancel a trial before auto-charge. Counts toward "Saved by SYNCRO" metric.
 */
router.post('/:id/trial/cancel', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const subId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { acted_on_reminder_days } = req.body;

    const db = (await import('../config/database')).supabase;

    const { data: sub, error: fetchErr } = await db
      .from('subscriptions')
      .select('*')
      .eq('id', subId)
      .eq('user_id', req.user!.id)
      .single();

    if (fetchErr || !sub) {
      return res.status(404).json({ success: false, error: 'Subscription not found' });
    }

    if (!sub.is_trial) {
      return res.status(400).json({ success: false, error: 'Subscription is not a trial' });
    }

    // Cancel the subscription
    await db.from('subscriptions').update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', subId);

    // Log cancellation — saved_by_syncro = true when credit card was on file
    await db.from('trial_conversion_events').insert({
      subscription_id: subId,
      user_id: req.user!.id,
      outcome: 'cancelled',
      conversion_type: 'intentional',
      saved_by_syncro: sub.credit_card_required === true,
      acted_on_reminder_days: acted_on_reminder_days ?? null,
    });

    res.json({ success: true, message: 'Trial cancelled successfully' });
  } catch (error) {
    logger.error('Trial cancel error:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to cancel trial' });
  }
});

/**
 * GET /api/subscriptions/trials/saved-metric
 * Returns the "Saved by SYNCRO" count — trials cancelled before auto-charge.
 */
router.get('/trials/saved-metric', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = (await import('../config/database')).supabase;

    const { count, error } = await db
      .from('trial_conversion_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.user!.id)
      .eq('saved_by_syncro', true);

    if (error) throw error;

    res.json({ success: true, savedCount: count ?? 0 });
  } catch (error) {
    logger.error('Saved metric error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch saved metric' });
  }
});

/**
 * POST /api/subscriptions/:id/cancel
 * Cancel subscription with blockchain sync
 * Validates a given mnemonic phrase (must be 12 words).
 */
export function validateMnemonic(mnemonic: string): boolean {
  if (!mnemonic || typeof mnemonic !== 'string') {
    return false;
  }

  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 12) {
    return false;
  }

  return bip39.validateMnemonic(words.join(' '));
}