import { BALANCE, DAY_LIMIT, FAMILY_PIN, FARMER_PIN, freshApp, newPlan, SUPPLIERS, OTHER_PAYEES } from '../data/mock'
import { getLang, type Bi } from '../lib/i18n'
import { N } from '../lib/format'
import { appStore, uiStore } from './store'
import { liveApproveNode, liveCmd, liveStartPlan } from './livePlan'
import { liveCancel, liveConfirm, liveDecline, liveDone, livePin, liveScenario, liveStartGated, liveStartPayment, liveWithdraw } from './live'
import type { AppState, Approval, Payee, PayInfo, Plan, PlanSpec, SheetState, SubKey } from './types'

/*
 * Every user action lives here, away from the screens. In Phase 1 these change the mock state directly.
 * In Phase 2 each one calls the backend first (/bank/*, /analysis/*, /agent/*) and then stores the answer.
 */

const BY_YOU: Bi = ['您确认的', 'Confirmed by you']
const BY_BOTH: Bi = ['您和女儿确认的', 'Confirmed by you and your daughter']
const t = (zh: string, en: string) => (getLang() === 'zh' ? zh : en)

export function log(s: AppState, zh: string, en: string, by: Bi | null) {
  s.clock += 3
  s.log.unshift({ t: `14:${String(s.clock).padStart(2, '0')}`, zh, en, by })
}

export const allPayees = (s: Pick<AppState, 'extraPayees'>): Payee[] => [...SUPPLIERS, ...OTHER_PAYEES, ...s.extraPayees]
export const planOpen = (p: Plan | null) => !!p && (p.status === 'waiting' || p.status === 'paused')

/* ---------------- confirmation sheet ---------------- */
export function openSheet(a: Approval) {
  if (liveStartGated(a)) return
  uiStore.update((u) => {
    u.sheet = { ...a, step: 'readback', pin: '', err: '', fam: false }
  })
}
export const closeSheet = () => {
  liveCancel(uiStore.get().sheet)
  uiStore.update((u) => void (u.sheet = null))
}
export const sheetOk = () => {
  const sheet = uiStore.get().sheet
  if (sheet && liveConfirm(sheet)) return
  uiStore.update((u) => {
    if (u.sheet) u.sheet.step = u.sheet.tier === 'r' ? 'pin' : 'done'
  })
}

export function pressPin(d: string) {
  const sheet = uiStore.get().sheet
  if (!sheet || sheet.step !== 'pin') return
  let pin = sheet.pin
  if (d === '⌫') pin = pin.slice(0, -1)
  else if (pin.length < 6) pin += d
  if (pin.length < 6) {
    uiStore.update((u) => void (u.sheet && (u.sheet.pin = pin)))
    return
  }
  if (sheet.live) return void livePin(sheet, pin)
  const right = pin === (sheet.fam ? FAMILY_PIN : FARMER_PIN)
  if (!right) {
    let locked = false
    appStore.update((s) => {
      s.pinTries -= 1
      if (s.pinTries <= 0) {
        s.locked = true
        locked = true
        log(s, '密码错了3次，账户锁定', '3 wrong PINs: account locked', null)
      }
    })
    const tries = appStore.get().pinTries
    uiStore.update((u) => {
      if (!u.sheet) return
      u.sheet.pin = ''
      if (locked) u.sheet.step = 'locked'
      else u.sheet.err = t(`密码不对，还能试${tries}次`, `Wrong PIN, ${tries} tries left`)
    })
    return
  }
  appStore.update((s) => {
    s.pinTries = 3
  })
  if (sheet.fam) {
    uiStore.update((u) => void (u.sheet && ((u.sheet.step = 'done'), (u.sheet.pin = ''), (u.sheet.err = ''))))
    return
  }
  // the farmer's PIN is right: now it waits for the daughter, in her own window
  appStore.update((s) => {
    s.famPending = true
    s.famReq = approvalOf(sheet)
    if (sheet.payInfo) s.payments.unshift({ d: ['今天', 'Today'], ...sheet.payInfo, wait: true })
  })
  uiStore.update((u) => void (u.sheet && ((u.sheet.step = 'family'), (u.sheet.pin = ''), (u.sheet.err = ''))))
}
const approvalOf = (x: SheetState | Approval): Approval => ({
  tier: x.tier, raised: x.raised, zh: x.zh, en: x.en, before: x.before, after: x.after, then: x.then, payInfo: x.payInfo, sub: x.sub, live: x.live,
})

