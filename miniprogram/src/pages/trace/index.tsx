import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import Screen from '../../components/Screen'
import { EmptyCard, ErrorCard, Skeleton, Tap, TierChip, useDelayed, yuan } from '../../components/ui'
import { AuditVerify, TraceDetail, TraceStep, TraceSummary, api } from '../../services/api'

// Judge console: recent traces -> one trace step by step. Denser than the farmer screens, same tokens.
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`
const clock = (ts: string) => ts.slice(11, 19)
const copy = (text: string) => Taro.setClipboardData({ data: text }).then(() => Taro.showToast({ title: '已复制', icon: 'none' }))

function Hash({ label, value }: { label: string; value: string }) {
  return (
    <View className='row tappable' hoverClass='pressed' hoverStartTime={0} hoverStayTime={100} onClick={() => copy(value)}>
      <Text className='small muted'>{label}</Text>
      <Text className='small mono'>{short(value)}</Text>
      <Text className='small'>复制</Text>
    </View>
  )
}

function Step({ s }: { s: TraceStep }) {
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

export default function Trace() {
  const [list, setList] = useState<TraceSummary[] | null>(null)
  const [detail, setDetail] = useState<TraceDetail | null>(null)
  const [opening, setOpening] = useState(false)
  const [down, setDown] = useState(false)
  const [verify, setVerify] = useState<AuditVerify | null>(null)
  const [checking, setChecking] = useState(false)
  const slow = useDelayed((list === null && !down) || opening)

  const load = () => {
    setDown(false)
    api.traceRecent().then(setList).catch(() => setDown(true))
  }
  useEffect(load, [])

  const open = (id: string) => {
    setOpening(true)
    api.trace(id).then(setDetail).catch(() => setDown(true)).finally(() => setOpening(false))
  }
  const check = () => {
    setChecking(true)
    api.auditVerify().then(setVerify).catch(() => setDown(true)).finally(() => setChecking(false))
  }

  return (
    <Screen title={detail ? '一次操作的每一步' : '评委控制台'} back>
      <Tap kind='primary' wide onClick={check}>{checking ? '正在验证…' : '验证审计链'}</Tap>
      {verify && (
        <Text className={`chip ${verify.ok ? 'chip-done' : 'chip-red'}`}>
          {verify.ok ? `✅ 审计链完整（已检查 ${verify.rows_checked} 行）` : `❌ 第 ${verify.first_broken_id} 行被改动（检查了 ${verify.rows_checked} 行）`}
        </Text>
      )}
      {down && <ErrorCard onRetry={detail ? () => open(detail.trace_id) : load} />}
      {slow && <Skeleton />}

      {detail ? (
        <>
          <Tap kind='quiet' onClick={() => setDetail(null)}>‹ 回到列表</Tap>
          <View className='card'>
            <Text className='card-title'>{detail.summary_zh}</Text>
            <View className='row'><Text className='chip chip-pending'>{detail.status}</Text><Text className='small muted'>{detail.started_at}</Text></View>
            <Hash label='trace' value={detail.trace_id} />
          </View>
          {detail.steps.map((s) => <Step key={s.row_id} s={s} />)}
        </>
      ) : (
        <>
          {list?.length === 0 && <EmptyCard>还没有记录。先在聊天页办一件事。</EmptyCard>}
          {list?.map((t) => (
            <View key={t.trace_id} className='card enter-down tappable' hoverClass='pressed' hoverStartTime={0} hoverStayTime={100} onClick={() => open(t.trace_id)}>
              <View className='row'>
                <Text className='chip chip-pending'>{t.status}</Text>
                <Text className='small muted'>{t.steps} 步 · {t.started_at.slice(5, 16).replace('T', ' ')}</Text>
              </View>
              <Text className='card-title'>{t.summary_zh}</Text>
              <Text className='small mono'>{t.endpoint} · {short(t.trace_id)}</Text>
            </View>
          ))}
        </>
      )}
    </Screen>
  )
}
