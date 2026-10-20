import { api, ApiError, beginAction, type AgentView, type AgentCommand } from '../api/client'
import type { Bi } from '../lib/i18n'
import { getLang } from '../lib/i18n'
import { log } from './actions'
import { live, syncBank } from './live'
import { appStore, uiStore } from './store'
import type { LoanState, Plan, PlanNode, TierKey } from './types'

/*
 * The agent plan (/agent/*). The backend decides the steps, the tier of each step and the bank approval behind it;
 * this file only maps its answer onto the Plan screen's shape. Only the two scripted requests have a backend plan:
 * 'season' (get me ready for honey buying) and 'sup' (pay the six families). Climate / cash plans stay mock.
 */
const UTTER: Record<'season' | 'sup', string> = {
  season: '下个月要收蜂蜜了，帮我准备一下',
  sup: '像去年一样给六家付蜂蜜钱',
}
/** English wording for the fixed templates' step labels (the backend sends Chinese only; replies stay Chinese until Phase 3). */
const EN: Record<string, string> = {
  check_compliance: 'Check tax notes',
  match_policies: 'Look at subsidies and loans',
  forecast_procurement: 'Work out what the honey purchase will cost',
  reserve_funds: 'Set aside the honey money (kept in your account, not sent)',
  prefill_financing: 'Pre-fill the loan application (not sent yet)',
  submit_financing: 'Send the loan application',
  schedule_conditional_transfers: 'Schedule payment on delivery',
  plan_supplier_payments: 'Look up what you paid each family last year',
}
const REASON_EN: [string, string][] = [
  ['新的收款人', 'new payee'],
  ['1000元', 'over 1,000 in a day'],
  ['2倍', 'over 2x the usual amount'],
  ['余额的一半', 'more than half the balance'],
  ['夜间', 'night-time'],
]
const FINANCING = new Set(['prefill_financing', 'submit_financing'])
const TIER: Record<string, TierKey> = { green: 'g', yellow: 'y', red: 'r' }
const ST: Record<string, PlanNode['st']> = {
  pending: 'pending', waiting: 'waiting', done: 'done', skipped: 'done', undone: 'undone', dropped: 'dropped', failed: 'dropped', blocked: 'dropped',
}
const PLAN_ST: Record<string, Plan['status']> = {
  running: 'waiting', waiting: 'waiting', paused: 'paused', done: 'done', failed: 'cancelled', cancelled: 'cancelled', handed_over: 'handover', rejected: 'cancelled', question: 'cancelled',
}
const COMMAND: Record<string, AgentCommand> = { pause: '等一下', resume: '继续', noloan: '贷款先不要', cancel: '算了', human: '找人工' }

const reasonBi = (zh: string[]): Bi | null =>
  zh.length ? [zh.join('、'), zh.map((r) => REASON_EN.find(([k]) => r.includes(k))?.[1] ?? r).join(', ')] : null

/** The Plan the screens draw, from the agent's view. */
export function planOf(v: AgentView, sid: string, kind: Plan['kind']): Plan {
  const nodes: PlanNode[] = v.nodes.map((n) => {
    const raise = n.approval && n.tier === 'red' && n.tier_base !== 'red' ? reasonBi(n.approval.reasons_zh) : null
    return {
      id: n.id,
      zh: n.label_zh,
      en: EN[n.tool] ?? n.label_zh,
      tier: TIER[n.tier] ?? 'g',
      st: ST[n.status] ?? 'pending',
      ...(n.summary_zh ? { sum: [n.summary_zh, n.summary_zh] as Bi } : {}),
      ...(raise ? { raise } : {}),
      ...(FINANCING.has(n.tool) ? { loan: true } : {}),
      ...(n.approval ? { ap: n.approval.approval_id } : {}),
    }
  })
  const pend = v.pending
  if (pend) {
    const n = nodes.find((x) => x.id === pend.node_id)
    if (n) n.read = pend.readback_zh
  }
  return { status: PLAN_ST[v.status] ?? 'waiting', kind, utter: [v.utterance ?? UTTER[kind as 'season'] ?? '', v.utterance ?? ''], nodes, sid }
}

