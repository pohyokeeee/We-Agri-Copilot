import { useEffect } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { hasChosenLang, setLang, useLang, useT } from '../lib/i18n'
import { clearNotice, handToHuman, planOpen } from '../state/actions'
import { useRole } from '../state/role'
import { useApp, useUi } from '../state/store'
import { AccountControl, AccountMenu, AvatarButton } from './AccountMenu'
import { AskBar } from './AskBar'
import { FamilyView } from './FamilyView'
import { JudgePanel } from './JudgePanel'
import { Overlays } from './Overlays'

const NAV: [string, string, string][] = [
  ['/', '首页', 'Home'],
  ['/tax/check', '税务', 'Tax'],
  ['/support', '补贴', 'Support'],
  ['/season', '收购', 'Buying'],
  ['/pay', '付款', 'Pay'],
]
const TITLES: Record<string, [string, string]> = {
  '/': ['首页', 'Home'],
  '/tax/check': ['税务检查', 'Tax check'],
  '/tax': ['我的税务情况', 'My tax situation'],
  '/support': ['补贴与贷款', 'Support & loans'],
  '/applications': ['我的申请', 'My applications'],
  '/season': ['收购准备', 'Buying prep'],
  '/plan': ['计划', 'Plan'],
  '/pay': ['付款', 'Payments'],
  '/judge': ['评委面板', 'Judge panel'],
}

export function LangButton() {
  const lang = useLang()
  return (
    <button className="lang-btn" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} aria-label={lang === 'zh' ? 'Switch to English' : '切换到中文'}>
      {lang === 'zh' ? 'EN' : '中文'}
    </button>
  )
}

function useBadges() {
  const plan = useApp((s) => s.plan)
  const loan = useApp((s) => s.app.loan)
  const famPay = useApp((s) => s.famPending && !!s.famReq?.payInfo)
  const home = planOpen(plan) || loan === 'draft' || loan === 'needdocs'
  return (path: string) => (path === '/' && home) || (path === '/pay' && famPay)
}

function Sidebar() {
  const t = useT()
  const plan = useApp((s) => s.plan)
  const badge = useBadges()
  const link = (to: string, zh: string, en: string, end?: boolean) => (
    <NavLink key={to} to={to} end={end} className={({ isActive }) => `side-btn ${isActive ? 'on' : ''}`}>
      {t(zh, en)}
      {badge(to) && <span className="pill-count">1</span>}
    </NavLink>
  )
  return (
    <nav className="side" aria-label={t('主菜单', 'Main menu')}>
      <Link to="/" className="logo" aria-label={t('回到首页', 'Back to Home')}>
        元农民
      </Link>
      {NAV.map(([to, zh, en]) => link(to, zh, en, to === '/'))}
      <hr />
      {link('/applications', '我的申请', 'My applications')}
      {link('/tax', '我的税务情况', 'My tax situation')}
      {planOpen(plan) && link('/plan', '进行中的计划', 'Plan in progress')}
      <AccountControl />
    </nav>
  )
}

function TabBar() {
  const t = useT()
  const badge = useBadges()
  return (
    <nav className="tabbar" aria-label={t('主菜单', 'Main menu')}>
      {NAV.map(([to, zh, en]) => (
        <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `tab ${isActive ? 'on' : ''}`}>
          <i />
          {t(zh, en)}
          {badge(to) && <span className="dot-badge">1</span>}
        </NavLink>
      ))}
    </nav>
  )
}

function TopBar() {
  const t = useT()
  const loc = useLocation()
  const nav = useNavigate()
  const title = TITLES[loc.pathname] ?? ['', '']
  const back = ['/plan', '/tax', '/applications'].includes(loc.pathname)
  return (
    <header className="topbar">
      {back ? (
        <button className="icon-btn" aria-label={t('返回', 'Back')} onClick={() => nav('/')}>
          ‹
        </button>
      ) : (
        <Link to="/" className="brand" aria-label={t('回到首页', 'Back to Home')}>
          元农民 ·
        </Link>
      )}
      <span className="title">{t(title[0], title[1])}</span>
      <span className="badge-sim">{t('模拟账户', 'Simulated')}</span>
      <LangButton />
      <AvatarButton />
    </header>
  )
}

