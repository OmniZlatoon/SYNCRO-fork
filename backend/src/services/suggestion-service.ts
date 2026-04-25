import { supabase } from '../config/database';
import logger from '../config/logger';

export type SuggestionType =
  | 'switch_to_annual'
  | 'unused_subscription'
  | 'duplicate_service'
  | 'plan_downgrade';

export interface Suggestion {
  id: string;
  type: SuggestionType;
  subscriptionId: string;
  subscriptionName: string;
  message: string;
  savingsPerYear?: number;
  dismissedUntil?: string | null;
}

interface ActiveSubscription {
  id: string;
  name: string;
  price: number;
  billing_cycle: string;
  category: string | null;
  last_interaction_at: string | null;
  created_at: string;
}

/** Minimal template shape needed for annual savings calculation. */
interface AnnualTemplate {
  name: string;
  annualPrice: number;
}

/**
 * Known annual prices for popular subscriptions.
 * Kept here to avoid a cross-package import from the client.
 */
const ANNUAL_TEMPLATES: AnnualTemplate[] = [
  { name: 'Netflix',          annualPrice: 139.99 },
  { name: 'Spotify',          annualPrice:  99.99 },
  { name: 'YouTube Premium',  annualPrice:  99.99 },
  { name: 'Amazon Prime',     annualPrice: 139.00 },
  { name: 'Hulu',             annualPrice:  79.99 },
  { name: 'Disney+',          annualPrice:  79.99 },
  { name: 'Apple TV+',        annualPrice:  99.00 },
  { name: 'ChatGPT Plus',     annualPrice: 200.00 },
  { name: 'Claude Pro',       annualPrice: 200.00 },
  { name: 'GitHub Copilot',   annualPrice: 100.00 },
  { name: 'Notion',           annualPrice:  96.00 },
  { name: 'Dropbox Plus',     annualPrice: 119.99 },
  { name: 'Adobe CC',         annualPrice: 599.88 },
  { name: 'Microsoft 365',    annualPrice:  99.99 },
];

const UNUSED_DAYS_THRESHOLD = 60;
const MIN_ANNUAL_SAVINGS = 20;
const DISMISS_DAYS = 30;

export class SuggestionService {
  /**
   * Generate money-saving suggestions for a user.
   * Covers: annual billing savings, unused detection, duplicate service detection.
   */
  async generateSuggestions(userId: string): Promise<Suggestion[]> {
    const { data: subscriptions, error } = await supabase
      .from('subscriptions')
      .select('id, name, price, billing_cycle, category, last_interaction_at, created_at')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error) {
      logger.error('Failed to fetch subscriptions for suggestions', { error, userId });
      throw error;
    }

    const subs: ActiveSubscription[] = subscriptions ?? [];
    const suggestions: Suggestion[] = [];

    // Fetch dismissed suggestions so we can skip them
    const { data: dismissed } = await supabase
      .from('dismissed_suggestions')
      .select('subscription_id, suggestion_type, dismissed_until')
      .eq('user_id', userId)
      .gt('dismissed_until', new Date().toISOString());

    const dismissedSet = new Set(
      (dismissed ?? []).map((d) => `${d.subscription_id}:${d.suggestion_type}`),
    );

    const isDismissed = (subId: string, type: SuggestionType) =>
      dismissedSet.has(`${subId}:${type}`);

    // 1. Annual billing savings
    for (const sub of subs.filter((s) => s.billing_cycle === 'monthly')) {
      if (isDismissed(sub.id, 'switch_to_annual')) continue;

      const template = ANNUAL_TEMPLATES.find(
        (t) => t.name.toLowerCase() === sub.name.toLowerCase(),
      );
      if (!template) continue;

      const monthlyCostAnnualised = sub.price * 12;
      const savings = monthlyCostAnnualised - template.annualPrice;
      if (savings >= MIN_ANNUAL_SAVINGS) {
        suggestions.push({
          id: `${sub.id}:switch_to_annual`,
          type: 'switch_to_annual',
          subscriptionId: sub.id,
          subscriptionName: sub.name,
          message: `Switch ${sub.name} to annual billing and save $${savings.toFixed(2)}/year`,
          savingsPerYear: savings,
        });
      }
    }

    // 2. Unused subscription detection (no interaction for 60+ days)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - UNUSED_DAYS_THRESHOLD);

    for (const sub of subs) {
      if (isDismissed(sub.id, 'unused_subscription')) continue;

      const lastActivity = sub.last_interaction_at
        ? new Date(sub.last_interaction_at)
        : new Date(sub.created_at);

      if (lastActivity < cutoff) {
        suggestions.push({
          id: `${sub.id}:unused_subscription`,
          type: 'unused_subscription',
          subscriptionId: sub.id,
          subscriptionName: sub.name,
          message: `You haven't used ${sub.name} in over ${UNUSED_DAYS_THRESHOLD} days. Are you still using it?`,
        });
      }
    }

    // 3. Duplicate service detection (same category, multiple subscriptions)
    const byCategory: Record<string, ActiveSubscription[]> = {};
    for (const sub of subs) {
      const cat = sub.category ?? 'uncategorized';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(sub);
    }

    for (const [category, group] of Object.entries(byCategory)) {
      if (group.length < 2) continue;
      // Only flag categories where duplicates are meaningful (not generic ones)
      const flaggableCategories = ['ai_tools', 'entertainment', 'productivity', 'design', 'music'];
      if (!flaggableCategories.includes(category)) continue;

      for (const sub of group) {
        if (isDismissed(sub.id, 'duplicate_service')) continue;
        const others = group.filter((s) => s.id !== sub.id).map((s) => s.name);
        suggestions.push({
          id: `${sub.id}:duplicate_service`,
          type: 'duplicate_service',
          subscriptionId: sub.id,
          subscriptionName: sub.name,
          message: `You may be paying twice for similar ${category.replace('_', ' ')} tools: ${sub.name} and ${others.join(', ')}. Compare plans →`,
        });
        break; // one suggestion per category group is enough
      }
    }

    return suggestions;
  }

  /**
   * Dismiss a suggestion for a user for DISMISS_DAYS days.
   */
  async dismissSuggestion(
    userId: string,
    subscriptionId: string,
    suggestionType: SuggestionType,
  ): Promise<void> {
    const dismissedUntil = new Date();
    dismissedUntil.setDate(dismissedUntil.getDate() + DISMISS_DAYS);

    const { error } = await supabase.from('dismissed_suggestions').upsert(
      {
        user_id: userId,
        subscription_id: subscriptionId,
        suggestion_type: suggestionType,
        dismissed_until: dismissedUntil.toISOString(),
      },
      { onConflict: 'user_id,subscription_id,suggestion_type' },
    );

    if (error) {
      logger.error('Failed to dismiss suggestion', { error });
      throw error;
    }
  }
}

export const suggestionService = new SuggestionService();
