import { Input, Text, View } from '@tarojs/components'
import { useEffect, useRef, useState } from 'react'
import { AgentCommand, AgentNode, AgentView, ApiError, api, beginAction } from '../services/api'
import ApprovalFlow from './ApprovalFlow'
import PlanCard from './PlanCard'
import { EmptyCard, ErrorCard, Skeleton, StepState, Tap, useDelayed } from './ui'

const COMMANDS: AgentCommand[] = ['等一下', '继续', '贷款先不要', '算了', '找人工']
const EXAMPLES = ['下个月要收蜂蜜了，帮我准备一下', '像去年一样给六家付蜂蜜钱', '给老李转800，蜂蜜钱']
const STATUS_ZH: Record<string, string> = { done: '全部办完', cancelled: '已撤销', handed_over: '已转人工', paused: '已暂停', failed: '出错了', rejected: '计划被拒绝' }
const STEP: Record<AgentNode['status'], StepState> = {
  pending: 'pending', blocked: 'pending', waiting: 'waiting', done: 'done', skipped: 'done', undone: 'undone', dropped: 'undone', failed: 'failed',
}

export interface Incoming { id: number; text: string; voice: boolean } // a sentence from the push-to-talk bar or the bottom text box

// A sentence (typed, or heard and confirmed) -> the plan with live step status -> approval steps -> quick commands.
export default function AgentPanel({ incoming, onReply }: { incoming?: Incoming | null; onReply?: (text: string, voice: boolean) => void }) {
  const session = useRef(`m${Date.now().toString(36)}`).current
  const [text, setText] = useState('')
  const [view, setView] = useState<AgentView | null>(null)
  const [busy, setBusy] = useState(false)
  const [down, setDown] = useState(false)
  const [note, setNote] = useState('')
  const [stopped, setStopped] = useState('') // the person cancelled, or the bank said no, at this step
  const retry = useRef<() => void>(() => undefined)
  const slow = useDelayed(busy)

  const call = (fn: () => Promise<AgentView>, voice = false) => {
    retry.current = () => call(fn, voice)
    setBusy(true)
    setDown(false)
    setNote('')
    setStopped('')
    fn().then((v) => {
      setView(v)
      if (v.reply_zh) onReply?.(v.reply_zh, voice) // the chat page speaks it if the person spoke
    }).catch((e) => {
      if (e instanceof ApiError) setNote(typeof e.data.detail === 'string' ? e.data.detail : '这一步没有办成')
      else setDown(true)
    }).finally(() => setBusy(false))
  }
  const send = (t: string, voice = false) => {
    if (!t.trim() || busy) return
    setText('')
    call(() => { beginAction(); return api.agentMessage(session, t.trim()) }, voice)
  }
  useEffect(() => { if (incoming) send(incoming.text, incoming.voice) }, [incoming?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const command = (c: AgentCommand) => !busy && call(() => api.agentCommand(session, c))

  const pending = view?.pending
  // what was said this turn, without the bank's read-back (the approval card below shows that in big letters)
  const news = view?.reply_zh ? view.reply_zh.replace(pending?.readback_zh ?? '', '').trim() : ''
  const live = view && view.nodes.length > 0
  return (
    <View className='stack'>
      <Text className='card-q'>跟我说一件事（按住下面的按钮说，或者打字）</Text>
      <View className='row'>
        <Input className='input' value={text} placeholder='例如：下个月要收蜂蜜了' confirmType='send' onInput={(e) => setText(e.detail.value)} onConfirm={() => send(text)} />
        <Tap kind='primary' onClick={() => send(text)}>发送</Tap>
      </View>
      {!live && EXAMPLES.map((x) => <Tap key={x} kind='quiet' onClick={() => send(x)}>试试：{x}</Tap>)}

      {down && <ErrorCard onRetry={() => retry.current()} />}
      {note && <EmptyCard>{note}</EmptyCard>}
      {slow && !view && <Skeleton />}
      {view?.status === 'question' && <EmptyCard>{view.question_zh}</EmptyCard>}
      {view?.status === 'question' && view.question_zh && <Tap kind='quiet' onClick={() => onReply?.(view.question_zh as string, true)}>🔊 听一遍</Tap>}

      {live && view && (
        <>
          <PlanCard
            title={view.utterance ?? '这件事'}
            steps={view.nodes.map((n) => ({ id: n.id, label: n.label_zh, tier: n.tier, state: STEP[n.status], status: n.summary_zh || n.error || undefined }))}
          />
          {STATUS_ZH[view.status] && <View className='row'><Text className='chip chip-pending'>{STATUS_ZH[view.status]}</Text></View>}
          {news && (
            <View className='card enter-down'>
              <Text>{news}</Text>
              <View className='row'><Tap kind='quiet' onClick={() => onReply?.(view.reply_zh as string, true)}>🔊 听一遍</Tap></View>
            </View>
          )}
          {stopped && (
            <View className='card enter-down'>
              <Text className='card-title'>{stopped}</Text>
              <Tap kind='primary' wide onClick={() => command('继续')}>再问一次</Tap>
              <Text className='muted'>或者说「算了」，把已经办的撤销。</Text>
            </View>
          )}
          {pending && view.status === 'waiting' && !stopped && (
            <ApprovalFlow
              key={pending.approval.approval_id}
              approval={pending.approval}
              readback={pending.readback_zh}
              onToken={(token) => call(() => api.agentApprove(session, pending.node_id, token))}
              onStopped={setStopped}
            />
          )}
          <Text className='card-q'>随时可以说</Text>
          <View className='row'>{COMMANDS.map((c) => <Tap key={c} kind='secondary' onClick={() => command(c)}>{c}</Tap>)}</View>
        </>
      )}
    </View>
  )
}
