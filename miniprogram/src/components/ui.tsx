import { Text, View } from '@tarojs/components'
import { ReactNode, useEffect, useState } from 'react'
import type { Tier } from '../mock'

export const yuan = (x: number) => Math.round(x).toLocaleString('en-US')

// Every tappable thing: pressed look starts on touch-down (hoverStartTime 0), not on release.
export function Tap({ kind = 'secondary', onClick, children, wide }: {
  kind?: 'primary' | 'secondary' | 'quiet'; onClick?: () => void; children: ReactNode; wide?: boolean
}) {
  return (
    <View className={`btn btn-${kind} ${wide ? 'btn-wide' : ''}`} hoverClass='pressed' hoverStartTime={0} hoverStayTime={100} onClick={onClick}>
      {typeof children === 'string' ? <Text>{children}</Text> : children}
    </View>
  )
}

// A tier is always a shape and a word as well as a colour.
const TIER = { green: ['●', '直接做'], yellow: ['▲', '要您确认'], red: ['■', '要您和家人确认'] } as const
export function TierChip({ tier }: { tier: Tier }) {
  return <Text className={`chip chip-${tier}`}>{TIER[tier][0]} {TIER[tier][1]}</Text>
}

const STATE = { pending: ['○', '待办'], waiting: ['…', '等您确认'], done: ['✓', '已完成'], undone: ['↺', '已撤销'], failed: ['✕', '没办成'] } as const
export type StepState = keyof typeof STATE
export function StateChip({ state }: { state: StepState }) {
  return <Text className={`chip chip-${state}`}>{STATE[state][0]} {STATE[state][1]}</Text>
}

export function Skeleton() {
  return (
    <View className='card enter-down' aria-hidden>
      <View className='sk sk-line sk-short' />
      <View className='sk sk-block' />
      <View className='sk sk-line' />
      <View className='sk sk-line' />
    </View>
  )
}

export function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <View className='card enter-down'>
      <Text className='card-title'>连不上银行，请稍后再试</Text>
      <Tap kind='primary' wide onClick={onRetry}>再试一次</Tap>
    </View>
  )
}

export function EmptyCard({ children }: { children: ReactNode }) {
  return <View className='card enter-down'><Text className='card-title'>{children}</Text></View>
}

// Shows only when the wait is long enough to notice, so a fast answer never flashes a skeleton.
export function useDelayed(flag: boolean, ms = 300): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!flag) { setShown(false); return undefined }
    const t = setTimeout(() => setShown(true), ms)
    return () => clearTimeout(t)
  }, [flag, ms])
  return shown
}

// A longer explanation kept out of the way: one tappable row, opened on demand.
export function Fold({ label = '为什么？', children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <View className='fold'>
      <View className='fold-h tappable' hoverClass='pressed' hoverStartTime={0} hoverStayTime={100} onClick={() => setOpen(!open)}>
        <Text>{label}</Text><Text>{open ? '▴' : '▾'}</Text>
      </View>
      {open && <View className='fold-b'>{children}</View>}
    </View>
  )
}

// Leaves along the same path it came in on (up/down = which side of its trigger it sits), then unmounts.
export function Dismissable({ from, onDone, children }: { from: 'up' | 'down'; onDone: () => void; children: ReactNode }) {
  const [leaving, setLeaving] = useState(false)
  const close = () => { setLeaving(true); setTimeout(onDone, 300) }
  return (
    <View className={`card ${leaving ? 'leave' : 'enter'}-${from}`}>
      {children}
      <Tap kind='secondary' wide onClick={close}>知道了</Tap>
    </View>
  )
}
