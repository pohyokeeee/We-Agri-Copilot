import Taro from '@tarojs/taro'

// Set TARO_APP_API_BASE in miniprogram/.env to override (see .env.example)
export const API_BASE: string = process.env.TARO_APP_API_BASE || 'http://localhost:8000'

async function request<T>(method: 'GET' | 'POST', path: string, data?: object): Promise<T> {
  const res = await Taro.request({ url: API_BASE + path, method, data, header: { 'content-type': 'application/json' } })
  if (res.statusCode >= 400 && res.statusCode !== 423) throw new Error(`${res.statusCode} ${JSON.stringify(res.data)}`)
  return res.data as T
}

export interface Approval {
  approval_id: number
  action: string
  payload: Record<string, unknown>
  tier: 'green' | 'yellow' | 'red'
  reasons: string[]
  requires_cosigner: boolean
  status: 'pending' | 'approved' | 'declined' | 'used'
  approval_token: string | null
}

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
  pendingForCosigner: (cosignerId: number) => request<Approval[]>('GET', `/bank/approvals?cosigner_id=${cosignerId}`),
  cosign: (approvalId: number, cosignerId: number, pin: string, approve: boolean) =>
    request<Approval>('POST', `/bank/approvals/${approvalId}/cosign`, { cosigner_id: cosignerId, pin, approve }),
  statement: (year: number) => request<Statement>('GET', `/bank/income/statement?year=${year}`),
  reconcile: (period: string) => request<Reconcile>('GET', `/bank/income/reconcile?period=${period}`),
  compliance: (period?: string) => request<Compliance>('POST', '/analysis/compliance', period ? { period } : {}),
  procurementForecast: () => request<Forecast>('POST', '/analysis/procurement-forecast', {}),
  structures: (period?: string) => request<Structures>('POST', '/analysis/structures', period ? { period } : {}),
}
