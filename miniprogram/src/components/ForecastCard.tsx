import { Text, View } from '@tarojs/components'
import type { Forecast } from '../services/api'
import PlanCard from './PlanCard'
import { EmptyCard, yuan } from './ui'

// One question: is there enough money? The answer (gap, or "enough") is the biggest thing on the card.
export default function ForecastCard({ data }: { data: Forecast }) {
  const p = data.next_purchases[0]
  if (!p || data.gap_high === undefined) return <EmptyCard>最近没有要收购的东西</EmptyCard>
  const enough = data.gap_high === 0
  return (
    <View className='stack'>
      <View className='card enter-down'>
        <Text className='card-q'>收蜂蜜的钱够不够？</Text>
        <View>
          {enough
            ? <Text className='number'>够用</Text>
            : <><Text className='small muted'>可能差  </Text><Text className='number'>{yuan(data.gap_expected!)}</Text><Text className='unit'>元</Text></>}
        </View>
        {!enough && <Text className='small muted'>最多差 {yuan(data.gap_high)} 元</Text>}
        <View className='inset'>
          <Text className='small muted'>{p.activity}：{p.window_start} 到 {p.window_end}，{p.days_until} 天后开始</Text>
          <Text className='small muted'>要花</Text>
          <View><Text className='figure'>{yuan(data.amount_low!)} – {yuan(data.amount_high!)}</Text><Text className='unit'>元</Text></View>
          <Text className='small muted'>开始时手上有</Text>
          <View><Text className='figure'>{yuan(data.cash_available_low!)} – {yuan(data.cash_available_high!)}</Text><Text className='unit'>元</Text></View>
        </View>
      </View>

      <PlanCard
        title='可以这样安排（现在还没有动钱）'
        steps={data.plan.steps.map((s) => ({ id: s.id, label: s.text_zh, tier: s.tier, status: s.reasons_zh.join('、') || undefined }))}
      />
      {data.plan.financing.map((f) => (
        <View key={f.product_id} className='card enter-down'>
          <Text className='card-q'>借钱要多花多少？</Text>
          <View><Text className='number'>{yuan(f.total_cost)}</Text><Text className='unit'>元</Text><Text className='small muted'>  利息加手续费</Text></View>
          <Text>{f.text_zh}</Text>
        </View>
      ))}

      <View className='card enter-down'>
        <Text className='card-q'>这是怎么算出来的？</Text>
        {data.assumptions.map((a) => <Text key={a}>· {a}</Text>)}
      </View>
    </View>
  )
}
