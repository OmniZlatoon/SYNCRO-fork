# Implementation Plan: Two-Factor Authentication (TOTP)

## Overview

Implement TOTP-based 2FA for SYNCRO using Supabase Auth MFA APIs. The plan covers the database migration, backend recovery code service and API routes, client enrollment flow, 2FA verification page, security settings panel, and middleware AAL enforcement.

## Tasks

- [x] 1. Database migration
  - Create `recovery_codes` table with RLS policies as specified in the design
  - Add `require_2fa` and `require_2fa_set_at` columns to `teams`
  - Add `two_fa_enabled_at` column to `profiles`
  - _Requirements: 1.5, 2.2, 4.2, 5.2_

- [x] 2. Backend — Recovery Code Service
  - [x] 2.1 Implement `RecoveryCodeService` in `backend/src/services/mfa-service.ts`
    - `generate(userId)`: produce 10 `crypto.randomBytes(10).toString('hex')` codes, bcrypt-hash each (cost 12), bulk-insert into `recovery_codes`, return plain-text codes
    - `verify(userId, code)`: fetch unused codes, `bcrypt.compare` each, set `used_at` on match, return boolean
    - `invalidateAll(userId)`: delete all recovery code rows for the user
    - _Requirements: 2.1, 2.2, 2.5, 3.4, 4.4_

  - [ ]* 2.2 Write property test for `RecoveryCodeService.generate` — Property 4
    - **Property 4: Recovery code generation produces 10 unique codes**
    - **Validates: Requirements 2.1**

  - [ ]* 2.3 Write property test for recovery code hashing — Property 5
    - **Property 5: Recovery codes are stored hashed**
    - **Validates: Requirements 2.2**

  - [ ]* 2.4 Write property test for single-use invariant — Property 8
    - **Property 8: Recovery code single-use invariant**
    - **Validates: Requirements 2.5, 3.4**

  - [ ]* 2.5 Write unit tests for `RecoveryCodeService`
    - `generate` returns exactly 10 unique strings
    - `verify` returns true for correct code, false for wrong code, false for used code
    - _Requirements: 2.1, 2.2, 2.5_

- [x] 3. Backend — TOTP Rate Limiter
  - [x] 3.1 Implement `TotpRateLimiter` in `backend/src/lib/totp-rate-limiter.ts`
    - Track failed attempts per session ID using `Map<sessionId, FailureRecord>`
    - Window: 10 min, max failures: 5, lockout: 15 min
    - Expose `recordFailure(sessionId)`, `isLocked(sessionId)`, `reset(sessionId)`
    - _Requirements: 6.2_

  - [ ]* 3.2 Write property test for rate limiter lockout — Property 17
    - **Property 17: Rate limiter locks out after 5 consecutive failures**
    - **Validates: Requirements 6.2**

  - [ ]* 3.3 Write unit tests for `TotpRateLimiter`
    - Lockout triggers at exactly 5 failures
    - Resets after window expires
    - _Requirements: 6.2_

- [x] 4. Backend — MFA API Routes
  - [x] 4.1 Create `backend/src/routes/mfa.ts` with all five routes
    - `POST /api/2fa/recovery-codes/generate` — call `RecoveryCodeService.generate`, return plain-text codes
    - `POST /api/2fa/recovery-codes/verify` — apply rate limiter, call `RecoveryCodeService.verify`, return 401 on failure / 429 on lockout
    - `DELETE /api/2fa/recovery-codes` — call `RecoveryCodeService.invalidateAll`
    - `POST /api/2fa/notify` — send confirmation email (non-blocking on failure)
    - `PUT /api/teams/:teamId/require-2fa` — verify team owner, update `require_2fa` and `require_2fa_set_at`
    - Apply `authenticate` middleware to all routes
    - _Requirements: 2.1, 2.5, 4.4, 5.2, 6.2, 6.4_

  - [ ]* 4.2 Write unit tests for MFA API routes
    - Generate route returns 10 codes
    - Verify route returns 401 for invalid code and 429 after 5 failures
    - Team enforcement route rejects non-owners
    - _Requirements: 2.1, 6.2_

