import { createStore } from '../lib/store'
import { freshApp } from '../data/mock'
import type { AppState, UiState } from './types'

/** The mock bank + agent state. Mirrored to localStorage so a second window (the daughter's) sees the same thing. */
export const appStore = createStore<AppState>(freshApp, 'wac-app-v1')
/** Per-window screen state: the open sheet, the judge drawer, the assistant strip. Never shared between windows. */
export const uiStore = createStore<UiState>(() => ({
  sheet: null,
  info: null,
  drawer: false,
  tipSeen: false,
  ask: null,
  answer: null,
}))

export const useApp = <S,>(selector: (s: AppState) => S): S => appStore.use(selector)
export const useUi = <S,>(selector: (s: UiState) => S): S => uiStore.use(selector)
