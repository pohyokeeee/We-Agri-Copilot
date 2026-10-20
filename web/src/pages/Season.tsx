import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Field } from '../components/ui'
import { CASH, forecast, SUPPLIERS } from '../data/mock'
import { N } from '../lib/format'
import { useT } from '../lib/i18n'
import { setPct, startPlan, toggleFamily } from '../state/actions'
import { useApp } from '../state/store'
import Climate from './season/Climate'
import Other from './season/Other'

type Case = 'honey' | 'climate' | 'other'

/** What are you preparing cash for? Honey buying (default, unchanged), weather and climate, or something else. */
export default function Season() {
  const t = useT()
  const [kase, setKase] = useState<Case>('honey')
  const cases: { k: Case; zh: string; en: string; sub: [string, string] }[] = [
    { k: 'honey', zh: '收蜂蜜', en: 'The honey-buying season', sub: ['8–9月收邻居的蜂蜜', 'Aug–Sep, buying neighbours’ honey'] },
    { k: 'climate', zh: '天气和气候', en: 'Weather and climate', sub: ['干旱、台风暴雨、寒潮、高温', 'Drought, typhoon, cold, heat'] },
    { k: 'other', zh: '别的情况', en: 'Something else', sub: ['新蜂箱、设备、婚事、学费……', 'New hives, equipment, a wedding, school fees…'] },
  ]
  return (
    <div className="page pad-ask">
      <div className="card">
        <b style={{ fontSize: '1.25rem', color: 'var(--ink)' }}>{t('您想为什么备钱？', 'What are you preparing for?')}</b>
        <div className="btns" role="group" aria-label={t('备钱的原因', 'What to prepare for')}>
          {cases.map((c) => (
            <button key={c.k} className={`btn ${kase === c.k ? 'pri' : ''}`} style={{ minHeight: 64, flex: '1 1 160px', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left' }} aria-pressed={kase === c.k} onClick={() => setKase(c.k)}>
              <b>{t(c.zh, c.en)}</b>
              <span style={{ fontSize: '0.95rem', fontWeight: 500 }}>{t(c.sub[0], c.sub[1])}</span>
            </button>
          ))}
        </div>
      </div>
      {kase === 'honey' && <Honey />}
      {kase === 'climate' && <Climate />}
      {kase === 'other' && <Other />}
    </div>
  )
}

/** Will there be enough cash for the honey purchase? Adjustable, with the range and the assumptions shown. */
function Honey() {
  const t = useT()
  const nav = useNavigate()
  const season = useApp((s) => s.season)
  const [adjusting, setAdjusting] = useState(false)
  const [pctIn, setPctIn] = useState('')
  const f = forecast(season)

  return (
    <>
      <div className="card em">
        <div className="eyebrow">{t('收购邻居蜂蜜 · 8月1日–9月30日', 'Buying neighbours’ honey · 1 Aug – 30 Sep')}</div>
        <div className="mid">{t('7天后开始', 'Starts in 7 days')}</div>
        <div className="kv"><span>{t(`预计要花（${f.families}家）`, `Expected cost (${f.families} families)`)}</span><b style={{ color: 'var(--ink)' }}>{N(f.low)}–{N(f.high)}</b></div>
        <div className="kv"><span>{t('那时手里大概有', 'Cash you’ll likely have')}</span><b style={{ color: 'var(--ink)' }}>{N(CASH.low)}–{N(CASH.high)}</b></div>
        <div className="kv"><span>{t('可能差', 'May be short')}</span><span className="mid" style={{ color: 'var(--ink)' }}>{f.gapExp > 0 ? t(`约${N(f.gapExp)}`, `~${N(f.gapExp)}`) : t('够用', 'Enough')}</span></div>
        <div className="small">{t(`差额范围 ${N(f.gapLow)}–${N(f.gapHigh)}`, `Gap range ${N(f.gapLow)}–${N(f.gapHigh)}`)}</div>
        {(season.pct !== 0 || season.off.length > 0) && (
          <div className="small">
            {t('已按您改的算', 'Using your adjustments')}
            {season.pct !== 0 && ` · ${t('价格', 'price')} ${season.pct > 0 ? '+' : ''}${season.pct}%`}
            {season.off.length > 0 && ` · ${t('不收', 'not buying from')} ${season.off.join('、')}`}
          </div>
        )}
        <div className="row"><button className="chip" onClick={() => setAdjusting(!adjusting)} aria-expanded={adjusting}>{adjusting ? t('收起', 'Close') : t('不对？改一下', 'Not right? Adjust it')}</button></div>
      </div>

      {adjusting && (
        <div className="card">
          <b style={{ color: 'var(--ink)' }}>{t('改一下估算', 'Adjust the estimate')}</b>
          <div className="small">{t('今年收哪几家？', 'Which families this year?')}</div>
          {SUPPLIERS.map((s) => (
            <label key={s.n} className="check">
              <input type="checkbox" checked={!season.off.includes(s.n)} onChange={() => toggleFamily(s.n)} />
              <span>{s.n} <span className="small">{t('去年', 'last year')} {N(s.year ?? 0)}</span></span>
            </label>
          ))}
          <div className="small">{t('今年蜂蜜价格比去年', 'Honey price compared with last year')}</div>
          <div className="row">
            {[-10, 0, 10, 20].map((p) => (
              <button key={p} className={`chip ${season.pct === p ? 'on' : ''}`} onClick={() => setPct(p)}>{p > 0 ? '+' : ''}{p}%</button>
            ))}
          </div>
          <Field id="pctIn" label={['别的幅度（%）', 'Another change (%)']} placeholder={['例如：15', 'e.g. 15']} numeric value={pctIn} onChange={setPctIn} />
          <div className="btns">
            <button className="btn" onClick={() => pctIn !== '' && setPct(Number(pctIn))}>{t('用这个', 'Use this')}</button>
            <button className="btn pri wide" onClick={() => setAdjusting(false)}>{t('好了', 'Done')}</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="eyebrow">{t('这个估算是怎么来的', 'How we estimated this')}</div>
        <div className="small">
          • {t('按去年每家付的钱，上下浮动', 'Last year’s payments to each family, with a range')}<br />
          • {t('每月平台收入、养老金246元、家里开销照常', 'Monthly payouts, 246 pension and household costs as usual')}<br />
          • {t('是估算，不是保证', 'An estimate, not a promise')}
        </div>
      </div>
      <button className="btn pri lg" onClick={() => { startPlan('season'); nav('/plan') }}>{t('让助手帮我准备', 'Let the assistant prepare')}</button>
    </>
  )
}