export function sheetDone() {
  const sheet = uiStore.get().sheet
  if (!sheet) return
  if (sheet.live) return void liveDone(sheet)
  appStore.update((s) => applyDone(s, sheet))
  uiStore.update((u) => void (u.sheet = null))
}

export function applyDone(s: AppState, a: Approval) {
  const by = a.tier === 'r' ? BY_BOTH : BY_YOU
  if (a.then === 'taxpot') {
    s.taxRule = true
    log(s, '开启了税金罐：每笔转卖收入留1%', 'Turned on the tax pot: 1% of each resale payout', by)
  }
  if (a.then === 'prefill') {
    s.app.loan = 'draft'
    s.app.amount = s.borrow
    log(s, `预填了${N(s.borrow)}元贷款申请（没有发出）`, `Pre-filled a ${N(s.borrow)} yuan loan application (not sent)`, by)
  }
  if (a.then === 'submit') {
    s.app.loan = 'submitted'
    log(s, '把贷款申请发给了模拟银行', 'Sent the loan application to the mock bank', by)
  }
  if (a.then === 'subprefill' && a.sub) {
    s.subs[a.sub] = 'draft'
    log(s, `填好了“${SUB_NAME[a.sub][0]}”的申请表（没有提交）`, `Filled in the ${SUB_NAME[a.sub][1]} application (not submitted)`, by)
  }
  if (a.then === 'subsubmit' && a.sub) {
    s.subs[a.sub] = 'submitted'
    log(s, `把“${SUB_NAME[a.sub][0]}”的申请提交到了（模拟）县补贴系统`, `Submitted the ${SUB_NAME[a.sub][1]} application to the (simulated) county subsidy system`, by)
  }
  if (a.then === 'node' && s.plan) {
    const n = s.plan.nodes.find((x) => x.st === 'waiting')
    if (n) {
      n.st = 'done'
      log(s, n.zh, n.en, by)
      if (s.plan.kind === 'season' && n.id === 'N4') {
        s.app.loan = 'draft'
        s.app.amount = s.borrow
      }
      if (s.plan.kind === 'season' && n.id === 'N5') s.app.loan = 'submitted'
      if (s.plan.kind !== 'season' && s.plan.kind !== 'sup' && n.loan) {
        // climate / cash plans: the first loan step pre-fills, the second sends
        if (n.tier === 'y') {
          s.app.loan = 'draft'
          s.app.amount = s.plan.borrow ?? s.borrow
        } else s.app.loan = 'submitted'
      }
    }
    advance(s.plan)
  }
  if (a.then === 'paydone' && a.payInfo) {
    const i = a.payInfo
    s.payments = s.payments.filter((r) => !r.wait)
    s.payments.unshift({ d: ['今天', 'Today'], ...i, by })
    s.sentToday += i.amt
    log(s, `给${i.n}转了${N(i.amt)}元（${i.what[0]}）`, `Sent ${N(i.amt)} yuan to ${i.n} (${i.what[1].toLowerCase()})`, by)
  }
  // the daughter's request is finished once it has been applied
  if (s.famPending && s.famReq && s.famReq.zh === a.zh) {
    s.famPending = false
    s.famReq = null
  }
}

export function famApprove() {
  const r = appStore.get().famReq
  if (!r) return
  uiStore.update((u) => {
    u.sheet = { ...r, step: 'pin', pin: '', err: '', fam: true }
  })
}
export function famDecline() {
  const r = appStore.get().famReq
  if (!r) return
  liveDecline(r)
  appStore.update((s) => {
    s.famPending = false
    s.famReq = null
    s.payments = s.payments.map((p) => (p.wait ? { ...p, wait: false, declined: true } : p))
    log(s, '女儿没有同意：' + r.zh, 'Daughter declined: ' + r.en, ['王小丽', 'Wang Xiaoli'])
    s.notice = {
      zh: '女儿没有同意：' + r.zh + '。这笔没有做。',
      en: 'Your daughter declined: ' + r.en + '. Nothing was done.',
      retry: r.payInfo ? '/pay' : r.then === 'submit' || r.then === 'subsubmit' ? '/applications' : '/plan',
    }
  })
}
export const clearNotice = () => appStore.update((s) => void (s.notice = null))

