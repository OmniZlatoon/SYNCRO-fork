/**
 * Monthly Digest Type Definitions
 * All interfaces used across the digest pipeline
 */

// ─── Summary Data ────────────────────────────────────────────────────────────

export interface UpcomingRenewal {
  subscriptionId: string;
  name: string;
  price: number;
  currency: string;
  renewalDate: string; // ISO date
  billingCycle: string;
  logoUrl?: string | null;
  daysUntilRenewal: number;
}

export interface PriceChange {
  subscriptionId: string;
  name: string;
  oldPrice: number;
  newPrice: number;
  delta: number;       // newPrice - oldPrice
  deltaPercent: number;
  currency: string;
  detectedAt: string;
}

export interface DigestAlert {
  subscriptionId: string;
  name: string;
  alertType: 'approval_expiring' | 'payment_failed' | 'trial_ending' | 'high_risk' | 'unused';
  message: string;
  severity: 'info' | 'warning' | 'critical';
  actionUrl?: string;
}

export interface MonthlyDigestSummary {
  userId: string;
  userEmail: string;
  userFullName?: string | null;
  generatedAt: string;         // ISO timestamp
  periodLabel: string;         // e.g. "March 2025"
  periodMonth: number;         // 1–12
  periodYear: number;

  totalMonthlySpend: number;
  lastMonthSpend: number;
  spendDifference: number;     // totalMonthlySpend - lastMonthSpend
  spendDifferencePercent: number;
  yearToDateSpend: number;

  renewalsCount: number;
  upcomingRenewals: UpcomingRenewal[];

  priceChanges: PriceChange[];
  alerts: DigestAlert[];

  currency: string;            // User's preferred display currency
}

// ─── User Preferences ────────────────────────────────────────────────────────

export type DigestDay = 1 | 15 | number; // day of month (1–28)

export interface UserDigestPreferences {
  userId: string;
  digestEnabled: boolean;
  digestDay: DigestDay;
  includeYearToDate: boolean;
  updatedAt: string;
}

// ─── Audit / Logging ─────────────────────────────────────────────────────────

export type DigestSendStatus = 'sent' | 'failed' | 'skipped';

export interface DigestAuditRecord {
  id: string;
  userId: string;
  digestType: "monthly" | "test";
  periodLabel: string;
  status: DigestSendStatus;
  errorMessage?: string | null;
  sentAt: string;
}