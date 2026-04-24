// ── Types ─────────────────────────────────────────────────────────────────────

interface ParseEmailInput {
  subject?: string | null
  from?: string | null
  body?: string | null
}

interface ParsedSubscription {
  name: string | null
  amount: number | null
  currency: string | null
  interval: string | null
  signals: string[]
  confidence: number
}

interface ExtractedAmount {
  amount: number | null
  currency: string | null
}

interface IntervalMatcher {
  pattern: RegExp
  value: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SUBSCRIPTION_KEYWORDS: string[] = [
  'subscription',
  'renewal',
  'auto-renew',
  'billing',
  'billed',
  'charged',
  'invoice',
  'receipt',
  'membership',
  'trial',
  'plan',
]

const STRONG_PHRASES: string[] = [
  'your subscription',
  'subscription confirmed',
  'trial ends',
  'renews on',
  'payment received',
]

const INTERVAL_MATCHERS: IntervalMatcher[] = [
  { pattern: /\bmonthly\b|\bper month\b|\/month\b/i, value: 'monthly' },
  { pattern: /\bannual\b|\byearly\b|\bper year\b|\/year\b/i, value: 'yearly' },
  { pattern: /\bweekly\b|\bper week\b|\/week\b/i, value: 'weekly' },
  { pattern: /\bquarterly\b|\bper quarter\b|\/quarter\b/i, value: 'quarterly' },
]

// ── Exported function ─────────────────────────────────────────────────────────

export function parseSubscriptionEmail({
  subject,
  from,
  body,
}: ParseEmailInput): ParsedSubscription | null {
  const combined = `${subject ?? ''}\n${body ?? ''}`.trim()
  const normalized = normalizeText(combined)

  const signals = SUBSCRIPTION_KEYWORDS.filter((keyword) => normalized.includes(keyword))
  const strongSignal = STRONG_PHRASES.some((phrase) => normalized.includes(phrase))

  const { amount, currency } = extractAmount(normalized)
  const interval = detectInterval(normalized)
  const name = extractSenderName(from)

  if (!signals.length && !strongSignal) return null
  if (!amount && !strongSignal && !interval) return null

  let confidence = 0.2
  if (signals.length) confidence += 0.2
  if (strongSignal) confidence += 0.2
  if (amount) confidence += 0.2
  if (interval) confidence += 0.1
  confidence = Math.min(confidence, 0.95)

  return { name, amount, currency, interval, signals, confidence }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function normalizeText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .toLowerCase()
}

function extractSenderName(from?: string | null): string | null {
  if (!from) return null

  const trimmed = String(from).trim()

  const nameMatch = trimmed.match(/^(.*?)(<|$)/)
  if (nameMatch?.[1]) {
    const name = nameMatch[1].replace(/"|'/g, '').trim()
    if (name) return name
  }

  const emailMatch = trimmed.match(/([^\s@]+)@/)
  if (emailMatch) return emailMatch[1]

  return trimmed
}

function extractAmount(text: string): ExtractedAmount {
  const symbolMatch = text.match(/([$€£])\s?(\d{1,5}(?:[.,]\d{2})?)/i)
  if (symbolMatch) {
    return {
      amount: normalizeAmount(symbolMatch[2]),
      currency: symbolToCurrency(symbolMatch[1]),
    }
  }

  const codeBeforeMatch = text.match(/\b(USD|EUR|GBP|CAD|AUD)\s?(\d{1,5}(?:[.,]\d{2})?)\b/i)
  if (codeBeforeMatch) {
    return {
      amount: normalizeAmount(codeBeforeMatch[2]),
      currency: codeBeforeMatch[1].toUpperCase(),
    }
  }

  const codeAfterMatch = text.match(/(\d{1,5}(?:[.,]\d{2})?)\s?(USD|EUR|GBP|CAD|AUD)\b/i)
  if (codeAfterMatch) {
    return {
      amount: normalizeAmount(codeAfterMatch[1]),
      currency: codeAfterMatch[2].toUpperCase(),
    }
  }

  return { amount: null, currency: null }
}

function normalizeAmount(value?: string | null): number | null {
  if (!value) return null
  const normalized = String(value).replace(/,/g, '')
  const amount = Number.parseFloat(normalized)
  return Number.isFinite(amount) ? amount : null
}

function symbolToCurrency(symbol: string): string {
  switch (symbol) {
    case '€': return 'EUR'
    case '£': return 'GBP'
    default:  return 'USD'
  }
}

function detectInterval(text: string): string | null {
  for (const matcher of INTERVAL_MATCHERS) {
    if (matcher.pattern.test(text)) return matcher.value
  }
  return null
}