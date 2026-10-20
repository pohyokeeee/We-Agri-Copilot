import { Link } from 'react-router-dom'
import { Notice, Tier } from '../components/ui'
import { useT } from '../lib/i18n'
import { approveNode, cmdPlan } from '../state/actions'
import { useApp } from '../state/store'

type Cmd = 'pause' | 'resume' | 'noloan' | 'cancel' | 'human'

/** The agent's plan, shown before anything runs: each step with its approval level, and commands that undo only what you ask. */
export default function Plan() {
  const t = useT()
  const p = useApp((s) => s.plan)
  const famWait = useApp((s) => s.famPending && s.famReq?.then === 'node')

  if (!p)
    return (
      <div className="page pad-ask">
        <div className="card ph">
          <b style={{ color: 'var(--ink)' }}>{t('现在没有进行中的计划', 'No plan in progress')}</b>
          <span className="small">{t('在“收购”页点“让助手帮我准备”，或者按住说“下个月要收蜂蜜了，帮我准备一下”。', 'Tap “Let the assistant prepare” on Buying, or hold and say “Get me ready for next month’s honey buying”.')}</span>
          <div className="btns"><Link to="/season" className="btn">{t('去收购页', 'Go to Buying')}</Link></div>
        </div>
      </div>
    )

  const stL = { done: ['已完成', 'Done'], waiting: ['等您确认', 'Waiting for you'], pending: ['还没开始', 'Not started'], undone: ['已撤销', 'Undone'], dropped: ['不做了', 'Dropped'] } as const
  const status = { waiting: ['进行中', 'In progress'], paused: ['已暂停', 'Paused'], cancelled: ['已全部撤销', 'All undone'], handover: ['已转给工作人员', 'Handed to a person'], done: ['都做完了', 'All done'] }[p.status]
  const Cmd = (c: { v: Cmd; zh: string; en: string }) => <button className="btn" onClick={() => cmdPlan(c.v)}>{t(c.zh, c.en)}</button>

  return (
    <div className="page pad-ask">
      <div className="card">
        <div className="small">{t('您说的', 'You said')}</div>
        <div style={{ fontSize: '1.2rem', fontWeight: 650, color: 'var(--ink)' }}>“{t(p.utter[0], p.utter[1])}”</div>
        <div className="kv"><span>{t('计划状态', 'Plan status')}</span><span className="pill acc">{t(status[0], status[1])}</span></div>
      </div>
      {p.status === 'handover' && <Notice>{t('已转给工作人员，计划和记录一起发过去了。他们会打电话给您。', 'Handed to a staff member with the plan and full record. They will call you.')}</Notice>}
      {p.status === 'paused' && <Notice>{t('已暂停。点“继续”或说“继续”就接着做。', 'Paused. Tap or say “Continue” to carry on.')}</Notice>}
      {p.kind === 'season' && (
        <div className="row"><span className="chip static">{t('税务：3条提示', 'Tax: 3 notes')}</span><span className="chip static">{t('补贴：贴息50%', 'Support: 50% interest subsidy')}</span></div>
      )}
      {p.title && (
        <div className="row"><span className="chip static">{t(p.title[0], p.title[1])}</span><span className="chip static">{t('补贴：贴息50%', 'Support: 50% interest subsidy')}</span></div>
      )}
      <div className="card">
        {p.nodes.map((n) => (
          <div key={n.id} className={`node ${n.st}`}>
            <div className="dot">{n.st === 'done' ? '✓' : n.id}</div>
            <div>
              <div className="label" style={{ fontWeight: 650, color: 'var(--ink)' }}>{t(n.zh, n.en)}</div>
              <div className="meta">
                <Tier t={n.tier} />
                <span className="pill">{n.st === 'waiting' && famWait ? t('等女儿确认', 'Waiting for daughter') : t(stL[n.st][0], stL[n.st][1])}</span>
                {n.sum && n.st !== 'pending' && <span className="small">{t(n.sum[0], n.sum[1])}</span>}
                {n.raise && n.st !== 'done' && <span className="small">{t('原因：' + n.raise[0], 'Reason: ' + n.raise[1])}</span>}
              </div>
              {n.st === 'waiting' && p.status === 'waiting' && !famWait && (
                <div className="btns" style={{ marginTop: 10 }}><button className="btn pri" onClick={() => approveNode(n.id)}>{t('看一下，确认', 'Review and confirm')}</button></div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="cmds">
        <Cmd v="pause" zh="等一下" en="Wait" />
        <Cmd v="resume" zh="继续" en="Continue" />
        {p.nodes.some((n) => n.loan) && <Cmd v="noloan" zh="贷款先不要" en="Not the loan" />}
        <Cmd v="cancel" zh="算了" en="Never mind" />
        <Cmd v="human" zh="找人工" en="Get a person" />
      </div>
      <div className="small">{t('这些也可以按住直接说出来。', 'You can also hold and say these.')}</div>
      {p.kind === 'climate' && (
        <div className="small">{t('受灾以后，可以问问县农业农村局有没有灾害补助（模拟提示，不是真实申请）。', 'After a disaster, ask the county agriculture bureau about disaster relief (simulated pointer, not a real application).')}</div>
      )}
    </div>
  )
}
