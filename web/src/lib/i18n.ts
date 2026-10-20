import { createStore } from './store'

export type Lang = 'zh' | 'en'
/** A string in both languages: [中文, English]. Kept next to where it is used so the two never drift apart. */
export type Bi = readonly [string, string]

const KEY = 'wac-lang'
function initialLang(): Lang {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'zh' || v === 'en') return v
  } catch {
    /* ignore */
  }
  return 'zh'
}

const langStore = createStore<{ lang: Lang }>(() => ({ lang: initialLang() }))

export function setLang(lang: Lang, remember = true) {
  langStore.update((s) => {
    s.lang = lang
  })
  if (!remember) return
  try {
    localStorage.setItem(KEY, lang)
  } catch {
    /* ignore */
  }
}
export function hasChosenLang(): boolean {
  try {
    return localStorage.getItem(KEY) !== null
  } catch {
    return false
  }
}

export function useLang(): Lang {
  return langStore.use((s) => s.lang)
}

/** t('中文', 'English') for the current language. */
export function useT() {
  const lang = useLang()
  return (zh: string, en: string) => (lang === 'zh' ? zh : en)
}
export function pick(lang: Lang, b: Bi): string {
  return lang === 'zh' ? b[0] : b[1]
}
export function useBi() {
  const lang = useLang()
  return (b: Bi) => pick(lang, b)
}
export function getLang(): Lang {
  return langStore.get().lang
}
