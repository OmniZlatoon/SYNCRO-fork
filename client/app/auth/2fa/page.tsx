"use client"

// Feature: two-factor-authentication

import { useState, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Shield, KeyRound } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { apiPost } from "@/lib/api"

type Tab = "totp" | "recovery"

const MAX_TOTP_FAILURES = 5

export default function TwoFactorVerificationPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get("redirectTo") || "/dashboard"

  const supabase = createClient()

  const [activeTab, setActiveTab] = useState<Tab>("totp")

  // TOTP state
  const [totpCode, setTotpCode] = useState("")
  const [totpError, setTotpError] = useState("")
  const [totpLoading, setTotpLoading] = useState(false)
  const [totpFailures, setTotpFailures] = useState(0)
  const [totpLocked, setTotpLocked] = useState(false)

  // Recovery code state
  const [recoveryCode, setRecoveryCode] = useState("")
  const [recoveryError, setRecoveryError] = useState("")
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [recoveryLocked, setRecoveryLocked] = useState(false)

  // ── TOTP submit ──────────────────────────────────────────────────────────
  const handleTotpSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (totpLocked) return
    if (totpCode.length !== 6) {
      setTotpError("Please enter a 6-digit code.")
      return
    }

    setTotpLoading(true)
    setTotpError("")

    try {
      const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors()
      if (factorsError || !factorsData) {
        setTotpError("Could not retrieve your 2FA factor. Please try again.")
        setTotpLoading(false)
        return
      }

      const totpFactor = factorsData.totp?.find((f) => f.status === "verified")
      if (!totpFactor) {
        setTotpError("No verified 2FA factor found for your account.")
        setTotpLoading(false)
        return
      }

      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: totpFactor.id,
      })
      if (challengeError || !challengeData) {
        setTotpError(challengeError?.message ?? "Failed to initiate challenge. Please try again.")
        setTotpLoading(false)
        return
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: totpFactor.id,
        challengeId: challengeData.id,
        code: totpCode,
      })

      if (verifyError) {
        const newFailures = totpFailures + 1
        setTotpFailures(newFailures)
        if (newFailures >= MAX_TOTP_FAILURES) {
          setTotpLocked(true)
          setTotpError("")
        } else {
          setTotpError("Invalid or expired code. Please try again.")
        }
        setTotpLoading(false)
        return
      }

      // AAL2 elevated — redirect
      router.push(redirectTo)
    } catch {
      setTotpError("Verification failed. Please try again.")
      setTotpLoading(false)
    }
  }, [totpCode, totpFailures, totpLocked, redirectTo, supabase, router])

  const handleTotpInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, "").slice(0, 6)
    setTotpCode(val)
    if (totpError) setTotpError("")
  }, [totpError])

  // ── Recovery code submit ─────────────────────────────────────────────────
  const handleRecoverySubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (recoveryLocked) return
    if (!recoveryCode.trim()) {
      setRecoveryError("Please enter a recovery code.")
      return
    }

    setRecoveryLoading(true)
    setRecoveryError("")

    try {
      await apiPost("/api/2fa/recovery-codes/verify", { code: recoveryCode.trim() })
      // Success — session elevated to AAL2
      router.push(redirectTo)
    } catch (err: any) {
      const status = err?.response?.status
      if (status === 429) {
        setRecoveryLocked(true)
      } else if (status === 401) {
        setRecoveryError("Invalid or already-used recovery code.")
      } else {
        setRecoveryError("Verification failed. Please try again.")
      }
      setRecoveryLoading(false)
    }
  }, [recoveryCode, recoveryLocked, redirectTo, router])

  const handleRecoveryInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setRecoveryCode(e.target.value)
    if (recoveryError) setRecoveryError("")
  }, [recoveryError])

  // ── Tab switch ───────────────────────────────────────────────────────────
  const switchTab = useCallback((tab: Tab) => {
    setActiveTab(tab)
    setTotpError("")
    setRecoveryError("")
  }, [])

  return (
    <div className="min-h-screen bg-[#F9F6F2] dark:bg-[#1E2A35] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#2D3748] rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#1E2A35] to-[#2D3748] p-6">
          <div className="flex items-center gap-3">
            <Shield aria-hidden="true" className="w-7 h-7 text-[#FFD166]" />
            <div>
              <h1 className="text-xl font-bold text-white">Two-Factor Authentication</h1>
              <p className="text-sm text-gray-300 mt-0.5">Verify your identity to continue</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => switchTab("totp")}
            aria-selected={activeTab === "totp"}
            role="tab"
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === "totp"
                ? "border-b-2 border-[#FFD166] text-[#1E2A35] dark:text-white"
                : "text-gray-500 hover:text-[#1E2A35] dark:hover:text-white"
            }`}
          >
            Authenticator App
          </button>
          <button
            onClick={() => switchTab("recovery")}
            aria-selected={activeTab === "recovery"}
            role="tab"
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === "recovery"
                ? "border-b-2 border-[#FFD166] text-[#1E2A35] dark:text-white"
                : "text-gray-500 hover:text-[#1E2A35] dark:hover:text-white"
            }`}
          >
            Recovery Code
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {/* ── TOTP tab ── */}
          {activeTab === "totp" && (
            <>
              {totpLocked ? (
                <div
                  role="alert"
                  className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 text-center"
                >
                  <p className="font-semibold mb-1">Too many failed attempts.</p>
                  <p>Please try again in 15 minutes, or use a recovery code.</p>
                </div>
              ) : (
                <form onSubmit={handleTotpSubmit} noValidate className="space-y-5">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Open your authenticator app and enter the 6-digit code for SYNCRO.
                  </p>

                  <div>
                    <label
                      htmlFor="totp-input"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                    >
                      Authentication code
                    </label>
                    <input
                      id="totp-input"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={totpCode}
                      onChange={handleTotpInput}
                      placeholder="000000"
                      maxLength={6}
                      aria-describedby={totpError ? "totp-error" : undefined}
                      aria-invalid={!!totpError}
                      autoFocus
                      className={`w-full px-4 py-3 text-center text-2xl font-mono tracking-[0.5em] border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD166] dark:bg-[#1E2A35] dark:text-white ${
                        totpError
                          ? "border-red-400 bg-red-50 dark:bg-red-900/20"
                          : "border-gray-300 dark:border-gray-600 bg-white"
                      }`}
                    />
                    {totpError && (
                      <p id="totp-error" role="alert" className="mt-2 text-sm text-red-600">
                        {totpError}
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={totpLoading || totpCode.length !== 6}
                    aria-disabled={totpLoading || totpCode.length !== 6}
                    className="w-full px-4 py-3 bg-[#FFD166] text-[#1E2A35] rounded-lg font-semibold hover:bg-[#FFD166]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {totpLoading ? "Verifying…" : "Verify"}
                  </button>
                </form>
              )}
            </>
          )}

          {/* ── Recovery code tab ── */}
          {activeTab === "recovery" && (
            <>
              {recoveryLocked ? (
                <div
                  role="alert"
                  className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 text-center"
                >
                  <p className="font-semibold mb-1">Too many failed attempts.</p>
                  <p>Please try again in 15 minutes.</p>
                </div>
              ) : (
                <form onSubmit={handleRecoverySubmit} noValidate className="space-y-5">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Enter one of your saved recovery codes to access your account.
                  </p>

                  <div>
                    <label
                      htmlFor="recovery-input"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                    >
                      Recovery code
                    </label>
                    <div className="relative">
                      <KeyRound
                        aria-hidden="true"
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                      />
                      <input
                        id="recovery-input"
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        value={recoveryCode}
                        onChange={handleRecoveryInput}
                        placeholder="xxxxxxxxxxxxxxxxxxxxxxxx"
                        aria-describedby={recoveryError ? "recovery-error" : undefined}
                        aria-invalid={!!recoveryError}
                        autoFocus
                        className={`w-full pl-9 pr-4 py-3 font-mono text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD166] dark:bg-[#1E2A35] dark:text-white ${
                          recoveryError
                            ? "border-red-400 bg-red-50 dark:bg-red-900/20"
                            : "border-gray-300 dark:border-gray-600 bg-white"
                        }`}
                      />
                    </div>
                    {recoveryError && (
                      <p id="recovery-error" role="alert" className="mt-2 text-sm text-red-600">
                        {recoveryError}
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={recoveryLoading || !recoveryCode.trim()}
                    aria-disabled={recoveryLoading || !recoveryCode.trim()}
                    className="w-full px-4 py-3 bg-[#FFD166] text-[#1E2A35] rounded-lg font-semibold hover:bg-[#FFD166]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {recoveryLoading ? "Verifying…" : "Use Recovery Code"}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
