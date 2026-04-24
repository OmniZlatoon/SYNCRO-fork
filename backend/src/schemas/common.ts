import { z } from 'zod';

// ─── Reusable URL schema ────────────────────────────────────────────────────
/** Validates a URL string, requiring http or https protocol. */
export const safeUrlSchema = z
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

// ─── UUID param schema ──────────────────────────────────────────────────────
/** Validates that a route `:id` parameter is a valid UUID. */
export const uuidParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

// ─── Pagination query helpers ───────────────────────────────────────────────
/** Reusable limit/offset pagination for query strings. */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
