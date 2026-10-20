/*
 * Phase 2: the one place that talks to the FastAPI backend. Dev: Vite proxies /api to :8000 (vite.config.ts).
 * One user action = one trace id (beginAction); every call after it carries X-Trace-Id so the judge panel shows the whole action.
 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api'

/** An answer the server gave but we cannot use (wrong PIN, locked, ...). A network failure rejects with a plain Error. */
export class ApiError extends Error {
  constructor(public status: number, public data: { detail?: string; locked?: boolean }) {
    super(`${status} ${JSON.stringify(data)}`)
  }
}

let activeTrace = ''
export function beginAction(): void {
  activeTrace = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, data?: object): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (activeTrace) headers['X-Trace-Id'] = activeTrace
  const res = await fetch(API_BASE + path, { method, headers, body: data ? JSON.stringify(data) : undefined })
  const body = res.status === 204 ? '' : await res.json().catch(() => ({}))
  // 202 = "approval needed": a normal answer, not an error
  if (res.status >= 400) throw new ApiError(res.status, body)
  return body as T
}

/* ---- types (the subset the web uses; same shapes as the old miniprogram client) ---- */
export type TierName = 'green' | 'yellow' | 'red'
export interface Approval {
  approval_id: number
  action: string
  payload: Record<string, unknown>
  tier: TierName
  reasons: string[]
  reasons_zh: string[]
  requires_pin: boolean
  requires_cosigner: boolean
  status: 'pending' | 'approved' | 'declined' | 'expired' | 'used'
  next: 'confirm' | 'pin' | 'cosign' | 'ready' | 'declined' | 'expired' | 'used'
  approval_token: string | null
}
export interface BankPayee { id: number; name: string; aliases: string[]; phone: string; known: boolean }
export interface TransferResult { status: 'executed'; balance_before: number; balance_after: number; payee: string; amount: number }
export interface CosignRequest { id: number; approval_id: number; summary_zh: string; reasons_zh: string[]; status: string; seconds_left: number }
export interface Balance { balance: number; reserved: number; available: number }
export interface SecurityStatus { locked: boolean; reason: string; message_zh: string }
export interface TransferBody { payee_id: number; amount: number; purpose: string }

export const COSIGNER_ID = 2

export const api = {
  health: () => request<{ status: string }>('GET', '/health'),
  balance: () => request<Balance>('GET', '/bank/balance'),
  securityStatus: () => request<SecurityStatus>('GET', '/bank/security/status'),
  payees: (q = '') => request<BankPayee[]>('GET', `/bank/payees?q=${encodeURIComponent(q)}`),
  startTransfer: (b: TransferBody) => request<Approval>('POST', '/bank/transfers', b),
  executeTransfer: (b: TransferBody, token: string) => request<TransferResult>('POST', '/bank/transfers', { ...b, approval_token: token }),
  confirmApproval: (id: number) => request<Approval>('POST', `/bank/approvals/${id}/confirm`),
  cancelApproval: (id: number) => request<Approval>('POST', `/bank/approvals/${id}/cancel`),
  approval: (id: number) => request<Approval>('GET', `/bank/approvals/${id}`),
  verifyPin: async (approvalId: number, pin: string) => {
    const { challenge } = await request<{ challenge: string }>('POST', '/bank/auth/mfa/challenge', { approval_id: approvalId })
    return request<Approval>('POST', '/bank/auth/mfa/verify', { approval_id: approvalId, challenge, pin })
  },
  cosignPending: () => request<CosignRequest[]>('GET', `/cosign/pending?cosigner_id=${COSIGNER_ID}`),
  cosignApprove: (id: number, pin: string) => request<CosignRequest>('POST', `/cosign/${id}/approve`, { cosigner_id: COSIGNER_ID, pin }),
  cosignDecline: (id: number) => request<CosignRequest>('POST', `/cosign/${id}/decline`, { cosigner_id: COSIGNER_ID }),
  demoReset: () => request<{ status: string }>('POST', '/demo/reset'),
}