/** Keep the loan card in step with the plan's financing steps. */
function loanOf(v: AgentView): LoanState | null {
  const pre = v.nodes.find((n) => n.tool === 'prefill_financing')
  const sub = v.nodes.find((n) => n.tool === 'submit_financing')
  if (!pre) return null
  if (sub?.status === 'done') return 'submitted'
  if (pre.status === 'done') return 'draft'
  return pre.status === 'undone' || pre.status === 'dropped' ? 'none' : null
}

/** Store an agent answer: the plan, the loan card, the lock, and a notice when the agent says something. */
export function applyView(v: AgentView, sid: string, kind: Plan['kind'], logLine?: [string, string, Bi | null]) {
  appStore.update((s) => {
    s.plan = planOf(v, sid, kind)
    const loan = loanOf(v)
    if (loan) s.app.loan = loan
    if (logLine) log(s, logLine[0], logLine[1], logLine[2])
    if (v.status === 'failed' && v.notice_zh) s.notice = { zh: v.notice_zh, en: v.notice_zh, retry: '/plan' }
  })
  void syncBank()
}

function failed(e: unknown) {
  const zh = e instanceof ApiError ? String(e.data.detail ?? e.status) : '连不上银行，请再试一次'
  appStore.update((s) => void (s.notice = { zh, en: getLang() === 'zh' ? zh : 'Could not do that: ' + zh, retry: '/plan' }))
}

/** Start a plan at the agent. Returns true when the live path took it. */
export function liveStartPlan(kind: Plan['kind']): boolean {
  if (!live() || (kind !== 'season' && kind !== 'sup')) return false
  const sid = `web-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  beginAction()
  api.agentMessage(sid, UTTER[kind]).then((v) => applyView(v, sid, kind)).catch(failed)
  return true
}

/** The plan's waiting step: open the bank approval the agent already made. Returns true when handled. */
export function liveApproveNode(id: string): boolean {
  const plan = appStore.get().plan
  const n = plan?.nodes.find((x) => x.id === id)
  if (!live() || !plan?.sid || !n?.ap) return false
  uiStore.update((u) => {
    u.sheet = {
      tier: n.tier, raised: n.raise ?? null, zh: n.read ?? n.zh, en: n.en, then: 'node',
      live: { approvalId: n.ap!, node: { sid: plan.sid!, nodeId: n.id } },
      step: 'readback', pin: '', err: '', fam: false,
    }
  })
  return true
}

/** The approved token goes back to the agent, which runs the step and moves on. */
export function liveNodeDone(sid: string, nodeId: string, token: string, by: Bi, finish: () => void) {
  const plan = appStore.get().plan
  const n = plan?.nodes.find((x) => x.id === nodeId)
  api
    .agentApprove(sid, nodeId, token)
    .then((v) => {
      applyView(v, sid, plan?.kind ?? 'season', n ? [n.zh, n.en, by] : undefined)
      finish()
    })
    .catch(failed)
}

/** "wait / go on / not the loan / never mind / a person": the five commands. Returns true when handled. */
export function liveCmd(v: 'pause' | 'resume' | 'noloan' | 'cancel' | 'human'): boolean {
  const plan = appStore.get().plan
  if (!live() || !plan?.sid) return false
  const sid = plan.sid
  const line: Record<typeof v, [string, string]> = {
    pause: ['先等一下', 'Paused'],
    resume: ['接着办', 'Carried on'],
    noloan: ['贷款先不要：只撤销了贷款这一支', 'Not the loan: only the loan branch was undone'],
    cancel: ['算了：整个计划撤销', 'Never mind: the whole plan was undone'],
    human: ['转给了工作人员', 'Handed over to a staff member'],
  }
  beginAction()
  api
    .agentCommand(sid, COMMAND[v])
    .then((view) => applyView(view, sid, plan.kind, [line[v][0], line[v][1], ['您要求的', 'You asked']]))
    .catch(failed)
  return true
}
