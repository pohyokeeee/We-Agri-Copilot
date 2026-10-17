import { Text, View } from '@tarojs/components'

export interface SupportProps {
  name: string
  wording: string // always "may qualify" wording, never "qualifies"
  documents: string[]
  deadline: string
}

// One question: can I get this support, and by when?
export default function SupportCard({ name, wording, documents, deadline }: SupportProps) {
  return (
    <View className='card enter-down'>
      <Text className='card-q'>能申请这笔补助吗？</Text>
      <Text className='card-title'>{name}</Text>
      <Text className='chip chip-pending'>{wording}</Text>
      <View className='inset'>
        <Text className='small muted'>截止日期</Text>
        <Text className='figure'>{deadline}</Text>
      </View>
      <View className='inset'>
        <Text className='small muted'>要准备</Text>
        {documents.map((d) => <Text key={d}>· {d}</Text>)}
      </View>
      <Text className='note'>模拟数据，仅供演示，不是真实政策</Text>
    </View>
  )
}
