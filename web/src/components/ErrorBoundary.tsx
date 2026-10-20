import { Component, type ReactNode } from 'react'
import { getLang } from '../lib/i18n'

/** If a screen crashes, show a plain recovery screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error('screen crashed', error)
  }
  startOver = () => {
    try {
      localStorage.removeItem('wac-app-v1')
    } catch {
      /* storage may be blocked; reloading still helps */
    }
    window.location.href = '/'
  }
  render() {
    if (!this.state.failed) return this.props.children
    const zh = getLang() === 'zh'
    return (
      <div className="page" style={{ maxWidth: 560, marginTop: 48 }}>
        <div className="card em">
          <div className="mid">{zh ? '这一页出了点问题' : 'Something went wrong on this page'}</div>
          <p>{zh ? '您的钱和记录没有受影响（这是模拟账户）。可以刷新，或者从头开始。' : 'Your money and records are not affected (this is a simulated account). You can reload, or start over.'}</p>
          <div className="btns">
            <button className="btn pri wide lg" onClick={() => window.location.reload()}>{zh ? '刷新' : 'Reload'}</button>
            <button className="btn wide lg" onClick={this.startOver}>{zh ? '从头开始' : 'Start over'}</button>
          </div>
        </div>
      </div>
    )
  }
}
