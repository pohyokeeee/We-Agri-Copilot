import { Text, View } from '@tarojs/components'
import { useState } from 'react'
import { DemoPayout } from '../services/api'
import TaxPotOffer from './TaxPotOffer'
import { yuan } from './ui'

type Result = Pick<DemoPayout, 'moved' | 'pot_total' | 'available_before' | 'available_after'>

// A resale payout arrived. Rule on: show what moved, before and after. Rule off: offer to turn it on, then apply it to THIS payout.
export default function PayoutCard({ data }: { data: DemoPayout }) {
  const [done, setDone] = useState<Result | null>(data.moved > 0 ? data : null)
  return (
    <View className='stack'>
      <View className='card enter-down'>
        <Text className='card-q'>收到一笔转卖货款</Text>
        <View><Text className='number'>{yuan(data.amount)}</Text><Text className='unit'>元</Text></View>
        <Text>账上余额 {yuan(data.balance_before)} → {yuan(data.balance_after)} 元</Text>
        {done ? (
          <View className='inset'>
            <Text className='small muted'>自动留出做税金</Text>
            <View><Text className='figure'>{yuan(done.moved)}</Text><Text className='unit'>元</Text></View>
            <Text className='small muted'>能动用的钱 {yuan(done.available_before)} → {yuan(done.available_after)} 元</Text>
            <Text className='small muted'>税金一共存了 {yuan(done.pot_total)} 元</Text>
          </View>
        ) : <Text className='muted'>还没有开启税金预留，这笔钱没有留出税金。</Text>}
      </View>
      {!done && <TaxPotOffer payoutId={data.payout_id} onApplied={setDone} />}
    </View>
  )
}
