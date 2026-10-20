import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useBi, useT } from '../lib/i18n'
import { famApprove, famDecline } from '../state/actions'
import { setRole } from '../state/role'
import { useApp } from '../state/store'
import { Tier } from './ui'

/** Signs this window back in as Uncle Wang (and leaves the /family route if needed). */
export function useSwitchBack() {
  const nav = useNavigate()
  return () => {
    setRole('farmer')
    if (location.pathname === '/family') nav('/')
  }
}

export function SwitchBack({ primary }: { primary?: boolean }) {
  const t = useT()
  const back = useSwitchBack()
  return (
    <button className={`btn ${primary ? 'pri' : ''} wide lg`} onClick={back}>
      {t('切换回王建国', 'Switch back to Uncle Wang')}
    </button>
  )
}

/** What the daughter sees: the one request that needs her OK. Used in the /family window and when this window is signed in as the family account. */
export function FamilyView() {
  const t = useT()
  const bi = useBi()
  const loc = useLocation()
  const req = useApp((s) => s.famReq)
  const pending = useApp((s) => s.famPending)
  const [declined, setDeclined] = useState(false)
  return (
    <div className="page">
      <div className="card">
        <div className="eyebrow">{t('家人端 · 王小丽（女儿）', 'Family view · Wang Xiaoli (daughter)')}</div>
        <div className="muted">{t('爸爸的大额或新收款人付款，要您在这里同意。', 'Large payments or payments to someone new need your OK here.')}</div>
      </div>
      {pending && req ? (
        <div className="card em">
          <div className="small">{t('爸爸（王建国）请您同意：', 'Your father (Wang Jianguo) asks you to approve:')}</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 650, color: 'var(--ink)', lineHeight: 1.4 }}>{t(req.zh, req.en)}</div>
          <div className="row">
            <Tier t="r" />
            {req.raised && <span className="small">{t('原因：' + req.raised[0], 'Reason: ' + bi(req.raised))}</span>}
          </div>
          <div className="small">{t('还剩 4分32秒，过时自动取消', '4:32 left, then it cancels itself')}</div>
          <div className="btns">
            <button className="btn pri wide lg" onClick={famApprove}>{t('同意（输入密码）', 'Approve (enter PIN)')}</button>
            <button
              className="btn wide lg"
              onClick={() => {
                famDecline()
                setDeclined(true)
              }}
            >
              {t('不同意', 'Decline')}
            </button>
          </div>
        </div>
      ) : declined ? (
        <div className="card em" role="status">
          <b style={{ color: 'var(--ink)', fontSize: '1.15rem' }}>{t('您没有同意，已告诉爸爸', 'You declined, and your father is told')}</b>
          <span className="small">{t('这件事没有做。', 'Nothing was done.')}</span>
          <div className="btns">
            <SwitchBack primary />
          </div>
        </div>
      ) : (
        <div className="card ph">
          <b style={{ color: 'var(--ink)' }}>{t('现在没有要您确认的', 'Nothing waiting for you')}</b>
          <span className="small">{t('爸爸有需要您同意的事，会出现在这里。', 'When your father needs your OK, it appears here.')}</span>
          {loc.pathname !== '/family' && (
            <div className="btns">
              <SwitchBack />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
