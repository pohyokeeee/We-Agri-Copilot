import { Text, View } from '@tarojs/components'
import type { Compliance } from '../services/api'
import { COMPARISON_FOOTER, showCitation } from './ComparisonCard'

export default function FlagsCard({ data }: { data: Compliance }) {
  return (
    <View className='card'>
      <Text className='card-title'>需要留意的几件事</Text>
      {data.flags.map((f) => (
        <View key={f.code} className='card' onClick={() => showCitation(f.rule_ids, data.rules)}>
          <Text>{f.plain_text_zh}</Text>
          <Text className='small'>点这里看规则来源 ⓘ</Text>
        </View>
      ))}
      <Text className='footer-note'>{COMPARISON_FOOTER}</Text>
    </View>
  )
}
