import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { setMenu, setRole, useMenuOpen, useRole, type Role } from '../state/role'
import { uiStore, useApp } from '../state/store'
import { Modal } from './Overlays'

function useWide() {
  const q = '(min-width: 900px)'
  const [wide, setWide] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const f = () => setWide(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return wide
}

const useWaiting = () => useApp((s) => s.famPending && !!s.famReq)

function useAccounts() {
  const t = useT()
  return {
    farmer: { initial: '王', name: t('王建国', 'Uncle Wang'), role: t('农户', 'Farmer'), full: t('王建国 · 农户', 'Uncle Wang · Farmer') },
    family: { initial: '丽', name: t('王小丽', 'Wang Xiaoli'), role: t('家人（负责确认）', 'Family (approves)'), full: t('王小丽 · 家人（负责确认）', 'Wang Xiaoli · Family (approves)') },
  }
}

/** Bottom-left account control in the sidebar: who is signed in, and the way to switch. */
export function AccountControl() {
  const t = useT()
  const role = useRole()
  const open = useMenuOpen()
  const waiting = useWaiting()
  const acc = useAccounts()[role]
  return (
    <div className="acct-wrap">
      <button className="acct" aria-haspopup="dialog" aria-expanded={open} onClick={() => setMenu(!open)} aria-label={t('账号：', 'Account: ') + acc.full}>
        <span className={`avatar ${role}`} aria-hidden>{acc.initial}</span>
        <span className="acct-txt">
          <b>{acc.name}</b>
          <span>{acc.role}</span>
          <em>{t('模拟账户', 'Simulated account')}</em>
        </span>
        {waiting && role === 'farmer' && <span className="count-badge" aria-label={t('有1件等家人确认', '1 waiting for family')}>1</span>}
      </button>
    </div>
  )
}

/** Phone top bar: just the avatar. */
export function AvatarButton() {
  const t = useT()
  const role = useRole()
  const waiting = useWaiting()
  const acc = useAccounts()[role]
  return (
    <button className="avatar-btn" onClick={() => setMenu(true)} aria-haspopup="dialog" aria-label={t('切换账号，现在是', 'Switch account, now ') + acc.full}>
      <span className={`avatar ${role}`} aria-hidden>{acc.initial}</span>
      {waiting && role === 'farmer' && <span className="count-badge">1</span>}
    </button>
  )
}

function MenuBody() {
  const t = useT()
  const nav = useNavigate()
  const role = useRole()
  const waiting = useWaiting()
  const accs = useAccounts()
  const pick = (r: Role) => {
    if (r === role) return setMenu(false)
    setRole(r)
    if (r === 'farmer' && location.pathname === '/family') nav('/')
  }
  const judge = () => {
    setMenu(false)
    uiStore.update((u) => void (u.drawer = true))
  }
  return (
    <>
      <div className="mid">{t('切换账号', 'Switch account')}</div>
      <div className="small">{t('这是模拟账户：切换不需要密码，只是换一个人来看。', 'This is a simulated account: switching needs no PIN, it just shows the app as the other person.')}</div>
      <div className="list" role="group" aria-label={t('切换账号', 'Switch account')}>
        {(['farmer', 'family'] as Role[]).map((r) => (
          <button key={r} className={`li press acct-row ${r === role ? 'cur' : ''}`} onClick={() => pick(r)} aria-current={r === role}>
            <span className={`avatar ${r}`} aria-hidden>{accs[r].initial}</span>
            <span className="grow" style={{ textAlign: 'left' }}>
              <b style={{ color: 'var(--ink)' }}>{accs[r].name}</b>
              <br />
              <span className="small">{accs[r].role}</span>
            </span>
            {r === 'family' && waiting && role === 'farmer' && <span className="count-badge static">1</span>}
            {r === role && <span className="tick" aria-label={t('当前账号', 'Signed in')}>✓</span>}
          </button>
        ))}
      </div>
      <button className="judge-link" onClick={judge}>
        {t('评委查看', 'Judge tools')}
      </button>
    </>
  )
}

/** The menu itself: a popover above the control on wide screens, a bottom sheet on phones. */
export function AccountMenu() {
  const open = useMenuOpen()
  const wide = useWide()
  const t = useT()
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!open || !wide) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, wide])
  return (
    <AnimatePresence>
      {open && wide && (
        <div key="pop" className="pop-layer" onPointerDown={() => setMenu(false)}>
          <motion.div
            className="pop"
            role="dialog"
            aria-label={t('切换账号', 'Switch account')}
            onPointerDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: reduce ? 0 : 8, scale: reduce ? 1 : 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0.1 : 0.18 }}
          >
            <MenuBody />
          </motion.div>
        </div>
      )}
      {open && !wide && (
        <Modal key="sheet" label={t('切换账号', 'Switch account')} onDismiss={() => setMenu(false)}>
          <MenuBody />
          <button className="btn" onClick={() => setMenu(false)}>
            {t('关闭', 'Close')}
          </button>
        </Modal>
      )}
    </AnimatePresence>
  )
}
