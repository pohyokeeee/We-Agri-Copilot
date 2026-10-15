import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import ComparisonCard from '../../components/ComparisonCard'
import PlanCard from '../../components/PlanCard'
import ReadBackCard from '../../components/ReadBackCard'
import SupportCard from '../../components/SupportCard'
import { mockComparison, mockPlan, mockReadBack, mockSupport } from '../../mock'

const recorder = Taro.getRecorderManager()
const audio = Taro.createInnerAudioContext()

export default function Chat() {
  const [recording, setRecording] = useState(false)
  const [heard, setHeard] = useState('')

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
  const start = () => { setRecording(true); recorder.start({ format: 'mp3', duration: 60000 }) }
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
      {heard && <Text>{heard}</Text>}

      {/* static mock cards until the agent exists */}
      <PlanCard title={mockPlan.title} steps={mockPlan.steps} />
      <ComparisonCard {...mockComparison} />
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
