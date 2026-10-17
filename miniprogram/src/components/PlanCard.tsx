import { Text, View } from '@tarojs/components'
import type { Tier } from '../mock'
import { StateChip, StepState, TierChip } from './ui'

export interface PlanStep { id: string; label: string; tier: Tier; status?: string; state?: StepState }

// One question: what will happen, in what order. Each step shows its tier and where it stands.
export default function PlanCard({ title, steps }: { title: string; steps: PlanStep[] }) {
  return (
    <View className='card enter-down'>
      <Text className='card-q'>要做哪几步？</Text>
      <Text className='card-title'>{title}</Text>
      {steps.map((s) => (
        <View key={s.id} className='inset'>
          <View className='row'>
            <TierChip tier={s.tier} />
            <StateChip state={s.state ?? 'pending'} />
          </View>
          <Text>{s.label}</Text>
          {s.status && <Text className='small muted'>{s.status}</Text>}
        </View>
      ))}
    </View>
  )
}
