import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { askConfirm, cancelAsk, dismissAnswer, say, startPlan } from '../state/actions'
import { uiStore, useUi } from '../state/store'
import { live as backendUp } from '../state/live'
import { startRecording, stopRecording, transcribe } from '../state/liveVoice'

const ROUTES: [RegExp, string, [string, string]][] = [
  [/补贴|贷款|subsid|loan/i, '/support', ['补贴与贷款', 'Support & loans']],
  [/申请|进度|application/i, '/applications', ['我的申请', 'My applications']],
  [/税|买了|卖了|tax|bought|sold/i, '/tax/check', ['税务检查', 'Tax check']],
  [/转|付|pay/i, '/pay', ['付款', 'Payments']],
  [/收购|够不够|cash/i, '/season', ['收购准备', 'Buying prep']],
]

/**
 * The assistant sits at the bottom of every farmer screen: hold to talk, or type. It does not open a chat.
 * The answer is a short strip, and the real work happens on a screen (or the Plan screen for the one-sentence request).
 * Phase 1: holding the button always "hears" the honey-season sentence; real speech arrives in Phase 2.
 */
export function AskBar() {
  const t = useT()
  const nav = useNavigate()
  const loc = useLocation()
  const ask = useUi((u) => u.ask)
  const heard = useUi((u) => u.heard)
  const answer = useUi((u) => u.answer)
  const tipSeen = useUi((u) => u.tipSeen)
  const [live, setLive] = useState(false)
  const [text, setText] = useState('')
  const who = t('元农民助手（人工智能）', 'Yuan Nongmin assistant (AI)')

  /** A finished recording: with a speech service, act on what was heard; without one, the Phase 1 stand-in sentence. */
  const heardIt = async () => {
    const clip = await stopRecording()
    const r = clip && backendUp() ? await transcribe(clip) : null
    if (!r?.transcript) return askConfirm()
    if (r.needs_confirm) {
      uiStore.update((u) => void ((u.heard = r.transcript), (u.ask = 'confirm')))
      return
    }
    run(r.transcript)
  }
  const go = () => {
    const q = text.trim()
    if (!q) return
    setText('')
    run(q)
  }
  const run = (q: string) => {
    if (/像去年一样/.test(q)) {
      startPlan('sup')
      return nav('/plan')
    }
    if (/收蜂蜜|准备|ready|honey season/i.test(q)) return askConfirm()
    const hit = ROUTES.find((r) => r[0].test(q))
    if (hit) {
      nav(hit[1])
      say(t(`已打开“${hit[2][0]}”。`, `Opened “${hit[2][1]}”.`))
    } else say(t('这个我还不会。可以试试：“有什么补贴”、“给老李转800”。也可以点“找人工”。', 'I can’t do that yet. Try “any subsidies?” or “pay Old Li 800”, or ask for a person.'))
  }

  return (
    <div className="askwrap">
      {ask ? (
        <div className="strip" role="status">
          <span className="small">{who}</span>
          <span>{heard ? t(`我听到的是：“${heard}”。对吗？`, `I heard: “${heard}”. Right?`) : t('我听到的是：“下个月要收蜂蜜了，帮我准备一下”。对吗？', 'I heard: “Get me ready for next month’s honey buying”. Right?')}</span>
          <span className="row">
            <button
              className="btn pri"
              onClick={() => {
                cancelAsk()
                if (heard) {
                  uiStore.update((u) => void (u.heard = null))
                  return run(heard)
                }
                startPlan('season')
                nav('/plan')
              }}
            >
              {t('对', 'Yes')}
            </button>
            <button className="btn" onClick={cancelAsk}>
              {t('不对，再说一次', 'No, say it again')}
            </button>
          </span>
        </div>
      ) : answer ? (
        <div className="strip" role="status">
          <span className="small">{who}</span>
          <span>{answer}</span>
          <span className="row">
            <button className="btn" onClick={dismissAnswer}>
              {t('关闭', 'Close')}
            </button>
          </span>
        </div>
      ) : !tipSeen && loc.pathname === '/' ? (
        <div className="strip tip">
          <span>{t('不会打字？按住下面的“按住说话”，直接说就行。', 'Not keen on typing? Hold “Hold to talk” below and just say it.')}</span>
          <span className="row">
            <button className="btn" onClick={() => uiStore.update((u) => void (u.tipSeen = true))}>
              {t('知道了', 'Got it')}
            </button>
          </span>
        </div>
      ) : null}
      <div className="ask">
        <button
          className={`mic ${live ? 'live' : ''}`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            setLive(true)
            void startRecording()
          }}
          onPointerUp={() => {
            setLive(false)
            void heardIt()
          }}
          onPointerCancel={() => setLive(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              askConfirm()
            }
          }}
        >
          ● {live ? t('正在听…松开发送', 'Listening… release to send') : t('按住说话', 'Hold to talk')}
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          placeholder={t('或者在这里打字', 'Or type here')}
          aria-label={t('打字提问', 'Type a question')}
        />
        <button className="go" onClick={go}>
          {t('问', 'Ask')}
        </button>
      </div>
    </div>
  )
}
