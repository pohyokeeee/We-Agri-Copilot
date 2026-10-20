import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { api, demoLimited, onDemoLimited } from '../api/client'
import { initLive } from '../state/live'

/*
 * Starts the backend link. In production a backend that does not answer is an error the person can see, never a quiet switch to
 * sample data; only the local dev server keeps the offline mock path. When the backend says it is a public demo, a banner says so.
 */
export function DemoGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'wait' | 'ok' | 'down'>('wait')
  const [demo, setDemo] = useState(false)
  const limited = useSyncExternalStore(onDemoLimited, demoLimited)

  const connect = () => {
    setState('wait')
    initLive().then((ok) => setState(ok || import.meta.env.DEV ? 'ok' : 'down'))
    api.health().then((h) => setDemo(!!h.demo)).catch(() => undefined)
  }
  useEffect(connect, [])

  if (state !== 'ok') {
    return (
      <div className="page" style={{ maxWidth: 560, marginTop: 48 }}>
        <div className="card em">
          <div className="mid">{state === 'wait' ? '正在连接，请稍等…' : '连不上服务，请稍后再试'}</div>
          <p>{state === 'wait' ? '免费的演示服务刚醒来时要等一会儿，大约一分钟。' : '您的钱和记录没有受影响（这是模拟账户）。'}</p>
          {state === 'down' && <div className="btns"><button className="btn pri wide lg" onClick={connect}>再试一次</button></div>}
        </div>
      </div>
    )
  }
  return (
    <>
      {demo && (
        <div style={{ background: 'var(--accent-soft)', color: 'var(--ink)', textAlign: 'center', fontSize: 14, padding: '6px 12px' }}>
          演示环境 · 模拟账户 · 数据会重置{limited ? ' · 访问的人多，智能回答暂时用固定模板' : ''}
        </div>
      )}
      {children}
    </>
  )
}
