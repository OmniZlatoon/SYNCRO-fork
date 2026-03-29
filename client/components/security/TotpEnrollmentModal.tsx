"use client"

import { useState, useEffect, useCallback } from "react"
import { X, Copy, Check, Download, Shield } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { apiPost } from "@/lib/api"

// Feature: two-factor-authentication

interface TotpEnrollmentModalProps {
  onComplete: () => void
  onClose: () => void
}

export function buildDownloadBlob(codes: string[]): Blob {
  const content = [
    "SYNCRO - Two-Factor Authentication Recovery Codes",
    "=================================================",
    "Keep these codes in a safe place. Each code can only be used once.",
    "",
    ...codes.map((code, i) => `${i + 1}. ${code}`),
    "",
    `Generated: ${new Date().toISOString()}`,
  ].join("\n")
  return new Blob([content], { type: "text/plain" })
}

type Step = 1 | 2 | 3

export default function TotpEnrollmentModal({ onComplete, onClose }: TotpEnrollmentModalProps) {
  const [step, setStep] = useState<Step>(1)

  // Step 1 state
  const [factorId, setFactorId] = useState<string>("")
  const [qrCode, setQrCode] = useState<string>("")
  const [secret, setSecret] = useState<string>("")
  const [enrollError, setEnrollError] = useState<string>("")
  const [enrollLoading, setEnrollLoading] = useState(true)
  const [secretCopied, setSecretCopied] = useState(false)

  // Step 2 state
  const [totpCode, setTotpCode] = useState<string>("")
  const [verifyError, setVerifyError] = useState<string>("")
  const [verifyLoading, setVerifyLoading] = useState(false)

  // Step 3 state
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [recoveryCopied, setRecoveryCopied] = useState(false)

  const supabase = createClient()

  // Step 1: enroll on mount
  useEffect(() => {
    let cancelled = false

    async function enroll() {
      setEnrollLoading(true)
      setEnrollError("")
      try {
        const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" })
        if (cancelled) return
        if (error || !data) {
          setEnrollError(error?.message ?? "Failed to start 2FA setup. Please try again.")
          return
        }
        setFactorId(data.id)
        setQrCode(data.totp.qr_code)
        setSecret(data.totp.secret)
      } catch (err) {
        if (!cancelled) {
          setEnrollError("Failed to start 2FA setup. Please try again.")
        }
      } finally {
        if (!cancelled) setEnrollLoading(false)
      }
    }

    enroll()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopySecret = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(secret)
      setSecretCopied(true)
      setTimeout(() => setSecretCopied(false), 2000)
    } catch {
      // clipboard not available — silently ignore
    }
  }, [secret])

  // Step 2: verify TOTP code
  const handleVerify = useCallback(async () => {
    if (totpCode.length !== 6) {
      setVerifyError("Please enter a 6-digit code.")
      return
    }
    setVerifyLoading(true)
    setVerifyError("")
    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
      if (challengeError || !challengeData) {
        setVerifyError(challengeError?.message ?? "Failed to initiate challenge. Please try again.")
        setVerifyLoading(false)
        return
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: totpCode,
      })

      if (verifyError) {
        setVerifyError("Invalid or expired code. Please try again.")
        setVerifyLoading(false)
        return
      }

      // Mark 2FA enabled in profiles
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase
          .from("profiles")
          .update({ two_fa_enabled_at: new Date().toISOString() })
          .eq("id", user.id)
      }

      // Generate recovery codes
      const codesData = await apiPost("/api/2fa/recovery-codes/generate")
      setRecoveryCodes(codesData.codes ?? codesData)
      setStep(3)
    } catch (err) {
      setVerifyError("Verification failed. Please try again.")
    } finally {
      setVerifyLoading(false)
    }
  }, [factorId, totpCode, supabase])

  const handleTotpInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, "").slice(0, 6)
    setTotpCode(val)
    if (verifyError) setVerifyError("")
  }, [verifyError])

  // Step 3: download recovery codes
  const handleDownload = useCallback(() => {
    const blob = buildDownloadBlob(recoveryCodes)
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "syncro-recovery-codes.txt"
    a.click()
    URL.revokeObjectURL(url)
  }, [recoveryCodes])

  const handleCopyAllCodes = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"))
      setRecoveryCopied(true)
      setTimeout(() => setRecoveryCopied(false), 2000)
    } catch {
      // silently ignore
    }
  }, [recoveryCodes])

  // Done: fire-and-forget notify, then call onComplete
  const handleDone = useCallback(() => {
    apiPost("/api/2fa/notify", { event: "enrolled" }).catch(() => {
      // non-blocking — ignore errors
    })
    onComplete()
  }, [onComplete])

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div
        role="dialog"
        aria-labelledby="totp-modal-title"
        aria-modal="true"
        className="bg-white text-[#1E2A35] rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-[#1E2A35] to-[#2D3748] p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield aria-hidden="true" className="w-6 h-6 text-[#FFD166]" />
              <div>
                <h2 id="totp-modal-title" className="text-xl font-bold text-white">
                  Enable Two-Factor Authentication
                </h2>
                <p className="text-sm text-gray-300 mt-0.5">Step {step} of 3</p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close 2FA setup dialog"
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X aria-hidden="true" className="w-5 h-5 text-white" />
            </button>
          </div>

          {/* Progress bar */}
          <div className="mt-4 flex gap-2" aria-hidden="true">
            {([1, 2, 3] as Step[]).map((s) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  s <= step ? "bg-[#FFD166]" : "bg-white/20"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* ── Step 1: QR code + secret ── */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h3 className="font-semibold text-lg mb-1">Scan with your authenticator app</h3>
                <p className="text-sm text-gray-600">
                  Open Google Authenticator, Authy, or any TOTP app and scan the QR code below.
                </p>
              </div>

              {enrollLoading && (
                <div className="flex items-center justify-center py-12">
                  <div className="w-8 h-8 border-2 border-[#FFD166] border-t-transparent rounded-full animate-spin" aria-label="Loading QR code" />
                </div>
              )}

              {enrollError && (
                <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {enrollError}
                </div>
              )}

              {!enrollLoading && !enrollError && (
                <>
                  {/* QR Code */}
                  <div className="flex justify-center">
                    <div className="p-4 bg-white border-2 border-gray-200 rounded-xl inline-block">
                      <img
                        src={qrCode}
                        alt="TOTP QR code — scan with your authenticator app"
                        width={200}
                        height={200}
                        className="block"
                      />
                    </div>
                  </div>

                  {/* Plain-text secret */}
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      Can't scan? Enter this secret manually:
                    </p>
                    <div className="flex items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                      <code
                        className="flex-1 text-sm font-mono tracking-widest break-all select-all"
                        aria-label="TOTP secret key"
                      >
                        {secret}
                      </code>
                      <button
                        onClick={handleCopySecret}
                        aria-label={secretCopied ? "Secret copied" : "Copy secret to clipboard"}
                        className="shrink-0 p-1.5 hover:bg-gray-200 rounded transition-colors"
                      >
                        {secretCopied
                          ? <Check aria-hidden="true" className="w-4 h-4 text-green-600" />
                          : <Copy aria-hidden="true" className="w-4 h-4 text-gray-500" />
                        }
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Step 2: Verify TOTP code ── */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h3 className="font-semibold text-lg mb-1">Enter the 6-digit code</h3>
                <p className="text-sm text-gray-600">
                  Open your authenticator app and enter the current code for SYNCRO.
                </p>
              </div>

              <div>
                <label htmlFor="totp-code-input" className="block text-sm font-medium text-gray-700 mb-2">
                  Authentication code
                </label>
                <input
                  id="totp-code-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={totpCode}
                  onChange={handleTotpInput}
                  placeholder="000000"
                  maxLength={6}
                  aria-describedby={verifyError ? "totp-error" : undefined}
                  aria-invalid={!!verifyError}
                  className={`w-full px-4 py-3 text-center text-2xl font-mono tracking-[0.5em] border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD166] ${
                    verifyError ? "border-red-400 bg-red-50" : "border-gray-300 bg-white"
                  }`}
                />
                {verifyError && (
                  <p id="totp-error" role="alert" className="mt-2 text-sm text-red-600">
                    {verifyError}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── Step 3: Recovery codes ── */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h3 className="font-semibold text-lg mb-1">Save your recovery codes</h3>
                <p className="text-sm text-gray-600">
                  Store these codes somewhere safe. Each code can only be used once to access your account if you lose your authenticator device.
                </p>
              </div>

              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm text-amber-800 font-medium">
                  These codes will not be shown again. Download or copy them now.
                </p>
              </div>

              {/* Recovery codes list */}
              <ol
                aria-label="Recovery codes"
                className="grid grid-cols-2 gap-2"
              >
                {recoveryCodes.map((code, i) => (
                  <li
                    key={i}
                    className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg font-mono text-sm text-center tracking-wider"
                  >
                    {code}
                  </li>
                ))}
              </ol>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={handleCopyAllCodes}
                  aria-label={recoveryCopied ? "Codes copied" : "Copy all recovery codes"}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-gray-300 hover:border-[#1E2A35] rounded-lg text-sm font-medium transition-colors"
                >
                  {recoveryCopied
                    ? <><Check aria-hidden="true" className="w-4 h-4 text-green-600" /> Copied</>
                    : <><Copy aria-hidden="true" className="w-4 h-4" /> Copy all</>
                  }
                </button>
                <button
                  onClick={handleDownload}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-gray-300 hover:border-[#1E2A35] rounded-lg text-sm font-medium transition-colors"
                >
                  <Download aria-hidden="true" className="w-4 h-4" />
                  Download
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200">
          {step === 1 && (
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-3 border-2 border-gray-300 hover:border-[#1E2A35] rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => setStep(2)}
                disabled={enrollLoading || !!enrollError}
                aria-disabled={enrollLoading || !!enrollError}
                className="flex-1 px-4 py-3 bg-[#FFD166] text-[#1E2A35] rounded-lg font-semibold hover:bg-[#FFD166]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next — Enter code
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="flex gap-3">
              <button
                onClick={() => { setStep(1); setTotpCode(""); setVerifyError("") }}
                className="flex-1 px-4 py-3 border-2 border-gray-300 hover:border-[#1E2A35] rounded-lg font-medium transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleVerify}
                disabled={verifyLoading || totpCode.length !== 6}
                aria-disabled={verifyLoading || totpCode.length !== 6}
                className="flex-1 px-4 py-3 bg-[#FFD166] text-[#1E2A35] rounded-lg font-semibold hover:bg-[#FFD166]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {verifyLoading ? "Verifying…" : "Verify"}
              </button>
            </div>
          )}

          {step === 3 && (
            <button
              onClick={handleDone}
              className="w-full px-4 py-3 bg-[#007A5C] text-white rounded-lg font-semibold hover:bg-[#007A5C]/90 transition-colors"
            >
              Done — I've saved my codes
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