- [x] 5. Checkpoint — Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Client — `TotpEnrollmentModal` component
  - [x] 6.1 Create `client/components/security/TotpEnrollmentModal.tsx`
    - Step 1: call `supabase.auth.mfa.enroll({ factorType: 'totp' })`, display QR code image and plain-text secret simultaneously
    - Step 2: 6-digit code input, call `mfa.challengeAndVerify`, show inline error on failure without resetting step
    - Step 3: call `POST /api/2fa/recovery-codes/generate`, display all 10 codes, provide download button (`buildDownloadBlob`)
    - After step 3: call `POST /api/2fa/notify { event: 'enrolled' }`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.3, 2.4, 6.4_

  - [ ]* 6.2 Write property test for enrollment UI data — Property 1
    - **Property 1: Enrollment data contains QR code and secret**
    - **Validates: Requirements 1.2**

  - [ ]* 6.3 Write property test for invalid TOTP code form state — Property 2
    - **Property 2: Invalid TOTP code preserves form state**
    - **Validates: Requirements 1.4, 3.3**

  - [ ]* 6.4 Write property test for recovery code display — Property 6
    - **Property 6: Recovery code display renders all 10 codes**
    - **Validates: Requirements 2.3**

  - [ ]* 6.5 Write property test for recovery code download — Property 7
    - **Property 7: Recovery code download contains all codes**
    - **Validates: Requirements 2.4**

  - [ ]* 6.6 Write unit tests for `TotpEnrollmentModal`
    - Step transitions work correctly
    - Error message shown on invalid code without closing modal
    - Download button triggers blob with all 10 codes
    - _Requirements: 1.2, 1.4, 2.3, 2.4_

- [x] 7. Client — Security Settings Panel
  - [x] 7.1 Create `client/components/security/SecuritySettingsPanel.tsx`
    - Display 2FA enabled/disabled status and `two_fa_enabled_at` date when enabled
    - Show "Enable 2FA" button when disabled; show "Disable 2FA" button when enabled
    - Disable flow: prompt for TOTP or recovery code, call `mfa.unenroll` + `DELETE /api/2fa/recovery-codes` + `POST /api/2fa/notify { event: 'disabled' }`, then update `two_fa_enabled_at` to null
    - For team owners: render enforcement toggle calling `PUT /api/teams/:teamId/require-2fa`
    - When team enforces 2FA: render disable control as unavailable with enforcement message
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.5_

  - [ ]* 7.2 Write property test for security settings panel state — Property 11
    - **Property 11: Security settings page reflects 2FA state**
    - **Validates: Requirements 4.1, 4.2**

  - [ ]* 7.3 Write property test for disable requires valid credential — Property 12
    - **Property 12: Disable 2FA requires valid credential**
    - **Validates: Requirements 4.3**

  - [ ]* 7.4 Write property test for team enforcement blocks disable — Property 14
    - **Property 14: Team enforcement blocks disable for members**
    - **Validates: Requirements 4.5**

  - [ ]* 7.5 Write property test for team enforcement policy persistence — Property 15
    - **Property 15: Team enforcement policy persists on toggle**
    - **Validates: Requirements 5.2, 5.5**

  - [ ]* 7.6 Write unit tests for `SecuritySettingsPanel`
    - Snapshot: enabled state shows date and disable button
    - Snapshot: disabled state shows enable button
    - Snapshot: enforced state shows locked disable control with message
    - _Requirements: 4.1, 4.2, 4.5_

- [x] 8. Client — Security Settings Page
  - Create `client/app/settings/security/page.tsx` as a server component
  - Fetch user's MFA factors via `supabase.auth.mfa.listFactors()` and team enforcement status from DB
  - Render `SecuritySettingsPanel` with fetched props
  - _Requirements: 4.1, 4.2, 4.5, 5.1_

