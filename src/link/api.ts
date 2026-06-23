import type {
  ApprovalRequest,
  MemoryEntry,
  MissionEnqueueResponse,
  MissionListResponse,
  MissionStatusResponse,
  StreamEvent,
} from '../shared/contracts'

const STORAGE_URL = 'dino-link-nest-url'
const STORAGE_TOKEN = 'dino-link-token'

export interface NestStatus {
  runs: number
  successRate: number
  memory: number
  uptime: number
  mood: string
  queueDepth: number
  activeRunId: string | null
  pendingApprovals: number
  creed: { name: string; mood: string; motto: string }
}

export interface LinkSession {
  nestUrl: string
  token: string
}

export function loadSession(): LinkSession | null {
  const nestUrl = localStorage.getItem(STORAGE_URL)?.trim()
  const token = localStorage.getItem(STORAGE_TOKEN)?.trim()
  if (!nestUrl || !token) return null
  return { nestUrl, token }
}

export function saveSession(nestUrl: string, token: string): void {
  localStorage.setItem(STORAGE_URL, nestUrl.replace(/\/$/, ''))
  localStorage.setItem(STORAGE_TOKEN, token)
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_URL)
  localStorage.removeItem(STORAGE_TOKEN)
}

export class DinoLinkClient {
  private nestUrl: string
  private token: string

  constructor(nestUrl: string, token: string) {
    this.nestUrl = nestUrl
    this.token = token
  }

  private headers(json = true): HeadersInit {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    }
    if (json) h['Content-Type'] = 'application/json'
    return h
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.nestUrl}${path}`, {
      ...init,
      headers: { ...this.headers(init?.body !== undefined), ...init?.headers },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
      throw new Error(err.error ?? `Request failed (${res.status})`)
    }
    return res.json() as Promise<T>
  }

  static async pair(nestUrl: string, code: string): Promise<string> {
    const base = nestUrl.replace(/\/$/, '')
    const res = await fetch(`${base}/pair`, {
      method: 'POST',
      headers: { 'X-Pairing-Code': code.trim() },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Pairing failed' })) as { error?: string }
      throw new Error(err.error ?? 'Invalid pairing code')
    }
    const data = await res.json() as { token: string }
    return data.token
  }

  async health(): Promise<{ status: string; version: string }> {
    return this.request('/health')
  }

  async status(): Promise<NestStatus> {
    return this.request('/status')
  }

  async submitMission(goal: string, context?: string): Promise<MissionEnqueueResponse> {
    return this.request('/mission', {
      method: 'POST',
      body: JSON.stringify({ goal, context }),
    })
  }

  async getMission(runId: string): Promise<MissionStatusResponse> {
    return this.request(`/mission/${runId}`)
  }

  async getMissions(): Promise<MissionListResponse> {
    return this.request('/missions?limit=15')
  }

  async getApprovals(): Promise<{ pending: ApprovalRequest[] }> {
    return this.request('/approvals')
  }

  async resolveApproval(stepId: string, runId: string, approved: boolean): Promise<void> {
    await this.request(`/approvals/${stepId}`, {
      method: 'POST',
      body: JSON.stringify({ runId, approved }),
    })
  }

  async getMemory(query?: string): Promise<{ entries: MemoryEntry[] }> {
    const params = new URLSearchParams({ limit: '8' })
    if (query) params.set('q', query)
    return this.request(`/memory?${params}`)
  }

  connectEvents(handlers: {
    onStream?: (event: StreamEvent) => void
    onApproval?: (request: ApprovalRequest) => void
    onError?: () => void
  }): () => void {
    const url = `${this.nestUrl}/events?token=${encodeURIComponent(this.token)}`
    const source = new EventSource(url)

    source.addEventListener('stream', (e) => {
      handlers.onStream?.(JSON.parse(e.data) as StreamEvent)
    })
    source.addEventListener('approval', (e) => {
      handlers.onApproval?.(JSON.parse(e.data) as ApprovalRequest)
    })
    source.onerror = () => handlers.onError?.()

    return () => source.close()
  }
}
