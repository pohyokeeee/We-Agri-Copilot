import { Text, View } from '@tarojs/components'
import type { Compliance, Flag } from '../services/api'
import { showCitation } from './ComparisonCard'
import { EmptyCard, yuan } from './ui'

// Each flag answers one question and leads with its one number (taken from the flag's own numbers).
function headline(f: Flag): { q: string; big: string; unit: string; cap: string } | null {
  const n = f.numbers as Record<string, number | string>
  switch (f.code) {
    case 'RESALE_SHARE':
      return { q: '卖的蜂蜜里，转卖的占多少？', big: `${Math.round(Number(n.resale_share) * 100)}`, unit: '%', cap: '是收购邻居的蜂蜜再卖出的' }
    case 'RECONCILIATION_GAP':
      return { q: '平台报告的和您的记录差多少？', big: yuan(Number(n.gap)), unit: '元', cap: `${n.period} 季度的差额` }
    case 'VAT_THRESHOLD':
      return n.quarter_status === 'reached' || n.month_status === 'reached'
        ? { q: '离增值税门槛还有多远？', big: '已到', unit: '', cap: '转卖销售额已达到门槛' }
        : { q: '离增值税门槛还有多远？', big: yuan(Number(n.quarter_threshold) - Number(n.quarter_resale)), unit: '元', cap: '本季度转卖销售额距门槛' }
    case 'NEEDS_CONFIRMATION':
      return { q: '有哪些商品要您确认？', big: `${(n.products as unknown as unknown[]).length}`, unit: '种', cap: '商品分不清是自产还是转卖' }
    default:
      return null
  }
}

export default function FlagsCard({ data }: { data: Compliance }) {
  if (!data.flags.length) return <EmptyCard>目前没有需要留意的事</EmptyCard>
  return (
    <View className='stack'>
      {data.flags.map((f) => {
        const h = headline(f)
        return (
          <View key={f.code} className='card enter-down'>
            {h && <Text className='card-q'>{h.q}</Text>}
            {h && (
              <View>
                <Text className='number'>{h.big}</Text>
                <Text className='unit'>{h.unit}</Text>
                <Text className='small muted'>  {h.cap}</Text>
              </View>
            )}
            <Text>{f.plain_text_zh}</Text>
            <View className='btn btn-quiet' hoverClass='pressed' hoverStartTime={0} hoverStayTime={100}
              onClick={() => showCitation(f.rule_ids, data.rules)}>
              <Text>规则来源 ⓘ</Text>
            </View>
          </View>
        )
      })}
    </View>
  )
}
