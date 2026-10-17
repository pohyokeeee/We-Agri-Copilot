import Taro from '@tarojs/taro'

// backdrop-filter is reliable in WeChat on iOS and on desktop/DevTools. Android WebViews vary a lot, so
// they get the solid fallback. (ponytail: allow-list by platform; add an SDKVersion check if Android is verified)
export function supportsBlur(): boolean {
  try {
    return ['ios', 'devtools', 'mac', 'windows'].includes(Taro.getSystemInfoSync().platform)
  } catch {
    return false
  }
}

// Every screen must have a way out: back if there is a page behind, otherwise the chat home.
export function goBack(): void {
  if (Taro.getCurrentPages().length > 1) Taro.navigateBack()
  else Taro.redirectTo({ url: '/pages/chat/index' })
}
