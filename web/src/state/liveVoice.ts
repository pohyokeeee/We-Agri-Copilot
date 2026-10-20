import { API_BASE } from '../api/client'
import { live } from './live'

/*
 * Hold-to-talk. The browser records with MediaRecorder; the clip goes up as the raw body to /voice/asr.
 * Without a backend, a microphone or a speech service (the dev server runs with LLM_MOCK=1) every step returns null
 * and the Ask bar falls back to its typed / Phase 1 behaviour.
 */
export interface AsrResult {
  transcript: string
  confidence: number
  needs_confirm: boolean
  reasons: string[]
  confirm_text_zh: string
}

let rec: MediaRecorder | null = null
let chunks: Blob[] = []
let stream: MediaStream | null = null

export async function startRecording(): Promise<void> {
  if (!live() || rec || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    chunks = []
    rec = new MediaRecorder(stream)
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.start()
  } catch {
    rec = null // permission refused or no microphone
  }
}

/** Stop and return the clip (null if nothing was being recorded). */
export function stopRecording(): Promise<Blob | null> {
  const r = rec
  if (!r) return Promise.resolve(null)
  rec = null
  return new Promise((resolve) => {
    r.onstop = () => {
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
      resolve(chunks.length ? new Blob(chunks, { type: r.mimeType || 'audio/webm' }) : null)
    }
    r.stop()
  })
}

/** The clip to a transcript, or null when the speech service is not available. */
export async function transcribe(clip: Blob): Promise<AsrResult | null> {
  try {
    const res = await fetch(`${API_BASE}/voice/asr`, { method: 'POST', body: clip, headers: { 'content-type': clip.type.split(';')[0] || 'audio/webm' } })
    if (!res.ok) return null
    return (await res.json()) as AsrResult
  } catch {
    return null
  }
}

