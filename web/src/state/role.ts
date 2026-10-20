import { createStore } from '../lib/store'
import { closeSheet } from './actions'

export type Role = 'farmer' | 'family'
const KEY = 'wac-role'

function read(): Role {
  try {
    return sessionStorage.getItem(KEY) === 'family' ? 'family' : 'farmer'
  } catch {
    return 'farmer'
  }
}

/** Which simulated account this window is signed in as. Per window (sessionStorage), never shared. `menu` = the switch-account menu is open. */
export const roleStore = createStore<{ role: Role; menu: boolean }>(() => ({ role: read(), menu: false }))
export const useRole = (): Role => roleStore.use((s) => s.role)
export const useMenuOpen = (): boolean => roleStore.use((s) => s.menu)

export function setRole(role: Role) {
  try {
    sessionStorage.setItem(KEY, role)
  } catch {
    /* private window: the role just lives in memory */
  }
  if (roleStore.get().role !== role) closeSheet()
  roleStore.update((s) => {
    s.role = role
    s.menu = false
  })
}
export const setMenu = (open: boolean) => roleStore.update((s) => void (s.menu = open))
