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

// The server sets X-Demo-Notice when the public demo's model budget ran out and a template answered instead.
let limited = false
const watchers = new Set<() => void>()
export const demoLimited = () => limited
export const onDemoLimited = (l: () => void) => (watchers.add(l), () => void watchers.delete(l))

export async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, data?: object): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (activeTrace) headers['X-Trace-Id'] = activeTrace
  const res = await fetch(API_BASE + path, { method, headers, body: data ? JSON.stringify(data) : undefined })
  if (!limited && res.headers.get('x-demo-notice')) {
    limited = true
    watchers.forEach((l) => l())
  }
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

export type AgentCommand = '等一下' | '继续' | '贷款先不要' | '算了' | '找人工'
export interface AgentNode {
  id: string
  tool: string
  label_zh: string
  status: string
  tier: TierName
  tier_base: TierName
  summary_zh: string
  error: string
  approval: { approval_id: number; status: string; next: string; tier: TierName; reasons_zh: string[] } | null
}
export interface AgentView {
  status: string
  utterance?: string
  notice_zh?: string
  reply_zh?: string
  nodes: AgentNode[]
  pending: { node_id: string; readback_zh: string } | null
}

export interface TraceSummary { trace_id: string; summary_zh: string; status: string; steps: number; started_at: string; last_at: string }
export interface TraceStep {
  seq: number; ts: string; actor: string; event: string; event_zh: string
  tier_base: TierName | null; tier_final: TierName | null; reasons_zh: string[]
  approval: { method: string | null; result: string | null } | null
  balance_before: number | null; balance_after: number | null; hash: string
}
export interface TraceDetail { trace_id: string; summary_zh: string; status: string; utterance: string | null; steps: TraceStep[] }

export const COSIGNER_ID = 2

export const api = {
  health: () => request<{ status: string; demo?: boolean }>('GET', '/health'),
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
  createRule: (token?: string) => request<Approval | { status: 'created'; rule_id: number }>('POST', '/bank/reserves/rules', token ? { approval_token: token } : {}),
  createDraft: (b: { product_id: number; amount: number }, token?: string) =>
    request<Approval | { application_id: number; status: string }>('POST', '/bank/financing/applications', token ? { ...b, approval_token: token } : b),
  submitApplication: (id: number, token?: string) =>
    request<Approval | { application_id: number; status: string }>('POST', `/bank/financing/applications/${id}/submit`, token ? { approval_token: token } : {}),
  withdrawApplication: (id: number) => request<{ status: string }>('DELETE', `/bank/financing/applications/${id}`),
  agentMessage: (sessionId: string, text: string) => request<AgentView>('POST', '/agent/message', { session_id: sessionId, text }),
  agentApprove: (sessionId: string, nodeId: string, token: string) => request<AgentView>('POST', '/agent/approve', { session_id: sessionId, node_id: nodeId, token }),
  agentCommand: (sessionId: string, command: AgentCommand) => request<AgentView>('POST', '/agent/command', { session_id: sessionId, command }),
  traceRecent: (limit = 12) => request<TraceSummary[]>('GET', `/trace/recent?limit=${limit}`),
  trace: (id: string) => request<TraceDetail>('GET', `/trace/${encodeURIComponent(id)}`),
  auditVerify: () => request<{ ok: boolean; rows_checked: number; first_broken_id: number | null }>('GET', '/audit/verify'),
  demoSuspicious: () => request<{ new: number; locked: boolean }>('POST', '/bank/demo/orders/import-suspicious'),
  demoPayout: () => request<{ amount: number; moved: number; pot_total: number; balance_before: number; balance_after: number }>('POST', '/bank/demo/payouts', { income_class: 'resale' }),
  lock: () => request<{ locked: boolean }>('POST', '/bank/security/lock', {}),
  unlock: (token?: string) => request<Approval | { locked: boolean }>('POST', '/bank/security/unlock', token ? { approval_token: token } : {}),
  demoReset: () => request<{ status: string }>('POST', '/demo/reset'),
}
