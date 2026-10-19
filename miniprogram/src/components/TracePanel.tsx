import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { AuditVerify, TraceDetail, TraceStep, api } from '../services/api'
import { Tap, TierChip, yuan } from './ui'

export const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`
const clock = (ts: string) => ts.slice(11, 19)
const copy = (text: string) => Taro.setClipboardData({ data: text }).then(() => Taro.showToast({ title: '已复制', icon: 'none' }))

export function Hash({ label, value }: { label: string; value: string }) {
  return (
    <View className='row tappable' hoverClass='pressed' hoverStartTime={0} hoverStayTime={100} onClick={() => copy(value)}>
      <Text className='small muted'>{label}</Text>
      <Text className='small mono'>{short(value)}</Text>
      <Text className='small'>复制</Text>
    </View>
  )
}

export function Step({ s }: { s: TraceStep }) {
  return (
    <View className='card enter-down'>
      <View className='row'>
        <Text className='chip chip-pending'>{s.seq}</Text>
        <Text className='card-title'>{s.event_zh}</Text>
        <Text className='small muted mono'>{clock(s.ts)}</Text>
      </View>
      <Text className='small mono'>{s.actor} · {s.tool}{s.endpoint ? ` · ${s.endpoint}` : ''}</Text>
      {s.tier_final && (
        <View className='inset'>
          <View className='row'>
            <Text className='small muted'>等级</Text>
            {s.tier_base && <TierChip tier={s.tier_base} />}
            <Text>→</Text>
            <TierChip tier={s.tier_final} />
          </View>
          {s.reasons_zh.map((r) => <Text key={r} className='small'>· 升级原因：{r}</Text>)}
        </View>
      )}
      {s.approval && <Text className='small'>审批：{s.approval.method || '—'} → {s.approval.result || '—'}</Text>}
      {s.balance_before !== null && s.balance_after !== null && (
        <Text className='small'>余额 <Text className='figure'>{yuan(s.balance_before)}</Text> → <Text className='figure'>{yuan(s.balance_after)}</Text> 元</Text>
      )}
      {s.wording_check && <Text className='small'>措辞检查：{s.wording_check}</Text>}
      {s.utterance && <Text className='small mono'>说：{s.utterance}</Text>}
      {s.dag !== null && s.dag !== undefined && <Text className='small mono'>任务图：{JSON.stringify(s.dag)}</Text>}
      <Hash label='上一条' value={s.prev_hash} />
      <Hash label='本条' value={s.hash} />
    </View>
  )
}


// Web judge panel: follows the newest trace_id by itself, so the timeline grows while the farmer talks. Plus the chain check.
export default function TracePanel() {
  const [detail, setDetail] = useState<TraceDetail | null>(null)
  const [down, setDown] = useState(false)
  const [verify, setVerify] = useState<AuditVerify | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    let alive = true
    const tick = () => api.traceRecent(1)
      .then((l) => (l.length ? api.trace(l[0].trace_id) : null))
      .then((d) => { if (alive) { setDetail(d); setDown(false) } })
      .catch(() => alive && setDown(true))
    tick()
    const t = setInterval(tick, 2000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const check = () => {
    setChecking(true)
    api.auditVerify().then(setVerify).catch(() => setDown(true)).finally(() => setChecking(false))
  }
  return (
    <View className='stack'>
      <Tap kind='primary' wide onClick={check}>{checking ? '正在验证… Verifying…' : '验证审计链 Verify chain'}</Tap>
      {verify && (
        <Text className={`chip ${verify.ok ? 'chip-done' : 'chip-red'}`}>
          {verify.ok ? `✅ 审计链完整 Chain intact（${verify.rows_checked} 行 rows）` : `❌ 第 ${verify.first_broken_id} 行被改动 Row ${verify.first_broken_id} altered（${verify.rows_checked} 行 rows）`}
        </Text>
      )}
      {down && <Text className='chip chip-failed'>连不上后端 Backend unreachable</Text>}
      {!detail && !down && <Text className='note'>还没有记录。在左边办一件事。 No trace yet: ask something on the left.</Text>}
      {detail && (
        <>
          <View className='card'>
            <Text className='card-title'>{detail.summary_zh}</Text>
            <View className='row'><Text className='chip chip-pending'>{detail.status}</Text><Text className='small muted'>{detail.started_at}</Text></View>
            <Hash label='trace' value={detail.trace_id} />
          </View>
          {detail.steps.map((s) => <Step key={s.row_id} s={s} />)}
        </>
      )}
    </View>
  )
}
