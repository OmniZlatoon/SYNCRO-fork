import crypto from 'crypto'

const STATE_TTL_MS = 10 * 60 * 1000
const stateStore = new Map<string, number>()

export function createState(): string {
  const state = crypto.randomBytes(16).toString('hex')
  stateStore.set(state, Date.now() + STATE_TTL_MS)
  return state
}

export function consumeState(state: string | undefined): boolean {
  if (!state) return false

  const expiresAt = stateStore.get(state)
  stateStore.delete(state)

  if (!expiresAt) return false

  return Date.now() <= expiresAt
}