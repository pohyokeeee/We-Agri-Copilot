import Taro from '@tarojs/taro'

const KEY = 'ui-settings'

export interface Settings {
  // true swaps every slide for a short cross-fade (the Mini Program has no prefers-reduced-motion query)
  reducedMotion: boolean
}

const DEFAULTS: Settings = { reducedMotion: false }

export function getSettings(): Settings {
  try {
    return { ...DEFAULTS, ...(Taro.getStorageSync(KEY) || {}) }
  } catch {
    return DEFAULTS
  }
}

export function setReducedMotion(reducedMotion: boolean): void {
  try {
    Taro.setStorageSync(KEY, { ...getSettings(), reducedMotion })
  } catch {
    // storage can be unavailable (preview, private mode); the flag then lasts until the page re-renders
  }
}
