import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { ReactNode, useState } from 'react'
import { api } from '../services/api'
import { Tap, yuan } from './ui'

// For showing the two safety stories live: money arriving (tax pot) and a suspicious order note (lock). Demo data only.
// `children` are extra operations the caller wants in the same list (the web judge panel adds reset).
export default function DemoCard({ onChanged, children }: { onChanged: () => void; children?: ReactNode }) {
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const run = (fn: () => Promise<string>) => {
    if (busy) return
    setBusy(true)
    fn().then(setMsg).catch(() => setMsg('连不上银行，请稍后再试')).finally(() => { setBusy(false); onChanged() })
  }
  const payout = () => api.demoPayout().then((r) => {
    Taro.eventCenter.trigger('demo', { kind: 'payout', data: r }) // the farmer's phone shows the card
    return r.moved > 0 ? `收到 ${yuan(r.amount)} 元，自动留出税金 ${yuan(r.moved)} 元（税金一共 ${yuan(r.pot_total)} 元）` : `收到 ${yuan(r.amount)} 元，还没有设置自动留税金的规矩`
  })
  const orders = () => api.demoImportSuspicious().then((r) => {
    Taro.eventCenter.trigger('demo', { kind: 'notice' })
    return r.flagged.length ? `导入了 ${r.new} 单，其中 ${r.flagged.length} 单的留言可疑，已暂停转账` : `导入了 ${r.new} 单，没有发现可疑内容`
  })
  return (
    <View className='stack'>
      {children}
      <View className='op'><Tap kind='secondary' wide onClick={() => run(payout)}>收到一笔转卖货款</Tap><Text className='note'>模拟平台打来一笔转卖货款，看税金怎么自动留出。</Text></View>
      <View className='op'><Tap kind='secondary' wide onClick={() => run(orders)}>导入可疑订单</Tap><Text className='note'>模拟一条带可疑留言的新订单，看安全锁怎么拦住转账。</Text></View>
      {msg && <Text>{msg}</Text>}
    </View>
  )
}
