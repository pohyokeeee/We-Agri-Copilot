import { Text, View } from '@tarojs/components'
import { useCallback, useEffect, useState } from 'react'
import PinPad from '../../components/PinPad'
import Screen from '../../components/Screen'
import { EmptyCard, ErrorCard, Skeleton, Tap, useDelayed } from '../../components/ui'
import { ApiError, CosignRequest, api } from '../../services/api'

const COSIGNER_ID = 2 // TODO: from login; demo = Uncle Wang's daughter
const POLL_MS = 3000

export default function Cosigner() {
  const [list, setList] = useState<CosignRequest[] | null>(null) // null = not loaded yet
  const [down, setDown] = useState(false)
  const [asking, setAsking] = useState<number | null>(null) // request whose PIN pad is open
  const [verifying, setVerifying] = useState(false)
  const [wrong, setWrong] = useState('')
  const [done, setDone] = useState('')
  const slow = useDelayed(list === null && !down)

  const load = useCallback(async () => {
    try { setList(await api.cosignPending(COSIGNER_ID)); setDown(false) } catch { setDown(true) }
  }, [])
  useEffect(() => {
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  const approve = async (r: CosignRequest, pin: string) => {
    setVerifying(true)
    setWrong('')
    try {
      await api.cosignApprove(r.id, COSIGNER_ID, pin)
      setAsking(null)
      setDone('已同意')
      load()
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setWrong('密码不对，请再试一次')
      else if (e instanceof ApiError && e.status === 423) { setWrong('密码输错太多次，已锁住'); setAsking(null) }
      else if (e instanceof ApiError) { setAsking(null); load() } // already decided or timed out
      else setWrong('连不上银行，请稍后再试')
    } finally {
      setVerifying(false)
    }
  }
  const decline = async (r: CosignRequest) => {
    try { await api.cosignDecline(r.id, COSIGNER_ID); setDone('已拒绝'); load() } catch { setDown(true) }
  }

  return (
    <Screen title='家人确认' back>
      {done && <View className='row'><Text className='chip chip-done'>✓ {done}</Text></View>}
      {down && <ErrorCard onRetry={load} />}
      {list === null && slow && <Skeleton />}
      {list?.length === 0 && !down && <EmptyCard>现在没有需要您确认的事</EmptyCard>}
      {list?.map((r) => (
        <View key={r.id} className='card enter-down'>
          <Text className='card-q'>有一件事等您确认</Text>
          <Text className='card-title'>{r.summary_zh}</Text>
          <View className='inset'>
            <Text className='small muted'>为什么要您确认</Text>
            {(r.reasons_zh.length ? r.reasons_zh : ['账户开启了家人保护']).map((x) => <Text key={x}>· {x}</Text>)}
          </View>
          <Text className='small muted'>还剩 {r.seconds_left} 秒，超时就不转了</Text>
          {asking === r.id ? (
            <>
              <Text className='card-title'>请输入您的6位密码</Text>
              {wrong && <Text className='chip chip-red'>■ {wrong}</Text>}
              <PinPad busy={verifying} onComplete={(pin) => approve(r, pin)} />
              <Tap kind='quiet' onClick={() => { setAsking(null); setWrong('') }}>先不同意</Tap>
            </>
          ) : (
            <>
              <Tap kind='primary' wide onClick={() => { setAsking(r.id); setDone('') }}>同意</Tap>
              <Tap kind='secondary' wide onClick={() => decline(r)}>拒绝</Tap>
            </>
          )}
        </View>
      ))}
    </Screen>
  )
}