export function Notices() {
  const t = useT()
  const notice = useApp((s) => s.notice)
  if (!notice) return null
  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="flash bad" role="alert">
        <b style={{ color: 'var(--ink)' }}>{t(notice.zh, notice.en)}</b>
        <div className="btns">
          {notice.retry && (
            <Link className="btn" to={notice.retry} onClick={clearNotice}>
              {t('重新发起', 'Try again')}
            </Link>
          )}
          <button className="btn" onClick={handToHuman}>
            {t('找人工', 'Get a person')}
          </button>
          <button className="chip" onClick={clearNotice}>
            {t('关闭', 'Close')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** The farmer's website: sidebar on wide screens, tab bar on phones, the assistant at the bottom of every screen. */
export function Shell() {
  const t = useT()
  const loc = useLocation()
  const drawer = useUi((u) => u.drawer)
  const locked = useApp((s) => s.locked)
  const visited = useApp((s) => s.visited)
  const role = useRole()

  useEffect(() => {
    document.title = '元农民 · We-Agri-Copilot'
  }, [])
  if (role === 'family') return <FamilyLayout />
  // first visit: show the welcome page once
  if (!visited && loc.pathname === '/') return <Navigate to="/welcome" replace />

  return (
    <div className={`shell ${drawer ? 'with-drawer' : ''}`}>
      <Sidebar />
      <div className="main">
        <TopBar />
        {locked && (
          <div className="lockbar" role="alert">
            <b>■</b>
            <span>
              <b>{t('账户已锁定', 'Account locked')}</b>：{t('查询还能用；转账和预留要家人和工作人员一起解锁。', 'look-ups still work; payments need your family and a staff member to unlock.')}
            </span>
          </div>
        )}
        <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="scroll">
            <Notices />
            <Outlet />
          </div>
          <AskBar />
        </div>
        <TabBar />
      </div>
      {drawer && <JudgePanel />}
      <Overlays />
      <AccountMenu />
    </div>
  )
}

/** The daughter's layout: no farmer navigation, only the logo, her request, and the account control to switch back. */
export function FamilyLayout() {
  const t = useT()
  const drawer = useUi((u) => u.drawer)
  useEffect(() => {
    document.title = '元农民 · 家人端 · We-Agri-Copilot'
  }, [])
  return (
    <div className={`shell ${drawer ? 'with-drawer' : ''}`}>
      <nav className="side" aria-label={t('账号', 'Account')}>
        <span className="logo">元农民</span>
        <AccountControl />
      </nav>
      <div className="main">
        <header className="topbar">
          <span className="brand">元农民 ·</span>
          <span className="title">{t('家人端', 'Family')}</span>
          <span className="badge-sim">{t('模拟账户', 'Simulated')}</span>
          <LangButton />
          <AvatarButton />
        </header>
        <div className="scroll">
          <FamilyView />
        </div>
      </div>
      {drawer && <JudgePanel />}
      <Overlays />
      <AccountMenu />
    </div>
  )
}

/** /judge: the judge panel full-window, for a second screen. */
export function JudgeRoute() {
  const t = useT()
  useEffect(() => {
    if (!hasChosenLang()) setLang('en', false)
  }, [])
  return (
    <div className="shell">
      <div className="main">
        <header className="topbar">
          <Link to="/" className="brand" style={{ display: 'inline' }} aria-label={t('回到农户首页', 'Farmer home')}>
            元农民 ·
          </Link>
          <span className="title">{t('评委面板', 'Judge panel')}</span>
          <span className="badge-sim">{t('模拟账户', 'Simulated')}</span>
          <LangButton />
        </header>
        <div className="scroll">
          <JudgePanel full />
        </div>
      </div>
      <Overlays />
    </div>
  )
}
