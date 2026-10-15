import Taro from '@tarojs/taro'

// Set TARO_APP_API_BASE in miniprogram/.env (see .env.example)
export const API_BASE: string = process.env.TARO_APP_API_BASE || 'http://127.0.0.1:8000'

async function request<T>(method: 'GET' | 'POST', path: string, data?: object): Promise<T> {
  const res = await Taro.request({ url: API_BASE + path, method, data, header: { 'content-type': 'application/json' } })
  if (res.statusCode >= 400 && res.statusCode !== 423) throw new Error(`${res.statusCode} ${JSON.stringify(res.data)}`)
  return res.data as T
}

export interface Approval {
  approval_id: number
  action: string
  payload: Record<string, unknown>
  tier: 'green' | 'yellow' | 'red'
  reasons: string[]
  requires_cosigner: boolean
  status: 'pending' | 'approved' | 'declined' | 'used'
  approval_token: string | null
}

export const api = {
  balance: () => request<{ balance: number; reserved: number; available: number }>('GET', '/bank/balance'),
  pendingForCosigner: (cosignerId: number) => request<Approval[]>('GET', `/bank/approvals?cosigner_id=${cosignerId}`),
  cosign: (approvalId: number, cosignerId: number, pin: string, approve: boolean) =>
    request<Approval>('POST', `/bank/approvals/${approvalId}/cosign`, { cosigner_id: cosignerId, pin, approve }),
  // TODO: chat / transcript / trace endpoints arrive with the agent (app/agent is stubbed)
}
