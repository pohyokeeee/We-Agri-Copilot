import { Text, View } from '@tarojs/components'

export interface SupportProps {
  name: string
  wording: string // always "may qualify" wording, never "qualifies"
  documents: string[]
  deadline: string
}

export default function SupportCard({ name, wording, documents, deadline }: SupportProps) {
  return (
    <View className='card'>
      <Text className='card-title'>{name}</Text>
      <Text>{wording}</Text>
      <Text>要准备：{documents.join('、')}</Text>
      <Text>截止日期：{deadline}</Text>
      <Text className='simulated'>模拟数据 · 仅供演示，不是真实政策</Text>
    </View>
  )
}
