import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';

const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

if (!ADMIN_API_KEY) {
  throw new Error(
    'ADMIN_API_KEY environment variable is required. ' +
    'Please set it to a strong random value and restart the server.'
  );
}

export const adminAuth = (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-admin-api-key'];
    if (!apiKey || apiKey !== ADMIN_API_KEY) {
        logger.warn(`Unauthorized admin access attempt from IP: ${req.ip}`);
        return res.status(401).json({ error: 'Unauthorized: Invalid admin API key' });
    }
    next();
};