/* ---------------- plans ---------------- */
function advance(p: Plan) {
  const next = p.nodes.find((n) => n.st === 'pending')
  if (next) next.st = 'waiting'
  else if (p.status === 'waiting') p.status = 'done'
}
export function startPlan(kind: Plan['kind'], spec?: PlanSpec) {
  if (liveStartPlan(kind)) return
  appStore.update((s) => void (s.plan = newPlan(kind, s, spec)))
}
export function approveNode(id: string) {
  const plan = appStore.get().plan
  const n = plan?.nodes.find((x) => x.id === id)
  if (!n) return
  if (liveApproveNode(id)) return
  openSheet({ tier: n.tier, raised: n.raise ?? null, zh: n.zh, en: n.en, before: N(BALANCE), after: N(BALANCE), then: 'node' })
}
export function cmdPlan(v: 'pause' | 'resume' | 'noloan' | 'cancel' | 'human') {
  if (liveCmd(v)) return
  appStore.update((s) => {
    const p = s.plan
    if (!p) return
    if (v === 'pause' && p.status === 'waiting') p.status = 'paused'
    if (v === 'resume' && p.status === 'paused') p.status = 'waiting'
    if (v === 'noloan') {
      p.nodes.forEach((n) => {
        if (n.loan) n.st = n.st === 'done' ? 'undone' : 'dropped'
      })
      if (s.app.loan === 'draft') s.app.loan = 'none'
      if (!p.nodes.some((n) => n.st === 'waiting')) advance(p)
      log(s, '贷款先不要：只撤销了贷款这一支', 'Not the loan: only the loan branch was undone', ['您要求的', 'You asked'])
    }
    if (v === 'cancel') {
      p.nodes.forEach((n) => (n.st = n.st === 'done' ? 'undone' : 'dropped'))
      p.status = 'cancelled'
      if (s.app.loan === 'draft') s.app.loan = 'none'
      log(s, '算了：整个计划撤销', 'Never mind: the whole plan was undone', ['您要求的', 'You asked'])
    }
    if (v === 'human') {
      p.status = 'handover'
      log(s, '转给了工作人员', 'Handed over to a staff member', ['您要求的', 'You asked'])
    }
    if ((v === 'cancel' || v === 'human') && s.famPending && s.famReq?.then === 'node') {
      s.famPending = false
      s.famReq = null
    }
  })
}

/* ---------------- tax ---------------- */
export function confirmOrder(v: 'res' | 'own') {
  appStore.update((s) => {
    s.orderConfirmed = v
    log(s, v === 'res' ? '把一笔直播订单记为转卖（老李家的蜂蜜）' : '把一笔直播订单记为自家产的', v === 'res' ? 'Marked a livestream order as resale (Old Li’s honey)' : 'Marked a livestream order as your own produce', BY_YOU)
  })
}
export function askTaxPot() {
  openSheet({ tier: 'y', raised: null, zh: '每笔转卖收入自动留1%到税金罐，钱还在您账户里', en: 'Set aside 1% of each resale payout in a tax pot; the money stays in your account', then: 'taxpot' })
}
export function saveToRecord(entry: string | null) {
  appStore.update((s) => log(s, '把一笔买卖存进了记录' + (entry ? '：' + entry : ''), 'Saved a purchase/sale to your record' + (entry ? ': ' + entry : ''), BY_YOU))
}

