import { useState } from 'react'
import { allPayees, addPayee, reportWrongPayment, startPayment, startPlan } from '../state/actions'
import { Field, Notice, StepHead } from '../components/ui'
import { useNavigate } from 'react-router-dom'
import { DAY_LIMIT, PURPOSES } from '../data/mock'
import { N } from '../lib/format'
import { useBi, useT, type Bi } from '../lib/i18n'
import { useApp } from '../state/store'
import type { Payee } from '../state/types'

const AMOUNTS = [500, 800, 1000, 2000]

/** Guided payment: who -> how much -> what for -> read-back. Quick choices everywhere, and a way to type anything. */
export default function Pay() {
  const t = useT()
  const bi = useBi()
  const nav = useNavigate()
  const s = useApp((a) => ({ sentToday: a.sentToday, payments: a.payments, extra: a.extraPayees, famPending: a.famPending, famReq: a.famReq }))
  const [step, setStep] = useState(1)
  const [who, setWho] = useState<string | null>(null)
  const [amt, setAmt] = useState<number | null>(null)
  const [keypad, setKeypad] = useState<string | null>(null)
  const [other, setOther] = useState(false)
  const [otherText, setOtherText] = useState('')
  const [adding, setAdding] = useState(false)
  const [np, setNp] = useState({ name: '', phone: '' })
  const [q, setQ] = useState('')

  const all = allPayees({ extraPayees: s.extra })
  const person = all.find((p) => p.n === who)
  const reset = () => { setStep(1); setWho(null); setAmt(null); setKeypad(null); setOther(false); setAdding(false); setOtherText('') }
  const back = () => {
    if (keypad !== null) return setKeypad(null)
    setOther(false)
    if (step === 2) return reset()
    setStep(step - 1)
  }
  const finish = (purpose: Bi) => {
    if (who && amt) startPayment(who, amt, purpose)
    reset()
  }
  const match = (p: Payee) => {
    const k = q.trim().toLowerCase()
    return !k || `${p.n} ${p.nick ? p.nick.join(' ') : ''} ${p.phone ?? ''}`.toLowerCase().includes(k)
  }
  const over = amt !== null && s.sentToday + amt > DAY_LIMIT
  const famWaitingPay = s.famPending && s.famReq?.payInfo

  const chips = (
    <>
      {person && <span className="chip static">{person.n}</span>}
      {amt && <span className="chip static">{N(amt)} {t('元', 'yuan')}</span>}
    </>
  )

  return (
    <div className="page pad-ask">
      <div className="card">
        <div className="kv"><span>{t('今天已转', 'Sent today')}</span><b style={{ color: 'var(--ink)' }}>{N(s.sentToday)} / {N(DAY_LIMIT)}</b></div>
        <div className="range"><b style={{ width: `${Math.min(100, s.sentToday / 10)}%` }} /></div>
        <div className="small">{t('一天超过1,000元，要您和家人一起确认', 'Over 1,000 a day needs you and your family')}</div>
      </div>
      {famWaitingPay && s.famReq && <Notice>{t('等女儿确认：' + s.famReq.zh + ' · 还剩4分32秒', 'Waiting for your daughter: ' + s.famReq.en + ' · 4:32 left')}</Notice>}

      <StepHead title={t('付款', 'Make a payment')} step={step} of={3} onBack={back} chips={chips} />

      {step === 1 && !adding && (
        <>
          <h2 className="lg">{t('付给谁？', 'Who are you paying?')}</h2>
          <div className="inrow">
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('找人：名字、外号或电话，例如“老李”', 'Find: name, nickname or phone, e.g. “Old Li”')} aria-label={t('找人', 'Find a person')} />
            <button className="say" onClick={() => undefined} aria-label={t('说话输入', 'Speak')}>{t('说', 'Speak')}</button>
          </div>
          <div className="grid2">
            {all.filter(match).map((p) => (
              <button key={p.n} className="li press boxed" onClick={() => { setWho(p.n); setStep(2) }}>
                <span className="grow">
                  <b style={{ fontSize: '1.1rem' }}>{p.n}</b> {p.nick && <span className="small">{bi(p.nick)}</span>}
                  <br />
                  <span className="small">{p.last ? t(`上次付 ${N(p.last)} 元`, `Last paid ${N(p.last)}`) : t('还没付过', 'Never paid')}</span>
                </span>
                {!p.known && <span className="pill">{t('新收款人', 'New payee')}</span>}
              </button>
            ))}
            <button className="li press dashed" onClick={() => setAdding(true)}><b style={{ fontSize: '1.1rem' }}>+ {t('新的收款人', 'New payee')}</b></button>
          </div>
          <div className="card em">
            <div className="eyebrow">{t('一次付给六家', 'Pay all six at once')}</div>
            <div style={{ fontSize: '1.1rem' }}>“{t('像去年一样给六家付蜂蜜钱', 'Pay the six families like last year')}”</div>
            <div className="small">{t('按去年的钱，每家送货时再付 · 合计约26,810元', 'Last year’s amounts, each paid on delivery · ~26,810 in total')}</div>
            <div className="btns"><button className="btn pri wide" onClick={() => { startPlan('sup'); nav('/plan') }}>{t('做个付款计划', 'Make a payment plan')}</button></div>
          </div>
        </>
      )}

      {step === 1 && adding && (
        <>
          <h2 className="lg">{t('新的收款人', 'New payee')}</h2>
          <div className="card">
            <Field id="npName" label={['名字', 'Name']} placeholder={['例如：王二', 'e.g. Wang Er']} value={np.name} onChange={(v) => setNp({ ...np, name: v })} autoFocus />
            <Field id="npPhone" label={['电话', 'Phone']} placeholder={['手机号', 'Mobile number']} numeric noSpeak value={np.phone} onChange={(v) => setNp({ ...np, phone: v })} />
            <Notice>{t('第一次付的人，要您和家人一起确认。这是为了防骗。', 'First-time payees need you and your family to confirm. This protects you from scams.')}</Notice>
            <div className="btns">
              <button className="btn pri wide" onClick={() => { if (np.name.trim()) { addPayee(np.name.trim(), np.phone); setWho(np.name.trim()); setStep(2); setAdding(false); setNp({ name: '', phone: '' }) } }}>{t('下一步', 'Next')}</button>
              <button className="btn" onClick={() => setAdding(false)}>{t('取消', 'Cancel')}</button>
            </div>
          </div>
        </>
      )}

      {step === 2 && person && (
        <>
          <h2 className="lg">{t('付多少？', 'How much?')}</h2>
          <div className="amt" aria-live="polite">{keypad !== null ? keypad || '0' : amt ? N(amt) : '—'} {t('元', 'yuan')}</div>
          {keypad !== null ? (
            <div className="pad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].map((k) => (
                <button key={k} onClick={() => {
                  if (k === '⌫') setKeypad(keypad.slice(0, -1))
                  else if (k === 'OK') { if (Number(keypad) > 0) setAmt(Number(keypad)); setKeypad(null) }
                  else if (keypad.length < 7) setKeypad(keypad + k)
                }}>{k === 'OK' ? t('确定', 'OK') : k}</button>
              ))}
            </div>
          ) : (
            <div className="grid4">
              {person.last && <button className="tile" onClick={() => setAmt(person.last)}>{t('和上次一样', 'Same as last time')}<span className="mid" style={{ color: 'var(--ink)' }}>{N(person.last)}</span></button>}
              {AMOUNTS.map((a) => <button key={a} className="tile" onClick={() => setAmt(a)}><span className="mid" style={{ color: 'var(--ink)' }}>{N(a)}</span></button>)}
              <button className="tile dashed" onClick={() => setKeypad('')}>{t('输入其他金额', 'Enter another amount')}</button>
            </div>
          )}
          <div className="small">{t('也可以按住说金额，比如“三千六百五”。', 'You can also hold and say the amount.')}</div>
          {amt && over && <Notice>{t(`今天已转 ${N(s.sentToday)} 元。加上这笔超过每天1,000元，要您和家人一起确认。`, `Sent today: ${N(s.sentToday)}. With this one you go over 1,000 a day, so you and your family both confirm.`)}</Notice>}
          {!person.known && <Notice>{t('这是新的收款人，要您和家人一起确认。', 'This is a new payee, so you and your family both confirm.')}</Notice>}
          <div className="btns"><button className="btn pri wide lg" disabled={!amt || keypad !== null} onClick={() => setStep(3)}>{t('下一步', 'Next')}</button></div>
        </>
      )}

      {step === 3 && (
        <>
          <h2 className="lg">{t('是什么钱？', 'What is it for?')}</h2>
          <div className="grid2">
            {PURPOSES.map((p) => <button key={p[0]} className="li press boxed" style={{ minHeight: 64 }} onClick={() => finish(p)}><b style={{ fontSize: '1.1rem' }}>{bi(p)}</b></button>)}
            <button className="li press dashed" onClick={() => setOther(true)}><b style={{ fontSize: '1.1rem' }}>{t('其他', 'Other')}</b></button>
          </div>
          {other && (
            <div className="card">
              <Field id="purposeText" label={['写一下是什么钱', 'What is it for?']} placeholder={['例如：修蜂箱的工钱', 'e.g. wages for fixing hives']} value={otherText} onChange={setOtherText} autoFocus />
              <div className="btns"><button className="btn pri wide" onClick={() => { const x = otherText.trim() || t('其他', 'Other'); finish([`其他：${x}`, `Other: ${x}`]) }}>{t('就是这个', 'Use this')}</button></div>
            </div>
          )}
          <div className="small">{t('选好后，我们把这笔读给您听，您说“对”才付。', 'Once you choose, we read the payment back to you. It is only paid after you say “yes”.')}</div>
        </>
      )}

      <h2 className="lg">{t('最近付款', 'Recent payments')}</h2>
      <div className="list">
        {s.payments.map((r, i) => (
          <div key={i} className="li">
            <span className="small" style={{ width: 58, flex: 'none' }}>{bi(r.d)}</span>
            <span className="grow">
              <b>{r.n} · {N(r.amt)} {t('元', 'yuan')}</b> <span className="small">{bi(r.what)}</span>
              <br />
              <span className={`small ${r.declined ? 'err' : ''}`}>
                {r.wait ? t('等女儿确认', 'Waiting for your daughter') : r.declined ? t('女儿没有同意，没有付', 'Your daughter declined; not paid') : '✓ ' + (r.by ? bi(r.by) : '')}
              </span>
            </span>
            {!r.wait && !r.declined && <button className="chip" onClick={reportWrongPayment}>{t('付错了？', 'Wrong payment?')}</button>}
          </div>
        ))}
      </div>
    </div>
  )
}
