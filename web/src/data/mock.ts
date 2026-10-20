import type { Bi } from '../lib/i18n'
import { N } from '../lib/format'
import type { AppState, Payee, Payment, Plan, PlanNode, PlanSpec } from '../state/types'

/*
 * Phase 1 fixtures. The numbers are the real seed values (Uncle Wang, demo clock 2026-07-25), so the screens
 * match the final demo. Phase 2 replaces the reads and writes in state/actions.ts with calls to the backend.
 */
export const BALANCE = 47150
export const FARMER_PIN = '123456'
export const FAMILY_PIN = '654321'
export const DAY_LIMIT = 1000
export const CASH = { low: 49060, mid: 51234, high: 53409 }

export const SUPPLIERS: Payee[] = [
  { n: '李国强', nick: ['老李', 'Old Li'], year: 9980, last: 4990, known: true },
  { n: '刘桂花', nick: ['刘婶', 'Aunt Liu'], year: 9290, last: 4645, known: true },
  { n: '张秀英', nick: ['张大姐', 'Sister Zhang'], year: 9160, last: 4580, known: true },
  { n: '周小军', nick: ['小周', 'Xiao Zhou'], year: 8950, last: null, known: false },
  { n: '赵三', nick: ['老赵', 'Old Zhao'], year: 8470, last: 4235, known: true },
  { n: '陈阿福', nick: ['阿福', 'A-Fu'], year: 7770, last: 3885, known: true },
]
export const OTHER_PAYEES: Payee[] = [{ n: '孙海', nick: null, last: null, known: false }]
export const PURPOSES: Bi[] = [
  ['蜂蜜钱', 'Honey'],
  ['瓶罐标签', 'Jars and labels'],
  ['蜂饲料', 'Hive feed'],
]

export const GLOSSARY: Record<string, { title: Bi; body: Bi }> = {
  resale: {
    title: ['转卖', 'Resale'],
    body: ['从别人那里收来、再卖出去的东西，比如收邻居的蜂蜜再卖。', 'Goods you bought from someone else and sold on, like neighbours’ honey.'],
  },
  vat: {
    title: ['增值税', 'VAT'],
    body: ['卖东西时按销售额算的一种税。农民卖自己种的、养的农产品，按规则免征。', 'A tax on sales. Farmers selling what they grew or raised themselves are exempt by the rules.'],
  },
  threshold: {
    title: ['门槛', 'Threshold'],
    body: ['一条金额线。转卖的销售额低于这条线，按规则免征增值税。', 'An amount line. Resale sales below it are VAT-exempt by the rules.'],
  },
  tbc: {
    title: ['待核实', 'To be checked'],
    body: ['这条规则我们还没和官方原文核对，所以先不给数字。', 'We have not yet checked this rule against the official text, so no figure is shown.'],
  },
}

export function seedPayments(): Payment[] {
  return [
    { d: ['7月18日', '18 Jul'], n: '包装店', amt: 860, what: ['瓶罐标签', 'Jars and labels'], by: ['您确认的', 'Confirmed by you'] },
    { d: ['7月6日', '6 Jul'], n: '刘桂花', amt: 300, what: ['蜂饲料', 'Hive feed'], by: ['您确认的', 'Confirmed by you'] },
    { d: ['6月20日', '20 Jun'], n: '李国强', amt: 600, what: ['其他：借的蜂箱', 'Other: borrowed hives'], by: ['您确认的', 'Confirmed by you'] },
  ]
}

export function freshApp(): AppState {
  return {
    locked: false,
    pinTries: 3,
    taxRule: false,
    orderConfirmed: null,
    app: { loan: 'none', amount: 7500 },
    subs: { farmland: 'none', interest: 'none' },
    log: [],
    clock: 2,
    sentToday: 0,
    payments: seedPayments(),
    extraPayees: [],
    famPending: false,
    famReq: null,
    mu: null,
    borrow: 7500,
    season: { pct: 0, off: [] },
    plan: null,
    visited: false,
    notice: null,
  }
}

export function forecast(season: AppState['season']) {
  const live = SUPPLIERS.filter((s) => !season.off.includes(s.n))
  const sum = live.reduce((a, s) => a + (s.year ?? 0), 0) * (1 + season.pct / 100)
  const low = sum * 0.9463
  const high = sum * 1.0537
  return {
    families: live.length,
    low,
    mid: sum,
    high,
    gapLow: Math.max(0, low - CASH.high),
    gapExp: Math.max(0, sum - CASH.mid),
    gapHigh: Math.max(0, high - CASH.low),
  }
}

