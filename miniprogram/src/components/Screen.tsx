import { Text, View } from '@tarojs/components'
import { ReactNode } from 'react'
import { goBack } from '../utils/device'
import { getSettings } from '../utils/settings'
import { Tap } from './ui'

// Page frame: solid header, content that starts below it, optional bottom bar.
export default function Screen({ title, sub, back, bar, children }: {
  title: string; sub?: string; back?: boolean; bar?: ReactNode; children: ReactNode
}) {
  const tall = !!sub
  return (
    <View className={`screen ${getSettings().reducedMotion ? 'rm' : ''}`}>
      <View className={`header ${tall ? 'tall' : ''}`}>
        <View className='row'>
          {back && <Tap kind='quiet' onClick={goBack}>‹ 返回</Tap>}
          <Text className='h-title'>{title}</Text>
        </View>
        {sub && <Text className='h-sub'>{sub}</Text>}
      </View>
      <View className={`content ${bar ? 'has-bar' : ''}`}>{children}</View>
      {bar && <View className={'bar'}>{bar}</View>}
    </View>
  )
}
