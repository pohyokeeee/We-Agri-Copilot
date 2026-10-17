import { Text, View } from '@tarojs/components'
import { useEffect, useRef, useState } from 'react'
import { ApiError, Approval, Payee, TransferBody, TransferResult, api, beginAction } from '../services/api'
import PinPad from './PinPad'
import ReadBackCard from './ReadBackCard'
import ResultCard from './ResultCard'
import { ErrorCard, Skeleton, Tap, TierChip, useDelayed } from './ui'

// The demo sentence. Voice will fill these in later; every number and name used below still comes from the bank.
const DEMO = { spokenAs: '老李', amount: 800, purpose: '蜂蜜钱' }

type Step =
  | { k: 'idle' }
  | { k: 'busy' }
  | { k: 'failed' }
  | { k: 'pick'; who: Payee[] }
  | { k: 'readback'; payee: Payee; text: string }
  | { k: 'pin'; ap: Approval; payee: Payee; wrong?: boolean; verifying?: boolean }
  | { k: 'wait'; ap: Approval; payee: Payee }
  | { k: 'result'; ok: boolean; title: string; lines?: string[]; before?: number; after?: number }

const stopped = (title: string, lines?: string[]): Step => ({ k: 'result', ok: false, title, lines })
const body = (p: Payee): TransferBody => ({ payee_id: p.id, amount: DEMO.amount, purpose: DEMO.purpose })

// resolve -> read-back -> confirm -> (PIN -> co-sign if the bank asks) -> result. The bank decides every step.
export default function PayFlow() {
  const [step, setStep] = useState<Step>({ k: 'idle' })
  const spent = useRef(false) // a token may be used once; never fire the payment twice
  const slow = useDelayed(step.k === 'busy')

  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.status === 423) return setStep(stopped('账户已锁住，没有转账', ['读余额、看账单还可以。请找家人解锁。']))
    if (e instanceof ApiError) return setStep(stopped('没有转账', [e.data.detail ?? '银行没有同意']))
    setStep({ k: 'failed' }) // network
  }
  const guarded = async (fn: () => Promise<void>) => {
    setStep({ k: 'busy' })
    try { await fn() } catch (e) { fail(e) }
  }

  const finish = (r: TransferResult) =>
    setStep({ k: 'result', ok: true, title: `已给${r.payee}转 ${r.amount} 元`, lines: [r.purpose], before: r.balance_before, after: r.balance_after })

  const execute = async (ap: Approval, payee: Payee) => {
    if (spent.current) return
    spent.current = true
    try { finish(await api.executeTransfer(body(payee), ap.approval_token!)) } catch (e) { spent.current = false; fail(e) }
  }

  // Go to whatever the bank says is next for this approval.
  const advance = async (ap: Approval, payee: Payee) => {
    if (ap.next === 'ready') return execute(ap, payee)
    if (ap.next === 'pin') return setStep({ k: 'pin', ap, payee })
    if (ap.next === 'cosign') return setStep({ k: 'wait', ap, payee })
    return setStep(stopped(ap.next === 'expired' ? '等得太久了，没有转账' : '没有转账'))
  }

  const toReadback = (payee: Payee) => guarded(async () => {
    const r = await api.readback({ ...body(payee), spoken_as: DEMO.spokenAs })
    setStep({ k: 'readback', payee, text: r.text_zh })
  })

  // 1. resolve the name. None: say so. Several: ask which one, never pick silently.
  const start = () => guarded(async () => {
    beginAction()
    spent.current = false
    const who = await api.payees(DEMO.spokenAs)
    if (!who.length) return setStep(stopped(`没找到叫“${DEMO.spokenAs}”的人`, ['请再说一次名字。']))
    if (who.length > 1) return setStep({ k: 'pick', who })
    await toReadback(who[0])
  })

  // 3. "对，转账": open the approval, then confirm it (the same tap)
  const yes = (payee: Payee) => guarded(async () => {
    const first = await api.startTransfer(body(payee))
    if (!('approval_id' in first)) return finish(first as unknown as TransferResult) // green: the bank already did it
    await advance(await api.confirmApproval(first.approval_id), payee)
  })

  const pin = async (ap: Approval, payee: Payee, code: string) => {
    setStep({ k: 'pin', ap, payee, verifying: true })
    try {
      await advance(await api.verifyPin(ap.approval_id, code), payee)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setStep({ k: 'pin', ap, payee, wrong: true })
      else fail(e)
    }
  }

  const cancel = async (ap: Approval) => {
    try { await api.cancelApproval(ap.approval_id) } catch { /* nothing was approved, nothing to undo */ }
    setStep(stopped('已取消，没有转账'))
  }

  // waiting for the co-signer: ask the bank every 2 seconds
  useEffect(() => {
    if (step.k !== 'wait') return undefined
    const { ap, payee } = step
    const t = setInterval(async () => {
      try {
        const now = await api.approval(ap.approval_id)
        if (now.next === 'cosign') return
        clearInterval(t)
        if (now.next === 'ready') await execute(now, payee)
        else setStep(stopped(now.next === 'expired' ? '家人没有及时回复，没有转账' : '家人没有同意，没有转账'))
      } catch { /* try again on the next tick */ }
    }, 2000)
    return () => clearInterval(t)
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  switch (step.k) {
    case 'idle':
      return <Tap kind='secondary' wide onClick={start}>给老李转800，蜂蜜钱</Tap>
    case 'busy':
      return <>{slow ? <Skeleton /> : null}<Tap kind='secondary' wide>正在办…</Tap></>
    case 'failed':
      return <ErrorCard onRetry={start} />
    case 'pick':
      return (
        <View className='card enter-down'>
          <Text className='card-q'>有好几位，请选一位</Text>
          <Text className='card-title'>您是说哪一位？</Text>
          {step.who.map((p) => <Tap key={p.id} kind='secondary' wide onClick={() => toReadback(p)}>{p.name}</Tap>)}
          <Tap kind='quiet' onClick={() => setStep({ k: 'idle' })}>都不是</Tap>
        </View>
      )
    case 'readback':
      return <ReadBackCard text={step.text} onYes={() => yes(step.payee)} onNo={() => setStep(stopped('已取消，没有转账'))} />
    case 'pin':
      return (
        <View className='card enter-up'>
          <Text className='card-q'>这笔要输入密码</Text>
          <Text className='card-title'>请输入6位密码</Text>
          <View className='row'><TierChip tier={step.ap.tier} /></View>
          {step.ap.reasons_zh.map((r) => <Text key={r} className='muted'>· {r}</Text>)}
          {step.wrong && <Text className='chip chip-red'>■ 密码不对，请再试一次</Text>}
          <PinPad busy={step.verifying} onComplete={(code) => pin(step.ap, step.payee, code)} />
          <Tap kind='quiet' onClick={() => cancel(step.ap)}>取消，不转了</Tap>
        </View>
      )
    case 'wait':
      return (
        <View className='card enter-up'>
          <Text className='card-q'>要家人一起确认</Text>
          <Text className='card-title'>已经通知家人，等她确认</Text>
          <View className='row'><TierChip tier={step.ap.tier} /></View>
          <Text className='muted'>她同意后，会自动转账。</Text>
          <Tap kind='secondary' wide onClick={() => cancel(step.ap)}>取消，不转了</Tap>
        </View>
      )
    case 'result':
      return <ResultCard ok={step.ok} title={step.title} lines={step.lines} before={step.before} after={step.after} onClose={() => setStep({ k: 'idle' })} />
  }
}
