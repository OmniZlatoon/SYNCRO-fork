import crypto from 'crypto'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProofHashInput {
  provider?: string | null
  messageId?: string | null
  receivedAt?: string | null
  subject?: string | null
  from?: string | null
  amount?: number | null
  currency?: string | null
  interval?: string | null
  contentHash?: string | null
}

// ── Exported functions ────────────────────────────────────────────────────────

export function hashContent(content?: string | null): string | null {
  if (!content) return null
  return sha256(String(content))
}

export function generateProofHash({
  provider,
  messageId,
  receivedAt,
  subject,
  from,
  amount,
  currency,
  interval,
  contentHash,
}: ProofHashInput): string {
  const parts = [
    provider ?? '',
    messageId ?? '',
    receivedAt ?? '',
    subject ?? '',
    from ?? '',
    amount != null ? String(amount) : '',
    currency ?? '',
    interval ?? '',
    contentHash ?? '',
  ]

  return sha256(parts.join('|'))
}

// ── Internal helper ───────────────────────────────────────────────────────────

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}