import type { Bi } from '../lib/i18n'

export type TierKey = 'g' | 'y' | 'r'

export interface PlanNode {
  id: string
  zh: string
  en: string
  tier: TierKey
  st: 'pending' | 'waiting' | 'done' | 'undone' | 'dropped'
  sum?: Bi
  raise?: Bi
  loan?: boolean
  /** Phase 2: the bank approval waiting on this step, and the read-back sentence the bank wrote for it */
  ap?: number
  read?: string
}
export interface Plan {
  status: 'waiting' | 'paused' | 'cancelled' | 'handover' | 'done'
  kind: 'season' | 'sup' | 'climate' | 'cash'
  utter: Bi
  nodes: PlanNode[]
  /** climate/cash plans: short name of what the cash is for, and the loan amount pre-filled in the loan step */
  title?: Bi
  borrow?: number
  /** Phase 2: the agent session behind this plan */
  sid?: string
}

/** What the Season page hands to `startPlan` for the climate / generic-cash plans. All amounts in yuan. */
export interface PlanSpec {
  title: Bi
  utter: Bi
  /** the cash need range */
  low: number
  high: number
  /** how much to set aside (never sent anywhere) */
  aside: number
  /** shortfall the loan step would cover (0 = no loan step) */
  gap: number
  /** climate only: the worry, for the plain-words step */
  worry?: Bi
}

export interface PayInfo {
  n: string
  amt: number
  what: Bi
}
export interface Payment extends PayInfo {
  d: Bi
  by?: Bi
  wait?: boolean
  declined?: boolean
}
export interface Payee {
  n: string
  nick: Bi | null
  last: number | null
  known: boolean
  year?: number
  phone?: string
}

export type LoanState = 'none' | 'draft' | 'submitted' | 'needdocs' | 'approved' | 'paid'
export type After = 'taxpot' | 'prefill' | 'submit' | 'node' | 'paydone'

/** What a confirmation sheet is asking for. Created by an action, finished by `applyDone`. */
export interface Approval {
  tier: TierKey
  raised: Bi | null
  zh: string
  en: string
  before?: string
  after?: string
  then: After
  payInfo?: PayInfo
  /** Phase 2: the bank approval behind this sheet. Absent = a mock-only action. */
  live?: LiveRef
}

/** Ties a sheet to the real bank approval and the transfer it unlocks. */
export interface LiveRef {
  approvalId: number
  transfer?: { payee_id: number; amount: number; purpose: string }
  /** loan draft: the amount to pre-fill */
  amount?: number
  /** a plan step: approving it hands the token back to the agent */
  node?: { sid: string; nodeId: string }
}

export interface LogEntry {
  t: string
  zh: string
  en: string
  by: Bi | null
}

export interface AppState {
  locked: boolean
  pinTries: number
  taxRule: boolean
  orderConfirmed: 'res' | 'own' | null
  app: { loan: LoanState; sub: boolean; amount: number }
  log: LogEntry[]
  clock: number
  sentToday: number
  payments: Payment[]
  extraPayees: Payee[]
  famPending: boolean
  famReq: Approval | null
  mu: number | null
  borrow: number
  season: { pct: number; off: string[] }
  plan: Plan | null
  visited: boolean
  /** Phase 2: id of the loan draft at the bank, once one exists */
  loanId?: number
  /** a message every farmer window shows until dismissed (e.g. the daughter declined) */
  notice: { zh: string; en: string; retry?: string } | null
}

export interface SheetState extends Approval {
  step: 'readback' | 'pin' | 'family' | 'done' | 'locked'
  pin: string
  err: string
  fam: boolean
}

export interface UiState {
  sheet: SheetState | null
  info: string | null
  drawer: boolean
  tipSeen: boolean
  ask: 'confirm' | null
  /** what the microphone heard, shown in the confirm strip; null = the Phase 1 stand-in sentence */
  heard: string | null
  answer: string | null
}
