import { Text, View } from '@tarojs/components'
import { useEffect, useState } from 'react'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '清除', '0', '删除']
const LENGTH = 6

// Temporary input for the 6-digit PIN until spoken PIN exists. Masked: only dots are shown, never the digits.
// The parent sets `busy` while it checks the PIN; when busy goes false again the pad clears for the next try.
export default function PinPad({ onComplete, busy }: { onComplete: (pin: string) => void; busy?: boolean }) {
  const [pin, setPin] = useState('')
  useEffect(() => { if (!busy) setPin('') }, [busy])

  const press = (key: string) => {
    if (busy) return
    if (key === '清除') return setPin('')
    if (key === '删除') return setPin(pin.slice(0, -1))
    if (pin.length >= LENGTH) return
    const next = pin + key
    setPin(next)
    if (next.length === LENGTH) onComplete(next)
  }

  return (
    <View className='stack'>
      <View className='dots' aria-label={`已输入 ${pin.length} 位，共 ${LENGTH} 位`}>
        {Array.from({ length: LENGTH }, (_, i) => <View key={i} className={`dot ${i < pin.length ? 'on' : ''}`} />)}
      </View>
      <View className='pad'>
        {KEYS.map((k) => (
          <View key={k} className={`pad-key ${k.length > 1 ? 'quiet' : ''}`} hoverClass='pressed' hoverStartTime={0} hoverStayTime={100}
            onClick={() => press(k)}>
            <Text>{k}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
