import { useCallback, useEffect, useState } from 'react'
import { api, type TraceDetail, type TraceSummary, type TierName } from '../api/client'
import { useT } from '../lib/i18n'
import { N } from '../lib/format'
import { liveResalePayout } from '../state/live'

/* Phase 2 judge views, read from the bank's own audit trail: /trace/*, /audit/verify and the demo events. */
const MARK: Record<TierName, string> = { green: '●', yellow: '▲', red: '■' }
const tier = (b: TierName | null, f: TierName | null) => (f ? (b && b !== f ? `${MARK[b]}→${MARK[f]}` : MARK[f]) : '—')

function usePoll<T>(load: () => Promise<T>, ms: number) {
  const [data, setData] = useState<T | null>(null)
  const [err, setErr] = useState(false)
  const reload = useCallback(() => load().then((d) => (setData(d), setErr(false))).catch(() => setErr(true)), [load])
  useEffect(() => {
    void reload()
    const id = setInterval(reload, ms)
    return () => clearInterval(id)
  }, [reload, ms])
  return { data, err, reload }
}

export function LiveTrace() {
  const t = useT()
  const [open, setOpen] = useState<string | null>(null)
  const list = usePoll<TraceSummary[]>(useCallback(() => api.traceRecent(12), []), 4000)
  const traces = list.data ?? []
  const shown = open ?? traces[0]?.trace_id ?? null
  const detail = usePoll<TraceDetail | null>(useCallback(() => (shown ? api.trace(shown) : Promise.resolve(null)), [shown]), 4000)
  return (
    <>
      {list.err && <div className="small err">{t('连不上后台', 'Cannot reach the backend')}</div>}
      <div className="list">
        {traces.length === 0 && <div className="small">{t('还没有记录。', 'No traces yet.')}</div>}
        {traces.map((r) => (
          <button key={r.trace_id} className="li press" onClick={() => setOpen(r.trace_id)} aria-pressed={shown === r.trace_id}>
            <span className="grow">
              <b>{r.summary_zh}</b>
              <br />
              <span className="small">
                {r.steps} {t('步', 'steps')} · {r.status}
              </span>
            </span>
            {shown === r.trace_id && <span className="pill">open</span>}
          </button>
        ))}
      </div>
      {detail.data && (
        <div className="tbl-x">
          <table className="jt">
            <thead>
              <tr>
                {['#', 'actor', 'event', 'tier base→final', 'approval', 'balance', 'hash'].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.data.steps.map((s) => (
                <tr key={s.seq}>
                  <td>{s.seq}</td>
                  <td>{s.actor}</td>
                  <td title={s.event}>{s.event_zh}</td>
                  <td title={s.reasons_zh.join('、')}>{tier(s.tier_base, s.tier_final)}</td>
                  <td>{s.approval?.method && s.approval.method !== 'none' ? `${s.approval.method}${s.approval.result ? ' · ' + s.approval.result : ''}` : '—'}</td>
                  <td>{s.balance_before !== null && s.balance_after !== null ? `${N(s.balance_before)}→${N(s.balance_after)}` : '—'}</td>
                  <td className="hash">{s.hash.slice(0, 4)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

export function LiveAudit() {
  const t = useT()
  const { data, err, reload } = usePoll(useCallback(() => api.auditVerify(), []), 15000)
  return (
    <div className="card em">
      {err && <div className="small err">{t('连不上后台', 'Cannot reach the backend')}</div>}
      {data && (
        <>
          <div className="mid" style={data.ok ? undefined : { color: 'var(--err, #b3261e)' }}>
            {data.ok ? '✓' : '✗'} {data.ok ? t('审计链完整', 'Audit chain intact') : t('审计链有断点', 'Audit chain broken')}
          </div>
          <div className="small">
            {t(`已检查 ${data.rows_checked} 行 · 第一个断点：${data.first_broken_id ?? '无'}`, `${data.rows_checked} rows checked · first break: ${data.first_broken_id ?? 'none'}`)}
          </div>
        </>
      )}
      <div className="btns">
        <button className="btn" onClick={() => void reload()}>
          {t('重新校验', 'Verify again')}
        </button>
      </div>
    </div>
  )
}

export function LiveScenario() {
  const t = useT()
  return (
    <div className="li">
      <span className="grow">
        <b>{t('收到一笔转卖货款', 'A resale payout arrives')}</b>
        <br />
        <span className="small">{t('开了税金罐，会自动留1%', 'If the tax pot is on, 1% is set aside')}</span>
      </span>
      <button className="btn" onClick={() => void liveResalePayout()}>
        {t('执行', 'Run')}
      </button>
    </div>
  )
}
