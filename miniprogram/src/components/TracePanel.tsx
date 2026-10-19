import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { AuditVerify, TraceDetail, TraceStep, api } from '../services/api'
import { Fold, Tap, yuan } from './ui'

export const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`
const clock = (ts: string) => ts.slice(11, 19)
const when = (ts: string) => `${Number(ts.slice(5, 7))}月${Number(ts.slice(8, 10))}日 ${ts.slice(11, 16)}`
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

// Judge page step card (Mini Program): everything shown. The web panel uses Row below.
export function Step({ s }: { s: TraceStep }) {
  return (
    <View className='card enter-down'>
      <View className='row'>
        <Text className='chip chip-pending'>{s.seq}</Text>
        <Text className='card-title'>{s.event_zh}</Text>
        <Text className='small muted mono'>{clock(s.ts)}</Text>
      </View>
      <Text className='small mono'>{s.actor} · {s.tool}{s.endpoint ? ` · ${s.endpoint}` : ''}</Text>
      {s.tier_final && <Text className='small'>等级：{s.tier_base} → {s.tier_final}{s.reasons_zh.length ? `（${s.reasons_zh.join('、')}）` : ''}</Text>}
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

// ---- web judge panel ----
const TIER = { green: ['●', '绿'], yellow: ['▲', '黄'], red: ['■', '红'] } as const
// what a step came to, from its event name (the backend has no single result field)
const WAITING = new Set(['approval_requested', 'cosign_requested', 'agent_node_waiting'])
const UNDONE = new Set(['cancelled', 'agent_undo', 'reserve_released', 'application_withdrawn', 'schedules_cancelled', 'cosign_expired'])
const BLOCKED = new Set(['pin_failed', 'token_rejected', 'cosign_declined', 'injection_flagged', 'agent_plan_rejected', 'agent_node_failed', 'locked'])
const result = (event: string) => (WAITING.has(event) ? ['waiting', '等待确认'] : UNDONE.has(event) ? ['undone', '已撤销'] : BLOCKED.has(event) ? ['failed', '已拦截'] : ['done', '已完成'])

function Row({ s }: { s: TraceStep }) {
  const [cls, res] = result(s.event)
  const raised = s.tier_base && s.tier_final && s.tier_base !== s.tier_final
  return (
    <View className='trow'>
      <View className='row'>
        <Text className='chip chip-pending'>{s.seq}</Text>
        <Text className='trow-name'>{s.event_zh}</Text>
        {s.tier_final ? <Text className={`chip chip-${s.tier_final}`}>{TIER[s.tier_final][0]} {TIER[s.tier_final][1]}</Text> : <Text className='note'>无等级</Text>}
        <Text className={`chip chip-${cls}`}>{res}</Text>
        <Text className='note'>{when(s.ts)}</Text>
      </View>
      {raised && <Text className='small'>{TIER[s.tier_base!][1]} → {TIER[s.tier_final!][1]}：{s.reasons_zh.join('、') || '风险升级'}</Text>}
      {s.balance_before !== null && s.balance_after !== null && <Text className='small'>余额 {yuan(s.balance_before)} → {yuan(s.balance_after)} 元</Text>}
      {s.utterance && <Text className='small'>听到：{s.utterance}</Text>}
      <Fold label='技术详情'>
        <Text className='small mono'>{s.actor} · {s.tool}{s.endpoint ? ` · ${s.endpoint}` : ''}</Text>
        {s.approval && <Text className='small mono'>{s.approval.method || '—'} → {s.approval.result || '—'}</Text>}
        {s.wording_check && <Text className='small mono'>措辞检查：{s.wording_check}</Text>}
        {s.dag !== null && s.dag !== undefined && <Text className='small mono'>{JSON.stringify(s.dag)}</Text>}
        <Hash label='上一条' value={s.prev_hash} />
        <Hash label='本条' value={s.hash} />
      </Fold>
    </View>
  )
}

// Follows the newest trace_id by itself, so the timeline grows while the farmer talks.
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
      <View className='card'>
        <View className='row'>
          <Text className='note'>当前操作</Text>
          <Text className='trow-name'>{detail ? detail.summary_zh : '暂无'}</Text>
        </View>
        <View className='row'>
          <Text className='note'>状态</Text>
          {detail ? <Text className='chip chip-pending'>{detail.status}</Text> : <Text className='note'>—</Text>}
        </View>
        <View className='row'>
          <Text className='note'>审计链</Text>
          {verify ? <Text className={`chip ${verify.ok ? 'chip-done' : 'chip-red'}`}>{verify.ok ? '✅ 校验通过' : `❌ 第 ${verify.first_broken_id} 条异常`}</Text> : <Text className='note'>尚未校验</Text>}
          <Tap kind='secondary' onClick={check}>{checking ? '正在校验…' : '校验审计链'}</Tap>
        </View>
        {detail && <Fold label='技术详情'><Hash label='追踪编号' value={detail.trace_id} /></Fold>}
      </View>
      {down && <Text className='chip chip-failed'>连不上后端</Text>}
      {!detail && !down && <Text className='note'>还没有记录，请先在左边办一件事。</Text>}
      {detail && <View className='card'>{detail.steps.map((s) => <Row key={s.row_id} s={s} />)}</View>}
    </View>
  )
}
