import { ZodSchema } from 'zod';
import { Request, Response, NextFunction } from 'express';

/**
 * Shared validation middleware factory.
 *
 * Validates `req[source]` against the given Zod schema.
 * On success the raw value is **replaced** with the parsed / coerced result
 * so downstream handlers receive clean, typed data.
 *
 * On failure a **422 Unprocessable Entity** response is returned using the
 * RFC 9457 Problem Details format.
 *
 * @param schema - Any Zod schema (z.object, z.array, …)
 * @param source - Which part of the request to validate (default `'body'`)
 *
 * @example
 * ```ts
 * router.post('/', authenticate, validate(createFooSchema), handler);
 * router.get('/',  authenticate, validate(listQuerySchema, 'query'), handler);
 * ```
 */
export function validate(
  schema: ZodSchema,
  source: 'body' | 'query' | 'params' = 'body',
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      return res.status(422).json({
        type: 'https://syncro.app/errors/validation',
        title: 'Validation Error',
        status: 422,
        errors: result.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    // Replace with parsed / coerced data
    (req as any)[source] = result.data;
    next();
  };
}
