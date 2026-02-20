import cron from 'node-cron';
import logger from '../config/logger';
import { reminderEngine } from './reminder-engine';
import { renewalExecutor } from './renewal-executor';
import { supabase } from '../config/database';

export class SchedulerService {
  private jobs: cron.ScheduledTask[] = [];

  /**
   * Start all scheduled jobs
   */
  start(): void {
    logger.info('Starting scheduler service');

    // Schedule reminder processing - runs daily at 9 AM UTC
    const reminderJob = cron.schedule('0 9 * * *', async () => {
      logger.info('Running scheduled reminder processing');
      try {
        await reminderEngine.processReminders();
      } catch (error) {
        logger.error('Error in scheduled reminder processing:', error);
      }
    });

    this.jobs.push(reminderJob);

    // Schedule reminder scheduling - runs daily at midnight UTC
    const schedulingJob = cron.schedule('0 0 * * *', async () => {
      logger.info('Running scheduled reminder scheduling');
      try {
        await reminderEngine.scheduleReminders();
      } catch (error) {
        logger.error('Error in scheduled reminder scheduling:', error);
      }
    });

    this.jobs.push(schedulingJob);

    // Schedule retry processing - runs every 30 minutes
    const retryJob = cron.schedule('*/30 * * * *', async () => {
      logger.info('Running scheduled retry processing');
      try {
        await reminderEngine.processRetries();
      } catch (error) {
        logger.error('Error in scheduled retry processing:', error);
      }
    });

    this.jobs.push(retryJob);

    // Schedule renewal execution - runs every hour
    const renewalJob = cron.schedule('0 * * * *', async () => {
      logger.info('Running scheduled renewal execution');
      try {
        await this.processRenewals();
      } catch (error) {
        logger.error('Error in scheduled renewal execution:', error);
      }
    });

    this.jobs.push(renewalJob);

    logger.info(`Started ${this.jobs.length} scheduled jobs`);
  }

  private async processRenewals(): Promise<void> {
    const { data: pendingRenewals, error } = await supabase
      .from('subscriptions')
      .select('id, user_id, price')
      .eq('status', 'active')
      .lte('next_billing_date', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());

    if (error || !pendingRenewals) {
      logger.error('Failed to fetch pending renewals:', error);
      return;
    }

    for (const sub of pendingRenewals) {
      const { data: approval } = await supabase
        .from('renewal_approvals')
        .select('approval_id')
        .eq('subscription_id', sub.id)
        .eq('used', false)
        .single();

      if (approval) {
        await renewalExecutor.executeRenewalWithRetry({
          subscriptionId: sub.id,
          userId: sub.user_id,
          approvalId: approval.approval_id,
          amount: sub.price,
        });
      }
    }
  }

  /**
   * Stop all scheduled jobs
   */
  stop(): void {
    logger.info('Stopping scheduler service');
    this.jobs.forEach((job) => job.stop());
    this.jobs = [];
    logger.info('Scheduler service stopped');
  }

  /**
   * Get status of all jobs
   */
  getStatus(): { running: boolean; jobCount: number } {
    return {
      running: this.jobs.length > 0,
      jobCount: this.jobs.length,
    };
  }
}

export const schedulerService = new SchedulerService();

