import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BigOption, Field, InfoFoot, StepHead, Term, Tier } from '../components/ui'
import { N } from '../lib/format'
import { useT } from '../lib/i18n'
import { askTaxPot, saveToRecord } from '../state/actions'
import { useApp } from '../state/store'

type Kind = 'bought' | 'sold' | null
type What = 'resale' | 'supplies' | 'own' | 'processed' | 'unknown' | null

/** Guided tax check: what happened -> what kind -> what it means. Every step has an "enter it yourself / not sure" way out. */
export default function TaxCheck() {
  const t = useT()
  const taxRule = useApp((s) => s.taxRule)
  const [step, setStep] = useState(1)
  const [kind, setKind] = useState<Kind>(null)
  const [what, setWhat] = useState<What>(null)
  const [custom, setCustom] = useState(false)
  const [entry, setEntry] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [f, setF] = useState({ what: '', who: '', amt: '', day: '' })

  const reset = () => {
    setStep(1); setKind(null); setWhat(null); setCustom(false); setEntry(null); setSaved(false); setF({ what: '', who: '', amt: '', day: '' })
  }
  const back = () => {
    setStep((s) => Math.max(1, s - 1))
    if (step === 2) { setKind(null); setEntry(null); setCustom(false) }
    setSaved(false)
  }
  const choose = (w: Exclude<What, null>) => { setWhat(w); setStep(3); setSaved(false) }
  const bought = kind === 'bought'

  const result: Record<Exclude<What, null>, { title: ReactNode; body: ReactNode; rows: [ReactNode, ReactNode][]; rule: string }> = {
    resale: {
      title: <>{t('这批蜂蜜卖出去，算', 'When this honey is sold, it counts as ')}<Term k="resale" /></>,
      body: <>{t('按规则，农民卖自己产的初级农产品免征', 'By the rules, farmers’ own primary produce is exempt from ')}<Term k="vat" />{t('；收来再卖的不在其内。', '; produce bought in and resold is not.')}</>,
      rows: [[t('本季度转卖已卖', 'Resale sold this quarter'), '22,551'], [<><Term k="threshold" />{t('（每季度）', ' (per quarter)')}</>, '300,000'], [t('规则', 'Rule'), t('低于门槛免征', 'Exempt below threshold')]],
      rule: 'vat_law_art24_own_produce · vat_ann2026_no10_threshold',
    },
    supplies: {
      title: t('这是生产用的开支', 'This is a production cost'),
      body: t('瓶罐、标签、饲料是成本，不是收入。留好凭证，算利润时可以减掉。', 'Jars, labels and feed are costs, not income. Keep the receipt; it counts against profit.'),
      rows: [[t('本季度这类开支', 'Such costs this quarter'), '1,860']],
      rule: 'eit_cost_records',
    },
    own: {
      title: t('自家产的蜂蜜', 'Your own honey'),
      body: <>{t('按规则，农民卖自己产的初级农产品免征', 'By the rules, farmers’ own primary produce is exempt from ')}<Term k="vat" />{t('。留着蜂箱数和产量记录作凭证。', '. Keep hive and yield records as evidence.')}</>,
      rows: [[t('本季度自产销售', 'Own-produce sales this quarter'), '31,837']],
      rule: 'vat_law_art24_own_produce',
    },
    processed: {
      title: t('加工过的产品', 'A processed product'),
      body: t('加工过的可能不算初级农产品，免征不一定适用。', 'Processed goods may not count as primary produce, so the exemption may not apply.'),
      rows: [[t('状态', 'Status'), <Term key="tbc" k="tbc" />]],
      rule: 'processed_primary_status',
    },
    unknown: {
      title: t('先记下，标成“待确认”', 'Recorded and marked “to be confirmed”'),
      body: t('是自家产的、收来再卖的，还是自用的，会影响税。您想起来可以随时改；也可以打 12366 问。', 'Whether it is your own, resold, or for your own use affects tax. You can change it any time, or ask 12366.'),
      rows: [[t('状态', 'Status'), t('待确认', 'To be confirmed')]],
      rule: 'needs_confirmation',
    },
  }

  return (
    <div className="page pad-ask">
      <StepHead title={t('税务合规检查', 'Tax compliance check')} step={step} of={3} onBack={back} chips={entry ? <span className="chip static">{t('自己填的', 'Own entry')}</span> : null} />

      {step === 1 && (
        <>
          <h2 className="lg">{t('发生了什么？', 'What happened?')}</h2>
          <div className="grid2">
            <BigOption onClick={() => { setKind('bought'); setStep(2) }} title={t('我买了东西', 'I bought something')} sub={t('比如收了邻居的蜂蜜、买了瓶罐', 'e.g. neighbours’ honey, jars and labels')} />
            <BigOption onClick={() => { setKind('sold'); setStep(2) }} title={t('我卖了东西', 'I sold something')} sub={t('平台订单、直播、熟人买', 'Platform, livestream or direct sales')} />
            <Link to="/tax" className="li press boxed">
              <span className="grow">
                <b style={{ fontSize: '1.1rem' }}>{t('只想看看我合不合规', 'Just check where I stand')}</b>
                <br />
                <span className="small">{t('本季度情况和3件要知道的事', 'This quarter and 3 things to know')}</span>
              </span>
              <span className="chev">›</span>
            </Link>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h2 className="lg">{bought ? t('买的是什么？', 'What did you buy?') : t('卖的东西是哪里来的？', 'Where did it come from?')}</h2>
          {entry ? (
            <div className="card em">
              <div className="small">{t('您填的这一笔', 'The entry you made')}</div>
              <b style={{ color: 'var(--ink)' }}>{entry}</b>
              <div className="row"><button className="chip" onClick={() => { setEntry(null); setCustom(true) }}>{t('改一下', 'Edit')}</button></div>
            </div>
          ) : custom ? (
            <div className="card">
              <b style={{ color: 'var(--ink)' }}>{t('自己填一笔', 'Enter it yourself')}</b>
              <Field id="txWhat" label={bought ? ['买了什么', 'What did you buy?'] : ['卖了什么', 'What did you sell?']} placeholder={['例如：老李家的蜂蜜 30斤', 'e.g. 30 jin of Old Li’s honey']} value={f.what} onChange={(v) => setF({ ...f, what: v })} />
              <Field id="txWho" label={bought ? ['跟谁买的', 'Bought from whom?'] : ['卖给谁 / 哪个平台', 'Sold to whom / which platform?']} placeholder={['名字或外号', 'Name or nickname']} value={f.who} onChange={(v) => setF({ ...f, who: v })} />
              <Field id="txAmt" label={['多少钱（元）', 'How much (yuan)?']} placeholder={['例如：1200', 'e.g. 1200']} numeric value={f.amt} onChange={(v) => setF({ ...f, amt: v })} />
              <Field id="txDay" label={['哪天', 'Which day?']} placeholder={['例如：7月23日', 'e.g. 23 Jul']} value={f.day} onChange={(v) => setF({ ...f, day: v })} />
              <div className="btns">
                <button className="btn pri wide" onClick={() => { setEntry([f.what || t('（没写是什么）', '(no description)'), f.who, f.amt ? N(Number(f.amt)) + t('元', ' yuan') : '', f.day].filter(Boolean).join(' · ')); setCustom(false) }}>
                  {t('就是这笔', 'Use this entry')}
                </button>
                <button className="btn" onClick={() => setCustom(false)}>{t('取消', 'Cancel')}</button>
              </div>
            </div>
          ) : (
            <div className="card ph">
              <div className="small">{bought ? t('我们在您的账户里找到一笔：', 'We found this payment in your account:') : t('最近的一笔订单：', 'Latest order:')}</div>
              <b style={{ fontSize: '1.1rem', color: 'var(--ink)' }}>
                {bought ? t('7月24日 · 付给 李国强（老李） · 4,990元', '24 Jul · to Li Guoqiang (Old Li) · 4,990 yuan') : t('7月20日 · 直播间 · 2罐 · 136元', '20 Jul · livestream · 2 jars · 136 yuan')}
              </b>
              <div className="row"><button className="chip" onClick={() => setCustom(true)}>{t('不是这笔？自己填一笔', 'Not this one? Enter it yourself')}</button></div>
            </div>
          )}
          <div className="grid2">
            {bought ? (
              <>
                <BigOption onClick={() => choose('resale')} title={t('收邻居的蜂蜜，准备再卖', 'Neighbours’ honey, to sell on')} sub={t('以后卖出去算“转卖”', 'Counts as resale when sold on')} />
                <BigOption onClick={() => choose('supplies')} title={t('瓶罐、标签、蜂饲料', 'Jars, labels, hive feed')} sub={t('生产用的东西', 'Things used to produce')} />
                <BigOption dashed onClick={() => choose('unknown')} title={t('别的东西 / 说不清', 'Something else / not sure')} sub={t('我们先记下，标成待确认', 'We record it and mark it to be confirmed')} />
              </>
            ) : (
              <>
                <BigOption onClick={() => choose('own')} title={t('自家养蜂产的', 'From my own bees')} />
                <BigOption onClick={() => choose('resale')} title={t('收邻居的再卖', 'Bought from neighbours, sold on')} />
                <BigOption onClick={() => choose('processed')} title={t('加工过的', 'Processed')} sub={t('比如蜂蜜膏、蜂蜜酒', 'e.g. honey paste, mead')} />
                <BigOption dashed onClick={() => choose('unknown')} title={t('别的 / 说不清', 'Something else / not sure')} />
              </>
            )}
          </div>
        </>
      )}

      {step === 3 && what && (
        <>
          {entry && <div className="small">{t('这一笔：', 'This entry: ')}{entry}</div>}
          <h2 className="lg">{t('这对税有什么影响', 'What this means for tax')}</h2>
          <div className="card em">
            <b style={{ fontSize: '1.2rem', color: 'var(--ink)' }}>{result[what].title}</b>
            <div>{result[what].body}</div>
            {result[what].rows.map((r, i) => (
              <div key={i} className="kv"><span>{r[0]}</span><b style={{ color: 'var(--ink)' }}>{r[1]}</b></div>
            ))}
            <div className="rule">{result[what].rule}</div>
          </div>
          <h2>{t('您可以', 'You can')}</h2>
          <div className="list">
            <div className="li">
              <span className="grow"><b>{t('把这笔存进记录，当作凭证', 'Save this to your record as evidence')}</b></span>
              <Tier t="g" />
              <button className="btn" onClick={() => { if (!saved) saveToRecord(entry); setSaved(true) }}>{saved ? t('已保存', 'Saved') : t('保存', 'Save')}</button>
            </div>
            {what === 'resale' && (
              <div className="li">
                <span className="grow"><b>{t('每笔转卖收入自动留1%到税金罐', 'Set aside 1% of each resale payout in a tax pot')}</b><br /><span className="small">{t('钱还在您账户里', 'The money stays in your account')}</span></span>
                {taxRule ? <span className="pill acc">{t('已开启', 'On')}</span> : (<><Tier t="y" /><button className="btn" onClick={askTaxPot}>{t('开启', 'Turn on')}</button></>)}
              </div>
            )}
            <Link to="/tax" className="li press"><span className="grow"><b>{t('看我的税务情况', 'See my tax situation')}</b></span><span className="chev">›</span></Link>
            <button className="li press" onClick={reset}><span className="grow"><b>{t('再记一笔', 'Record another one')}</b></span><span className="chev">›</span></button>
          </div>
          <InfoFoot />
        </>
      )}
    </div>
  )
}
