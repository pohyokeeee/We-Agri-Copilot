import { Text, View } from '@tarojs/components'
import Screen from '../../components/Screen'
import { mockTrace } from '../../mock'

// Judge console: transcript -> DAG -> tier + reasons -> API calls -> audit hash. Denser than the farmer screens.
// TODO: replace mockTrace with the run log from the backend (evidence/ JSONL + agent_audit rows)
export default function Trace() {
  return (
    <Screen title='评委控制台' back>
      <Text className='note'>示例数据 (static mock)</Text>
      {mockTrace.map((t, i) => (
        <View key={t.step} className='card enter-down'>
          <Text className='card-q'>{i + 1}. {t.step}</Text>
          <Text className={t.step === '审计哈希' || t.step === '银行接口调用' ? 'mono' : ''}>{t.detail}</Text>
        </View>
      ))}
    </Screen>
  )
}
