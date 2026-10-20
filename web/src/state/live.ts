import { api, ApiError, beginAction, type Approval as BankApproval, type TransferBody } from '../api/client'
import { BALANCE } from '../data/mock'
import { getLang } from '../lib/i18n'
import { N } from '../lib/format'
import { applyDone } from './actions'
import { liveNodeDone } from './livePlan'
import { appStore, uiStore } from './store'
import type { Approval, LiveRef, SheetState, TierKey } from './types'

/*
 * Phase 2 bridge. When the backend answers /health, money actions go through the real bank approval chain
 * (transfer -> confirm -> PIN -> co-sign -> token -> execute). When it does not, every function here returns
 * "not mine" and the Phase 1 mock path in actions.ts runs unchanged, so UI work never depends on the server.
 */
const LOAN_PRODUCT = 1 // 惠农流动贷 A
let isLive = false
let payeeIds = new Map<string, number>()
export const live = () => isLive
const t = (zh: string, en: string) => (getLang() === 'zh' ? zh : en)
const tierKey = (x: BankApproval['tier']): TierKey => (x === 'red' ? 'r' : x === 'yellow' ? 'y' : 'g')

/** Call once at startup. Safe to call again (e.g. after the judge resets the demo). */
export async function initLive(): Promise<boolean> {
  try {
    await api.health()
    const payees = await api.payees()
    payeeIds = new Map(payees.map((p) => [p.name, p.id]))
    isLive = true
    await syncBank()
  } catch {
    isLive = false
  }
  return isLive
}

/** Pull the numbers the screens show from the bank: balance (as "sent so far today" against the seed balance) and the safety lock. */
export async function syncBank() {
  if (!isLive) return
  try {
    const [bal, sec] = await Promise.all([api.balance(), api.securityStatus()])
    appStore.update((s) => {
      s.sentToday = Math.max(0, Math.round(BALANCE - bal.balance))
      s.locked = sec.locked
    })
  } catch {
    /* a failed refresh keeps what the screen already shows */
  }
}

function fail(e: unknown) {
  if (e instanceof ApiError && (e.status === 423 || e.data.locked)) {
    appStore.update((s) => void (s.locked = true))
    uiStore.update((u) => void (u.sheet && ((u.sheet.step = 'locked'), (u.sheet.pin = ''))))
    return
  }
  const msg = e instanceof ApiError ? String(e.data.detail ?? e.status) : t('连不上银行，请再试一次', 'Cannot reach the bank, please try again')
  uiStore.update((u) => void (u.sheet && ((u.sheet.err = msg), (u.sheet.pin = ''))))
}

/* ---------------- payment ---------------- */
type Base = Omit<Approval, 'tier' | 'raised' | 'live'>

/** Ask the bank for an approval and open the sheet with the bank's own tier and reasons. */
function begin(base: Base, call: () => Promise<BankApproval>, ref: Omit<LiveRef, 'approvalId'>) {
  beginAction()
  call()
    .then((ap) => {
      const raised: [string, string] | null = ap.tier === 'red' && ap.reasons.length ? [ap.reasons_zh.join('、'), ap.reasons.join(', ')] : null
      uiStore.update((u) => {
        u.sheet = { ...base, tier: tierKey(ap.tier), raised, live: { ...ref, approvalId: ap.approval_id }, step: 'readback', pin: '', err: '', fam: false }
      })
    })
    .catch((e) => {
      uiStore.update((u) => {
        u.sheet = { ...base, tier: 'r', raised: null, step: 'readback', pin: '', err: '', fam: false }
      })
      fail(e)
    })
}

/** Returns true when the live path took the action. */
export function liveStartPayment(who: string, amt: number, purpose: readonly [string, string], base: Base): boolean {
  const id = payeeIds.get(who)
  if (!isLive || id === undefined) return false // typed-in payees have no bank record: mock path
  const body: TransferBody = { payee_id: id, amount: amt, purpose: purpose[0] }
  begin(base, () => api.startTransfer(body) as Promise<BankApproval>, { transfer: body })
  return true
}

/** Tax pot rule, loan draft, loan submit: the same chain, a different call at the end. */
export function liveStartGated(base: Base): boolean {
  if (!isLive) return false
  if (base.then === 'taxpot') begin(base, () => api.createRule() as Promise<BankApproval>, {})
  else if (base.then === 'prefill') {
    const amount = appStore.get().borrow
    begin(base, () => api.createDraft({ product_id: LOAN_PRODUCT, amount }) as Promise<BankApproval>, { amount })
  } else if (base.then === 'submit') {
    const id = appStore.get().loanId
    if (id === undefined) return false
    begin(base, () => api.submitApplication(id) as Promise<BankApproval>, {})
  } else return false
  return true
}

export function liveConfirm(sheet: SheetState): boolean {
  if (!sheet.live) return false
  api
    .confirmApproval(sheet.live.approvalId)
    .then((ap) => uiStore.update((u) => void (u.sheet && (u.sheet.step = ap.next === 'pin' ? 'pin' : 'done'))))
    .catch(fail)
  return true
}

