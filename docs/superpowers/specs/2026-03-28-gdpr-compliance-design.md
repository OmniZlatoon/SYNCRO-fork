# GDPR Compliance Design — Issue #173

**Date:** 2026-03-28
**Status:** Approved
**Approach:** Backend-first (APIs and DB changes first, then frontend)

## Overview

Add GDPR compliance to SYNCRO: data export, right to erasure (account deletion), cookie consent, privacy/terms pages, and email unsubscribe. This covers GDPR, CAN-SPAM, and provides a foundation for CCPA/NDPR compliance.

## Decisions Summary

| Feature | Approach |
|---------|----------|
| Data export | Streamed ZIP via `archiver`, 8 data files + README |
| Account deletion | 30-day soft delete, auth stays active, user can self-cancel, daily cron hard deletes |
| Audit log preservation | Make `audit_logs.user_id` nullable, change FK to `ON DELETE SET NULL` |
| Cookie consent | Client-side HTTP cookie only, minimal banner, no DB table |
| Unsubscribe | Stateless HMAC tokens, GET renders confirmation page, POST executes unsubscribe |
| Email headers | `List-Unsubscribe` + `List-Unsubscribe-Post` on all outbound emails |
| Privacy/Terms/DPA | Static pages with generated content, DPA is contact-only placeholder |
| New backend structure | `compliance.ts` route + `compliance-service.ts` service |
| New DB table | `account_deletions` only (1 new table) |

---

## 1. Database Changes

### New Table: `account_deletions`

```sql
CREATE TABLE account_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_deletion_at TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled', 'completed')),
  CONSTRAINT valid_scheduled_date CHECK (scheduled_deletion_at > requested_at)
);

CREATE INDEX idx_account_deletions_status ON account_deletions(status);
CREATE INDEX idx_account_deletions_scheduled ON account_deletions(scheduled_deletion_at) WHERE status = 'pending';

ALTER TABLE account_deletions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own deletion status"
  ON account_deletions FOR SELECT
  USING (auth.uid() = user_id);
```

### Migration: Audit Logs FK Change

```sql
-- Make user_id nullable so audit logs survive user deletion
ALTER TABLE audit_logs ALTER COLUMN user_id DROP NOT NULL;

-- Change FK from CASCADE to SET NULL
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Index for efficient data export queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
```

### No Other Schema Changes

- `user_preferences.email_opt_ins` JSONB already supports `{marketing, reminders, updates, digests}` categories
- Cookie consent stored as HTTP cookie only — no DB table needed
- Unsubscribe tokens are stateless HMAC — no DB table needed

---

## 2. Data Export API

**Endpoint:** `GET /api/user/export`
**Auth:** Required
**Rate limit:** 1 request per hour per user
**Response:** Streamed ZIP (`Content-Disposition: attachment`)

### ZIP Contents

```
syncro-export-{userId}-{date}.zip
├── profile.json          — profiles table data
├── subscriptions.json    — all subscriptions (including cancelled/paused, with price history)
├── notifications.json    — notification history
├── audit-log.json        — user's audit events
├── preferences.json      — user_preferences data
├── email-accounts.json   — connected email accounts
├── teams.json            — team memberships and owned teams
├── blockchain-log.json   — contract_events + renewal_approvals
└── README.txt            — explains each file and data format
```

### Implementation

