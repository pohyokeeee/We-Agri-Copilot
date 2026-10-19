import { Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import AgentPanel, { Incoming } from '../../components/AgentPanel'
import ComparisonCard from '../../components/ComparisonCard'
import DemoCard from '../../components/DemoCard'
import FlagsCard from '../../components/FlagsCard'
import ForecastCard from '../../components/ForecastCard'
import LockCard from '../../components/LockCard'
import PayFlow from '../../components/PayFlow'
import PlanCard from '../../components/PlanCard'
import ReadBackCard from '../../components/ReadBackCard'
import Screen from '../../components/Screen'
import SupportList from '../../components/SupportList'
import TaxPotOffer from '../../components/TaxPotOffer'
import { Dismissable, ErrorCard, Skeleton, Tap, useDelayed } from '../../components/ui'
import { API_BASE, ApiError, Compliance, Forecast, PolicyMatch, SecurityStatus, Structures, api, beginAction } from '../../services/api'
import { mockPlan, mockReadBack } from '../../mock'
import { getSettings, setReducedMotion } from '../../utils/settings'

type Ask = 'compliance' | 'forecast' | 'policy'

// Recorder, mic permission and audio playback exist only in WeChat. The H5 preview types instead and shows replies as text.
const WEAPP = process.env.TARO_ENV === 'weapp'
const recorder = WEAPP ? Taro.getRecorderManager() : null
const audio = WEAPP ? Taro.createInnerAudioContext() : null

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
  const [typing, setTyping] = useState(!WEAPP)
  const [text, setText] = useState('')
  const [reduced, setReduced] = useState(getSettings().reducedMotion)
  const [busy, setBusy] = useState<Ask | ''>('') // which question is loading
  const [failed, setFailed] = useState<Ask | ''>('') // which question could not reach the backend
  const [compliance, setCompliance] = useState<Compliance | null>(null)
  const [structures, setStructures] = useState<Structures | null>(null)
  const [forecast, setForecast] = useState<Forecast | null>(null)
  const [policies, setPolicies] = useState<PolicyMatch | null>(null)
  const [lock, setLock] = useState<SecurityStatus | null>(null)
  const [incoming, setIncoming] = useState<Incoming | null>(null)
  const [confirm, setConfirm] = useState<{ text: string; transcript: string } | null>(null)
  const lastReply = useRef('')
  const [textReply, setTextReply] = useState('') // a reply shown as large text because there is no audio
  const slow = { compliance: useDelayed(busy === 'compliance'), forecast: useDelayed(busy === 'forecast'), policy: useDelayed(busy === 'policy') }

  // Voice comes later: for now buttons ask the questions.
  const ask = async (kind: Ask, run: () => Promise<void>) => {
    if (busy) return
    beginAction()
    setBusy(kind)
    setFailed('')
    try {
      await run()
    } catch {
      setFailed(kind)
    } finally {
      setBusy('')
    }
  }
  const askCompliance = () => ask('compliance', async () => {
    const c = await api.compliance() // compliance first, then the comparison for the same period
    const s = await api.structures(c.period)
    setCompliance(c)
    setStructures(s)
  })
  const askForecast = () => ask('forecast', async () => setForecast(await api.procurementForecast()))
  const askPolicies = () => ask('policy', async () => setPolicies(await api.policyMatch()))

  const answer = useRef<(ok: boolean) => void>()
  // large-font explanation (native modals ignore our font size)
  const explain = () => new Promise<boolean>((res) => { answer.current = res; setMicHelp(true) })

  useEffect(() => {
    if (!recorder) return
    recorder.onStop((res) => {
      setRecording(false)
      listen(res.tempFilePath)
    })
    recorder.onError(() => {
      setRecording(false)
      Taro.showToast({ title: '请允许使用麦克风', icon: 'none' })
    })
  }, [])

  // The lock can be set by something that happened elsewhere (a suspicious order note), so look again every 10 seconds.
  const refreshLock = () => { api.securityStatus().then(setLock).catch(() => undefined) }
  useEffect(() => {
    refreshLock()
    const t = setInterval(refreshLock, 10000)
    return () => clearInterval(t)
  }, [])

  // Push-to-talk: hold to speak, release to send.
  const start = async () => {
    if (!recorder || !(await ensureMic(explain))) return
    setRecording(true)
    recorder.start({ format: 'mp3', duration: 60000 })
  }
  const stop = () => recorder?.stop()
  const say = (t: string, voice: boolean) => setIncoming({ id: Date.now(), text: t, voice })
  const sendText = () => {
    if (!text.trim()) return
    say(text.trim(), false)
    setText('')
  }

  // The recording goes to the server for a transcript. Doubtful audio or a confusable number is read back first.
  const listen = (path: string) => {
    setHeard('正在听…')
    beginAction()
    api.voiceAsr(path).then((r) => {
      if (!r.transcript.trim()) return setHeard('没听清，请再说一次，或者打字。')
      if (r.needs_confirm) {
        setHeard('')
        return setConfirm({ text: r.confirm_text_zh, transcript: r.transcript })
      }
      setHeard(`我听到：${r.transcript}`)
      say(r.transcript, true)
    }).catch((e) => setHeard(e instanceof ApiError && typeof e.data.detail === 'string' ? e.data.detail : '连不上语音识别，请直接打字。'))
  }

  // Speak a reply (the server puts 元农民助手： in front of every clip). With no audio (the provider has no speech, or it is
  // down) the same words are shown as large text with the AI label. That is a normal way to answer, not an error.
  const playReply = (t?: string) => {
    const words = t ?? (lastReply.current || '王大爷，您好。想办什么事？')
    if (!audio) return setTextReply(words) // H5: nothing to play, so the words are shown instead
    api.voiceTts(words).then((r) => {
      if (!r) return setTextReply(words)
      setTextReply('')
      audio.src = `${API_BASE}${r.audio_url}`
      audio.play()
    }).catch(() => setTextReply(words))
  }
  const onReply = (t: string, voice: boolean) => {
    lastReply.current = t
    if (voice) playReply(t)
  }

  const bar = (
    <>
      {typing ? (
        <View className='bar-row'>
          <Input className='input' value={text} placeholder='打字告诉我' confirmType='send' onInput={(e) => setText(e.detail.value)} onConfirm={sendText} />
          <Tap kind='primary' onClick={sendText}>发送</Tap>
        </View>
      ) : (
        <View className='bar-row'>
          <View className='ptt-wrap'>
            <View className={`ring ${recording ? 'on' : ''}`} />
            <View className={`ptt ${recording ? 'on' : ''}`} onTouchStart={start} onTouchEnd={stop} onTouchCancel={stop}>
              <Text>{recording ? '松开发送' : '按住说话'}</Text>
            </View>
          </View>
        </View>
      )}
      {WEAPP && <Tap kind='quiet' onClick={() => setTyping(!typing)}>{typing ? '改用说话' : '改用打字'}</Tap>}
      <Text className='note'>这是信息，不是建议 · 请咨询12366</Text>
    </>
  )

  return (
    <Screen title='元农民助手' sub='（人工智能，不是真人）' bar={bar}>
      <Text className='note'>Mock Bank — simulated accounts · 模拟账户，数据均为虚构</Text>
      {lock && <LockCard status={lock} />}
      <View className='card'>
        <Text className='card-title'>王大爷，您好。想办什么事？</Text>
        <Text className='muted'>按住下面的按钮说话，或者点一个常问的问题。</Text>
        <View className='row'><Tap kind='quiet' onClick={() => playReply()}>🔊 再听一遍</Tap></View>
      </View>
      {micHelp && (
        <Dismissable from='up' onDone={() => { setMicHelp(false); answer.current?.(false) }}>
          <Text className='card-title'>需要使用麦克风</Text>
          <Text>您需要对着手机说话，我才能听懂。请在设置里打开“麦克风”。</Text>
          <Tap kind='primary' wide onClick={() => { setMicHelp(false); answer.current?.(true) }}>去设置</Tap>
        </Dismissable>
      )}
      {heard && <Text className='card enter-down'>{heard}</Text>}
      {textReply && (
        <View className='card enter-down'>
          <Text className='card-q'>元农民助手（人工智能）</Text>
          <Text className='card-title'>{textReply}</Text>
          <View className='row'><Tap kind='quiet' onClick={() => setTextReply('')}>知道了</Tap></View>
        </View>
      )}
      {confirm && (
        <ReadBackCard text={confirm.text} yesLabel='对，就是这样' noLabel='不对，我再说一次'
          onYes={() => { say(confirm.transcript, true); setConfirm(null) }} onNo={() => { setConfirm(null); setHeard('好的，请再说一次。') }} />
      )}

      <AgentPanel incoming={incoming} onReply={onReply} />

      <Text className='card-q'>办一件事</Text>
      <View className='ask'><PayFlow /></View>

      <Text className='card-q'>常问的几件事</Text>
      <View className='ask'>
      <Tap kind='secondary' wide onClick={askCompliance}>{busy === 'compliance' ? '正在查…' : '我这样卖蜂蜜合规吗？'}</Tap>
      {slow.compliance && !compliance && <Skeleton />}
      {failed === 'compliance' && <ErrorCard onRetry={askCompliance} />}
      {compliance && <FlagsCard data={compliance} />}
      {compliance && <TaxPotOffer />}
      {structures && <ComparisonCard data={structures} />}

      <Tap kind='secondary' wide onClick={askForecast}>{busy === 'forecast' ? '正在算…' : '收蜂蜜的钱够不够？'}</Tap>
      {slow.forecast && !forecast && <Skeleton />}
      {failed === 'forecast' && <ErrorCard onRetry={askForecast} />}
      {forecast && <ForecastCard data={forecast} />}

      <Tap kind='secondary' wide onClick={askPolicies}>{busy === 'policy' ? '正在查…' : '有没有什么补贴我能申请？'}</Tap>
      {slow.policy && !policies && <Skeleton />}
      {failed === 'policy' && <ErrorCard onRetry={askPolicies} />}
      {policies && <SupportList data={policies} />}
      </View>

      <View className='row'>
        <Tap kind='quiet' onClick={() => { setReducedMotion(!reduced); setReduced(!reduced) }}>{reduced ? '开启动画' : '减少动画'}</Tap>
      </View>

      <View className='demo'>
        <Text className='card-q'>演示工具（仅供演示，不是办事流程）</Text>
        <DemoCard onChanged={refreshLock} />
        <View className='row'>
          <Tap kind='secondary' onClick={() => Taro.navigateTo({ url: '/pages/cosigner/index' })}>家人确认页</Tap>
          <Tap kind='secondary' onClick={() => Taro.navigateTo({ url: '/pages/trace/index' })}>评委控制台</Tap>
        </View>
        <Text className='card-q'>界面示例（演示数据）</Text>
        <PlanCard title={mockPlan.title} steps={mockPlan.steps} />
        <ReadBackCard {...mockReadBack} />
      </View>
    </Screen>
  )
}
