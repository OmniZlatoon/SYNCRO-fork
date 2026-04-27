/**
 * Contract Event Types
 * Standardized types for events emitted by the Soroban contract
 */

export enum EventType {
  RENEWAL_SUCCESS = 'RenewalSuccess',
  RENEWAL_FAILED = 'RenewalFailed',
  DUPLICATE_RENEWAL_REJECTED = 'DuplicateRenewalRejected',
  STATE_TRANSITION = 'StateTransition',
  APPROVAL_CREATED = 'ApprovalCreated',
  APPROVAL_REJECTED = 'ApprovalRejected',
  EXECUTOR_ASSIGNED = 'ExecutorAssigned',
  EXECUTOR_REMOVED = 'ExecutorRemoved',
  LIFECYCLE_TIMESTAMP_UPDATED = 'LifecycleTimestampUpdated',
}

export interface RenewalSuccessPayload {
  sub_id: number;
}

export interface RenewalFailedPayload {
  sub_id: number;
  failure_count: number;
}

export interface StateTransitionPayload {
  sub_id: number;
  new_state: 'Active' | 'Retrying' | 'Failed';
}

export interface ApprovalCreatedPayload {
  sub_id: number;
  approval_id: string;
  max_spend: string;
  expires_at: string;
}

export interface ApprovalRejectedPayload {
  sub_id: number;
  approval_id: string;
  reason: string;
}

export interface ExecutorAssignedPayload {
  sub_id: number;
  executor: string;
}

export interface ExecutorRemovedPayload {
  sub_id: number;
}

export interface DuplicateRenewalRejectedPayload {
  sub_id: number;
  cycle_id: string;
}

export interface LifecycleTimestampUpdatedPayload {
  sub_id: number;
  event_kind: number;
  timestamp: string;
}

export type ContractEventValue =
  | RenewalSuccessPayload
  | RenewalFailedPayload
  | StateTransitionPayload
  | ApprovalCreatedPayload
  | ApprovalRejectedPayload
  | ExecutorAssignedPayload
  | ExecutorRemovedPayload
  | DuplicateRenewalRejectedPayload
  | LifecycleTimestampUpdatedPayload;

export interface ContractEvent {
  type: string;
  ledger: number;
  txHash: string;
  contractId: string;
  topics: string[];
  value: ContractEventValue;
}

export interface ProcessedEvent {
  sub_id: number;
  event_type: string;
  ledger: number;
  tx_hash: string;
  event_data: ContractEventValue;
}

export interface DBContractEvent extends ProcessedEvent {
  id: string;
  processed_at: string;
}
