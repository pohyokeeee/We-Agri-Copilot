import type { ReactNode } from 'react'
import { useT } from '../lib/i18n'
import { GLOSSARY } from '../data/mock'
import { uiStore } from '../state/store'
import { say } from '../state/actions'
import type { TierKey } from '../state/types'

/** ● ▲ ■ : the approval level is always shape + word + colour, never colour alone. */
export function Tier({ t }: { t: TierKey }) {
  const tt = useT()
  const map = {
    g: ['●', tt('直接做', 'Runs now'), 'g'],
    y: ['▲', tt('要您确认', 'You confirm'), 'y'],
    r: ['■', tt('要您和家人确认', 'You + family confirm'), 'r'],
  } as const
  const [shape, word, cls] = map[t]
  return (
    <span className={`tier ${cls}`}>
      {shape} {word}
    </span>
  )
}

/** A tax word with a small ⓘ that opens a one-sentence plain explanation. */
export function Term({ k }: { k: keyof typeof GLOSSARY }) {
  const t = useT()
  const g = GLOSSARY[k]
  return (
    <span className="term">
      {t(g.title[0], g.title[1])}
      <button className="ib" aria-label={t('这是什么意思？', 'What does this mean?')} onClick={() => uiStore.update((u) => void (u.info = k))}>
        ⓘ
      </button>
    </span>
  )
}

/** A text/number field with a Speak button (voice fills the box in Phase 2). */
export function Field(props: {
  id: string
  label: [string, string]
  placeholder?: [string, string]
  value: string
  onChange: (v: string) => void
  numeric?: boolean
  noSpeak?: boolean
  autoFocus?: boolean
}) {
  const t = useT()
  return (
    <div className="field">
      <label htmlFor={props.id}>{t(props.label[0], props.label[1])}</label>
      <div className="inrow">
        <input
          id={props.id}
          className="input"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          inputMode={props.numeric ? 'numeric' : undefined}
          type={props.numeric ? 'number' : 'text'}
          placeholder={props.placeholder ? t(props.placeholder[0], props.placeholder[1]) : ''}
          autoFocus={props.autoFocus}
        />
        {!props.noSpeak && <SpeakButton />}
      </div>
    </div>
  )
}
export function SpeakButton() {
  const t = useT()
  return (
    <button className="say" aria-label={t('说话输入', 'Speak')} onClick={() => say(t('（按住下面的“按住说话”说，文字会填进这一栏。语音接入在第二阶段。）', '(Hold “Hold to talk” below and speak; your words will fill this box. Voice arrives in Phase 2.)'))}>
      {t('说', 'Speak')}
    </button>
  )
}

export function StepHead(props: { title: string; step: number; of: number; onBack: () => void; chips?: ReactNode }) {
  const t = useT()
  return (
    <div className="card">
      <div className="kv">
        <b style={{ fontSize: '1.15rem', color: 'var(--ink)' }}>{props.title}</b>
        <span className="small">
          {t(`第${props.step}步，共${props.of}步`, `Step ${props.step} of ${props.of}`)}
        </span>
      </div>
      <div className="steps" role="progressbar" aria-valuemin={1} aria-valuemax={props.of} aria-valuenow={props.step}>
        {Array.from({ length: props.of }, (_, i) => (
          <span key={i} className={i < props.step ? 'on' : ''} />
        ))}
      </div>
      {props.step > 1 && (
        <div className="row">
          <button className="chip" onClick={props.onBack}>
            ‹ {t('上一步', 'Back')}
          </button>
          {props.chips}
        </div>
      )}
    </div>
  )
}

export function BigOption(props: { onClick: () => void; title: ReactNode; sub?: ReactNode; dashed?: boolean }) {
  return (
    <button className={`li press ${props.dashed ? 'dashed' : 'boxed'}`} onClick={props.onClick}>
      <span className="grow">
        <b style={{ fontSize: '1.1rem' }}>{props.title}</b>
        {props.sub && (
          <>
            <br />
            <span className="small">{props.sub}</span>
          </>
        )}
      </span>
      <span className="chev">›</span>
    </button>
  )
}

export function Notice({ children }: { children: ReactNode }) {
  return <div className="notice">{children}</div>
}
export function InfoFoot() {
  const t = useT()
  return <div className="foot">{t('信息，不是建议 · 税务问题请打 12366', 'Information, not advice · Tax questions: call 12366')}</div>
}
export function Flag(props: { title: string; body: string; rule: string }) {
  return (
    <div className="li">
      <b style={{ width: 18 }}>▲</b>
      <span className="grow">
        <b>{props.title}</b>
        <br />
        <span className="small">{props.body}</span>
        <div className="rule">{props.rule}</div>
      </span>
    </div>
  )
}
