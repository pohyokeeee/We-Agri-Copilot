import { Text, View } from '@tarojs/components'
import type { SecurityStatus } from '../services/api'

// Calm, not alarming: say what happened, what still works, and how to get back.
export default function LockCard({ status }: { status: SecurityStatus }) {
  if (!status.locked) return null
  return (
    <View className='card enter-down'>
      <View className='row'><Text className='chip chip-pending'>○ 安全提醒</Text></View>
      <Text className='card-title'>{status.message_zh}</Text>
      <Text className='muted'>看余额、看账单、算一算都可以。要恢复转账，需要家人帮忙确认。</Text>
    </View>
  )
}
