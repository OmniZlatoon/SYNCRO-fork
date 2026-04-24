import { z } from 'zod';
import { ValidationError } from '../errors';

/**
 * Validates data against a Zod schema and throws a ValidationError if invalid.
 * Optional location parameter indicates where the data came from (e.g. 'body', 'query').
 */
export function validateRequest<T extends z.ZodTypeAny>(schema: T, data: unknown, location: string = 'body'): z.infer<T> {
  const result = schema.safeParse(data);
  
  if (!result.success) {
    const formattedErrors: Record<string, string[]> = {};
    
    result.error.errors.forEach((err: z.ZodIssue) => {
      const field = err.path.join('.') || location;
      if (!formattedErrors[field]) formattedErrors[field] = [];
      formattedErrors[field].push(err.message);
    });
    
    throw new ValidationError(`Validation failed in ${location}`, formattedErrors);
  }
  
  return result.data;
}

