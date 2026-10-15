import { Text, View } from '@tarojs/components'
import type { Tier } from '../mock'

export interface PlanStep { id: string; label: string; tier: Tier; status: string }

const TIER_TEXT: Record<Tier, string> = { green: '直接做', yellow: '要你确认', red: '要你和家人确认' }

export default function PlanCard({ title, steps }: { title: string; steps: PlanStep[] }) {
  return (
    <View className='card'>
      <Text className='card-title'>{title}</Text>
      {steps.map((s) => (
        <View key={s.id} className='row'>
          <Text className={`tag tier-${s.tier}`}>{TIER_TEXT[s.tier]}</Text>
          <Text>{s.label}</Text>
          <Text className='small'>({s.status})</Text>
        </View>
      ))}
    </View>
  )
}
