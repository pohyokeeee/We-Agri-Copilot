import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Field, Notice, Tier } from '../components/ui'
import { N } from '../lib/format'
import { useT } from '../lib/i18n'
import { prefill, setBorrow, setMu } from '../state/actions'
import { useApp } from '../state/store'

const Pol = (p: { name: string; benefit: ReactNode; deadline: string; met: string[]; docs: string; where: string; extra?: ReactNode }) => {
  const t = useT()
  return (
    <div className="card">
      <div className="kv">
        <b style={{ fontSize: '1.1rem', color: 'var(--ink)' }}>{p.name}</b>
        <span className="pill acc">{t('可能符合', 'May qualify')}</span>
      </div>
      <div>{p.benefit}</div>
      {p.extra}
      <div className="small">{t('截止', 'Deadline')}: {p.deadline} · {p.where}</div>
      <div className="small">{p.met.map((m) => '✓ ' + m).join('  ')}</div>
      <div className="small"><b>{t('要准备', 'Bring')}</b>: {p.docs}</div>
    </div>
  )
}

/** Subsidies the user may get (with their own amount) and cheaper loans (with the cost after the interest subsidy). */
export default function Support() {
  const t = useT()
  const mu = useApp((s) => s.mu)
  const b = useApp((s) => s.borrow)
  const loan = useApp((s) => s.app.loan)
  const [muIn, setMuIn] = useState('')
  const [bIn, setBIn] = useState('')

  const aCost = b * 0.0435
  const bCost = b * 0.051 * 0.5 + b * 0.005

  const muBlock = mu ? (
    <div className="row"><button className="chip" onClick={() => setMu(null)}>{t('改亩数', 'Change mu')}</button></div>
  ) : (
    <div className="stack">
      <Field id="mu" label={['您有几亩承包地？', 'How many mu of contracted land do you have?']} placeholder={['例如：12', 'e.g. 12']} numeric value={muIn} onChange={setMuIn} />
      <button className="btn" onClick={() => Number(muIn) > 0 && setMu(Number(muIn))}>{t('算一下', 'Calculate')}</button>
    </div>
  )

  return (
    <div className="page pad-ask">
      <Notice>{t('县里的政策表是模拟的。“可能符合”不是批准。', 'The county policy table is simulated. “May qualify” is not approval.')}</Notice>
      <div className="grid2">
        <Pol
          name={t('耕地地力保护补贴', 'Farmland protection subsidy')}
          benefit={mu ? <>{t(`您有${mu}亩 → 约`, `${mu} mu → about `)}<b style={{ color: 'var(--ink)' }}>{t(`${N(mu * 100)}元`, `${N(mu * 100)} yuan`)}</b></> : t('每亩100元', '100 yuan per mu')}
          deadline="2026-09-30"
          met={[t('本县农户', 'Farmer in this county'), t('有承包地', 'Has contracted land')]}
          docs={t('身份证、承包合同、银行卡', 'ID, land contract, bank card')}
          where={t('乡镇农业站', 'Township agri office')}
          extra={muBlock}
        />
        <Pol
          name={t('农业经营流动资金贴息', 'Working-capital interest subsidy')}
          benefit={t('贷款利息补一半，最多5,000元', 'Half the loan interest, up to 5,000 yuan')}
          deadline="2026-12-31"
          met={[t('农业经营者', 'Agricultural operator'), t('有12个月销售记录', '12 months of sales record')]}
          docs={t('销售记录、贷款合同', 'Sales record, loan contract')}
          where={t('县农业农村局', 'County agriculture bureau')}
        />
      </div>

      <h2 className="lg">{t('如果您加入合作社', 'If you join a co-op')}</h2>
      <div className="card ph">
        <b style={{ color: 'var(--ink)' }}>{t('农民专业合作社发展资金', 'Co-op development fund')}</b>
        <span>{t('一次最多20,000元 · 截止 2026-10-31', 'Up to 20,000 yuan once · deadline 2026-10-31')}</span>
        <span className="small">{t('✗ 需要是合作社成员', '✗ Requires co-op membership')}</span>
      </div>

      <h2 className="lg">{t('便宜的农业贷款', 'Cheaper farm loans')}</h2>
      <div className="card">
        <div className="kv"><span>{t('借多少？（按收购可能差的钱算）', 'How much? (based on your likely buying gap)')}</span><b className="mid" style={{ color: 'var(--ink)' }}>{N(b)}</b></div>
        <Field id="borrow" label={['想借别的金额？', 'A different amount?']} placeholder={['输入金额', 'Enter amount']} numeric value={bIn} onChange={setBIn} />
        <button className="btn" onClick={() => Number(bIn) > 0 && setBorrow(Number(bIn))}>{t('重新算', 'Recalculate')}</button>
      </div>
      <div className="tbl-x">
        <table style={{ minWidth: 420 }}>
          <thead><tr><th></th><th>{t('惠农流动贷 A', 'Agri loan A')}</th><th>{t('蜂农季节贷 B', 'Season loan B')}</th></tr></thead>
          <tbody>
            <tr><th>{t('年利率 · 期限', 'Rate · term')}</th><td>4.35% · 12{t('个月', ' mo')}</td><td>5.10% · 6{t('个月', ' mo')}</td></tr>
            <tr><th>{t('利息 + 手续费', 'Interest + fee')}</th><td className="num">{N(aCost)}</td><td className="num">{N(bCost)}</td></tr>
            <tr><th>{t('贴息后', 'After subsidy')}</th><td className="num"><b>{N(aCost / 2)}</b></td><td className="num"><b>{N(bCost - b * 0.051 * 0.25)}</b></td></tr>
          </tbody>
        </table>
      </div>

      {loan === 'none' ? (
        <div className="card em">
          <div>{t('帮您把申请表先填好，不会发出。发出前还要您和家人确认。', 'We pre-fill the form. Nothing is sent until you and your family confirm.')}</div>
          <div className="btns"><button className="btn pri wide lg" onClick={prefill}>{t('帮我预填申请', 'Pre-fill my application')}</button><Tier t="y" /></div>
        </div>
      ) : (
        <div className="card em">
          <div className="kv"><b style={{ color: 'var(--ink)' }}>✓ {t('申请表已填好', 'Application filled in')}</b><span className="pill acc">{t('在“我的申请”里', 'In My applications')}</span></div>
          <div className="btns"><Link to="/applications" className="btn pri wide lg">{t('看申请进度', 'See its progress')}</Link></div>
        </div>
      )}
    </div>
  )
}
