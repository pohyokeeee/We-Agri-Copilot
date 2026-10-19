import Taro from '@tarojs/taro'

// Every screen must have a way out: back if there is a page behind, otherwise the chat home.
export function goBack(): void {
  if (Taro.getCurrentPages().length > 1) Taro.navigateBack()
  else Taro.redirectTo({ url: '/pages/chat/index' })
}
