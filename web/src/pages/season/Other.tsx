import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Field } from '../../components/ui'
import { CASH } from '../../data/mock'
import { otherCash } from '../../data/prep'
import { N } from '../../lib/format'
import { useT } from '../../lib/i18n'
import { startPlan } from '../../state/actions'

const ink = { color: 'var(--ink)' } as const
const R = (a: number, b: number) => (Math.round(a) === Math.round(b) ? N(a) : `${N(a)}–${N(b)}`)

/** Something else: any upcoming cash need (what, how much, by when) checked against cash on hand. */
export default function Other() {
  const t = useT()
  const nav = useNavigate()
  const [what, setWhat] = useState('')
  const [amt, setAmt] = useState('')
  const [upTo, setUpTo] = useState('')
  const [when, setWhen] = useState('')
  const a = Number(amt)
  const c = a > 0 ? otherCash(a, Number(upTo) > a ? Number(upTo) : a) : null
  const label = what.trim() || t('这笔开销', 'this expense')
  const quick: [string, string][] = [['新蜂箱', 'New hives'], ['设备', 'Equipment'], ['婚事', 'A wedding'], ['学费', 'School fees']]

  return (
    <>
      <div className="card">
        <b style={{ fontSize: '1.15rem', ...ink }}>{t('要花钱的是什么事？', 'What is the cash for?')}</b>
        <div className="row">
          {quick.map((q) => (
            <button key={q[1]} className={`chip ${what === q[0] || what === q[1] ? 'on' : ''}`} style={{ minHeight: 48 }} onClick={() => setWhat(t(q[0], q[1]))}>{t(q[0], q[1])}</button>
          ))}
        </div>
        <Field id="othWhat" label={['或者自己写', 'Or write it yourself']} placeholder={['例如：买新蜂箱', 'e.g. buy new hives']} value={what} onChange={setWhat} />
        <Field id="othAmt" label={['大概要多少钱（元）', 'About how much (yuan)']} placeholder={['例如：15000', 'e.g. 15000']} numeric value={amt} onChange={setAmt} />
        <Field id="othUp" label={['最多可能到多少（可不填）', 'Could be up to (optional)']} placeholder={['例如：18000', 'e.g. 18000']} numeric value={upTo} onChange={setUpTo} />
        <Field id="othWhen" label={['什么时候要（可不填）', 'By when (optional)']} placeholder={['例如：9月底', 'e.g. end of Sep']} value={when} onChange={setWhen} />
      </div>

      {c && (
        <>
          <div className="card em" aria-live="polite">
            <div className="eyebrow">{t('钱的情况（估算，不是保证）', 'The cash picture (an estimate, not a promise)')}</div>
            <div className="kv"><span>{label}{when && ` · ${when}`}</span><b style={ink}>{R(c.low, c.high)}</b></div>
            <div className="kv"><span>{t('手里大概有', 'Cash you’d likely have')}</span><b style={ink}>{N(CASH.low)}–{N(CASH.high)}</b></div>
            <div className="kv"><span>{t('付完手里大概剩', 'Cash left after paying')}</span><b style={ink}>{c.cashAfter.high <= 0 ? t('不够', 'None') : `${N(Math.max(0, c.cashAfter.low))}–${N(c.cashAfter.high)}`}</b></div>
            <div className="kv"><span>{t('可能差', 'May be short')}</span><span className="mid" style={ink}>{c.gapHigh > 0 ? t(`约${N(c.gapMid)}`, `~${N(c.gapMid)}`) : t('够用', 'Enough')}</span></div>
            {c.gapHigh > 0 && <div className="small">{t(`差额范围 ${R(c.gapLow, c.gapHigh)}`, `Gap range ${R(c.gapLow, c.gapHigh)}`)}</div>}
          </div>
          <div className="card">
            <div className="eyebrow">{t('这个估算是怎么来的', 'How we estimated this')}</div>
            <div className="small">
              • {t('差额 = 您填的钱 − 手里的钱（手里的钱取一个范围）', 'Gap = the amount you entered − cash on hand (cash is a range)')}<br />
              • {t('这里没有算8–9月收蜂蜜要花的钱', 'This does not include the Aug–Sep honey buying')}<br />
              • {t('是估算，不是保证', 'An estimate, not a promise')}
            </div>
          </div>
        </>
      )}
      <button
        className="btn pri lg"
        disabled={!c}
        style={c ? undefined : { opacity: 0.5 }}
        onClick={() => {
          if (!c) return
          const w = what.trim()
          startPlan('cash', {
            title: [`备钱：${w || '一笔开销'}`, `Cash for: ${w || 'an expense'}`],
            utter: [`我要备钱：${w || '一笔开销'}${when ? '（' + when + '）' : ''}`, `I need to prepare cash for ${w || 'an expense'}${when ? ' (' + when + ')' : ''}`],
            low: c.low, high: c.high, aside: (c.low + c.high) / 2, gap: c.gapMid,
          })
          nav('/plan')
        }}
      >
        {t('让助手帮我准备', 'Let the assistant prepare')}
      </button>
      {!c && <div className="small">{t('先填上大概要多少钱。', 'Enter roughly how much first.')}</div>}
    </>
  )
}