/* ---------------- support and applications ---------------- */
export const setMu = (m: number | null) => appStore.update((s) => void (s.mu = m))
export const setBorrow = (b: number) => appStore.update((s) => void (s.borrow = b))
export function prefill() {
  const b = appStore.get().borrow
  openSheet({ tier: 'y', raised: null, zh: `帮您预填${N(b)}元贷款申请（惠农流动贷A），不会发出`, en: `Pre-fill a ${N(b)} yuan application for Agri loan A; it will not be sent`, then: 'prefill' })
}
export function submitLoan() {
  const a = appStore.get().app.amount
  openSheet({ tier: 'r', raised: null, zh: `把${N(a)}元贷款申请（惠农流动贷A）正式发给模拟银行`, en: `Send the ${N(a)} yuan Agri loan A application to the mock bank`, then: 'submit' })
}
export const withdrawLoan = () => {
  liveWithdraw()
  appStore.update((s) => {
    s.app.loan = 'none'
    log(s, '撤回了贷款申请', 'Withdrew the loan application', BY_YOU)
  })
}
export const docsSent = () =>
  appStore.update((s) => {
    s.app.loan = 'submitted'
    log(s, '补交了平台收入截图', 'Sent the platform income screenshot', BY_YOU)
  })
export const SUB_NAME: Record<SubKey, Bi> = {
  farmland: ['耕地地力保护补贴', 'Farmland protection subsidy'],
  interest: ['农业经营流动资金贴息', 'Working-capital interest subsidy'],
}
/**
 * Subsidies are filled in and submitted the same way as the loan, but to the SIMULATED county subsidy system
 * (the county table is simulated too). Filling is a yellow action; submitting is red (you + family).
 */
export function prefillSubsidy(k: SubKey) {
  const n = SUB_NAME[k]
  openSheet({ tier: 'y', raised: null, zh: `帮您填好“${n[0]}”的申请表，先不提交`, en: `Fill in the ${n[1]} application for you, not submitted yet`, then: 'subprefill', sub: k })
}
export function submitSubsidy(k: SubKey) {
  const n = SUB_NAME[k]
  openSheet({ tier: 'r', raised: null, zh: `把“${n[0]}”的申请正式提交到（模拟）县补贴系统`, en: `Submit the ${n[1]} application to the (simulated) county subsidy system`, then: 'subsubmit', sub: k })
}
export const withdrawSubsidy = (k: SubKey) =>
  appStore.update((s) => {
    s.subs[k] = 'none'
    log(s, `撤回了“${SUB_NAME[k][0]}”的申请`, `Withdrew the ${SUB_NAME[k][1]} application`, BY_YOU)
  })
export const subDocsSent = (k: SubKey) =>
  appStore.update((s) => {
    s.subs[k] = 'submitted'
    log(s, `补交了“${SUB_NAME[k][0]}”要的材料`, `Sent the extra document for the ${SUB_NAME[k][1]}`, BY_YOU)
  })

/* ---------------- season ---------------- */
export const toggleFamily = (name: string) =>
  appStore.update((s) => {
    s.season.off = s.season.off.includes(name) ? s.season.off.filter((n) => n !== name) : [...s.season.off, name]
  })
export const setPct = (p: number) => appStore.update((s) => void (s.season.pct = p))

/* ---------------- payments ---------------- */
export function addPayee(name: string, phone: string) {
  appStore.update((s) => void s.extraPayees.push({ n: name, nick: null, last: null, known: false, phone }))
}
export function startPayment(who: string, amt: number, purpose: Bi) {
  const s = appStore.get()
  const p = allPayees(s).find((q) => q.n === who)
  if (!p) return
  const reasons: Bi[] = []
  if (!p.known) reasons.push(['新收款人', 'new payee'])
  if (s.sentToday + amt > DAY_LIMIT) reasons.push(['一天超过1,000元', 'over 1,000 in a day'])
  const red = reasons.length > 0
  const info: PayInfo = { n: p.n, amt, what: purpose }
  const base = {
    zh: `给 ${p.n} 转 ${N(amt)} 元，用途：${purpose[0]}`,
    en: `Send ${N(amt)} yuan to ${p.n} for ${purpose[1].toLowerCase()}`,
    before: N(BALANCE - s.sentToday),
    after: N(BALANCE - s.sentToday - amt),
    then: 'paydone' as const,
    payInfo: info,
  }
  if (liveStartPayment(p.n, amt, purpose, base)) return
  openSheet({
    tier: red ? 'r' : 'y',
    raised: red ? [reasons.map((r) => r[0]).join('、'), reasons.map((r) => r[1]).join(', ')] : null,
    zh: `给 ${p.n} 转 ${N(amt)} 元，用途：${purpose[0]}`,
    en: `Send ${N(amt)} yuan to ${p.n} for ${purpose[1].toLowerCase()}`,
    before: N(BALANCE - s.sentToday),
    after: N(BALANCE - s.sentToday - amt),
    then: 'paydone',
    payInfo: info,
  })
}
export const reportWrongPayment = () => {
  appStore.update((s) => log(s, '报告付错了一笔，转给了工作人员', 'Reported a wrong payment; handed to a staff member', ['您要求的', 'You asked']))
  say(t('付出去的钱不能自动退回。已经转给工作人员，他们会联系您和收款人。', 'Money sent cannot be pulled back automatically. A staff member will contact you and the payee.'))
}

