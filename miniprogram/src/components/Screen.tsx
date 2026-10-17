import { Text, View } from '@tarojs/components'
import { ReactNode } from 'react'
import { goBack, supportsBlur } from '../utils/device'
import { getSettings } from '../utils/settings'
import { Tap } from './ui'

// Page frame: translucent header (solid where blur is unsupported), content that scrolls underneath,
// optional bottom bar. Header and bar never overlap, so translucent layers are never stacked.
export default function Screen({ title, sub, back, bar, children }: {
  title: string; sub?: string; back?: boolean; bar?: ReactNode; children: ReactNode
}) {
  const material = supportsBlur() ? 'blur' : 'solid'
  const tall = !!sub
  return (
    <View className={`screen ${getSettings().reducedMotion ? 'rm' : ''}`}>
      <View className={`header ${material} ${tall ? 'tall' : ''}`}>
        <View className='row'>
          {back && <Tap kind='quiet' onClick={goBack}>‹ 返回</Tap>}
          <Text className='h-title'>{title}</Text>
        </View>
        {sub && <Text className='h-sub'>{sub}</Text>}
      </View>
      <View className={`content ${tall ? 'pt-tall' : 'pt'} ${bar ? 'has-bar' : ''}`}>{children}</View>
      {bar && <View className={`bar ${material}`}>{bar}</View>}
    </View>
  )
}