- **Route file:** `backend/src/routes/compliance.ts`
- **Service:** `backend/src/services/compliance-service.ts`
- **Package:** `archiver` npm package for ZIP streaming (pipe directly to response, no temp files on disk)
- All data types queried in parallel via `Promise.all`
- Audit log entry created when export is generated
- All PII included as-is (that's the point of a GDPR data export)

---

## 3. Account Deletion

### Endpoints

- `POST /api/user/account/delete` — request deletion (starts 30-day grace period)
- `POST /api/user/account/delete/cancel` — cancel pending deletion

Both require authentication.

### Request Deletion Flow

1. Check for existing `account_deletions` row for this user:
   - If `status: 'pending'` exists → reject (already scheduled)
   - If `status: 'cancelled'` exists → update it back to `pending` with new dates (reuse row, respects UNIQUE constraint)
   - If none or `status: 'completed'` → insert new row
2. Set `status: 'pending'`, `scheduled_deletion_at: now + 30 days`
3. Cancel all active subscriptions (set status to `cancelled` in DB + attempt blockchain cancel non-blocking)
4. Cancel pending reminders/notifications
5. Send confirmation email with scheduled deletion date
6. Log to `audit_logs`

### Self-Cancel Flow

1. User logs in, sees "account scheduled for deletion" banner
2. Hits cancel endpoint
3. Sets `cancelled_at = now()` and `status = 'cancelled'` on the `account_deletions` row
4. Subscriptions are NOT auto-reactivated — user re-subscribes manually

### Hard Delete Cron Job (Daily)

Runs daily via `node-cron` (added to existing `backend/src/services/scheduler.ts`).

1. Query `account_deletions WHERE status = 'pending' AND scheduled_deletion_at <= now()`
2. For each user:
   a. **Anonymize audit logs first:** Set `user_id = NULL`, `ip_address = NULL`, `user_agent = NULL` on all `audit_logs` rows for this user (preserves action/resource for security audit trail)
   b. Send final confirmation email ("your account has been deleted")
   c. Delete Supabase auth user via admin API — cascading deletes handle: `subscriptions`, `notifications`, `push_subscriptions`, `email_accounts`, `user_preferences`, `teams`, `team_members`, `profiles`, `contract_events`, `renewal_approvals`, `webhook_configs`, `subscription_risk_scores`
   d. Update `account_deletions` row: `status = 'completed'`, `completed_at = now()`
3. Log completion to audit system

**Critical ordering:** Audit log anonymization MUST happen before auth user deletion. The FK is `ON DELETE SET NULL`, so both approaches (explicit anonymization of ip_address/user_agent + cascade setting user_id to NULL) work together correctly.

---

## 4. Email Unsubscribe System

### Stateless HMAC Tokens

```
payload = base64url(JSON.stringify({ userId, emailType, timestamp }))
signature = HMAC-SHA256(UNSUBSCRIBE_SECRET, payload)
token = payload.signature
```

- No DB table needed
- Token expiry: 90 days (generous, per RFC 8058)
- New env var: `UNSUBSCRIBE_SECRET`

### Endpoints

- `GET /api/unsubscribe?token={token}` — renders HTML confirmation page with "Confirm unsubscribe" button
- `POST /api/unsubscribe` — validates token, performs unsubscribe, renders success page

**GET does NOT mutate state.** This prevents email client link scanners and prefetch bots from accidentally unsubscribing users. The GET renders a page; the POST (triggered by the confirm button) does the actual work.

### Unsubscribe Flow

1. User clicks unsubscribe link in email
2. GET renders confirmation page: "Unsubscribe from {type}? [Confirm] | [Manage all preferences]"
3. User clicks Confirm → POST fires
4. Token validated (HMAC signature + expiry check)
5. `user_preferences.email_opt_ins.{emailType}` set to `false`
6. Success page rendered: "You've been unsubscribed from {type}. [Manage all email preferences]"

### Email Preferences Page

Client route: `/email-preferences?token={token}`

- **Client-rendered page** (not backend-rendered) — needs toggle UI with state management
- Calls backend APIs: `GET /api/user/preferences` (read) and `PATCH /api/user/preferences` (update)
- Two auth modes: signed HMAC token (from email link, no login required) OR session auth (from settings page)
- Shows toggles for: reminders, digests, marketing, updates
- Pre-populated from current `user_preferences.email_opt_ins`

Note: The unsubscribe confirmation/success pages (Section 4 endpoints) remain backend-rendered simple HTML — they don't need React.

### Email Template Changes

All emails sent via `email-service.ts` must include:

1. **Footer with unsubscribe link** — type-specific HMAC token link
2. **Link to full preferences page**
3. **Email headers:**
   - `List-Unsubscribe: <mailto:unsubscribe@syncro.app>, <https://app.syncro.com/api/unsubscribe?token=...>`
   - `List-Unsubscribe-Post: List-Unsubscribe=One-Click`

These headers enable native unsubscribe buttons in Gmail, Apple Mail, etc.

---

## 5. Cookie Consent Banner

**Client-side only — no backend changes.**

### Component: `client/components/cookie-consent.tsx`

- Fixed bottom banner, appears on first visit
- Text: "We use cookies to improve your experience." with link to Privacy Policy
- Two buttons: "Accept All" / "Necessary Only"
- Minimal design, consistent with existing UI (shadcn/ui components)

### Storage

- HTTP cookie: `syncro_consent`
- Values: `accepted` or `necessary_only`
- Attributes: `SameSite=Lax`, `Secure`, `Path=/`, 1-year expiry
- Banner only shows if cookie is absent

### Gating Logic

- Provide a `hasAnalyticsConsent()` utility function
- Any future analytics initialization (Vercel Analytics, PostHog, etc.) must be wrapped in this check
- Currently nothing to gate — infrastructure only

### Integration

- Rendered in `client/app/layout.tsx`
- Client-side only (`"use client"`) — no SSR flash
- Mounts after hydration

---

## 6. Privacy Policy, Terms of Service & DPA Pages

### `/privacy` — Privacy Policy Page

`client/app/privacy/page.tsx`

Content covers:
- What data is collected (profile info, email, subscriptions, connected email accounts, blockchain activity, device/IP via audit logs)
- How data is used (subscription management, renewal reminders, analytics)
- Third-party processors (Supabase for DB/auth, SMTP provider for email, Stellar network for blockchain)
- Data retention policy (active data kept while account active, audit logs retained post-deletion in anonymized form, 30-day deletion grace period)
- User rights (data export, account deletion, unsubscribe, cookie consent management)
- Cookie policy (necessary cookies for auth, optional analytics)
- Contact information
- Links to Terms of Service and DPA

### `/terms` — Terms of Service Page

`client/app/terms/page.tsx`

Content covers:
- Account responsibilities
- Self-custodial nature (SYNCRO never has custody of funds)
- Acceptable use
- Service availability (no SLA guarantees)
- Limitation of liability
- Termination (both user-initiated and platform-initiated)
- Links to Privacy Policy

### `/dpa` — Data Processing Agreement Page

`client/app/dpa/page.tsx`

- Brief explanation of what a DPA is and when it's needed
- "Contact us at {email} to request our Data Processing Agreement"
- Placeholder until legal counsel drafts a proper document

### Shared Implementation

- All three are server-rendered static pages (no client-side data fetching)
- Lightweight shared styling: consistent max-width container, clean typography, back link
- Content written directly in components (no CMS — these change rarely)
- "Last updated" date displayed on each page

---

## 7. Frontend Integration

### Settings: Data & Privacy Section

New section in user settings with:

- **"Export my data" button** — triggers `GET /api/user/export`, browser downloads ZIP
- **"Delete my account" button** — opens confirmation modal:
  - Warning text explaining 30-day grace period and what happens (subscriptions cancelled, data deleted after 30 days)
  - Optional reason text field
  - "I understand this action will cancel my subscriptions" checkbox
  - "Delete Account" danger button
  - Calls `POST /api/user/account/delete`

### Deletion Pending Banner

- If user has `status: 'pending'` in `account_deletions`, show a warning banner at the top of all authenticated pages
- Text: "Your account is scheduled for deletion on {date}. [Cancel deletion]"
- Cancel button calls `POST /api/user/account/delete/cancel`, dismisses banner on success

### Email Preferences Page

Client route: `/email-preferences`

- Accessible via signed token from unsubscribe link (no login required)
- Also accessible from settings when logged in
- Toggles for: reminders, digests, marketing, updates
- Reads/writes `user_preferences.email_opt_ins`

### Footer Updates

- Add "Privacy Policy" and "Terms of Service" links to the global app footer

---

## 8. New Dependencies

### Backend

- `archiver` — ZIP file generation for data export (well-maintained, standard choice)

### Client

- No new dependencies — cookie consent uses native `document.cookie`, UI uses existing shadcn/ui components

---

## 9. New Environment Variables

| Variable | Service | Purpose |
|----------|---------|---------|
| `UNSUBSCRIBE_SECRET` | Backend | HMAC signing key for stateless unsubscribe tokens |

---

## 10. New Files

### Backend
- `backend/src/routes/compliance.ts` — export, deletion, unsubscribe endpoints
- `backend/src/services/compliance-service.ts` — data gathering, deletion orchestration, HMAC token utils
- Migration SQL script (numbered next in sequence)

### Client
- `client/app/privacy/page.tsx`
- `client/app/terms/page.tsx`
- `client/app/dpa/page.tsx`
- `client/app/email-preferences/page.tsx`
- `client/components/cookie-consent.tsx`
- `client/components/deletion-banner.tsx`
- Settings section additions (in existing settings page)

---

## 11. Acceptance Criteria Mapping

| Criteria | Covered By |
|----------|-----------|
| Data export endpoint generates complete ZIP | Section 2 — 8 data files + README |
| Account deletion with 30-day grace period | Section 3 — soft delete, self-cancel, daily cron hard delete |
| Cookie consent banner implemented | Section 5 — minimal banner, HTTP cookie storage |
| Privacy Policy page exists | Section 6 — `/privacy` with generated content |
| Unsubscribe link in all emails | Section 4 — HMAC tokens, footer links, List-Unsubscribe headers |
| DPA template available for enterprise users | Section 6 — `/dpa` contact page |
