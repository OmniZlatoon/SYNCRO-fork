import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { isSupportedCurrency } from '../constants/currencies';
import { ExchangeRateService } from '../services/exchange-rate/exchange-rate-service';
import { BadRequestError } from '../errors';

export function createExchangeRatesRouter(exchangeRateService: ExchangeRateService): Router {
  const router = Router();
  router.use(authenticate);

  /**
   * GET /api/exchange-rates
   */
  router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    const base = (req.query.base as string) || 'USD';

    if (!isSupportedCurrency(base)) {
      throw new BadRequestError(`Unsupported currency: ${base}`);
    }

    const data = await exchangeRateService.getExchangeRateResponse(base);

    res.json({
      success: true,
      data,
      meta: { timestamp: new Date().toISOString() },
    });
  });

  return router;
}
