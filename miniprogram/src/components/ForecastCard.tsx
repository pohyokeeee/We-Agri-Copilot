import { Text, View } from '@tarojs/components'
import type { Forecast } from '../services/api'
import { COMPARISON_FOOTER } from './ComparisonCard'
import PlanCard from './PlanCard'

const yuan = (x: number) => `${Math.round(x).toLocaleString('en-US')} 元`

export default function ForecastCard({ data }: { data: Forecast }) {
  const p = data.next_purchases[0]
  if (!p || data.gap_high === undefined) {
    return (
      <View className='card'>
        <Text className='card-title'>最近没有要收购的东西</Text>
        {data.assumptions.map((a) => <Text key={a}>{a}</Text>)}
      </View>
    )
  }
  const enough = data.gap_high === 0
  return (
    <View className='card'>
      <Text className='card-title'>收蜂蜜的钱够不够？</Text>
      <Text>{p.activity}：{p.window_start} 到 {p.window_end}（{p.days_until} 天后开始）</Text>
      <Text>要花：{yuan(data.amount_low!)} 到 {yuan(data.amount_high!)}</Text>
      <Text>开始时手上有：{yuan(data.cash_available_low!)} 到 {yuan(data.cash_available_high!)}</Text>
      <Text className='card-title'>
        {enough ? '钱够用' : `可能差：约 ${yuan(data.gap_expected!)}（最多 ${yuan(data.gap_high)}）`}
      </Text>

      <PlanCard
        title='可以这样安排（现在还没有动钱）'
        steps={data.plan.steps.map((s) => ({ id: s.id, label: s.text_zh, tier: s.tier, status: s.reasons_zh.join('、') || '建议' }))}
      />
      {data.plan.financing.map((f) => (
        <View key={f.product_id} className='card'>
          <Text>{f.text_zh}</Text>
        </View>
      ))}

      <Text className='card-title'>这样算的依据</Text>
      {data.assumptions.map((a) => <Text key={a}>· {a}</Text>)}
      <Text className='footer-note'>{COMPARISON_FOOTER}</Text>
    </View>
  )
}
