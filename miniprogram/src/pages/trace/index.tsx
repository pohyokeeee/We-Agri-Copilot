import { Text, View } from '@tarojs/components'
import { mockTrace } from '../../mock'

// Judge console: transcript -> DAG -> tier + reasons -> API calls -> audit hash.
// TODO: replace mockTrace with the run log from the backend (evidence/ JSONL + agent_audit rows)
export default function Trace() {
  return (
    <View className='page'>
      <Text className='simulated'>示例数据 (static mock)</Text>
      {mockTrace.map((t, i) => (
        <View key={t.step} className='card'>
          <Text className='small'>{i + 1}. {t.step}</Text>
          <Text>{t.detail}</Text>
        </View>
      ))}
    </View>
  )
}
