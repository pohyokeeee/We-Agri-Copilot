import { Text, View } from '@tarojs/components'
import type { PolicyItem } from '../services/api'

// One question: can I get this support, and by when? One card per match, never a promise: "可能符合".
export default function SupportCard({ item }: { item: PolicyItem }) {
  const maybe = item.badge_zh === '可能符合'
  return (
    <View className='card enter-down'>
      <Text className='card-q'>能申请这笔吗？</Text>
      <View className='row'>
        <Text className={`chip ${maybe ? 'chip-pending' : 'chip-recall'}`}>{maybe ? '○' : '▲'} {item.badge_zh}</Text>
        {item.needs_verification && <Text className='chip chip-recall'>▲ 需核实</Text>}
      </View>
      <Text className='card-title'>{item.name}</Text>
      <Text className='figure'>{item.benefit}</Text>
      {item.deadline && (
        <View className='inset'>
          <Text className='small muted'>截止日期</Text>
          <Text className='figure'>{item.deadline}</Text>
        </View>
      )}
      <View className='inset'>
        <Text className='small muted'>要准备</Text>
        {item.documents.map((d) => <Text key={d}>☐ {d}</Text>)}
      </View>
      <View className='inset'>
        <Text className='small muted'>去哪里办</Text>
        <Text>{item.where_to_go}</Text>
      </View>
      {!maybe && item.rules_unmet.map((r) => <Text key={r.key} className='small muted'>· 还差：{r.text_zh}</Text>)}
    </View>
  )
}
