import Taro from '@tarojs/taro'

// Set TARO_APP_API_BASE in miniprogram/.env to override (see .env.example)
export const API_BASE: string = process.env.TARO_APP_API_BASE || 'http://localhost:8000'

// An answer the server gave but we cannot use (wrong PIN, locked, ...). A network failure rejects with a plain Error.
export class ApiError extends Error {
  constructor(public status: number, public data: { detail?: string; locked?: boolean }) {
    super(`${status} ${JSON.stringify(data)}`)
  }
}

// One user action = one trace. beginAction() starts a new one; every call after it carries its id, so the judge console can
// show the whole action. (The server also joins co-sign and execution steps to the trace their approval started in.)
let activeTrace = ''
export function beginAction(): void {
  activeTrace = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

async function request<T>(method: 'GET' | 'POST', path: string, data?: object): Promise<T> {
  const header: Record<string, string> = { 'content-type': 'application/json' }
  if (activeTrace) header['X-Trace-Id'] = activeTrace
  const res = await Taro.request({ url: API_BASE + path, method, data, header })
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
  subsidy_amount: number | null // only when an interest subsidy is among the matches
  cost_after_subsidy: number | null
  text_zh: string
}

export interface PolicyRule { key: string; text_zh: string }
export interface PolicyItem {
  policy_id: string
  name: string
  kind: string
  benefit: string
  documents: string[]
  deadline: string | null
  where_to_go: string
  rules_met: PolicyRule[]
  rules_unmet: PolicyRule[]
  needs_verification: boolean
  badge_zh: string | null
  summary_zh: string
  simulated: boolean
}
export interface PolicyMatch {
  simulated_label: string
  may_qualify: PolicyItem[]
  if_you: PolicyItem[]
  not_eligible: PolicyItem[] // kept for the trace page; never shown to the farmer
  disclaimer: string
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

export interface TraceSummary {
  trace_id: string
  summary_zh: string
  status: string
  steps: number
  started_at: string
  last_at: string
  endpoint: string | null
}
export interface TraceStep {
  seq: number
  row_id: number
  ts: string
  actor: string
  event: string
  event_zh: string
  tool: string
  endpoint: string | null
  tier_base: TierName | null
  tier_final: TierName | null
  reasons_zh: string[]
  approval: { method: string | null; result: string | null } | null
  wording_check: string | null
  balance_before: number | null
  balance_after: number | null
  utterance: string | null
  dag: unknown
  detail: Record<string, unknown>
  prev_hash: string
  hash: string
}
export interface TraceDetail { trace_id: string; summary_zh: string; status: string; started_at: string; steps: TraceStep[] }
export interface AuditVerify { ok: boolean; rows_checked: number; first_broken_id: number | null }

export type NodeStatus = 'pending' | 'waiting' | 'done' | 'skipped' | 'undone' | 'dropped' | 'failed' | 'blocked'
export interface AgentNode {
  id: string
  label_zh: string
  status: NodeStatus
  status_zh: string
  tier: TierName // the tier engine's answer, not the plan's
  summary_zh: string
  error: string
}
export interface AgentApproval { approval_id: number; status: string; next: Approval['next']; tier: TierName; reasons_zh: string[] }
export interface AgentView {
  status: 'running' | 'waiting' | 'paused' | 'done' | 'failed' | 'cancelled' | 'handed_over' | 'rejected' | 'question'
  paused?: boolean
  question_zh?: string
  notice_zh?: string
  utterance?: string
  trace_id?: string
  handover_id?: number | null
  nodes: AgentNode[]
  pending: { node_id: string; readback_zh: string; approval: AgentApproval } | null
}
export type AgentCommand = '等一下' | '继续' | '贷款先不要' | '算了' | '找人工'

export interface SecurityStatus { locked: boolean; reason: string; message_zh: string }
export type RuleStart = (Approval & { readback_zh: string }) | { status: 'created'; rule_id: number; percent: number }
export interface DemoPayout { amount: number; income_class: string; moved: number; pot_total: number }
export interface DemoImport { new: number; flagged: { order_id: string; score: number }[]; locked: boolean }

export const api = {
  securityStatus: () => request<SecurityStatus>('GET', '/bank/security/status'),
  createReserveRule: (token?: string) => request<RuleStart>('POST', '/bank/reserves/rules', token ? { approval_token: token } : {}),
  demoPayout: () => request<DemoPayout>('POST', '/bank/demo/payouts', { income_class: 'resale' }),
  demoImportSample: () => request<DemoImport>('POST', '/bank/demo/orders/import-sample?platform=livestream'),
  agentMessage: (sessionId: string, text: string) => request<AgentView>('POST', '/agent/message', { session_id: sessionId, text }),
  agentApprove: (sessionId: string, nodeId: string, token: string) =>
    request<AgentView>('POST', '/agent/approve', { session_id: sessionId, node_id: nodeId, token }),
  agentCommand: (sessionId: string, command: AgentCommand) => request<AgentView>('POST', '/agent/command', { session_id: sessionId, command }),
  traceRecent: (limit = 30) => request<TraceSummary[]>('GET', `/trace/recent?limit=${limit}`),
  trace: (id: string) => request<TraceDetail>('GET', `/trace/${encodeURIComponent(id)}`),
  auditVerify: () => request<AuditVerify>('GET', '/audit/verify'),
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
  policyMatch: () => request<PolicyMatch>('POST', '/analysis/policy-match', {}),
  structures: (period?: string) => request<Structures>('POST', '/analysis/structures', period ? { period } : {}),
}
