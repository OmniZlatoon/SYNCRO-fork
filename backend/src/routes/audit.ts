import { Router, Request, Response } from 'express';
import { auditService, AuditEntry } from '../services/audit-service';
import { adminAuth } from '../middleware/admin';
import { validate } from '../middleware/validate';
import logger from '../config/logger';
import { auditBatchSchema, auditQuerySchema } from '../schemas/audit';

const router: Router = Router();

/**
 * POST /api/audit
 * Submit a batch of audit events
 */
router.post('/', validate(auditBatchSchema), async (req: Request, res: Response) => {
  try {
    const enrichedEvents = req.body.events.map((event: any) => ({
      ...event,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent') || undefined,
    }));

    const result = await auditService.insertBatch(enrichedEvents as AuditEntry[]);

    if (!result.success) {
      logger.warn(`Audit batch insertion failed: ${result.errors.join(', ')}`);
      return res.status(400).json({
        error: 'Failed to insert audit events',
        details: result.errors,
      });
    }

    logger.info(
      `Audit batch processed: ${result.inserted} inserted, ${result.failed} failed`,
    );

    res.status(201).json({
      success: true,
      inserted: result.inserted,
      failed: result.failed,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (error) {
    logger.error('Error in POST /api/audit:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/audit
 * Retrieve audit logs (admin only)
 */
router.get(
  '/',
  adminAuth,
  validate(auditQuerySchema, 'query'),
  async (req: Request, res: Response) => {
    try {
      const { action, resourceType, userId, limit, offset, startDate, endDate } = req.query as any;

      const logs = await auditService.getAllLogs({
        action,
        resourceType,
        userId,
        limit,
        offset,
        startDate,
        endDate,
      });

      const total = await auditService.getLogsCount({
        action,
        resourceType,
        userId,
      });

      res.json({
        success: true,
        data: logs,
        pagination: {
          limit,
          offset,
          total,
          hasMore: offset + limit < total,
        },
      });
    } catch (error) {
      logger.error('Error in GET /api/admin/audit:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
);

export default router;
