import type { Bi } from '../lib/i18n'
import { CASH, forecast } from './mock'

/*
 * Cash-preparation maths for the Season page. Information, not advice: every figure is a RANGE built from
 * listed assumptions, and we never predict the weather (the user tells us what they are worried about).
 */

export type WorryKey = 'drought' | 'storm' | 'cold' | 'heat'
export type Severity = 'low' | 'mid' | 'high' | 'custom'

/** Assumed honey income for the season. The user can change it; it is only an assumption. */
export const INCOME_DEFAULT = 60000

export interface Worry {
  key: WorryKey
  name: Bi
  /** what it can do to a honey farm, in plain words */
  effects: Bi[]
  /** extra cost at a "medium" severity, yuan [low, high] */
  feed: [number, number]
  repair: [number, number]
  /** % of expected honey income lost at light / medium / heavy */
  pct: { low: number; mid: number; high: number }
}

export const WORRIES: Worry[] = [
  {
    key: 'drought', name: ['干旱', 'Drought'],
    effects: [
      ['花开得少、流蜜少，蜂蜜会收得少', 'Fewer flowers and less nectar, so a smaller honey harvest'],
      ['蜜蜂缺吃的，要多喂糖水', 'Bees run short of food and need extra sugar feed'],
      ['要多给蜂箱补水、遮阴', 'Hives need extra water and shade'],
    ],
    feed: [1500, 3000], repair: [0, 500], pct: { low: 10, mid: 25, high: 40 },
  },
  {
    key: 'storm', name: ['台风暴雨', 'Typhoon or heavy rain'],
    effects: [
      ['下雨蜜蜂出不了门，采蜜的天数变少', 'Bees cannot fly in the rain, so fewer days to gather nectar'],
      ['蜂箱可能被吹倒、进水，要修或换', 'Hives may be blown over or flooded and need repair or replacing'],
      ['蜜蜂缺吃的，要喂糖水', 'Bees go short of food and need sugar feed'],
    ],
    feed: [500, 1500], repair: [2000, 6000], pct: { low: 5, mid: 15, high: 35 },
  },
  {
    key: 'cold', name: ['寒潮霜冻', 'Cold snap or frost'],
    effects: [
      ['花被冻坏，流蜜少，蜂蜜收得少', 'Frost damages flowers, so less nectar and less honey'],
      ['蜂群要保暖，要多喂糖水', 'The colony needs to stay warm and needs extra feed'],
      ['蜂箱要加保温，部分要修', 'Hives need insulation and some repair'],
    ],
    feed: [1500, 3500], repair: [500, 1500], pct: { low: 10, mid: 20, high: 35 },
  },
  {
    key: 'heat', name: ['高温', 'Heat wave'],
    effects: [
      ['花很快谢，流蜜少，蜂蜜收得少', 'Flowers fade fast, so less nectar and less honey'],
      ['蜂箱太热，要遮阴、通风、补水', 'Hives overheat and need shade, airflow and water'],
      ['要多喂水和糖水', 'Bees need extra water and feed'],
    ],
    feed: [800, 2000], repair: [300, 1000], pct: { low: 5, mid: 15, high: 30 },
  },
]

export const SEVERITIES: { key: Exclude<Severity, 'custom'>; zh: string; en: string }[] = [
  { key: 'low', zh: '轻', en: 'Light' },
  { key: 'mid', zh: '中', en: 'Medium' },
  { key: 'high', zh: '重', en: 'Heavy' },
]

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/**
 * Climate cash picture. Formula (all yuan):
 *   pct        = chosen severity % (or the user's own %), of expected honey income
 *   loss       = income x pct x [0.75 .. 1.25]                       income at risk, shown as a range
 *   scale      = clamp(pct / medium pct of this worry, 0.3 .. 2.5)   heavier trouble means more feed/repair
 *   extra      = (feed + repair) x scale                             extra costs, from the listed low/high
 *   need       = loss + extra                                        how far cash falls short of the normal plan
 *   cashAfter  = CASH - need                                         expected cash on hand, minus the hit
 *   gap        = max(0, honey purchase cost - cashAfter)             what is missing for the Aug-Sep honey buying
 * CASH (49,060-53,409) is the existing forecast of cash on hand; it already includes normal honey income, so the
 * hit is subtracted from it. The honey purchase is forecast(default season), the existing buying-season estimate.
 * The low end of the gap pairs the best cash with the lowest cost, the high end the worst with the highest.
 */
export function climateCash(w: Worry, pct: number, income: number) {
  const loss = { low: income * (pct / 100) * 0.75, mid: income * (pct / 100), high: income * (pct / 100) * 1.25 }
  const scale = clamp(pct / w.pct.mid, 0.3, 2.5)
  const extra = { low: (w.feed[0] + w.repair[0]) * scale, high: (w.feed[1] + w.repair[1]) * scale }
  const extraMid = (extra.low + extra.high) / 2
  const need = { low: loss.low + extra.low, mid: loss.mid + extraMid, high: loss.high + extra.high }
  const honey = forecast({ pct: 0, off: [] })
  return {
    loss, need, honey,
    feed: [w.feed[0] * scale, w.feed[1] * scale] as [number, number],
    repair: [w.repair[0] * scale, w.repair[1] * scale] as [number, number],
    cashAfter: { low: CASH.low - need.high, mid: CASH.mid - need.mid, high: CASH.high - need.low },
    gapLow: Math.max(0, honey.low - (CASH.high - need.low)),
    gapMid: Math.max(0, honey.mid - (CASH.mid - need.mid)),
    gapHigh: Math.max(0, honey.high - (CASH.low - need.high)),
  }
}

/**
 * "Something else": a single cash need checked against cash on hand.
 *   gap = max(0, amount - CASH)   low end uses the best cash, high end the worst cash.
 * If the user also gives a "could be up to" amount, that is the top of the range; otherwise the amount is exact
 * and the range comes from the cash range only. This does not include the honey-buying season.
 */
export function otherCash(amount: number, upTo: number) {
  const hi = Math.max(amount, upTo)
  return {
    low: amount, high: hi,
    cashAfter: { low: CASH.low - hi, mid: CASH.mid - (amount + hi) / 2, high: CASH.high - amount },
    gapLow: Math.max(0, amount - CASH.high),
    gapMid: Math.max(0, (amount + hi) / 2 - CASH.mid),
    gapHigh: Math.max(0, hi - CASH.low),
  }
}
