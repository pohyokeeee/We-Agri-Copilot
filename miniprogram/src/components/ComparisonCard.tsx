import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'

export interface ComparisonProps {
  columns: string[] // A-D
  rows: { label: string; cells: string[] }[]
}

// The footer is not a prop on purpose: this card must never render without it.
export const COMPARISON_FOOTER = '这是信息，不是建议 · 请咨询12366'

export default function ComparisonCard({ columns, rows }: ComparisonProps) {
  // TODO: each cell should carry rule_id + citation_url from the backend; "TODO" until sources are verified
  const showCitation = () => Taro.showModal({ title: '来源', content: '来源待补充 (citation TODO)', showCancel: false })
  return (
    <View className='card'>
      <Text className='card-title'>四种经营方式对比</Text>
      <View className='cmp'>
        <View className='cmp-col'>
          <Text> </Text>
          {rows.map((r) => <Text key={r.label}>{r.label}</Text>)}
        </View>
        {columns.map((c, i) => (
          <View key={c} className='cmp-col'>
            <Text className='small'>{c}</Text>
            {rows.map((r) => (
              <View key={r.label} onClick={showCitation} style={{ minHeight: 'var(--tap-min)' }}>
                <Text>{r.cells[i]}</Text>
                <Text> ⓘ</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
      <Text className='footer-note'>{COMPARISON_FOOTER}</Text>
    </View>
  )
}
