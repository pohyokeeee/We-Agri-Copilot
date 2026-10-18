import { Text, View } from '@tarojs/components'
import { useState } from 'react'
import { ApiError, Approval, api } from '../services/api'
import ApprovalFlow from './ApprovalFlow'
import { ErrorCard, Tap } from './ui'

type Step = { k: 'offer' } | { k: 'busy' } | { k: 'approve'; view: Approval & { readback_zh: string } } | { k: 'done' } | { k: 'stopped'; why: string } | { k: 'failed' }

// Offered right after the compliance flags: one tap, then the usual read-back and confirm.
export default function TaxPotOffer() {
  const [step, setStep] = useState<Step>({ k: 'offer' })

  const start = () => {
    setStep({ k: 'busy' })
    api.createReserveRule().then((r) => {
      if ('approval_id' in r) setStep({ k: 'approve', view: r })
      else setStep({ k: 'done' })
    }).catch((e) => setStep(e instanceof ApiError && e.status === 423 ? { k: 'stopped', why: '现在已暂停转账，暂时不能设置。' } : { k: 'failed' }))
  }
  const finish = (token: string) => {
    setStep({ k: 'busy' })
    api.createReserveRule(token).then(() => setStep({ k: 'done' })).catch(() => setStep({ k: 'failed' }))
  }

  if (step.k === 'failed') return <ErrorCard onRetry={start} />
  if (step.k === 'approve') {
    return <ApprovalFlow key={step.view.approval_id} approval={step.view} readback={step.view.readback_zh} onToken={finish} onStopped={(why) => setStep({ k: 'stopped', why })} />
  }
  if (step.k === 'done') {
    return (
      <View className='card enter-down'>
        <View className='row'><Text className='chip chip-done'>✓ 已设置</Text></View>
        <Text className='card-title'>以后每收到一笔转卖货款，自动留出 1% 做税金</Text>
      </View>
    )
  }
  if (step.k === 'stopped') {
    return (
      <View className='card enter-down'>
        <Text className='card-title'>{step.why}</Text>
        <Tap kind='secondary' wide onClick={() => setStep({ k: 'offer' })}>回去</Tap>
      </View>
    )
  }
  return (
    <View className='card enter-down'>
      <Text className='card-q'>要不要自动留一点税金？</Text>
      <Text className='card-title'>每笔转卖货款，自动留出 1%</Text>
      <Text className='muted'>转卖的部分要交增值税，提前留一点，到时候不慌。只是把钱留出来，不转走，随时可以停。</Text>
      <Tap kind='primary' wide onClick={step.k === 'busy' ? undefined : start}>{step.k === 'busy' ? '正在办…' : '好，帮我设置'}</Tap>
    </View>
  )
}
