import { Input, Text, View } from '@tarojs/components'
import type { ITouchEvent } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import AgentPanel, { Incoming } from '../../components/AgentPanel'
import ComparisonCard from '../../components/ComparisonCard'
import DemoCard from '../../components/DemoCard'
import FlagsCard from '../../components/FlagsCard'
import ForecastCard from '../../components/ForecastCard'
import LockCard from '../../components/LockCard'
import PayFlow from '../../components/PayFlow'
import ReadBackCard from '../../components/ReadBackCard'
import Screen from '../../components/Screen'
import SupportList from '../../components/SupportList'
import TaxPotOffer from '../../components/TaxPotOffer'
import { Dismissable, ErrorCard, Skeleton, Tap, useDelayed } from '../../components/ui'
import { API_BASE, ApiError, Compliance, Forecast, PolicyMatch, SecurityStatus, Structures, api, beginAction } from '../../services/api'
import { getSettings, setReducedMotion } from '../../utils/settings'

type Ask = 'compliance' | 'forecast' | 'policy'
type Entry = { id: number; kind: 'say' | 'agent' | Ask; text?: string } // the conversation stream, oldest first

// The questions the farmer can ask by tapping. The same sentences are the judge panel's preset prompts.
export const ASK_TEXT: Record<Ask, string> = { compliance: '我这样卖蜂蜜合规吗？', forecast: '收蜂蜜的钱够不够？', policy: '有没有什么补贴我能申请？' }
const ASK_BY_TEXT = Object.fromEntries(Object.entries(ASK_TEXT).map(([k, v]) => [v, k])) as Record<string, Ask>

// Recorder, mic permission and audio playback: WeChat has its own API, the web uses MediaRecorder and shows replies as text.
const WEAPP = process.env.TARO_ENV === 'weapp'
const WEB = process.env.TARO_ENV === 'h5'
let lastTyping: boolean | null = null // the composer mode is remembered while the app runs
const recorder = WEAPP ? Taro.getRecorderManager() : null
const audio = WEAPP ? Taro.createInnerAudioContext() : null
const WEB_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg']

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

let entryId = 0

