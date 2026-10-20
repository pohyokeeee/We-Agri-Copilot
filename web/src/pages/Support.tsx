import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Field, Notice, Tier } from '../components/ui'
import { N } from '../lib/format'
import { useT } from '../lib/i18n'
import { prefill, prefillSubsidy, setBorrow, setMu } from '../state/actions'
import { useApp } from '../state/store'

const Pol = (p: { name: string; benefit: ReactNode; deadline: string; met: string[]; docs: string; where: string; extra?: ReactNode; action?: ReactNode }) => {
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
      {p.action}
    </div>
  )
}

/** Subsidies the user may get (with their own amount) and the loan application (with the cost after the interest subsidy). */
export default function Support() {
  const t = useT()
  const mu = useApp((s) => s.mu)
  const b = useApp((s) => s.borrow)
  const loan = useApp((s) => s.app.loan)
  const subs = useApp((s) => s.subs)
  const [muIn, setMuIn] = useState('')
  const [bIn, setBIn] = useState('')
  const [editing, setEditing] = useState(false)

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
      <h2 className="lg">{t('补贴（交给政府部门）', 'Subsidies (handed to government offices)')}</h2>
      <div className="grid2">
        <Pol
          name={t('耕地地力保护补贴', 'Farmland protection subsidy')}
          benefit={mu ? <>{t(`您有${mu}亩 → 约`, `${mu} mu → about `)}<b style={{ color: 'var(--ink)' }}>{t(`${N(mu * 100)}元`, `${N(mu * 100)} yuan`)}</b></> : t('每亩100元', '100 yuan per mu')}
          deadline="2026-09-30"
          met={[t('本县农户', 'Farmer in this county'), t('有承包地', 'Has contracted land')]}
          docs={t('身份证、承包合同、银行卡', 'ID, land contract, bank card')}
          where={t('乡镇农业站', 'Township agri office')}
          extra={muBlock}
          action={
            subs.farmland === 'none' ? (
              <div className="stack">
                <div className="btns"><button className="btn pri wide" onClick={() => prefillSubsidy('farmland')}>{t('帮我申请补贴', 'Apply for this subsidy')}</button><Tier t="y" /></div>
                <div className="small">{t('我们帮您填好申请表，提交到（模拟）县补贴系统。提交前要您和家人确认。', 'We fill in the form and submit it to the (simulated) county subsidy system. You and your family confirm before it is sent.')}</div>
              </div>
            ) : (
              <div className="kv">
                <b style={{ color: 'var(--ink)' }}>✓ {subs.farmland === 'draft' ? t('申请表已填好，等您确认提交', 'Form filled in, waiting for you to submit') : subs.farmland === 'approved' ? t('县里已批准', 'Approved by the county') : subs.farmland === 'needdocs' ? t('县里要您补材料', 'The county needs a document') : t('已提交，县里审核中', 'Submitted, the county is reviewing')}</b>
                <Link to="/applications" className="chip">{t('看进度', 'See progress')}</Link>
              </div>
            )
          }
        />
        <Pol
          name={t('农业经营流动资金贴息', 'Working-capital interest subsidy')}
          benefit={t('贷款利息补一半，最多5,000元', 'Half the loan interest, up to 5,000 yuan')}
          deadline="2026-12-31"
          met={[t('农业经营者', 'Agricultural operator'), t('有12个月销售记录', '12 months of sales record')]}
          docs={t('销售记录、贷款合同', 'Sales record, loan contract')}
          where={t('县农业农村局', 'County agriculture bureau')}
          action={
            subs.interest === 'none' ? (
              <div className="stack">
                <div className="btns"><button className="btn pri wide" onClick={() => prefillSubsidy('interest')}>{t('帮我申请补贴', 'Apply for this subsidy')}</button><Tier t="y" /></div>
                <div className="small">{t('我们帮您填好申请表，提交到（模拟）县补贴系统。提交前要您和家人确认。', 'We fill in the form and submit it to the (simulated) county subsidy system. You and your family confirm before it is sent.')}</div>
              </div>
            ) : (
              <div className="kv">
                <b style={{ color: 'var(--ink)' }}>✓ {subs.interest === 'draft' ? t('申请表已填好，等您确认提交', 'Form filled in, waiting for you to submit') : subs.interest === 'approved' ? t('县里已批准', 'Approved by the county') : subs.interest === 'needdocs' ? t('县里要您补材料', 'The county needs a document') : t('已提交，县里审核中', 'Submitted, the county is reviewing')}</b>
                <Link to="/applications" className="chip">{t('看进度', 'See progress')}</Link>
              </div>
            )
          }
        />
      </div>

      <h2 className="lg">{t('如果您加入合作社', 'If you join a co-op')}</h2>
      <div className="card ph">
        <b style={{ color: 'var(--ink)' }}>{t('农民专业合作社发展资金', 'Co-op development fund')}</b>
        <span>{t('一次最多20,000元 · 截止 2026-10-31', 'Up to 20,000 yuan once · deadline 2026-10-31')}</span>
        <span className="small">{t('✗ 需要是合作社成员', '✗ Requires co-op membership')}</span>
      </div>

      <h2 className="lg">{t('贷款申请（交给银行）', 'Loan application (to the bank)')}</h2>
      <div className="card">
        <div>{t('如果收购的钱不够，可以向银行申请贷款。我们帮您把申请表填好，发出前要您和家人确认。现在还没申请，下面只是算一算要花多少利息。', 'If the buying money is not enough, you can apply to the bank for a loan. We fill in the form, and nothing is sent until you and your family confirm. You have not applied yet: below is only what the interest would cost.')}</div>
        <div className="kv"><span>{t('申请金额', 'Amount to apply for')}</span><b className="mid" style={{ color: 'var(--ink)' }}>{N(b)}</b></div>
        <div className="small">{t('7,500 是收购最多可能差的钱。', '7,500 is the most you might be short when buying.')}</div>
        {editing ? (
          <>
            <div className="row">
              {[3000, 5000, 7500, 10000].map((a) => (
                <button key={a} className={`chip ${b === a ? 'on' : ''}`} onClick={() => { setBorrow(a); setBIn('') }}>{N(a)}</button>
              ))}
            </div>
            <Field id="borrow" label={['或者写别的金额', 'Or enter another amount']} placeholder={['输入金额', 'Enter amount']} numeric value={bIn} onChange={(v) => { setBIn(v); if (Number(v) > 0) setBorrow(Number(v)) }} />
            <div className="btns"><button className="btn pri" onClick={() => setEditing(false)}>{t('好了', 'Done')}</button></div>
          </>
        ) : (
          <div className="row"><button className="chip" onClick={() => setEditing(true)}>{t('改金额', 'Change amount')}</button></div>
        )}
      </div>
      <div className="list">
        <div className="li">
          <span className="grow">
            <b>{t('惠农流动贷 A', 'Agri loan A')}</b> <span className="small">{t('年利率 4.35%，12个月', '4.35% a year, 12 months')}</span>
            <br />
            <span className="small">{t(`借${N(b)}元，利息约 ${N(aCost)} 元；有贴息后约 `, `Borrow ${N(b)}: about ${N(aCost)} in interest; with the subsidy about `)}<b style={{ color: 'var(--ink)' }}>{N(aCost / 2)}</b>{t(' 元', '')}</span>
          </span>
        </div>
        <div className="li">
          <span className="grow">
            <b>{t('蜂农季节贷 B', 'Season loan B')}</b> <span className="small">{t('年利率 5.10%，6个月，手续费 0.5%', '5.10% a year, 6 months, 0.5% fee')}</span>
            <br />
            <span className="small">{t(`借${N(b)}元，利息和手续费约 ${N(bCost)} 元；有贴息后约 `, `Borrow ${N(b)}: about ${N(bCost)} in interest and fee; with the subsidy about `)}<b style={{ color: 'var(--ink)' }}>{N(bCost - b * 0.051 * 0.25)}</b>{t(' 元', '')}</span>
          </span>
        </div>
      </div>
      <div className="small">{t('贴息 = 县里替您付一半利息（模拟）。只是了解，不是建议您借。', 'Subsidy = the county pays half the interest (simulated). For information, not a suggestion to borrow.')}</div>

      {loan === 'none' ? (
        <div className="card em">
          <div>{t('帮您把申请表先填好，不会发出。发出前还要您和家人确认。', 'We pre-fill the form. Nothing is sent until you and your family confirm.')}</div>
          <div className="btns"><button className="btn pri wide lg" onClick={prefill}>{t('帮我预填贷款申请', 'Pre-fill my loan application')}</button><Tier t="y" /></div>
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