/* ---------------- assistant strip + help ---------------- */
export const say = (text: string) => uiStore.update((u) => void ((u.answer = text), (u.ask = null)))
export const dismissAnswer = () => uiStore.update((u) => void (u.answer = null))
export const askConfirm = () => uiStore.update((u) => void ((u.ask = 'confirm'), (u.tipSeen = true)))
export const cancelAsk = () => uiStore.update((u) => void (u.ask = null))
export const handToHuman = () => {
  appStore.update((s) => {
    s.notice = null
    log(s, '转给了工作人员', 'Handed over to a staff member', ['您要求的', 'You asked'])
  })
  say(t('已转给工作人员，他们会打电话给您。您的记录也一起发过去了。', 'Passed to a staff member, who will call you. Your record went with it.'))
}

/* ---------------- judge scenario controls ---------------- */
export function scenario(v: 'reset' | 'suspicious' | 'unlock' | 'approve' | 'docs' | 'payout' | 'lock' | `subApprove:${SubKey}` | `subDocs:${SubKey}`) {
  if (v.startsWith('sub')) {
    const [kind, key] = v.split(':') as [string, SubKey]
    appStore.update((s) => {
      s.subs[key] = kind === 'subApprove' ? 'approved' : 'needdocs'
      const n = SUB_NAME[key]
      if (kind === 'subApprove') log(s, `县里批准了“${n[0]}”`, `The county approved the ${n[1]}`, ['模拟县补贴系统', 'Simulated county system'])
      else log(s, `县里要补一份“${n[0]}”的材料`, `The county asked for an extra document for the ${n[1]}`, ['模拟县补贴系统', 'Simulated county system'])
    })
    return
  }
  liveScenario(v)
  if (v === 'reset') {
    appStore.replace(freshApp())
    uiStore.update((u) => {
      u.sheet = null
      u.answer = null
      u.ask = null
    })
    return
  }
  appStore.update((s) => {
    if (v === 'lock') s.locked = !s.locked
    if (v === 'suspicious') {
      s.locked = true
      log(s, '导入的订单备注里有可疑指令，账户已锁定', 'Suspicious instruction in an imported order note: account locked', null)
    }
    if (v === 'unlock') {
      s.locked = false
      s.pinTries = 3
      log(s, '家人和工作人员核实后解锁', 'Unlocked after family and staff checks', null)
    }
    if (v === 'approve') {
      s.app.loan = 'approved'
      log(s, '银行批准了贷款申请', 'The bank approved the loan', ['模拟银行', 'Mock bank'])
    }
    if (v === 'docs') {
      s.app.loan = 'needdocs'
      log(s, '银行要补一张平台收入截图', 'The bank asked for a platform income screenshot', ['模拟银行', 'Mock bank'])
    }
    if (v === 'payout') {
      s.app.loan = 'paid'
      log(s, `${N(s.app.amount)}元贷款到账`, `${N(s.app.amount)} yuan loan paid out`, ['模拟银行', 'Mock bank'])
    }
  })
}
export const markVisited = () => appStore.update((s) => void (s.visited = true))
