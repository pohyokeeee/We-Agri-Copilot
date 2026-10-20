import { useRef, useSyncExternalStore } from 'react'

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b || Array.isArray(a) || Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/**
 * A tiny external store. `update` clones the state, lets the caller mutate the clone, then swaps it in,
 * so every state object is immutable and selectors can return stable references.
 * With `persistKey`, the state is mirrored to localStorage and other windows pick up changes through the
 * `storage` event. That is how the farmer window and the daughter's window share one mock bank in Phase 1.
 */
export function createStore<T extends object>(initial: () => T, persistKey?: string) {
  let state: T = load() ?? initial()
  const listeners = new Set<() => void>()

  function load(): T | null {
    if (!persistKey) return null
    try {
      const raw = localStorage.getItem(persistKey)
      return raw ? (JSON.parse(raw) as T) : null
    } catch {
      return null
    }
  }
  function save() {
    if (!persistKey) return
    try {
      localStorage.setItem(persistKey, JSON.stringify(state))
    } catch {
      /* storage can be blocked (private window); the app still works in this window */
    }
  }
  const emit = () => listeners.forEach((l) => l())

  if (persistKey && typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key !== persistKey || !e.newValue) return
      try {
        state = JSON.parse(e.newValue) as T
        emit()
      } catch {
        /* ignore a half-written value */
      }
    })
  }

  return {
    get: () => state,
    update(fn: (draft: T) => void) {
      const next = structuredClone(state)
      fn(next)
      state = next
      save()
      emit()
    },
    replace(next: T) {
      state = next
      save()
      emit()
    },
    subscribe(l: () => void) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    use<S>(selector: (s: T) => S): S {
      const last = useRef<{ v: S } | null>(null)
      return useSyncExternalStore(
        (l) => {
          listeners.add(l)
          return () => listeners.delete(l)
        },
        () => {
          const next = selector(state)
          if (last.current && shallowEqual(last.current.v, next)) return last.current.v
          last.current = { v: next }
          return next
        },
      )
    },
  }
}
