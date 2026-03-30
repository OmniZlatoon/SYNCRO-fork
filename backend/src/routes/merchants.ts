import { Router, Response, Request } from 'express';
import { z } from 'zod';
import { merchantService } from '../services/merchant-service';
import { adminAuth } from '../middleware/admin';
import { renewalRateLimiter } from '../middleware/rateLimiter';
import { validateRequest } from '../utils/validation';
import { BadRequestError } from '../errors';

const router = Router();

// ─── Validation schemas ───────────────────────────────────────────────────────

const safeUrlSchema = z
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
    { message: 'URL must use http or https protocol' }
  );

const createMerchantSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must not exceed 100 characters'),
  description: z.string().max(500, 'Description must not exceed 500 characters').optional(),
  category: z.string().max(50, 'Category must not exceed 50 characters').optional(),
  website_url: safeUrlSchema.optional(),
  logo_url: safeUrlSchema.optional(),
  support_email: z.string().email('Must be a valid email').max(254, 'Email must not exceed 254 characters').optional(),
  country: z.string().max(2, 'Country must be a 2-letter ISO code').optional(),
});

const updateMerchantSchema = createMerchantSchema.partial();

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/merchants
 * List all merchants with optional filtering
 */
router.get('/', async (req: Request, res: Response) => {
  const { limit, offset, category } = req.query;

  const limitNum = limit ? parseInt(limit as string, 10) : 20;
  const offsetNum = offset ? parseInt(offset as string, 10) : 0;

  if (isNaN(limitNum) || limitNum < 1) throw new BadRequestError('Limit must be a positive integer');
  if (isNaN(offsetNum) || offsetNum < 0) throw new BadRequestError('Offset must be a non-negative integer');

  const result = await merchantService.listMerchants({
    category: category as string | undefined,
    limit: limitNum,
    offset: offsetNum,
  });

  res.json({
    success: true,
    data: result.merchants,
    pagination: {
      total: result.total,
      limit: limitNum,
      offset: offsetNum,
    },
  });
});

/**
 * GET /api/merchants/:id
 * Get a single merchant by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  const merchant = await merchantService.getMerchant(req.params.id);
  res.json({
    success: true,
    data: merchant,
  });
});

/**
 * POST /api/merchants
 * Create a new merchant (admin only)
 */
router.post('/', adminAuth, async (req: Request, res: Response) => {
  const validatedData = validateRequest(createMerchantSchema, req.body);
  const merchant = await merchantService.createMerchant(validatedData);

  res.status(201).json({
    success: true,
    data: merchant,
  });
});

/**
 * PATCH /api/merchants/:id
 * Update a merchant (admin only)
 */
router.patch('/:id', adminAuth, renewalRateLimiter, async (req: Request, res: Response) => {
  const validatedData = validateRequest(updateMerchantSchema, req.body);
  const merchant = await merchantService.updateMerchant(req.params.id, validatedData);

  res.json({
    success: true,
    data: merchant,
  });
});

/**
 * DELETE /api/merchants/:id
 * Delete a merchant (admin only)
 */
router.delete('/:id', adminAuth, async (req: Request, res: Response) => {
  await merchantService.deleteMerchant(req.params.id);

  res.json({
    success: true,
    message: 'Merchant deleted',
  });
});

export default router;