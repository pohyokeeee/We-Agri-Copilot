import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Field, Notice } from '../../components/ui'
import { CASH } from '../../data/mock'
import { climateCash, INCOME_DEFAULT, SEVERITIES, WORRIES, type Severity, type WorryKey } from '../../data/prep'
import { N } from '../../lib/format'
import { useT } from '../../lib/i18n'
import { startPlan } from '../../state/actions'

const big = { minHeight: 48 } as const
const ink = { color: 'var(--ink)' } as const
const R = (a: number, b: number) => `${N(a)}–${N(b)}`

/** Weather and climate: the user names the worry; we show what it can do and a ranged cash picture. We never predict weather. */
export default function Climate() {
  const t = useT()
  const nav = useNavigate()
  const [worry, setWorry] = useState<WorryKey | null>(null)
  const [sev, setSev] = useState<Severity>('mid')
  const [custom, setCustom] = useState('')
  const [incomeIn, setIncomeIn] = useState(String(INCOME_DEFAULT))
  const w = WORRIES.find((x) => x.key === worry)
  const income = Number(incomeIn) > 0 ? Number(incomeIn) : INCOME_DEFAULT
  const customPct = custom !== '' && Number(custom) >= 0 ? Math.min(100, Number(custom)) : null
  const pct = w ? (sev === 'custom' ? customPct ?? w.pct.mid : w.pct[sev]) : 0
  const c = w ? climateCash(w, pct, income) : null

  return (
    <>
      <div className="card">
        <b style={{ fontSize: '1.15rem', ...ink }}>{t('您担心哪一种？', 'Which one worries you?')}</b>
        <div className="small">{t('我们不预测天气，请看当地气象预报。您告诉我们担心什么，我们帮您算要备多少钱。', 'We do not predict the weather; check your local forecast. Tell us what worries you and we will work out how much cash to prepare.')}</div>
        <div className="btns">
          {WORRIES.map((x) => (
            <button key={x.key} className={`btn ${worry === x.key ? 'pri' : ''}`} style={big} aria-pressed={worry === x.key} onClick={() => setWorry(x.key)}>
              {t(x.name[0], x.name[1])}
            </button>
          ))}
        </div>
        <div className="small">{t('不在这里面？点上面的“别的情况”，自己写。', 'Not listed? Use “Something else” above and write it yourself.')}</div>
      </div>

      {w && c && (
        <>
          <div className="card">
            <div className="eyebrow">{t(`${w.name[0]}对养蜂的影响`, `What ${w.name[1].toLowerCase()} can do to a honey farm`)}</div>
            <div className="small">{w.effects.map((e, i) => <div key={i}>• {t(e[0], e[1])}</div>)}</div>
          </div>

          <div className="card">
            <b style={ink}>{t('这次有多严重？（只是您的假设）', 'How bad might it be? (your own assumption)')}</b>
            <div className="row">
              {SEVERITIES.map((s) => (
                <button key={s.key} className={`chip ${sev === s.key ? 'on' : ''}`} style={big} aria-pressed={sev === s.key} onClick={() => setSev(s.key)}>
                  {t(s.zh, s.en)} · {w.pct[s.key]}%
                </button>
              ))}
              <button className={`chip ${sev === 'custom' ? 'on' : ''}`} style={big} aria-pressed={sev === 'custom'} onClick={() => setSev('custom')}>{t('我自己填', 'My own %')}</button>
            </div>
            {sev === 'custom' && (
              <Field id="climPct" label={['蜂蜜收入会少多少（%）', 'How much less honey income (%)']} placeholder={['例如：20', 'e.g. 20']} numeric value={custom} onChange={setCustom} />
            )}
            <Field id="climIncome" label={['预计这一季蜂蜜收入（元）', 'Expected honey income this season (yuan)']} placeholder={[String(INCOME_DEFAULT), String(INCOME_DEFAULT)]} numeric value={incomeIn} onChange={setIncomeIn} />
            <div className="small">{t('这是我们先假设的数，不对请改。', 'We assumed this figure; change it if it is wrong.')}</div>
          </div>

          <div className="card em" aria-live="polite">
            <div className="eyebrow">{t('钱的情况（估算，不是保证）', 'The cash picture (an estimate, not a promise)')}</div>
            <div className="kv"><span>{t(`收入可能少 ${pct}%`, `Income at risk (${pct}%)`)}</span><b style={ink}>{R(c.loss.low, c.loss.high)}</b></div>
            <div className="kv"><span>{t('多花：喂蜂', 'Extra: feed')}</span><b style={ink}>{R(c.feed[0], c.feed[1])}</b></div>
            <div className="kv"><span>{t('多花：修蜂箱', 'Extra: hive repairs')}</span><b style={ink}>{R(c.repair[0], c.repair[1])}</b></div>
            <div className="kv"><span>{t('合计可能要备', 'Total to prepare')}</span><span className="mid" style={ink}>{R(c.need.low, c.need.high)}</span></div>
            <div className="kv"><span>{t('原本手里大概有', 'Cash you’d likely have')}</span><b style={ink}>{R(CASH.low, CASH.high)}</b></div>
            <div className="kv"><span>{t('出事后手里大概剩', 'Cash left after the hit')}</span><b style={ink}>{R(c.cashAfter.low, c.cashAfter.high)}</b></div>
            <div className="kv"><span>{t('8–9月收蜂蜜要', 'Honey buying Aug–Sep costs')}</span><b style={ink}>{R(c.honey.low, c.honey.high)}</b></div>
            <div className="kv"><span>{t('可能差', 'May be short')}</span><span className="mid" style={ink}>{c.gapHigh > 0 ? t(`约${N(c.gapMid)}`, `~${N(c.gapMid)}`) : t('够用', 'Enough')}</span></div>
            <div className="small">{t(`差额范围 ${R(c.gapLow, c.gapHigh)}`, `Gap range ${R(c.gapLow, c.gapHigh)}`)}</div>
          </div>

          <div className="card">
            <div className="eyebrow">{t('这个估算是怎么来的', 'How we estimated this')}</div>
            <div className="small">
              • {t(`少收的钱 = 预计收入 ${N(income)} × ${pct}%，上下浮动25%`, `Income at risk = expected income ${N(income)} × ${pct}%, give or take 25%`)}<br />
              • {t('喂蜂和修蜂箱：按这类天气常见的花费区间，越严重越多', 'Feed and repairs: a typical range for this kind of weather, more when it is worse')}<br />
              • {t('手里的钱、收蜂蜜的花费：和“收蜂蜜”那页用同一套数', 'Cash on hand and honey cost: the same figures as the honey-buying case')}<br />
              • {t('是估算，不是保证；我们不预测天气', 'An estimate, not a promise; we do not predict the weather')}
            </div>
          </div>
          <Notice>{t('受灾以后，可以问问县农业农村局有没有灾害补助（模拟提示）。', 'After a disaster, ask the county agriculture bureau about disaster relief (simulated pointer).')}</Notice>
          <button
            className="btn pri lg"
            onClick={() => {
              startPlan('climate', {
                title: [`${w.name[0]}准备`, `${w.name[1]} prep`],
                utter: [`担心${w.name[0]}，想先备点钱`, `I’m worried about ${w.name[1].toLowerCase()}; I want to set some cash aside`],
                low: c.need.low, high: c.need.high, aside: c.need.mid, gap: c.gapMid, worry: w.name,
              })
              nav('/plan')
            }}
          >
            {t('让助手帮我准备', 'Let the assistant prepare')}
          </button>
        </>
      )}
    </>
  )
}
