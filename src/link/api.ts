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

/** Browsers block HTTPS pages from calling http:// Nest URLs (mixed content). */
export function validateNestUrl(nestUrl: string): string | null {
  const trimmed = nestUrl.trim()
  if (!trimmed) return 'Enter your Nest URL.'

  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && /^http:\/\//i.test(trimmed)) {
    return 'Dino Link is HTTPS (GitHub Pages) but your Nest is HTTP. Use an https:// tunnel URL from DinoClaw → Infra → Tunnel (Cloudflare), or open Dino Link from http://YOUR-PC-IP:5173/link.html on your phone.'
  }

  if (/localhost|127\.0\.0\.1/i.test(trimmed)) {
    return 'localhost only works on the PC itself. On your phone use your LAN IP (ipconfig → IPv4), e.g. http://192.168.1.5:42617 — but from GitHub Pages you need an https tunnel instead.'
  }

  return null
}

export function formatLinkError(err: unknown, nestUrl?: string): string {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()

  if (lower === 'failed to fetch' || lower.includes('networkerror') || lower.includes('load failed')) {
    const hint = nestUrl ? validateNestUrl(nestUrl) : null
    if (hint) return hint
    return [
      'Cannot reach your Nest.',
      '1) DinoClaw → Infra → Start Gateway',
      '2) Same Wi‑Fi as your phone',
      '3) From GitHub Pages: use https tunnel URL (Infra → Tunnel)',
      '4) Allow port 42617 in Windows Firewall if needed',
    ].join(' ')
  }

  return msg
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
    let res: Response
    try {
      res = await fetch(`${this.nestUrl}${path}`, {
        ...init,
        headers: { ...this.headers(init?.body !== undefined), ...init?.headers },
      })
    } catch (err) {
      throw new Error(formatLinkError(err, this.nestUrl))
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
      throw new Error(err.error ?? `Request failed (${res.status})`)
    }
    return res.json() as Promise<T>
  }

  static async pair(nestUrl: string, code: string): Promise<string> {
    const blocked = validateNestUrl(nestUrl)
    if (blocked) throw new Error(blocked)

    const base = nestUrl.replace(/\/$/, '')
    let res: Response
    try {
      res = await fetch(`${base}/pair`, {
        method: 'POST',
        headers: { 'X-Pairing-Code': code.trim() },
      })
    } catch (err) {
      throw new Error(formatLinkError(err, nestUrl))
    }
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
