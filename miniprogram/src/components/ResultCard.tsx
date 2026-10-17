import { Text, View } from '@tarojs/components'
import { Tap, yuan } from './ui'

// One question: did it happen? The money before and after is shown when it did.
export default function ResultCard({ ok, title, lines, before, after, onClose }: {
  ok: boolean; title: string; lines?: string[]; before?: number; after?: number; onClose: () => void
}) {
  return (
    <View className='card enter-up'>
      <Text className='card-q'>{ok ? '办好了吗？' : '钱动了吗？'}</Text>
      <View className='row'>
        <Text className={`chip ${ok ? 'chip-done' : 'chip-pending'}`}>{ok ? '✓ 已完成' : '○ 没有转账'}</Text>
      </View>
      <Text className='card-title'>{title}</Text>
      {lines?.map((l) => <Text key={l} className='muted'>{l}</Text>)}
      {before !== undefined && after !== undefined && (
        <View className='row'>
          <View className='inset grow'><Text className='small muted'>转之前</Text><Text className='figure'>{yuan(before)} 元</Text></View>
          <Text>→</Text>
          <View className='inset grow'><Text className='small muted'>转之后</Text><Text className='figure'>{yuan(after)} 元</Text></View>
        </View>
      )}
      <Tap kind='primary' wide onClick={onClose}>知道了</Tap>
    </View>
  )
}
