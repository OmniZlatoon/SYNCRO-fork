import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { auditService, AuditEntry } from '../services/audit-service';
import { adminAuth } from '../middleware/admin';
import { validateRequest } from '../utils/validation';
import { BadRequestError } from '../errors';

const router = Router();

// ─── Validation schemas ───────────────────────────────────────────────────────

const auditEventSchema = z.object({
  action: z.string().min(1).max(100),
  resource_type: z.string().min(1).max(100),
  resource_id: z.string().max(255).optional(),
  user_id: z.string().max(128).optional(),
  session_id: z.string().max(128).optional(),
  metadata: z.record(z.unknown()).optional(),
  status: z.enum(['success', 'failure', 'pending']).optional(),
  severity: z.enum(['info', 'warn', 'error', 'critical']).optional(),
  timestamp: z.string().datetime({ offset: true }).optional(),
});

const auditBatchSchema = z.object({
  events: z
    .array(auditEventSchema)
    .min(1, 'events array must not be empty')
    .max(100, 'maximum 100 events per batch'),
});

const auditQuerySchema = z.object({
  action: z.string().optional(),
  resourceType: z.string().optional(),
  userId: z.string().optional(),
  limit: z.string().transform(Number).optional().default('100'),
  offset: z.string().transform(Number).optional().default('0'),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/audit
 * Submit a batch of audit events
 */
router.post('/', async (req: Request, res: Response) => {
  const { events } = validateRequest(auditBatchSchema, req.body);

  // Enrich events with request metadata
  const enrichedEvents = events.map((event: any) => ({
    ...event,
    ipAddress: req.ip || (req.connection as any).remoteAddress,
    userAgent: req.get('user-agent') || undefined,
  }));

  const result = await auditService.insertBatch(enrichedEvents as AuditEntry[]);

  if (!result.success) {
    throw new BadRequestError('Failed to insert audit events', { details: result.errors });
  }

  res.status(201).json({
    success: true,
    inserted: result.inserted,
    failed: result.failed,
    errors: result.errors.length > 0 ? result.errors : undefined,
  });
});

/**
 * GET /api/audit
 * Retrieve audit logs (admin only)
 */
router.get('/', adminAuth, async (req: Request, res: Response) => {
  const {
    action,
    resourceType,
    userId,
    limit,
    offset,
    startDate,
    endDate,
  } = validateRequest(auditQuerySchema, req.query, 'query');

  const parsedLimit = Math.min(limit || 100, 1000);
  const parsedOffset = Math.max(offset || 0, 0);

  const [logs, total] = await Promise.all([
    auditService.getAllLogs({
      action: action as string | undefined,
      resourceType: resourceType as string | undefined,
      userId: userId as string | undefined,
      limit: parsedLimit,
      offset: parsedOffset,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
    }),
    auditService.getLogsCount({
      action: action as string | undefined,
      resourceType: resourceType as string | undefined,
      userId: userId as string | undefined,
    }),
  ]);

  res.json({
    success: true,
    data: logs,
    pagination: {
      limit: parsedLimit,
      offset: parsedOffset,
      total,
      hasMore: parsedOffset + parsedLimit < total,
    },
  });
});

export default router;
