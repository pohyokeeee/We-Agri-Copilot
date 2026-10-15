import { Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { Approval, api } from '../../services/api'

const COSIGNER_ID = 2 // TODO: from login; demo = Uncle Wang's daughter

const FALLBACK: Approval = { // shown when the backend is not running
  approval_id: 0, action: 'transfer', payload: { payee: '孙海', amount: 4800 }, tier: 'red',
  reasons: ['new payee', 'night-time (23:00-06:00)'], requires_cosigner: true, status: 'pending', approval_token: null,
}

export default function Cosigner() {
  const [req, setReq] = useState<Approval | null>(null)
  const [pin, setPin] = useState('')

  useEffect(() => {
    api.pendingForCosigner(COSIGNER_ID).then((l) => setReq(l[0] ?? null)).catch(() => setReq(FALLBACK))
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

  if (!req) return <View className='page'><Text className='card-title'>现在没有需要您确认的事</Text></View>
  return (
    <View className='page'>
      <View className='card'>
        <Text className='tag tier-red'>需要您确认</Text>
        <Text className='card-title'>{req.action === 'unlock' ? '解除安全锁' : '一笔转账'}</Text>
        <Text>{JSON.stringify(req.payload)}</Text>
        <Text>为什么要您确认：{req.reasons.join('；') || '账户开启了家人保护'}</Text>
      </View>
      <Input className='btn' type='number' password maxlength={6} placeholder='您的6位密码' onInput={(e) => setPin(e.detail.value)} />
      <View className='row'>
        <View className='btn btn-primary' onClick={() => answer(true)}><Text>同意</Text></View>
        <View className='btn btn-danger' onClick={() => answer(false)}><Text>拒绝</Text></View>
      </View>
    </View>
  )
}
