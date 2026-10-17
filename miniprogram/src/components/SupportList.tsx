import { Text, View } from '@tarojs/components'
import type { PolicyMatch } from '../services/api'
import SupportCard from './SupportCard'
import { EmptyCard } from './ui'

// The farmer sees "may qualify" and "if you ..."; not_eligible stays in the response for the trace page only.
export default function SupportList({ data }: { data: PolicyMatch }) {
  return (
    <View className='stack'>
      <Text className='note'>{data.simulated_label}</Text>
      {data.may_qualify.length === 0 && <EmptyCard>现在没有查到可能符合的补贴或贷款</EmptyCard>}
      {data.may_qualify.map((i) => <SupportCard key={i.policy_id} item={i} />)}
      {data.if_you.length > 0 && <Text className='card-title'>如果加入合作社</Text>}
      {data.if_you.map((i) => <SupportCard key={i.policy_id} item={i} />)}
      <Text className='note'>{data.disclaimer}</Text>
    </View>
  )
}