- [x] 9. Client — 2FA Verification Page
  - [x] 9.1 Create `client/app/auth/2fa/page.tsx`
    - Accept TOTP code input: call `mfa.challengeAndVerify`, show inline error on failure
    - Accept recovery code input: call `POST /api/2fa/recovery-codes/verify`, handle 401 (invalid) and 429 (locked) responses
    - Track consecutive failures client-side; display lockout message when 429 received
    - On AAL2 elevation, redirect to `redirectTo` query param (or `/dashboard` as fallback)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 6.2_

  - [ ]* 9.2 Write property test for post-AAL2 redirect — Property 10
    - **Property 10: Post-AAL2 elevation redirects to original route**
    - **Validates: Requirements 3.5**

  - [ ]* 9.3 Write unit tests for 2FA verification page
    - Error shown on invalid TOTP without closing page
    - Lockout message shown on 429 response
    - Redirect uses `redirectTo` param after success
    - _Requirements: 3.3, 3.5, 6.2_

- [x] 10. Middleware — AAL enforcement
  - [x] 10.1 Extend `client/lib/supabase/middleware.ts` `updateSession` function
    - After session refresh, call `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`
    - If `currentLevel === 'aal1'` and `nextLevel === 'aal2'`, redirect to `/auth/2fa?redirectTo=<originalPath>`
    - If user has no enrolled factor and team `require_2fa=true`, redirect to `/settings/security?enforce=true`
    - Apply only to protected routes (exclude `/`, `/auth/*`, `/api/*`, `/_next/*`)
    - _Requirements: 3.1, 5.3, 5.4, 6.1_

  - [ ]* 10.2 Write property test for AAL1 session blocking — Property 9
    - **Property 9: AAL1 sessions with 2FA are blocked from protected routes**
    - **Validates: Requirements 3.1, 6.1**

  - [ ]* 10.3 Write property test for unenrolled members in enforced teams — Property 16
    - **Property 16: Unenrolled members in enforced teams are redirected to enrollment**
    - **Validates: Requirements 5.3**

  - [ ]* 10.4 Write unit tests for middleware AAL guard
    - AAL1 + enrolled factor → redirect to `/auth/2fa`
    - AAL2 → pass through
    - No factor + team enforced → redirect to `/settings/security?enforce=true`
    - Public routes → pass through without AAL check
    - _Requirements: 3.1, 5.3, 6.1_

- [x] 11. Client — `profiles` update on enrollment/disable
  - After successful `challengeAndVerify` in `TotpEnrollmentModal`, call backend or Supabase client to set `profiles.two_fa_enabled_at = now()`
  - After successful disable in `SecuritySettingsPanel`, clear `profiles.two_fa_enabled_at = null`
  - _Requirements: 1.5, 4.4_

  - [ ]* 11.1 Write property test for enrollment persists 2FA status — Property 3
    - **Property 3: Successful enrollment persists 2FA enabled status**
    - **Validates: Requirements 1.5**

  - [ ]* 11.2 Write property test for disable clears all factors and recovery codes — Property 13
    - **Property 13: Disable 2FA clears all factors and recovery codes**
    - **Validates: Requirements 4.4**

- [x] 12. Email notification — 2FA lifecycle events
  - Implement `POST /api/2fa/notify` handler to send confirmation email for `enrolled` and `disabled` events
  - Email send failures must be non-blocking (log error, do not fail the request)
  - _Requirements: 6.4_

  - [ ]* 12.1 Write property test for 2FA lifecycle email — Property 18
    - **Property 18: 2FA lifecycle events trigger confirmation email**
    - **Validates: Requirements 6.4**

- [x] 13. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use **fast-check** with a minimum of 100 iterations per test
- Tag format for property tests: `// Feature: two-factor-authentication, Property {N}: {property_text}`
- All backend routes use the Supabase service role key for DB inserts (bypasses RLS)
- HTTPS is enforced at the infrastructure level; no additional code needed for Requirement 6.3
