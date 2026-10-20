import { createStore } from '../lib/store'
import { freshApp } from '../data/mock'
import type { AppState, SubStatus, UiState } from './types'

/** The mock bank + agent state. Mirrored to localStorage so a second window (the daughter's) sees the same thing. */
/** A copy saved by an older build may lack newer fields; fill them from the current defaults instead of crashing. */
function withDefaults(saved: Partial<AppState>): AppState {
  const d = freshApp()
  // older builds saved subsidy statuses 'preparing' and 'handed'; they became 'draft' and 'submitted'
  const legacy: Record<string, SubStatus> = { preparing: 'draft', handed: 'submitted' }
  const subs = Object.fromEntries(Object.entries({ ...d.subs, ...saved.subs }).map(([k, v]) => [k, legacy[v as string] ?? v])) as AppState['subs']
  return { ...d, ...saved, app: { ...d.app, ...saved.app }, subs, season: { ...d.season, ...saved.season } }
}
export const appStore = createStore<AppState>(freshApp, 'wac-app-v1', withDefaults)
/** Per-window screen state: the open sheet, the judge drawer, the assistant strip. Never shared between windows. */
export const uiStore = createStore<UiState>(() => ({
  sheet: null,
  info: null,
  drawer: false,
  tipSeen: false,
  ask: null,
  heard: null,
  answer: null,
}))

export const useApp = <S,>(selector: (s: AppState) => S): S => appStore.use(selector)
export const useUi = <S,>(selector: (s: UiState) => S): S => uiStore.use(selector)
