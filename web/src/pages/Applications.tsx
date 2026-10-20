import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Notice, Tier } from '../components/ui'
import type { SubKey, SubStatus } from '../state/types'
import { N } from '../lib/format'
import { useBi, useT } from '../lib/i18n'
import { docsSent, prefillSubsidy, subDocsSent, submitLoan, submitSubsidy, SUB_NAME, withdrawLoan, withdrawSubsidy } from '../state/actions'
import { useApp } from '../state/store'

const ORDER = ['none', 'draft', 'submitted', 'approved', 'paid']

/** Where each application stands, and a plain-language history of what the assistant did. */
export default function Applications() {
  const t = useT()
  const bi = useBi()
  const app = useApp((s) => s.app)
  const subs = useApp((s) => s.subs)
  const log = useApp((s) => s.log)
  const waitingFam = useApp((s) => s.famPending && s.famReq?.then === 'submit')
  const famSub = useApp((s) => (s.famPending && s.famReq?.then === 'subsubmit' ? s.famReq.sub : null))
  const [tab, setTab] = useState<'apps' | 'log'>('apps')

  const at = app.loan === 'needdocs' ? 3 : ORDER.indexOf(app.loan)
  const Stage = (p: { i: number; zh: string; en: string; when?: string; bad?: boolean }) => {
    const st = at > p.i ? 'done' : at === p.i ? 'waiting' : 'pending'
    return (
      <div className={`node ${st}`}>
        <div className="dot">{st === 'done' ? '✓' : p.i}</div>
        <div>
          <div className="label" style={{ fontWeight: 650 }}>{t(p.zh, p.en)}</div>
          {p.when && <div className={`small ${p.bad ? 'err' : ''}`}>{p.when}</div>}
        </div>
      </div>
    )
  }
  const status = (
    { draft: waitingFam ? ['等女儿确认', 'Waiting for your daughter'] : ['等您确认发出', 'Waiting for you'], submitted: ['银行审核中', 'Bank reviewing'], needdocs: ['要补材料', 'Document needed'], approved: ['已批准', 'Approved'], paid: ['已到账', 'Paid out'] } as Record<string, [string, string]>
  )[app.loan]

  const subPill = (st: SubStatus, waiting: boolean) =>
    waiting ? t('等女儿确认', 'Waiting for your daughter') : ({ none: t('还没开始', 'Not started'), draft: t('等您确认提交', 'Waiting for you'), submitted: t('县里审核中', 'County reviewing'), needdocs: t('要补材料', 'Document needed'), approved: t('已批准', 'Approved') } as Record<SubStatus, string>)[st]
  const loanReady = app.loan === 'approved' || app.loan === 'paid'
  const SubCard = ({ k }: { k: SubKey }) => {
    const st = subs[k]
    const waiting = famSub === k
    const n = SUB_NAME[k]
    const sat = { none: 0, draft: 2, submitted: 3, needdocs: 3, approved: 5 }[st]
    const Stg = (p: { i: number; zh: string; en: string; when?: string; bad?: boolean }) => {
      const cls = sat > p.i ? 'done' : sat === p.i ? 'waiting' : 'pending'
      return (
        <div className={`node ${cls}`}>
          <div className="dot">{cls === 'done' ? '✓' : p.i}</div>
          <div>
            <div className="label" style={{ fontWeight: 650 }}>{t(p.zh, p.en)}</div>
            {p.when && <div className={`small ${p.bad ? 'err' : ''}`}>{p.when}</div>}
          </div>
        </div>
      )
    }
    const docNeed = k === 'farmland' ? t('一张承包合同的照片', 'a photo of the land contract') : t('一张贷款合同的照片', 'a photo of the loan contract')
    return (
      <div className="card">
        <div className="kv">
          <b style={{ fontSize: '1.1rem', color: 'var(--ink)' }}>{t(n[0], n[1])}</b>
          <span className="pill acc">{subPill(st, waiting)}</span>
        </div>
        {st === 'none' ? (
          <>
            <div className="small">{k === 'farmland' ? t('截止 2026-09-30 · 乡镇农业站', 'By 2026-09-30 · township agri office') : t('截止 2026-12-31 · 县农业农村局', 'By 2026-12-31 · county agriculture bureau')}</div>
            <div className="btns"><button className="btn pri" onClick={() => prefillSubsidy(k)}>{t('帮我申请补贴', 'Apply for this subsidy')}</button><Tier t="y" /></div>
          </>
        ) : (
          <>
            <div>
              <Stg i={1} zh="助手已帮您填好申请表" en="Assistant filled in the form" when={sat >= 3 ? undefined : t('还没有提交', 'Not submitted yet')} />
              <Stg i={2} zh="您和家人确认，正式提交到（模拟）县补贴系统" en="You and your family confirm; it is submitted to the (simulated) county system" when={sat >= 3 ? t('已提交', 'Submitted') : waiting ? t('等女儿在她的手机上确认', 'Waiting for your daughter on her phone') : k === 'interest' && !loanReady ? t('要等贷款批准后才能提交（贴息要有贷款合同）', 'Can be submitted once the loan is approved (the interest subsidy needs the loan contract)') : undefined} />
              <Stg i={3} zh="县里审核（约5–10个工作日）" en="County review (about 5–10 working days)" when={st === 'needdocs' ? t(`县里要您补：${docNeed}`, `The county needs: ${docNeed}`) : undefined} bad={st === 'needdocs'} />
              <Stg i={4} zh={k === 'farmland' ? '批准，补贴打到您的账户' : '批准，贷款利息补一半'} en={k === 'farmland' ? 'Approved, the subsidy is paid to your account' : 'Approved, half the loan interest is covered'} />
            </div>
            {st === 'draft' && !waiting && (
              <div className="btns">
                <button className="btn pri wide lg" disabled={k === 'interest' && !loanReady} onClick={() => submitSubsidy(k)}>{t('确认提交', 'Confirm and submit')}</button>
                <Tier t="r" />
              </div>
            )}
            {st === 'submitted' && <Notice>{t('县里正在审核，有结果会马上通知您。', 'The county is reviewing it. We will tell you as soon as there is a result.')}</Notice>}
            {st === 'needdocs' && (
              <>
                <div className="btns"><button className="btn pri wide lg" onClick={() => subDocsSent(k)}>{t('拍照上传', 'Take a photo and upload')}</button></div>
                <div className="small">{t('不会拍？可以带到乡镇农业站，或者“找人工”。', 'Not sure how? Bring it to the township office, or tap “Get a person”.')}</div>
              </>
            )}
            {st === 'approved' && <Notice>{k === 'farmland' ? t('已批准。补贴每亩100元，会打到您的账户。', 'Approved. 100 yuan per mu will be paid to your account.') : t('已批准。这笔贷款的利息，县里补一半。', 'Approved. The county covers half the interest on this loan.')}</Notice>}
            <div className="small"><b>{t('还需要您', 'Still needed from you')}</b>：{t('身份证（办理时出示，我们不保存）', 'ID card (shown in person; we never store it)')}</div>
            {st === 'draft' && !waiting && <div className="row"><button className="chip" onClick={() => withdrawSubsidy(k)}>{t('不要了，撤回', 'Withdraw')}</button></div>}
          </>
        )}
      </div>
    )
  }
  const tabs = (
    <div className="row">
      <button className={`chip ${tab === 'apps' ? 'on' : ''}`} onClick={() => setTab('apps')}>{t('我的申请', 'My applications')}</button>
      <button className={`chip ${tab === 'log' ? 'on' : ''}`} onClick={() => setTab('log')}>{t('助手帮您做过的事', 'What the assistant did')}</button>
    </div>
  )

  if (tab === 'log')
    return (
      <div className="page pad-ask">
        {tabs}
        <Notice>{t('助手每做一件事都记在这里，也记在不能改的审计记录里。', 'Everything the assistant does is listed here and in the tamper-evident audit log.')}</Notice>
        {log.length ? (
          <div className="list">
            {log.map((e, i) => (
              <div key={i} className="li">
                <span className="small" style={{ width: 52, flex: 'none' }}>{e.t}</span>
                <span className="grow"><b>{t(e.zh, e.en)}</b>{e.by && <><br /><span className="small">{bi(e.by)}</span></>}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="card ph"><b style={{ color: 'var(--ink)' }}>{t('还没有记录', 'Nothing yet')}</b><span className="small">{t('付一笔款、预填一份申请或开启税金罐，这里就会出现。', 'Make a payment, pre-fill an application or turn on the tax pot to see entries here.')}</span></div>
        )}
      </div>
    )

  return (
    <div className="page pad-ask">
      {tabs}
      <h2 className="lg">{t('贷款', 'Loans')}</h2>
      {app.loan === 'none' ? (
        <div className="card ph">
          <b style={{ color: 'var(--ink)' }}>{t('还没有贷款申请', 'No loan application yet')}</b>
          <span className="small">{t('在“补贴”页点“帮我预填申请”，助手会把表填好放在这里，等您确认。', 'Tap “Pre-fill my application” on the Support screen. The assistant fills the form and leaves it here for you.')}</span>
          <div className="btns"><Link to="/support" className="btn">{t('去补贴页', 'Go to Support')}</Link></div>
        </div>
      ) : (
        <div className="card em">
          <div className="kv">
            <b style={{ fontSize: '1.15rem', color: 'var(--ink)' }}>{t(`惠农流动贷 A · ${N(app.amount)}元 · 12个月`, `Agri loan A · ${N(app.amount)} yuan · 12 months`)}</b>
            <span className="pill acc">{t(status[0], status[1])}</span>
          </div>
          <div>
            <Stage i={1} zh="助手已帮您填好申请表" en="Assistant filled in the form" when={at >= 2 ? t('7月25日 14:02', '25 Jul 14:02') : t('7月25日 14:02 · 还没有发出', '25 Jul 14:02 · not sent')} />
            <Stage i={2} zh="您和家人确认，正式发出" en="You and your family confirm; it is sent" when={at >= 2 ? t('发给了模拟银行', 'Sent to the mock bank') : waitingFam ? t('等女儿在她的手机上确认', 'Waiting for your daughter on her phone') : undefined} />
            <Stage i={3} zh="银行审核（约1–3天）" en="Bank review (about 1–3 days)" when={app.loan === 'needdocs' ? t('银行要您补：近3个月平台收入截图', 'The bank needs: a screenshot of 3 months of platform income') : undefined} bad={app.loan === 'needdocs'} />
            <Stage i={4} zh="钱到账" en="Money arrives" when={app.loan === 'paid' ? t(`${N(app.amount)}元已到您账户`, `${N(app.amount)} yuan is in your account`) : undefined} />
          </div>
          {app.loan === 'draft' && !waitingFam && (
            <div className="btns"><button className="btn pri wide lg" onClick={submitLoan}>{t('确认发出', 'Confirm and send')}</button><Tier t="r" /></div>
          )}
          {app.loan === 'submitted' && <Notice>{t('银行正在审核，有结果会马上通知您。', 'The bank is reviewing it. We will tell you as soon as there is a result.')}</Notice>}
          {app.loan === 'needdocs' && (
            <>
              <div className="btns"><button className="btn pri wide lg" onClick={docsSent}>{t('拍照上传', 'Take a photo and upload')}</button></div>
              <div className="small">{t('不会拍？可以拿到银行网点，或者“找人工”。', 'Not sure how? Bring it to a branch, or tap “Get a person”.')}</div>
            </>
          )}
          {app.loan === 'approved' && <Notice>{t('银行已批准，钱会在1个工作日内到账。', 'Approved. The money arrives within 1 working day.')}</Notice>}
          <details>
            <summary className="small" style={{ cursor: 'pointer' }}>{t('助手已帮您填好的内容', 'What the assistant filled in')}</summary>
            <div className="small" style={{ marginTop: 6 }}>{t('姓名：王建国 · 账户：尾号 0001 · 近12个月销售：220,000元 · 用途：收购蜂蜜周转资金', 'Name: Wang Jianguo · Account ending 0001 · 12-month sales: 220,000 · Purpose: working capital for buying honey')}</div>
          </details>
          <div className="small"><b>{t('还需要您', 'Still needed from you')}</b>：{t('身份证（办理时出示，我们不保存）、经营证明', 'ID card (shown in person; we never store it), proof of business')}</div>
          {app.loan === 'draft' && !waitingFam && <div className="row"><button className="chip" onClick={withdrawLoan}>{t('不要了，撤回', 'Withdraw')}</button></div>}
        </div>
      )}

      <h2 className="lg">{t('补贴（交给县补贴系统）', 'Subsidies (to the county subsidy system)')}</h2>
      <Notice>{t('补贴交给县里的补贴系统（这里是模拟的）。我们帮您填好并提交，提交前要您和家人确认。', 'Subsidies go to the county subsidy system (simulated here). We fill in and submit the form for you; you and your family confirm before it is sent.')}</Notice>
      <SubCard k="interest" />
      <SubCard k="farmland" />
    </div>
  )
}
