import { Text, View } from '@tarojs/components'
import { useState } from 'react'
import { ApiError, Approval, TaxEstimate, api, beginAction } from '../services/api'
import ApprovalFlow from './ApprovalFlow'
import { showCitation } from './ComparisonCard'
import { ErrorCard, Fold, Tap, yuan } from './ui'

type Step = { k: 'offer' } | { k: 'busy' } | { k: 'approve'; ap: Approval } | { k: 'done' } | { k: 'stopped'; why: string } | { k: 'failed' }

// "这个季度大概要交多少税？": the range first, one sentence, the reasoning folded. Saving the money is a yellow approval; nothing is filed or paid.
export default function TaxCard({ data }: { data: TaxEstimate }) {
  const [step, setStep] = useState<Step>({ k: 'offer' })
  const body = { label: data.reserve_label, amount: data.reserve_amount }
  const below = data.vat_status === 'below'

  const start = () => {
    beginAction()
    setStep({ k: 'busy' })
    api.createReserve(body).then((r) => setStep('approval_id' in r ? { k: 'approve', ap: r } : { k: 'done' }))
      .catch((e) => setStep(e instanceof ApiError && e.status === 423 ? { k: 'stopped', why: '现在已暂停转账，暂时不能存。' } : { k: 'failed' }))
  }
  const finish = (token: string) => {
    setStep({ k: 'busy' })
    api.createReserve(body, token).then(() => setStep({ k: 'done' })).catch(() => setStep({ k: 'failed' }))
  }

  return (
    <View className='stack'>
      <View className='card enter-down'>
        <Text className='card-q'>这个季度大概要交多少税？</Text>
        <View>
          <Text className='number'>{yuan(data.total_low)} – {yuan(data.total_high)}</Text>
          <Text className='unit'>元</Text>
        </View>
        <Text>{below ? '转卖的销售额还低于门槛，增值税按规则是0；所得税给了一个参考范围。' : '转卖的销售额已达到门槛，按规则要全额计增值税。'}</Text>

        <View className='inset'>
          <Text className='small muted'>现在的经营方式：{data.structure_zh}</Text>
          <Text className='small muted'>本季度转卖销售额 / 门槛</Text>
          <View><Text className='figure'>{yuan(data.resale)}</Text><Text className='unit'> / {yuan(data.vat_threshold_quarter)} 元</Text></View>
          <Text className='small muted'>自产 {yuan(data.own_produce)} 元 · 转卖 {yuan(data.resale)} 元{data.other > 0 ? ` · 其他 ${yuan(data.other)} 元` : ''}</Text>
        </View>
        <View className='row'>
          <View className='inset grow'><Text className='small muted'>增值税</Text><Text className='figure'>{yuan(data.vat)} 元</Text></View>
          <View className='inset grow'><Text className='small muted'>所得税（参考）</Text><Text className='figure'>{yuan(data.income_tax_low)} – {yuan(data.income_tax_high)} 元</Text></View>
        </View>

        <Fold>{data.assumptions.map((a) => <Text key={a}>· {a}</Text>)}</Fold>
        <View className='tappable' hoverClass='pressed' hoverStartTime={0} hoverStayTime={100} onClick={() => showCitation(data.rule_ids, data.rules)}>
          <Text className='small'>规则来源 ⓘ</Text>
        </View>
        <Text className='note foot'>{data.footer_zh}</Text>
      </View>

      {data.reserve_amount > 0 && step.k === 'offer' && (
        <View className='card enter-down'>
          <Text className='card-title'>把这笔钱先存起来？</Text>
          <Text className='muted'>先留出 {yuan(data.reserve_amount)} 元，不转走，随时可以动用。</Text>
          <Tap kind='primary' wide onClick={start}>把这笔钱先存起来</Tap>
        </View>
      )}
      {step.k === 'busy' && <View className='card'><Text>正在办…</Text></View>}
      {step.k === 'approve' && <ApprovalFlow key={step.ap.approval_id} approval={step.ap} readback={data.readback_zh} onToken={finish} onStopped={(why) => setStep({ k: 'stopped', why })} />}
      {step.k === 'done' && <View className='card enter-down'><View className='row'><Text className='chip chip-done'>✓ 已存起来</Text></View><Text className='card-title'>已留出 {yuan(data.reserve_amount)} 元做税金</Text></View>}
      {step.k === 'stopped' && <View className='card enter-down'><Text className='card-title'>{step.why}</Text><Tap kind='secondary' wide onClick={() => setStep({ k: 'offer' })}>回去</Tap></View>}
      {step.k === 'failed' && <ErrorCard onRetry={start} />}
    </View>
  )
}
