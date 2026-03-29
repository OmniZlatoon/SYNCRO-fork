"use client"

// Feature: two-factor-authentication

import { useState, useCallback } from "react"
import { Shield, ShieldCheck, ShieldOff, AlertTriangle, ToggleLeft, ToggleRight } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { apiPost, apiDelete, apiPut } from "@/lib/api"
import TotpEnrollmentModal from "./TotpEnrollmentModal"

export interface SecuritySettingsPanelProps {
  twoFaEnabled: boolean
  twoFaEnabledAt: string | null   // ISO timestamp or null
  factorId: string | null          // Supabase MFA factor ID (needed for unenroll)
  isTeamOwner: boolean
  teamId: string | null
  teamRequires2fa: boolean
}

type DisableStep = "idle" | "confirm" | "submitting"

export default function SecuritySettingsPanel({
  twoFaEnabled: initialTwoFaEnabled,
  twoFaEnabledAt: initialTwoFaEnabledAt,
  factorId: initialFactorId,
  isTeamOwner,
  teamId,
  teamRequires2fa: initialTeamRequires2fa,
}: SecuritySettingsPanelProps) {
  const supabase = createClient()

  // Local state so the panel updates without a full page reload
  const [twoFaEnabled, setTwoFaEnabled] = useState(initialTwoFaEnabled)
  const [twoFaEnabledAt, setTwoFaEnabledAt] = useState(initialTwoFaEnabledAt)
  const [factorId, setFactorId] = useState(initialFactorId)
  const [teamRequires2fa, setTeamRequires2fa] = useState(initialTeamRequires2fa)

  // Enrollment modal
  const [showEnrollModal, setShowEnrollModal] = useState(false)

  // Disable flow
  const [disableStep, setDisableStep] = useState<DisableStep>("idle")
  const [disableCode, setDisableCode] = useState("")
  const [disableError, setDisableError] = useState("")

  // Team enforcement toggle
  const [enforcementLoading, setEnforcementLoading] = useState(false)
  const [enforcementError, setEnforcementError] = useState("")

  // ── Helpers ──────────────────────────────────────────────────────────────

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    })

  // ── Enable flow ──────────────────────────────────────────────────────────

  const handleEnrollComplete = useCallback(async () => {
    setShowEnrollModal(false)
    // Re-fetch the updated profile timestamp
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data } = await supabase
        .from("profiles")
        .select("two_fa_enabled_at")
        .eq("id", user.id)
        .single()
      if (data?.two_fa_enabled_at) {
        setTwoFaEnabledAt(data.two_fa_enabled_at)
      }
    }
    // Re-fetch the factor ID
    const { data: factors } = await supabase.auth.mfa.listFactors()
    const totp = factors?.totp?.[0]
    if (totp) setFactorId(totp.id)
    setTwoFaEnabled(true)
  }, [supabase])

  // ── Disable flow ─────────────────────────────────────────────────────────

  const handleDisableSubmit = useCallback(async () => {
    if (!disableCode.trim()) {
      setDisableError("Please enter a TOTP code or recovery code.")
      return
    }
    if (!factorId) {
      setDisableError("Factor ID not found. Please refresh and try again.")
      return
    }

    setDisableStep("submitting")
    setDisableError("")

    try {
      // Try TOTP verification first (6-digit numeric)
      const isTotpCode = /^\d{6}$/.test(disableCode.trim())

      if (isTotpCode) {
        const { data: challengeData, error: challengeError } =
          await supabase.auth.mfa.challenge({ factorId })
        if (challengeError || !challengeData) {
          setDisableError(challengeError?.message ?? "Failed to initiate challenge.")
          setDisableStep("confirm")
          return
        }
        const { error: verifyError } = await supabase.auth.mfa.verify({
          factorId,
          challengeId: challengeData.id,
          code: disableCode.trim(),
        })
        if (verifyError) {
          setDisableError("Invalid or expired TOTP code. Please try again.")
          setDisableStep("confirm")
          return
        }
      } else {
        // Recovery code path
        const res = await apiPost("/api/2fa/recovery-codes/verify", { code: disableCode.trim() })
        if (!res?.valid) {
          setDisableError("Invalid or already-used recovery code.")
          setDisableStep("confirm")
          return
        }
      }

      // Credential verified — proceed with unenroll
      const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId })
      if (unenrollError) {
        setDisableError(unenrollError.message ?? "Failed to unenroll. Please try again.")
        setDisableStep("confirm")
        return
      }

      // Delete recovery codes
      await apiDelete("/api/2fa/recovery-codes")

      // Send notification (non-blocking)
      apiPost("/api/2fa/notify", { event: "disabled" }).catch(() => {})

      // Clear two_fa_enabled_at in profiles
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase
          .from("profiles")
          .update({ two_fa_enabled_at: null })
          .eq("id", user.id)
      }

      // Update local state
      setTwoFaEnabled(false)
      setTwoFaEnabledAt(null)
      setFactorId(null)
      setDisableStep("idle")
      setDisableCode("")
    } catch (err: any) {
      setDisableError(err?.response?.data?.message ?? "An error occurred. Please try again.")
      setDisableStep("confirm")
    }
  }, [disableCode, factorId, supabase])

  const handleDisableCancel = useCallback(() => {
    setDisableStep("idle")
    setDisableCode("")
    setDisableError("")
  }, [])

  // ── Team enforcement toggle ───────────────────────────────────────────────

  const handleEnforcementToggle = useCallback(async () => {
    if (!teamId) return
    const newValue = !teamRequires2fa
    setEnforcementLoading(true)
    setEnforcementError("")
    try {
      await apiPut(`/api/teams/${teamId}/require-2fa`, { required: newValue })
      setTeamRequires2fa(newValue)
    } catch (err: any) {
      setEnforcementError(err?.response?.data?.message ?? "Failed to update team policy.")
    } finally {
      setEnforcementLoading(false)
    }
  }, [teamId, teamRequires2fa])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {showEnrollModal && (
        <TotpEnrollmentModal
          onComplete={handleEnrollComplete}
          onClose={() => setShowEnrollModal(false)}
        />
      )}

      <section
        aria-labelledby="security-settings-heading"
        className="space-y-6"
      >
        <div>
          <h2
            id="security-settings-heading"
            className="text-xl font-bold text-[#1E2A35]"
          >
            Security Settings
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Manage two-factor authentication and team security policies.
          </p>
        </div>

        {/* ── 2FA Status Card ── */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                {twoFaEnabled ? (
                  <ShieldCheck
                    aria-hidden="true"
                    className="w-8 h-8 text-[#007A5C] shrink-0"
                  />
                ) : (
                  <Shield
                    aria-hidden="true"
                    className="w-8 h-8 text-gray-400 shrink-0"
                  />
                )}
                <div>
                  <h3 className="font-semibold text-[#1E2A35]">
                    Two-Factor Authentication
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      aria-label={`2FA is ${twoFaEnabled ? "enabled" : "disabled"}`}
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        twoFaEnabled
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {twoFaEnabled ? "Enabled" : "Disabled"}
                    </span>
                    {twoFaEnabled && twoFaEnabledAt && (
                      <span className="text-xs text-gray-500">
                        since {formatDate(twoFaEnabledAt)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Enable / Disable button */}
              {!twoFaEnabled ? (
                <button
                  onClick={() => setShowEnrollModal(true)}
                  className="shrink-0 px-4 py-2 bg-[#FFD166] text-[#1E2A35] rounded-lg font-semibold text-sm hover:bg-[#FFD166]/90 transition-colors"
                >
                  Enable 2FA
                </button>
              ) : teamRequires2fa ? (
                <div className="shrink-0 text-right">
                  <button
                    disabled
                    aria-disabled="true"
                    className="px-4 py-2 bg-gray-100 text-gray-400 rounded-lg font-semibold text-sm cursor-not-allowed"
                  >
                    <ShieldOff aria-hidden="true" className="inline w-4 h-4 mr-1.5 -mt-0.5" />
                    Disable 2FA
                  </button>
                  <p className="text-xs text-amber-700 mt-1.5 flex items-center gap-1 justify-end">
                    <AlertTriangle aria-hidden="true" className="w-3.5 h-3.5" />
                    Required by your team
                  </p>
                </div>
              ) : disableStep === "idle" ? (
                <button
                  onClick={() => setDisableStep("confirm")}
                  className="shrink-0 px-4 py-2 border-2 border-red-300 text-red-600 rounded-lg font-semibold text-sm hover:bg-red-50 transition-colors"
                >
                  Disable 2FA
                </button>
              ) : null}
            </div>

            {/* ── Inline disable confirmation ── */}
            {twoFaEnabled && !teamRequires2fa && disableStep !== "idle" && (
              <div className="mt-5 pt-5 border-t border-gray-200">
                <p className="text-sm text-gray-700 mb-3">
                  Enter your current TOTP code or a recovery code to confirm.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={disableCode}
                    onChange={(e) => {
                      setDisableCode(e.target.value)
                      if (disableError) setDisableError("")
                    }}
                    placeholder="TOTP code or recovery code"
                    aria-label="TOTP code or recovery code"
                    aria-describedby={disableError ? "disable-error" : undefined}
                    aria-invalid={!!disableError}
                    disabled={disableStep === "submitting"}
                    className={`flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400 ${
                      disableError
                        ? "border-red-400 bg-red-50"
                        : "border-gray-300 bg-white"
                    }`}
                  />
                  <button
                    onClick={handleDisableSubmit}
                    disabled={disableStep === "submitting" || !disableCode.trim()}
                    aria-disabled={disableStep === "submitting" || !disableCode.trim()}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {disableStep === "submitting" ? "Disabling…" : "Confirm"}
                  </button>
                  <button
                    onClick={handleDisableCancel}
                    disabled={disableStep === "submitting"}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                {disableError && (
                  <p id="disable-error" role="alert" className="mt-2 text-sm text-red-600">
                    {disableError}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Team Enforcement Toggle (owners only) ── */}
        {isTeamOwner && teamId && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold text-[#1E2A35]">
                  Require 2FA for all team members
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  When enabled, all team members must have 2FA set up to access the application.
                </p>
                {enforcementError && (
                  <p role="alert" className="mt-2 text-sm text-red-600">
                    {enforcementError}
                  </p>
                )}
              </div>

              <button
                onClick={handleEnforcementToggle}
                disabled={enforcementLoading}
                aria-pressed={teamRequires2fa}
                aria-label={
                  teamRequires2fa
                    ? "Disable 2FA requirement for team"
                    : "Enable 2FA requirement for team"
                }
                className="shrink-0 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                {teamRequires2fa ? (
                  <ToggleRight
                    aria-hidden="true"
                    className="w-10 h-10 text-[#007A5C]"
                  />
                ) : (
                  <ToggleLeft
                    aria-hidden="true"
                    className="w-10 h-10 text-gray-400"
                  />
                )}
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  )
}
