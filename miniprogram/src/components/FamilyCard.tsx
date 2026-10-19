import { Text, View } from '@tarojs/components'
import { ReactNode } from 'react'
import { Tap } from './ui'

export type FamilyStatus = 'waiting' | 'approved' | 'declined' | 'expired'
const WORDS: Record<FamilyStatus, [string, string]> = {
  waiting: ['…', '等待女儿确认'], approved: ['✓', '女儿已同意'], declined: ['✕', '女儿已拒绝'], expired: ['✕', '已超时'],
}

// What the farmer sees while a request waits for the family: what, why, and where it stands. He cannot answer it from here;
// the answer comes from the daughter's own phone, and this card only reads the bank's status.
export default function FamilyCard({ what, why, status, onCancel }: { what: string; why: string[]; status: FamilyStatus; onCancel?: () => void }): ReactNode {
  return (
    <View className='card enter-up'>
      <Text className='card-q'>要家人一起确认</Text>
      <View className='row'><Text className={`chip chip-${status === 'approved' ? 'done' : status === 'waiting' ? 'waiting' : 'failed'}`}>{WORDS[status][0]} {WORDS[status][1]}</Text></View>
      <Text className='card-title'>{what}</Text>
      {why.length > 0 && <View className='inset'><Text className='small muted'>为什么要家人确认</Text>{why.map((r) => <Text key={r}>· {r}</Text>)}</View>}
      {status === 'waiting' && <Text className='muted'>已经通知女儿，她同意后会自动接着办。</Text>}
      {status === 'waiting' && onCancel && <Tap kind='secondary' wide onClick={onCancel}>取消，不办了</Tap>}
    </View>
  )
}
