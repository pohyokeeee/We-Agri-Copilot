import Taro from '@tarojs/taro'

// Set TARO_APP_API_BASE in miniprogram/.env to override (see .env.example)
export const API_BASE: string = process.env.TARO_APP_API_BASE || 'http://localhost:8000'

// An answer the server gave but we cannot use (wrong PIN, locked, ...). A network failure rejects with a plain Error.
export class ApiError extends Error {
  constructor(public status: number, public data: { detail?: string; locked?: boolean }) {
    super(`${status} ${JSON.stringify(data)}`)
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, data?: object): Promise<T> {
  const res = await Taro.request({ url: API_BASE + path, method, data, header: { 'content-type': 'application/json' } })
  if (res.statusCode >= 400) throw new ApiError(res.statusCode, res.data)
  return res.data as T
}

export type TierName = 'green' | 'yellow' | 'red'

// Where an approval is waiting: confirm -> pin (red only) -> cosign (protection mode) -> ready (token granted)
export interface Approval {
  approval_id: number
  action: string
  payload: Record<string, unknown>
  tier: TierName
  tier_base: TierName
  reasons: string[]
  reasons_zh: string[]
  requires_pin: boolean
  requires_cosigner: boolean
  status: 'pending' | 'approved' | 'declined' | 'expired' | 'used'
  next: 'confirm' | 'pin' | 'cosign' | 'ready' | 'declined' | 'expired' | 'used'
  approval_token: string | null
}

export interface Payee { id: number; name: string; aliases: string[]; phone: string; known: boolean }
export interface Readback { text_zh: string; payee_id: number; payee_name: string }
export interface TransferResult { status: 'executed'; balance_before: number; balance_after: number; payee: string; amount: number; purpose: string }
export interface TransferBody { payee_id: number; amount: number; purpose: string }
export interface CosignRequest { id: number; approval_id: number; summary_zh: string; reasons_zh: string[]; status: string; seconds_left: number }

export type RuleStatus = 'verified' | 'recall'
export type RulesMap = Record<string, { status: RuleStatus; citation_url: string }>

export interface Flag {
  code: string
  plain_text_zh: string
  numbers: Record<string, unknown>
  rule_ids: string[]
}
export interface Compliance { period: string; flags: Flag[]; rules: RulesMap; disclaimer: string }

export interface StructureCell { text_zh: string; value: number | null; rule_ids: string[]; status: RuleStatus }
export interface Structures {
  period: string
  columns: { key: string; label_zh: string }[]
  rows: { key: string; label_zh: string; cells: Record<string, StructureCell> }[]
  assumptions: string[]
  rules: RulesMap
  disclaimer: string
}

export interface Reconcile {
  period: string
  platform_reported: number
  record_total: number
  gap: number
  gap_breakdown: { resale: number; refunds: number; missed_payout: number; needs_confirmation: number }
  platform_fees: number
}
export interface Statement {
  year: number
  months: Record<string, number | string>[]
  totals: Record<string, number>
  pension: number
  payouts_received: number
}

export interface PlanStep {
  id: string
  kind: string
  text_zh: string
  amount: number
  tier: 'green' | 'yellow' | 'red'
  marker: string
  reasons_zh: string[]
  requires_cosigner: boolean
}
export interface FinancingOption {
  product_id: number
  name: string
  amount: number
  interest: number
  fee: number
  total_cost: number
  total_repay: number
  text_zh: string
}
export interface Forecast {
  today: string
  next_purchases: { activity: string; window_start: string; window_end: string; days_until: number }[]
  amount_low?: number
  amount_high?: number
  cash_available_low?: number
  cash_available_high?: number
  gap_low?: number
  gap_high?: number
  gap_expected?: number
  assumptions: string[]
  plan: { steps: PlanStep[]; financing: FinancingOption[]; executed: boolean }
  disclaimer: string
}

export const api = {
  balance: () => request<{ balance: number; reserved: number; available: number }>('GET', '/bank/balance'),
  // S1: supplier payment, one call per step of the approval flow
  payees: (q: string) => request<Payee[]>('GET', `/bank/payees?q=${encodeURIComponent(q)}`),
  readback: (b: TransferBody & { spoken_as?: string }) => request<Readback>('POST', '/bank/transfers/readback', b),
  startTransfer: (b: TransferBody) => request<Approval>('POST', '/bank/transfers', b),
  confirmApproval: (id: number) => request<Approval>('POST', `/bank/approvals/${id}/confirm`),
  cancelApproval: (id: number) => request<Approval>('POST', `/bank/approvals/${id}/cancel`),
  approval: (id: number) => request<Approval>('GET', `/bank/approvals/${id}`),
  verifyPin: async (approvalId: number, pin: string) => {
    const { challenge } = await request<{ challenge: string }>('POST', '/bank/auth/mfa/challenge', { approval_id: approvalId })
    return request<Approval>('POST', '/bank/auth/mfa/verify', { approval_id: approvalId, challenge, pin })
  },
  executeTransfer: (b: TransferBody, token: string) =>
    request<TransferResult>('POST', '/bank/transfers', { ...b, approval_token: token }),
  // co-signer
  cosignPending: (cosignerId: number) => request<CosignRequest[]>('GET', `/cosign/pending?cosigner_id=${cosignerId}`),
  cosignApprove: (id: number, cosignerId: number, pin: string) =>
    request<CosignRequest>('POST', `/cosign/${id}/approve`, { cosigner_id: cosignerId, pin }),
  cosignDecline: (id: number, cosignerId: number) => request<CosignRequest>('POST', `/cosign/${id}/decline`, { cosigner_id: cosignerId }),
  statement: (year: number) => request<Statement>('GET', `/bank/income/statement?year=${year}`),
  reconcile: (period: string) => request<Reconcile>('GET', `/bank/income/reconcile?period=${period}`),
  compliance: (period?: string) => request<Compliance>('POST', '/analysis/compliance', period ? { period } : {}),
  procurementForecast: () => request<Forecast>('POST', '/analysis/procurement-forecast', {}),
  structures: (period?: string) => request<Structures>('POST', '/analysis/structures', period ? { period } : {}),
}