export default function Chat({ external }: { external?: Incoming | null }) {
  const [recording, setRecording] = useState(false)
  const [heard, setHeard] = useState('')
  const [micHelp, setMicHelp] = useState(false)
  const [typing, setTyping] = useState(!(WEAPP || WEB) || !!lastTyping)
  const [cancelling, setCancelling] = useState(false) // finger slid up past the threshold
  const [tooShort, setTooShort] = useState(false)
  const touch = useRef({ y: 0, t: 0, discard: false, down: false })
  const web = useRef<{ mr: MediaRecorder; chunks: Blob[] } | null>(null)
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
  const [stream, setStream] = useState<Entry[]>([])
  const [confirm, setConfirm] = useState<{ text: string; transcript: string } | null>(null)
  const lastReply = useRef('')
  const [textReply, setTextReply] = useState('') // a reply shown as large text because there is no audio
  const slow = { compliance: useDelayed(busy === 'compliance'), forecast: useDelayed(busy === 'forecast'), policy: useDelayed(busy === 'policy') }

  // A card goes to the end of the stream when its question is asked; the agent's block keeps its place (it holds the session).
  const push = (kind: Entry['kind'], text?: string) =>
    setStream((s) => (kind === 'agent' && s.some((e) => e.kind === 'agent') ? s : [...s.filter((e) => e.kind !== kind || kind === 'say'), { id: ++entryId, kind, text }]))

  const ask = async (kind: Ask, run: () => Promise<void>) => {
    if (busy) return
    beginAction()
    push('say', ASK_TEXT[kind])
    push(kind)
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
  const asks = { compliance: askCompliance, forecast: askForecast, policy: askPolicies }

  const answer = useRef<(ok: boolean) => void>()
  // large-font explanation (native modals ignore our font size)
  const explain = () => new Promise<boolean>((res) => { answer.current = res; setMicHelp(true) })

  useEffect(() => {
    if (!recorder) return
    recorder.onStop((res) => {
      setRecording(false)
      if (touch.current.discard) return // cancelled or too short: nothing is sent
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
    Taro.eventCenter.on('lock', refreshLock) // the judge panel's demo tools change the lock
    return () => { clearInterval(t); Taro.eventCenter.off('lock', refreshLock) }
  }, [])

  // The judge panel's preset prompts arrive as `external`: a question button's sentence runs that question, anything else goes to the agent.
  useEffect(() => {
    if (!external) return
    const k = ASK_BY_TEXT[external.text]
    if (k) asks[k]()
    else say(external.text, false)
  }, [external?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // keep the newest card in view inside the phone frame (cards also grow later: plan status, approval steps), unless the person scrolled far up
  useEffect(() => {
    const el = WEB ? document.querySelector('.phone-scroll') : null
    if (!el) return undefined
    const mo = new MutationObserver(() => { if (el.scrollHeight - el.scrollTop - el.clientHeight < 1200) el.scrollTop = el.scrollHeight })
    mo.observe(el, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [])

  const noMic = () => {
    lastTyping = true
    setTyping(true)
    setHeard('麦克风没有打开，没关系，请直接打字。')
  }
  const startWeb = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return noMic()
    let media: MediaStream
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      return noMic()
    }
    if (!touch.current.down) return media.getTracks().forEach((t) => t.stop()) // let go while the browser was still asking
    const mime = WEB_TYPES.find((t) => MediaRecorder.isTypeSupported(t))
    const mr = new MediaRecorder(media, mime ? { mimeType: mime } : undefined)
    const chunks: Blob[] = []
    mr.ondataavailable = (e) => chunks.push(e.data)
    mr.onstop = () => {
      media.getTracks().forEach((t) => t.stop())
      web.current = null
      setRecording(false)
      if (!touch.current.discard) listen(new Blob(chunks, { type: mr.mimeType }))
    }
    touch.current.discard = false
    touch.current.t = Date.now()
    setCancelling(false)
    setRecording(true)
    web.current = { mr, chunks }
    mr.start()
  }

  // Push-to-talk: hold to speak, release to send.
  const start = async () => {
    touch.current.down = true
    if (WEB) return startWeb()
    if (!recorder || !(await ensureMic(explain))) return
    touch.current.discard = false
    touch.current.t = Date.now()
    setCancelling(false)
    setRecording(true)
    recorder.start({ format: 'mp3', duration: 60000 })
  }
  const stop = () => {
    touch.current.down = false
    if (!recorder && !web.current) return
    if (cancelling) touch.current.discard = true
    else if (Date.now() - touch.current.t < 600) {
      touch.current.discard = true
      setTooShort(true)
      setTimeout(() => setTooShort(false), 1200)
    }
    setCancelling(false)
    if (web.current) web.current.mr.stop()
    else recorder?.stop()
  }
  const clientY = (e: unknown) => (e as ITouchEvent).touches[0].clientY // the typed handler props only promise a plain event
  const moveTo = (y: number) => { // sliding up past 60px (about 120rpx) switches to cancel
    const dy = touch.current.y - y
    if (dy > 60 !== cancelling) setCancelling(dy > 60)
  }
  // on the web one pointer covers finger and mouse; capture keeps the release even when it lands outside the pill
  const pointer = (e: unknown) => e as PointerEvent & { target: Element }
  const webPill = {
    onPointerDown: (e: unknown) => { const p = pointer(e); p.target.setPointerCapture?.(p.pointerId); touch.current.y = p.clientY; start() },
    onPointerMove: (e: unknown) => { if (touch.current.down) moveTo(pointer(e).clientY) },
    onPointerUp: stop,
    onPointerCancel: stop,
  } as object
  const say = (t: string, voice: boolean) => {
    push('say', t)
    push('agent')
    setIncoming({ id: Date.now(), text: t, voice })
  }
  const sendText = () => {
    if (!text.trim()) return
    say(text.trim(), false)
    setText('')
  }

  // The recording goes to the server for a transcript. Doubtful audio or a confusable number is read back first.
  const listen = (src: string | Blob) => {
    setHeard('正在听…')
    beginAction()
    api.voiceAsr(src).then((r) => {
      if (!r.transcript.trim()) return setHeard('没听清，请再说一次，或者打字。')
      if (r.needs_confirm) {
        setHeard('')
        return setConfirm({ text: r.confirm_text_zh, transcript: r.transcript })
      }
      setHeard('')
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

  const toggleMode = () => { lastTyping = !typing; setTyping(!typing) }
  const bar = (
    <>
      {(WEAPP || WEB) && <View className='mode' hoverClass='pressed' hoverStartTime={0} hoverStayTime={100} onClick={toggleMode}><Text>{typing ? '🎤' : '⌨️'}</Text></View>}
      {typing ? (
        <>
          <Input className='input' value={text} placeholder='打字告诉我' confirmType='send' onInput={(e) => setText(e.detail.value)} onConfirm={sendText} />
          <View className={`send ${text.trim() ? '' : 'off'}`} hoverClass='pressed' hoverStartTime={0} hoverStayTime={100} onClick={sendText}><Text>发送</Text></View>
        </>
      ) : (
        <View className={`pill ${recording ? 'on' : ''}`} hoverClass='pill-down' hoverStartTime={0} hoverStayTime={0}
          {...(WEB ? webPill : { onTouchStart: (e: unknown) => { touch.current.y = clientY(e); start() }, onTouchMove: (e: unknown) => moveTo(clientY(e)), onTouchEnd: stop, onTouchCancel: stop })}>
          <Text>按住 说话</Text>
        </View>
      )}
    </>
  )

  const card = (e: Entry) => {
    switch (e.kind) {
      case 'say': return <View key={e.id} className='bubble enter-up'><Text>{e.text}</Text></View>
      case 'agent': return <AgentPanel key={e.id} incoming={incoming} onReply={onReply} bare={WEB} />
      case 'compliance': return (
        <View key={e.id} className='stack'>
          {slow.compliance && !compliance && <Skeleton />}
          {failed === 'compliance' && <ErrorCard onRetry={askCompliance} />}
          {compliance && <FlagsCard data={compliance} />}
          {compliance && <TaxPotOffer />}
          {structures && <ComparisonCard data={structures} />}
        </View>
      )
      case 'forecast': return (
        <View key={e.id} className='stack'>
          {slow.forecast && !forecast && <Skeleton />}
          {failed === 'forecast' && <ErrorCard onRetry={askForecast} />}
          {forecast && <ForecastCard data={forecast} />}
        </View>
      )
      default: return (
        <View key={e.id} className='stack'>
          {slow.policy && !policies && <Skeleton />}
          {failed === 'policy' && <ErrorCard onRetry={askPolicies} />}
          {policies && <SupportList data={policies} />}
        </View>
      )
    }
  }

  return (
    <Screen title='元农民助手' sub='人工智能，不是真人' bar={bar}>
      {(recording || tooShort) && (
        <View className={`hold ${cancelling ? 'cancel' : ''}`}>
          {tooShort ? <Text className='hold-text'>说话时间太短</Text> : (
            <>
              <Text className='hold-mic'>🎤</Text>
              <View className='levels'>{[0, 1, 2, 3, 4].map((i) => <View key={i} className='level' />)}</View>
              <Text className='hold-text'>{cancelling ? '松开 取消' : '松开 发送'}</Text>
              {!cancelling && <Text className='small'>上滑 取消</Text>}
            </>
          )}
        </View>
      )}
      <Text className='note'>Mock Bank — simulated accounts · 模拟账户，数据均为虚构</Text>
      {lock && <LockCard status={lock} />}
      <View className='card'>
        <Text className='card-title'>王大爷，您好。想办什么事？</Text>
        <Text className='muted'>按住下面的按钮说话，或者点一个常问的问题。</Text>
        <View className='ask'>
          {(Object.keys(ASK_TEXT) as Ask[]).map((k) => (
            <Tap key={k} kind='secondary' wide onClick={asks[k]}>{busy === k ? '正在查…' : ASK_TEXT[k]}</Tap>
          ))}
        </View>
        <View className='row'><Tap kind='quiet' onClick={() => playReply()}>🔊 再听一遍</Tap></View>
      </View>
      {micHelp && (
        <Dismissable from='up' onDone={() => { setMicHelp(false); answer.current?.(false) }}>
          <Text className='card-title'>需要使用麦克风</Text>
          <Text>您需要对着手机说话，我才能听懂。请在设置里打开“麦克风”。</Text>
          <Tap kind='primary' wide onClick={() => { setMicHelp(false); answer.current?.(true) }}>去设置</Tap>
        </Dismissable>
      )}

      {stream.map(card)}

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

      {!WEB && (
        <>
          <Text className='card-q'>办一件事</Text>
          <View className='ask'><PayFlow /></View>
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
          </View>
        </>
      )}
    </Screen>
  )
}
