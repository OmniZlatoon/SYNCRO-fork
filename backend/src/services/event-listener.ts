import logger from '../config/logger';
import { supabase } from '../config/database';
import { reorgHandler } from './reorg-handler';
import { generateCycleId } from '../utils/cycle-id';
import { renewalCooldownService } from './renewal-cooldown-service';
import { calculateBackoffDelay, NonRetryableError } from '../utils/retry';

interface ContractEvent {
  type: string;
  ledger: number;
  txHash: string;
  contractId: string;
  topics: string[];
  value: any;
}

interface ProcessedEvent {
  sub_id: number;
  event_type: string;
  ledger: number;
  tx_hash: string;
  event_data: any;
}

export interface EventListenerHealth {
  status: 'healthy' | 'unhealthy' | 'stopped';
  isRunning: boolean;
  lastSuccessfulPoll: string | null;
  consecutiveErrors: number;
  lastProcessedLedger: number;
}

const ALERT_THRESHOLD = 10;
const MAX_BACKOFF_MS = 300_000; // 5 minutes
export type EventListenerStatus = 'running' | 'stopped' | 'disabled' | 'retrying' | 'failed';
  status: EventListenerStatus;
  reason?: string;
  lastProcessedLedger: number | null;
  retryCount?: number;
  nextRetryAt?: string | null;
const MAX_RETRY_ATTEMPTS = 10;
const RETRY_INITIAL_DELAY_MS = 5000;
const RETRY_MAX_DELAY_MS = 5 * 60 * 1000; // 5 minutes

export class EventListener {
  private contractId: string;
  private rpcUrl: string;
  private lastProcessedLedger: number = 0;
  private isRunning: boolean = false;

  // Configurable via env var — defaults to 5 seconds
  private readonly pollInterval: number = parseInt(
    process.env.EVENT_LISTENER_INTERVAL_MS ?? '5000',
    10
  );

  // Resilience state
  private isProcessing: boolean = false;
  private consecutiveErrors: number = 0;
  private lastSuccessfulPoll: Date | null = null;

  // Health tracking
  private _status: EventListenerStatus = 'stopped';
  private _disabledReason?: string;
  private _retryCount: number = 0;
  private _nextRetryAt: Date | null = null;

  constructor() {
    this.contractId = process.env.SOROBAN_CONTRACT_ADDRESS || '';
    this.rpcUrl =
      process.env.STELLAR_NETWORK_URL || 'https://soroban-testnet.stellar.org';

    if (!this.contractId) {
      // Don't throw — mark as disabled so the process can still start
      this._status = 'disabled';
      this._disabledReason = 'SOROBAN_CONTRACT_ADDRESS not configured';
      logger.warn('EventListener disabled: SOROBAN_CONTRACT_ADDRESS not configured');
    }
  }

  getHealth(): EventListenerHealth {
    return {
      status: this._status,
      reason: this._disabledReason,
      lastProcessedLedger: this.lastProcessedLedger || null,
      retryCount: this._retryCount,
      nextRetryAt: this._nextRetryAt?.toISOString() ?? null,
    };
  }

  async start() {
    if (this._status === 'disabled') {
      logger.warn('EventListener.start() called but listener is disabled', {
        reason: this._disabledReason,
      });
      return;
    }

    if (this.isRunning) return;

    this.isRunning = true;
    this._status = 'running';
    this._retryCount = 0;
    this._nextRetryAt = null;
    this.lastProcessedLedger = await this.getLastProcessedLedger();
    logger.info('Event listener started', { lastLedger: this.lastProcessedLedger });

    void this.poll();
  }

  stop() {
    this.isRunning = false;
    if (this._status !== 'disabled') {
      this._status = 'stopped';
    }
    logger.info('Event listener stopped');
  }

  /**
   * Returns a health snapshot for the admin health endpoint.
   */
  getHealth(): EventListenerHealth {
    const status = !this.isRunning
      ? 'stopped'
      : this.consecutiveErrors >= ALERT_THRESHOLD
      ? 'unhealthy'
      : 'healthy';

    return {
      status,
      isRunning: this.isRunning,
      lastSuccessfulPoll: this.lastSuccessfulPoll?.toISOString() ?? null,
      consecutiveErrors: this.consecutiveErrors,
      lastProcessedLedger: this.lastProcessedLedger,
    };
  }

