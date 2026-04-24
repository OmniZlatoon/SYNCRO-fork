import { z } from 'zod';

const webhookEventSchema = z.enum([
  'subscription.renewal_due',
  'subscription.renewed',
  'subscription.renewal_failed',
  'subscription.cancelled',
  'subscription.risk_score_changed',
  'reminder.sent',
]);

const webhookUrlSchema = z
  .string()
  .max(2000, 'URL must not exceed 2000 characters')
  .url('Must be a valid URL')
  .refine(
    (val) => {
      try {
        const { protocol } = new URL(val);
        return protocol === 'http:' || protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'URL must use http or https protocol' },
  );

export const createWebhookSchema = z.object({
  url: webhookUrlSchema,
  events: z
    .array(webhookEventSchema)
    .min(1, 'At least one event type is required')
    .max(6, 'Maximum 6 event types per webhook'),
  description: z
    .string()
    .max(255, 'Description must not exceed 255 characters')
    .optional(),
});

export const updateWebhookSchema = z.object({
  url: webhookUrlSchema.optional(),
  events: z
    .array(webhookEventSchema)
    .min(1, 'At least one event type is required')
    .max(6, 'Maximum 6 event types per webhook')
    .optional(),
  enabled: z.boolean().optional(),
  description: z
    .string()
    .max(255, 'Description must not exceed 255 characters')
    .optional(),
});