/** Plan for a climate worry or any other cash need. Money-moving steps are raised to ■ over the day limit / half the balance. */
function specPlan(kind: 'climate' | 'cash', spec: PlanSpec): Plan {
  const aside = Math.min(Math.round(spec.aside / 100) * 100, BALANCE)
  const loan = spec.gap > 0 ? Math.max(1000, Math.ceil(spec.gap / 500) * 500) : 0
  const asideTier = aside > BALANCE / 2 ? 'r' : aside > DAY_LIMIT ? 'r' : 'y'
  const asideWhy: Bi = aside > BALANCE / 2 ? ['超过余额一半', 'more than half the balance'] : ['一天超过1,000元', 'over 1,000 in a day']
  const rng: Bi = [`约${N(spec.low)}–${N(spec.high)}元`, `about ${N(spec.low)}–${N(spec.high)} yuan`]
  const nodes: PlanNode[] = [
    { id: '', zh: '算一算要备多少钱', en: 'Work out how much cash to prepare', tier: 'g', st: 'done', sum: rng },
    { id: '', zh: '查贷款和可用补贴', en: 'Look at loans and available subsidies', tier: 'g', st: 'done', sum: ['贴息50%可用于贷款', '50% interest subsidy applies to a loan'] },
    { id: '', zh: `先预留${N(aside)}元（只留出来，不转出去）`, en: `Set aside ${N(aside)} yuan (kept in your account, not sent)`, tier: asideTier, st: 'waiting', ...(asideTier === 'r' ? { raise: asideWhy } : {}) },
  ]
  if (loan > 0) {
    nodes.push(
      { id: '', zh: `预填贷款申请${N(loan)}元（还不会发出）`, en: `Pre-fill a ${N(loan)} yuan loan application (not sent yet)`, tier: 'y', st: 'pending', loan: true },
      { id: '', zh: '您确认后，才正式发出贷款申请', en: 'Send the loan application only after you confirm', tier: 'r', st: 'pending', loan: true },
    )
  }
  nodes.push(
    kind === 'climate'
      ? { id: '', zh: '问问收货的邻居和供货方，能不能晚几天付款', en: 'Ask neighbours and suppliers whether payment can wait a few days', tier: 'y', st: 'pending' }
      : { id: '', zh: '问问对方，能不能分几次付或晚几天付', en: 'Ask the other side whether you can pay in parts or a few days later', tier: 'y', st: 'pending' },
    { id: '', zh: '任何大额付款先等女儿确认，办完告诉您', en: 'Hold any large payment for your daughter’s confirmation, then tell you when done', tier: 'y', st: 'pending' },
  )
  nodes.forEach((n, i) => (n.id = 'N' + (i + 1)))
  return { status: 'waiting', kind, utter: spec.utter, title: spec.title, borrow: loan || undefined, nodes }
}

export function newPlan(kind: Plan['kind'], s: Pick<AppState, 'season' | 'borrow'>, spec?: PlanSpec): Plan {
  if ((kind === 'climate' || kind === 'cash') && spec) return specPlan(kind, spec)
  if (kind === 'sup') {
    return {
      status: 'waiting',
      kind,
      utter: ['像去年一样给六家付蜂蜜钱', 'Pay the six families like last year'],
      nodes: [
        { id: 'N1', zh: '按去年算出每家的钱', en: 'Work out each family’s amount from last year', tier: 'g', st: 'done', sum: ['6家，合计约26,810元', '6 families, ~26,810 in total'] },
        { id: 'N2', zh: '安排5家老邻居送货时付款（共22,335元，现在不转出）', en: 'Schedule the 5 regular families to be paid on delivery (22,335 total, nothing sent now)', tier: 'r', st: 'waiting', raise: ['一天超过1,000元', 'over 1,000 in a day'] },
        { id: 'N3', zh: '周小军是今年新的收款人，单独再确认一次（4,475元）', en: 'Zhou Xiaojun is new this year, so confirm him separately (4,475)', tier: 'r', st: 'pending', raise: ['新收款人', 'new payee'] },
        { id: 'N4', zh: '每家送货时付款，付完告诉您', en: 'Pay each family on delivery and tell you when done', tier: 'g', st: 'pending' },
      ],
    }
  }
  const f = forecast(s.season)
  return {
    status: 'waiting',
    kind: 'season',
    utter: ['下个月要收蜂蜜了，帮我准备一下', 'Get me ready for next month’s honey buying'],
    nodes: [
      { id: 'N1', zh: '算一算收购要多少钱', en: 'Work out what the honey purchase will cost', tier: 'g', st: 'done', sum: [`约${N(f.low)}–${N(f.high)}元`, `about ${N(f.low)}–${N(f.high)} yuan`] },
      { id: 'N2', zh: '查税务提示和可用补贴', en: 'Check tax notes and available subsidies', tier: 'g', st: 'done', sum: ['3条税务提示；贴息50%可用于贷款', '3 tax notes; 50% interest subsidy applies to a loan'] },
      { id: 'N3', zh: '先预留47,100元（只留出来，不转出去）', en: 'Set aside 47,100 yuan (kept in your account, not sent)', tier: 'r', st: 'waiting', raise: ['超过余额一半', 'more than half the balance'] },
      { id: 'N4', zh: `预填贷款申请${N(s.borrow)}元（还不会发出）`, en: `Pre-fill a ${N(s.borrow)} yuan loan application (not sent yet)`, tier: 'y', st: 'pending', loan: true },
      { id: 'N5', zh: '您确认后，才正式发出贷款申请', en: 'Send the loan application only after you confirm', tier: 'r', st: 'pending', loan: true },
      { id: 'N6', zh: '每家送货时再付款（单笔约3,885–4,990元）', en: 'Pay each family on delivery (about 3,885–4,990 yuan each)', tier: 'r', st: 'pending' },
    ],
  }
}
