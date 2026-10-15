import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import ComparisonCard from '../../components/ComparisonCard'
import FlagsCard from '../../components/FlagsCard'
import PlanCard from '../../components/PlanCard'
import ReadBackCard from '../../components/ReadBackCard'
import SupportCard from '../../components/SupportCard'
import { Compliance, Structures, api } from '../../services/api'
import { mockPlan, mockReadBack, mockSupport } from '../../mock'

const recorder = Taro.getRecorderManager()
const audio = Taro.createInnerAudioContext()

// scope.record cannot go in app.json; ask at first use. Once denied, authorize() no longer prompts,
// so explain and send the user to the settings page.
async function ensureMic(explain: () => Promise<boolean>): Promise<boolean> {
  const { authSetting } = await Taro.getSetting()
  if (authSetting['scope.record']) return true
  if (authSetting['scope.record'] === undefined) {
    try {
      await Taro.authorize({ scope: 'scope.record' })
      return true
    } catch {
      // denied just now: fall through to the explanation
    }
  }
  if (!(await explain())) return false
  const { authSetting: after } = await Taro.openSetting()
  return !!after['scope.record']
}

export default function Chat() {
  const [recording, setRecording] = useState(false)
  const [heard, setHeard] = useState('')
  const [micHelp, setMicHelp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [compliance, setCompliance] = useState<Compliance | null>(null)
  const [structures, setStructures] = useState<Structures | null>(null)

  // Voice comes later: for now a button asks the same question. Compliance first, then the comparison.
  const askCompliance = async () => {
    setLoading(true)
    setError(false)
    try {
      const c = await api.compliance()
      const s = await api.structures(c.period)
      setCompliance(c)
      setStructures(s)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }
  const answer = useRef<(ok: boolean) => void>()
  // large-font explanation (native modals ignore our font size)
  const explain = () => new Promise<boolean>((res) => { answer.current = res; setMicHelp(true) })

  useEffect(() => {
    recorder.onStop((res) => {
      setRecording(false)
      // TODO: upload res.tempFilePath to the backend ASR (app/voice/asr.py is a stub), then show the transcript
      setHeard(`已录音 (${Math.round((res.duration || 0) / 1000)} 秒)，语音识别还没接上`)
    })
    recorder.onError(() => {
      setRecording(false)
      Taro.showToast({ title: '请允许使用麦克风', icon: 'none' })
    })
  }, [])

  // Push-to-talk: hold to speak, release to send.
  const start = async () => {
    if (!(await ensureMic(explain))) return
    setRecording(true)
    recorder.start({ format: 'mp3', duration: 60000 })
  }
  const stop = () => recorder.stop()

  // TODO: backend returns a TTS url (already prefixed with the spoken AI label "元农民助手：")
  const playReply = (url?: string) => { if (url) { audio.src = url; audio.play() } }

  return (
    <View className='page'>
      <Text className='simulated'>Mock Bank — simulated accounts · 模拟账户，数据均为虚构</Text>
      <View className='card'>
        <Text className='small'>元农民助手（人工智能，不是真人）</Text>
        <Text className='card-title'>王大爷，您好。想办什么事？</Text>
        <View className='btn' onClick={() => playReply()}><Text>🔊 再听一遍</Text></View>
      </View>
      {micHelp && (
        <View className='card'>
          <Text className='card-title'>需要使用麦克风</Text>
          <Text>您需要对着手机说话，我才能听懂。请在设置里打开“麦克风”。</Text>
          <View className='row'>
            <View className='btn btn-primary' onClick={() => { setMicHelp(false); answer.current?.(true) }}><Text>去设置</Text></View>
            <View className='btn' onClick={() => { setMicHelp(false); answer.current?.(false) }}><Text>不用了</Text></View>
          </View>
        </View>
      )}
      {heard && <Text>{heard}</Text>}

      {/* static mock cards until the agent exists */}
      <PlanCard title={mockPlan.title} steps={mockPlan.steps} />
      <View className='btn btn-primary' onClick={loading ? undefined : askCompliance}>
        <Text>{loading ? '正在查，请稍等…' : '我这样卖蜂蜜合规吗？'}</Text>
      </View>
      {error && (
        <View className='card'>
          <Text className='card-title'>现在连不上服务器</Text>
          <Text>请确认后台已经打开，然后再点一次。</Text>
        </View>
      )}
      {compliance && <FlagsCard data={compliance} />}
      {structures && <ComparisonCard data={structures} />}
      <SupportCard {...mockSupport} />
      <ReadBackCard {...mockReadBack} />

      <View
        className={`btn ${recording ? 'btn-danger' : 'btn-primary'}`}
        style={{ minHeight: '160px' }}
        onTouchStart={start}
        onTouchEnd={stop}
      >
        <Text>{recording ? '松开发送' : '按住说话'}</Text>
      </View>
      <View className='row'>
        <View className='btn' onClick={() => Taro.navigateTo({ url: '/pages/cosigner/index' })}><Text>家人确认页</Text></View>
        <View className='btn' onClick={() => Taro.navigateTo({ url: '/pages/trace/index' })}><Text>评委控制台</Text></View>
      </View>
    </View>
  )
}
