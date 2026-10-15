import { Text, View } from '@tarojs/components'
import type { Tier } from '../mock'

// Read-back before any yellow/red action: the exact payee and amount from the tool output, then yes/no.
export default function ReadBackCard({ text, tier, onYes, onNo }: {
  text: string; tier: Tier; onYes?: () => void; onNo?: () => void
}) {
  return (
    <View className='card'>
      <Text className={`tag tier-${tier}`}>请再确认一次</Text>
      <Text className='card-title'>{text}</Text>
      <View className='row'>
        <View className='btn btn-primary' onClick={onYes}><Text>对，就是这样</Text></View>
        <View className='btn btn-danger' onClick={onNo}><Text>不对</Text></View>
      </View>
    </View>
  )
}
