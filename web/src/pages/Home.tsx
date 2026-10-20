import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BALANCE, forecast } from '../data/mock'
import { N } from '../lib/format'
import { useT } from '../lib/i18n'
import { planOpen, SUB_NAME } from '../state/actions'
import { useApp } from '../state/store'

const Task = (p: { to: string; title: ReactNode; sub: ReactNode }) => (
  <Link to={p.to} className="li press boxed">
    <i style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--accent-soft)', flex: 'none' }} />
    <span className="grow">
      <b style={{ fontSize: '1.1rem' }}>{p.title}</b>
      <br />
      <span className="small">{p.sub}</span>
    </span>
    <span className="chev">›</span>
  </Link>
)
const Alert = (p: { to: string; mark: string; title: string; sub: string }) => (
  <Link to={p.to} className="li press">
    <b style={{ width: 18 }}>{p.mark}</b>
    <span className="grow">
      <b>{p.title}</b>
      <br />
      <span className="small">{p.sub}</span>
    </span>
    <span className="chev">›</span>
  </Link>
)

/** Task-first home: what would you like to do, what is unfinished, what we noticed. The balance sits right under the greeting. */
export default function Home() {
  const t = useT()
  const { plan, famPending, famReq, loan, season, sentToday, taxRule, subs } = useApp((s) => ({
    plan: s.plan, famPending: s.famPending, famReq: s.famReq, loan: s.app.loan, season: s.season, sentToday: s.sentToday, taxRule: s.taxRule, subs: s.subs,
  }))
  const f = forecast(season)
  const pending: { title: string; sub: string; to: string }[] = []
  if (planOpen(plan) && plan) {
    const w = plan.nodes.find((n) => n.st === 'waiting')
    pending.push({
      title: plan.title ? t(plan.title[0], plan.title[1]) : plan.kind === 'sup' ? t('六家付款计划', 'Six-family payment plan') : t('收蜂蜜准备计划', 'Honey-season plan'),
      sub: plan.status === 'paused' ? t('已暂停', 'Paused') : w ? t(`${w.id} 等您确认`, `${w.id} waiting for you`) : '',
      to: '/plan',
    })
  }
  if (famPending && famReq) pending.push({ title: t('等女儿确认', 'Waiting for your daughter'), sub: t(famReq.zh, famReq.en), to: famReq.payInfo ? '/pay' : famReq.then === 'submit' || famReq.then === 'subsubmit' ? '/applications' : '/plan' })
  if (loan === 'draft' && !famPending) pending.push({ title: t('贷款申请已填好', 'Loan application filled in'), sub: t('等您确认发出', 'Waiting for you to send it'), to: '/applications' })
  for (const k of ['farmland', 'interest'] as const) {
    const n = SUB_NAME[k]
    if (subs[k] === 'draft' && !(famPending && famReq?.sub === k)) pending.push({ title: t(`${n[0]}申请已填好`, `${n[1]} application filled in`), sub: t('等您确认提交', 'Waiting for you to submit it'), to: '/applications' })
    if (subs[k] === 'needdocs') pending.push({ title: t(`县里要您补材料：${n[0]}`, `The county needs a document: ${n[1]}`), sub: t('拍一张合同照片上传', 'Upload a photo of the contract'), to: '/applications' })
  }
  if (loan === 'needdocs') pending.push({ title: t('银行要您补材料', 'The bank needs a document'), sub: t('补一张近3个月平台收入截图', 'Add a screenshot of 3 months of platform income'), to: '/applications' })

  return (
    <div className="page pad-ask">
      <section>
        <h1>{t('王大叔，下午好', 'Good afternoon, Uncle Wang')}</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          {t('王家蜂场 · 2026年7月25日', 'Wang Family Apiary · 25 Jul 2026')} ·{' '}
          <Link to="/welcome" className="chip" style={{ marginLeft: 4 }}>
            {t('元农民能做什么？', 'What can Yuan Nongmin do?')}
          </Link>
        </p>
      </section>

      <div className="card" style={{ marginTop: 16, gap: 6 }}>
        <span className="muted">{t('账户余额（模拟账户）', 'Balance (simulated account)')}</span>
        <span className="big" style={{ color: 'var(--ink)' }}>{N(BALANCE - sentToday)}</span>
        <span className="small">
          {t('已预留', 'Set aside')} {taxRule ? '226' : '0'} · {t('可以用的', 'Available')} {N(BALANCE - sentToday - (taxRule ? 226 : 0))}
        </span>
      </div>

      {pending.length > 0 && (
        <>
          <h2 className="lg">{t('进行中', 'In progress')}</h2>
          <div className="list">
            {pending.map((p, i) => (
              <div key={i} className="li">
                <span className="grow">
                  <b>{p.title}</b>
                  <br />
                  <span className="small">{p.sub}</span>
                </span>
                <Link className="btn pri" to={p.to}>
                  {t('继续', 'Continue')}
                </Link>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="lg">{t('您今天想做什么？', 'What would you like to do today?')}</h2>
      <div className="grid2">
        <Task to="/tax/check" title={t('税务：记一笔买卖，看看合不合规', 'Tax: record a purchase or sale, check you’re within the rules')} sub={t('一步一步，用您自己的数字', 'Step by step, with your own numbers')} />
        <Task to="/support" title={t('看看我能领什么补贴', 'See what support I may get')} sub={t('补贴、贷款贴息、贷款申请', 'Subsidies, interest subsidies, loan application')} />
        <Task to="/season" title={t('准备收购的钱', 'Get cash ready for buying')} sub={t('7天后开始收邻居蜂蜜', 'Buying neighbours’ honey starts in 7 days')} />
        <Task to="/pay" title={t('给人付款', 'Pay someone')} sub={t('付蜂蜜钱、瓶罐钱、别的钱', 'Honey, jars, or anything else')} />
        <Task to="/applications" title={t('看我的申请进度', 'Track my applications')} sub={t('贷款、补贴办到哪一步了', 'Where your loan and subsidy applications stand')} />
        <Task to="/tax" title={t('我的税务情况', 'My tax situation')} sub={t('本季度、平台报的和您的记录', 'This quarter, platform reports and your record')} />
      </div>

      <h2 className="lg">{t('我们帮您发现的', 'What we noticed for you')}</h2>
      <div className="list">
        {f.gapExp > 0 && <Alert to="/season" mark="▲" title={t(`收购的钱可能差约${N(f.gapExp)}元`, `You may be about ${N(f.gapExp)} short for buying`)} sub={t('7天后开始 · 点这里看办法', 'Starts in 7 days · tap for options')} />}
        <Alert to="/support" mark="●" title={t('2项补贴可能符合', '2 subsidies may apply to you')} sub={t('贷款利息能补一半', 'Half your loan interest could be covered')} />
        <Alert to="/tax" mark="▲" title={t('转卖的蜂蜜占39%', 'Resold honey is 39% of sales')} sub={t('这部分不算自产免征，点这里看看', 'This part is not covered by the own-produce exemption')} />
      </div>
    </div>
  )
}
