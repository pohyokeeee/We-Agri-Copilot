import { Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import Screen from '../../components/Screen'
import { EmptyCard, Skeleton, Tap, TierChip, useDelayed, yuan } from '../../components/ui'
import { Approval, api } from '../../services/api'

const COSIGNER_ID = 2 // TODO: from login; demo = Uncle Wang's daughter

const FALLBACK: Approval = { // shown when the backend is not running
  approval_id: 0, action: 'transfer', payload: { payee: '孙海', amount: 4800 }, tier: 'red',
  reasons: ['new payee', 'night-time (23:00-06:00)'], requires_cosigner: true, status: 'pending', approval_token: null,
}
const REASON_ZH: Record<string, string> = { 'new payee': '新的收款人', 'night-time (23:00-06:00)': '夜里 23 点到 6 点' }

export default function Cosigner() {
  const [req, setReq] = useState<Approval | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [pin, setPin] = useState('')
  const slow = useDelayed(!loaded)

  useEffect(() => {
    api.pendingForCosigner(COSIGNER_ID).then((l) => setReq(l[0] ?? null)).catch(() => setReq(FALLBACK)).finally(() => setLoaded(true))
  }, [])

  const answer = async (approve: boolean) => {
    if (!req || pin.length !== 6) return Taro.showToast({ title: '请输入6位密码', icon: 'none' })
    try {
      await api.cosign(req.approval_id, COSIGNER_ID, pin, approve)
      Taro.showToast({ title: approve ? '已同意' : '已拒绝' })
      setReq(null)
    } catch (e) {
      Taro.showToast({ title: '失败，请重试', icon: 'none' })
    }
  }

  const amount = Number(req?.payload.amount)
  return (
    <Screen title='家人确认' back>
      {!loaded && slow && <Skeleton />}
      {loaded && !req && <EmptyCard>现在没有需要您确认的事</EmptyCard>}
      {req && (
        <>
          <View className='card enter-down'>
            <Text className='card-q'>{req.action === 'unlock' ? '有人要解除安全锁' : '有一笔转账等您确认'}</Text>
            {amount > 0 && <View><Text className='number'>{yuan(amount)}</Text><Text className='unit'>元</Text></View>}
            {typeof req.payload.payee === 'string' && <Text className='card-title'>给 {req.payload.payee}</Text>}
            <View className='row'><TierChip tier={req.tier} /></View>
            <View className='inset'>
              <Text className='small muted'>为什么要您确认</Text>
              {(req.reasons.length ? req.reasons : ['账户开启了家人保护']).map((r) => <Text key={r}>· {REASON_ZH[r] ?? r}</Text>)}
            </View>
          </View>
          <Input className='input' type='number' password maxlength={6} placeholder='您的6位密码' onInput={(e) => setPin(e.detail.value)} />
          <Tap kind='primary' wide onClick={() => answer(true)}>同意</Tap>
          <Tap kind='secondary' wide onClick={() => answer(false)}>拒绝</Tap>
        </>
      )}
    </Screen>
  )
}