/** A full 6-digit PIN was typed. The farmer's PIN goes to the bank; so does the daughter's, via the co-sign request. */
export function livePin(sheet: SheetState, pin: string) {
  const ref = sheet.live!
  const wrong = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) {
      appStore.update((s) => void (s.pinTries = Math.max(0, s.pinTries - 1)))
      const left = appStore.get().pinTries
      uiStore.update((u) => void (u.sheet && ((u.sheet.pin = ''), (u.sheet.err = t(`密码不对，还能试${left}次`, `Wrong PIN, ${left} tries left`)))))
    } else fail(e)
  }
  if (sheet.fam) {
    api
      .cosignPending()
      .then((list) => {
        const c = list.find((x) => x.approval_id === ref.approvalId)
        if (!c) throw new ApiError(409, { detail: t('这个请求已经过期了', 'This request has expired') })
        return api.cosignApprove(c.id, pin)
      })
      .then(() => uiStore.update((u) => void (u.sheet && ((u.sheet.step = 'done'), (u.sheet.pin = ''), (u.sheet.err = '')))))
      .catch(wrong)
    return
  }
  api
    .verifyPin(ref.approvalId, pin)
    .then((ap) => {
      appStore.update((s) => {
        s.pinTries = 3
        s.famPending = true
        s.famReq = { tier: sheet.tier, raised: sheet.raised, zh: sheet.zh, en: sheet.en, before: sheet.before, after: sheet.after, then: sheet.then, payInfo: sheet.payInfo, live: ref }
        if (sheet.payInfo) s.payments.unshift({ d: ['今天', 'Today'], ...sheet.payInfo, wait: true })
      })
      uiStore.update((u) => void (u.sheet && ((u.sheet.step = ap.next === 'cosign' ? 'family' : 'done'), (u.sheet.pin = ''), (u.sheet.err = ''))))
    })
    .catch(wrong)
}

/** OK pressed on the last screen: spend the approval token, then book the result like the mock did. */
export function liveDone(sheet: SheetState) {
  const ref = sheet.live!
  const finish = (a: Approval) => {
    appStore.update((s) => applyDone(s, a))
    uiStore.update((u) => void (u.sheet = null))
    void syncBank()
  }
  if (ref.node) {
    const by: [string, string] = sheet.tier === 'r' ? ['您和女儿确认的', 'Confirmed by you and your daughter'] : ['您确认的', 'Confirmed by you']
    api
      .approval(ref.approvalId)
      .then((ap) => {
        if (!ap.approval_token) throw new ApiError(409, { detail: t('还没有全部确认', 'Not fully approved yet') })
        liveNodeDone(ref.node!.sid, ref.node!.nodeId, ap.approval_token, by, () => {
          appStore.update((s) => {
            if (s.famReq?.live?.approvalId === ref.approvalId) {
              s.famPending = false
              s.famReq = null
            }
          })
          uiStore.update((u) => void (u.sheet = null))
        })
      })
      .catch(fail)
    return
  }
  const token = () =>
    api.approval(ref.approvalId).then((ap) => {
      if (!ap.approval_token) throw new ApiError(409, { detail: t('还没有全部确认', 'Not fully approved yet') })
      return ap.approval_token
    })
  if (sheet.then === 'paydone' && ref.transfer) {
    token()
      .then((tk) => api.executeTransfer(ref.transfer!, tk))
      .then((r) => finish({ ...sheet, before: N(r.balance_before), after: N(r.balance_after) }))
      .catch(fail)
  } else if (sheet.then === 'taxpot') {
    token().then((tk) => api.createRule(tk)).then(() => finish(sheet)).catch(fail)
  } else if (sheet.then === 'prefill' && ref.amount !== undefined) {
    token()
      .then((tk) => api.createDraft({ product_id: LOAN_PRODUCT, amount: ref.amount! }, tk))
      .then((r) => {
        appStore.update((s) => void (s.loanId = (r as { application_id: number }).application_id))
        finish(sheet)
      })
      .catch(fail)
  } else if (sheet.then === 'submit') {
    const id = appStore.get().loanId
    if (id === undefined) return finish(sheet)
    token().then((tk) => api.submitApplication(id, tk)).then(() => finish(sheet)).catch(fail)
  } else finish(sheet)
}

/** Withdraw the draft at the bank too; the screen has already changed. */
export function liveWithdraw() {
  const id = appStore.get().loanId
  if (!isLive || id === undefined) return
  api.withdrawApplication(id).catch(() => {})
  appStore.update((s) => void (s.loanId = undefined))
}

export function liveCancel(sheet: SheetState | null) {
  if (!sheet?.live || sheet.step === 'done' || sheet.step === 'family' || sheet.step === 'locked') return
  api.cancelApproval(sheet.live.approvalId).catch(() => {})
}

export function liveDecline(req: Approval) {
  if (!req.live) return
  api
    .cosignPending()
    .then((list) => {
      const c = list.find((x) => x.approval_id === req.live!.approvalId)
      return c ? api.cosignDecline(c.id) : undefined
    })
    .catch(() => {})
}
