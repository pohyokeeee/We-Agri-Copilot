import { Text, View } from '@tarojs/components'
import type { Tier } from '../mock'
import { Tap, TierChip } from './ui'

// One question: "is this right?" The sentence is read back exactly as the bank wrote it (payee, amount in digits and words).
export default function ReadBackCard({ text, tier, onYes, onNo }: {
  text: string; tier?: Tier; onYes?: () => void; onNo?: () => void
}) {
  return (
    <View className='card enter-up'>
      <Text className='card-q'>请再确认一次</Text>
      <Text className='card-title'>{text}</Text>
      {tier && <View className='row'><TierChip tier={tier} /></View>}
      <Tap kind='primary' wide onClick={onYes}>对，转账</Tap>
      <Tap kind='secondary' wide onClick={onNo}>不对，取消</Tap>
    </View>
  )
}