  /**
   * Main poll loop with:
   *  - Exponential backoff on errors (max 5 minutes)
   *  - Mutex to prevent overlapping fetchAndProcessEvents calls
   *  - Alert log after ALERT_THRESHOLD consecutive failures
   */
  private async poll() {
    let backoffMs = this.pollInterval;

    while (this.isRunning) {
      // Mutex: skip tick if the previous call is still running
      if (this.isProcessing) {
        logger.warn('EventListener: previous poll still running, skipping tick');
        await this.sleep(backoffMs);
        continue;
      }

      this.isProcessing = true;
      try {
        await this.fetchAndProcessEvents();

        // Success — reset backoff and error counter
        this.lastSuccessfulPoll = new Date();
        this.consecutiveErrors = 0;
        backoffMs = this.pollInterval;
      } catch (error) {
        this.consecutiveErrors++;
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);

        logger.error('EventListener poll failed', {
          error,
          consecutiveErrors: this.consecutiveErrors,
          nextRetryMs: backoffMs,
        });

        // Fire alert after threshold consecutive failures
        if (this.consecutiveErrors === ALERT_THRESHOLD) {
          logger.error(
            `ALERT: EventListener has failed ${ALERT_THRESHOLD} consecutive times`,
            {
              lastSuccessfulPoll: this.lastSuccessfulPoll?.toISOString() ?? 'never',
            }
          );
          // Plug in PagerDuty / Slack / email notification here if needed
        }
      } finally {
        // Always release the mutex, even if fetchAndProcessEvents throws
        this.isProcessing = false;
        // Reset retry count on success
        if (this._retryCount > 0) {
          logger.info('EventListener recovered after retries', { retryCount: this._retryCount });
          this._retryCount = 0;
          this._nextRetryAt = null;
        this._status = 'running';
        logger.error('Event polling error:', error);
        await this.handlePollError(error);
        if (!this.isRunning) break;
      }

      await this.sleep(backoffMs);
    }
  }

private async fetchAndProcessEvents() {
  logger.info('Polling for events...');
  const currentLedger = await this.getCurrentLedger();
  private async handlePollError(error: unknown) {
    this._retryCount++;

    if (this._retryCount >= MAX_RETRY_ATTEMPTS) {
      this._status = 'failed';
      this._disabledReason = `Exceeded max retry attempts (${MAX_RETRY_ATTEMPTS}). Last error: ${error instanceof Error ? error.message : String(error)}`;
      logger.error('EventListener permanently failed after max retries', {
        retryCount: this._retryCount,
        error: this._disabledReason,
      });
      this.isRunning = false;
      return;
    }

    const delay = calculateBackoffDelay(this._retryCount, {
      initialDelay: RETRY_INITIAL_DELAY_MS,
      maxDelay: RETRY_MAX_DELAY_MS,
      multiplier: 2,
      jitter: true,
    });

    this._status = 'retrying';
    this._nextRetryAt = new Date(Date.now() + delay);
    logger.warn('EventListener will retry', {
      attempt: this._retryCount,
      delayMs: delay,
      nextRetryAt: this._nextRetryAt.toISOString(),
    });

    await this.sleep(delay);
  }

  private async fetchAndProcessEvents() {
    const currentLedger = await this.getCurrentLedger();

  // Check for reorg
  if (currentLedger < this.lastProcessedLedger) {
    await reorgHandler.handleReorg(currentLedger, this.lastProcessedLedger);
    this.lastProcessedLedger = await this.getLastProcessedLedger();
  }

  const events = await this.fetchEvents(this.lastProcessedLedger + 1);

  if (events.length === 0) return;

  const processed = await this.processEvents(events);

  if (processed.length > 0) {
    await this.saveEvents(processed);
    this.lastProcessedLedger = Math.max(...events.map(e => e.ledger));
    await this.updateLastProcessedLedger(this.lastProcessedLedger);
  }
}




  private async fetchEvents(fromLedger: number): Promise<ContractEvent[]> {
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getEvents',
        params: {
          startLedger: fromLedger,
          filters: [{ contractIds: [this.contractId] }],
        },
      }),
    });

    const data: any = await response.json();
    return data.result?.events || [];
  }

  private async processEvents(events: ContractEvent[]): Promise<ProcessedEvent[]> {
    const processed: ProcessedEvent[] = [];

    for (const event of events) {
      const handler = this.getEventHandler(event.type);
      if (handler) {
        const result = await handler(event);
        if (result) processed.push(result);
      }
    }

    return processed;
  }

  private getEventHandler(eventType: string) {
    const handlers: Record<string, (e: ContractEvent) => Promise<ProcessedEvent | null>> = {
      RenewalSuccess: this.handleRenewalSuccess.bind(this),
      RenewalFailed: this.handleRenewalFailed.bind(this),
      StateTransition: this.handleStateTransition.bind(this),
      ApprovalCreated: this.handleApprovalCreated.bind(this),
      ApprovalRejected: this.handleApprovalRejected.bind(this),
      ExecutorAssigned: this.handleExecutorAssigned.bind(this),
      ExecutorRemoved: this.handleExecutorRemoved.bind(this),
      DuplicateRenewalRejected: this.handleDuplicateRenewalRejected.bind(this),
      LifecycleTimestampUpdated: this.handleLifecycleTimestampUpdated.bind(this),
    };

    return handlers[eventType];
  }

  private async handleRenewalSuccess(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id } = event.value;

    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id, next_billing_date')
      .eq('blockchain_sub_id', sub_id)
      .single();

    const updateData: Record<string, any> = {
      status: 'active',
      last_payment_date: new Date().toISOString(),
      failure_count: 0,
      last_renewal_attempt_at: new Date().toISOString(),
    };

    if (sub?.next_billing_date) {
      updateData.last_renewal_cycle_id = generateCycleId(sub.next_billing_date);
    }

    await supabase
      .from('subscriptions')
      .update(updateData)
      .eq('blockchain_sub_id', sub_id);

    if (sub?.id) {
      try {
        await renewalCooldownService.recordRenewalAttempt(
          sub.id,
          true,
          undefined,
          'automatic'
        );
      } catch (recordError) {
        logger.warn('Failed to record renewal attempt success:', recordError);
        // Don't throw — the main operation succeeded
      }
    }

    return {
      sub_id,
      event_type: 'renewal_success',
      ledger: event.ledger,
      tx_hash: event.txHash,
      event_data: event.value,
    };
  }

  private async handleRenewalFailed(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id, failure_count } = event.value;

    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('blockchain_sub_id', sub_id)
      .single();

    const updateData: Record<string, any> = {
      status: 'retrying',
      failure_count,
      last_renewal_attempt_at: new Date().toISOString(),
    };

    await supabase
      .from('subscriptions')
      .update(updateData)
      .eq('blockchain_sub_id', sub_id);

    if (sub?.id) {
      try {
        await renewalCooldownService.recordRenewalAttempt(
          sub.id,
          false,
          `Renewal failed on blockchain (failure count: ${failure_count})`,
          'automatic'
        );
      } catch (recordError) {
        logger.warn('Failed to record renewal attempt failure:', recordError);
        // Don't throw — the main operation succeeded
      }
    }

    return {
      sub_id,
      event_type: 'renewal_failed',
      ledger: event.ledger,
      tx_hash: event.txHash,
      event_data: event.value,
    };
  }

  private async handleStateTransition(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id, new_state } = event.value;

    const statusMap: Record<string, string> = {
      Active: 'active',
      Retrying: 'retrying',
      Failed: 'cancelled',
    };

    await supabase
      .from('subscriptions')
      .update({ status: statusMap[new_state] || 'active' })
      .eq('blockchain_sub_id', sub_id);

    return {
      sub_id,
      event_type: 'state_transition',
      ledger: event.ledger,
      tx_hash: event.txHash,
      event_data: event.value,
    };
  }

  private async handleApprovalCreated(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id, approval_id, max_spend, expires_at } = event.value;

    await supabase
      .from('renewal_approvals')
      .insert({
        blockchain_sub_id: sub_id,
        approval_id,
        max_spend,
        expires_at,
        used: false,
      });

    return {
      sub_id,
      event_type: 'approval_created',
      ledger: event.ledger,
      tx_hash: event.txHash,
      event_data: event.value,
    };
  }

  private async handleApprovalRejected(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id, approval_id, reason } = event.value;

    await supabase
      .from('renewal_approvals')
      .update({
        rejected: true,
        rejection_reason: reason,
      })
      .eq('blockchain_sub_id', sub_id)
      .eq('approval_id', approval_id);

    return {
      sub_id,
      event_type: 'approval_rejected',
      ledger: event.ledger,
      tx_hash: event.txHash,
      event_data: event.value,
    };
  }

  private async handleDuplicateRenewalRejected(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id, cycle_id } = event.value;

    logger.warn('Duplicate renewal rejected by contract', { sub_id, cycle_id });

    return {
      sub_id,
      event_type: 'duplicate_renewal_rejected',
  private async handleExecutorAssigned(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id, executor } = event.value;

    await supabase
      .from('subscriptions')
      .update({ executor_address: executor })
      .eq('blockchain_sub_id', sub_id);
      event_type: 'executor_assigned',
      ledger: event.ledger,
      tx_hash: event.txHash,
      event_data: event.value,
    };
  }

  private async handleRenewalLockAcquired(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id, locked_at, lock_timeout } = event.value;

    logger.info('Renewal lock acquired on-chain', { sub_id, locked_at, lock_timeout });

    return {
      sub_id,
      event_type: 'renewal_lock_acquired',
  private async handleExecutorRemoved(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id } = event.value;

    await supabase
      .from('subscriptions')
      .update({ executor_address: null })
      .eq('blockchain_sub_id', sub_id);
      event_type: 'executor_removed',
      ledger: event.ledger,
      tx_hash: event.txHash,
      event_data: event.value,
    };
  }

  private async handleRenewalLockReleased(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id, released_at } = event.value;

    logger.info('Renewal lock released on-chain', { sub_id, released_at });

    return {
      sub_id,
      event_type: 'renewal_lock_released',
      ledger: event.ledger,
      tx_hash: event.txHash,
      event_data: event.value,
    };
  }

  private async handleRenewalLockExpired(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id, original_locked_at, expired_at } = event.value;

    logger.warn('Renewal lock expired on-chain', { sub_id, original_locked_at, expired_at });

    return {
      sub_id,
      event_type: 'renewal_lock_expired',
  private async handleDuplicateRenewalRejected(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id, cycle_id } = event.value;
    logger.warn('Duplicate renewal rejected', { sub_id, cycle_id, ledger: event.ledger });
      event_type: 'duplicate_renewal_rejected',
      ledger: event.ledger,
      tx_hash: event.txHash,
      event_data: event.value,
    };
  }

  private async handleLifecycleTimestampUpdated(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id, event_kind, timestamp } = event.value;

    const column = LIFECYCLE_COLUMN_MAP[event_kind];
    if (!column) {
      logger.warn('Unknown lifecycle event_kind', { sub_id, event_kind });
      return null;
    }

    await supabase
    const column = LIFECYCLE_COLUMN_MAP[event_kind as number];
      logger.warn('Unknown lifecycle event_kind', { event_kind });
    const { error } = await supabase
      .from('subscriptions')
      .update({ [column]: timestamp })
      .eq('blockchain_sub_id', sub_id);

    logger.info('Lifecycle timestamp updated', { sub_id, column, timestamp });
    if (error) {
      logger.error('Failed to update lifecycle timestamp', { error, sub_id, column });
    }

    return {
      sub_id,
      event_type: 'lifecycle_timestamp_updated',
      ledger: event.ledger,
      tx_hash: event.txHash,
      event_data: event.value,
    };
  }
  // Duplicate handlers removed below in favor of consolidated implementations later in the file

  private async saveEvents(events: ProcessedEvent[]) {
    const { error } = await supabase
      .from('contract_events')
      .insert(
        events.map(e => ({
          ...e,
          processed_at: new Date().toISOString(),
        }))
      );

    if (error) {
      logger.error('Failed to save events:', error);
      throw error;
    }

    logger.info('Saved events', { count: events.length });
  }

  private async getLastProcessedLedger(): Promise<number> {
    const { data } = await supabase
      .from('event_cursor')
      .select('last_ledger')
      .single();

    return data?.last_ledger || 0;
  }

  private async updateLastProcessedLedger(ledger: number) {
    await supabase
      .from('event_cursor')
      .upsert({ id: 1, last_ledger: ledger });
  }

  private async getCurrentLedger(): Promise<number> {
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getLatestLedger',
      }),
    });

    const data: any = await response.json();
    return data.result?.sequence || 0;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const LIFECYCLE_COLUMN_MAP: Record<number, string> = {
  1: 'blockchain_created_at',
  2: 'blockchain_activated_at',
  3: 'blockchain_last_renewed_at',
  4: 'blockchain_canceled_at',
};

export const eventListener = new EventListener();