import { Text, View } from '@tarojs/components'
import { useState } from 'react'
import { api } from '../services/api'
import { Tap, yuan } from './ui'

// For showing the two safety stories live: money arriving (tax pot) and a suspicious order note (lock). Demo data only.
export default function DemoCard({ onChanged }: { onChanged: () => void }) {
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const run = (fn: () => Promise<string>) => {
    if (busy) return
    setBusy(true)
    fn().then(setMsg).catch(() => setMsg('连不上银行，请稍后再试')).finally(() => { setBusy(false); onChanged() })
  }
  const payout = () => api.demoPayout().then((r) =>
    r.moved > 0 ? `收到 ${yuan(r.amount)} 元，自动留出税金 ${yuan(r.moved)} 元（税金一共 ${yuan(r.pot_total)} 元）` : `收到 ${yuan(r.amount)} 元，还没有设置自动留税金的规矩`)
  const orders = () => api.demoImportSample().then((r) =>
    r.flagged.length ? `导入了 ${r.new} 单，其中 ${r.flagged.length} 单的留言可疑，已暂停转账` : `导入了 ${r.new} 单，没有发现可疑内容`)
  return (
    <View className='card'>
      <Text className='card-q'>演示用（模拟外面发来的消息）</Text>
      <Tap kind='secondary' wide onClick={() => run(payout)}>收到一笔转卖货款</Tap>
      <Tap kind='secondary' wide onClick={() => run(orders)}>导入新订单（含可疑留言）</Tap>
      {msg && <Text>{msg}</Text>}
    </View>
  )
}
