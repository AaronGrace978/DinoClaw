import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Send, Unplug, RefreshCw, ShieldAlert, Brain, Activity,
  ChevronDown, ChevronUp, Clock, ListOrdered,
} from 'lucide-react'
import type { ApprovalRequest } from '../shared/contracts'
import { useLinkStore, tryRestoreSession } from './store'
import './Link.css'

function moodEmoji(mood: string): string {
  const map: Record<string, string> = {
    focused: '🎯',
    curious: '🔍',
    cautious: '🛡️',
    determined: '💪',
    reflective: '🌙',
  }
  return map[mood] ?? '🦖'
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    queued: 'Queued',
    running: 'Running',
    awaiting_approval: 'Needs approval',
    completed: 'Done',
    failed: 'Failed',
  }
  return map[status] ?? status
}

function Collapsible({
  title,
  icon,
  defaultOpen = false,
  badge,
  children,
}: {
  title: string
  icon: React.ReactNode
  defaultOpen?: boolean
  badge?: number
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="link-card link-collapsible">
      <button
        type="button"
        className="link-collapsible-trigger"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span className="link-collapsible-title">
          {icon}
          {title}
          {badge != null && badge > 0 && <span className="link-badge">{badge}</span>}
        </span>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {open && <div className="link-collapsible-body">{children}</div>}
    </section>
  )
}

function ApprovalCard({ req, onResolve }: {
  req: ApprovalRequest
  onResolve: (approved: boolean) => void
}) {
  return (
    <div className="link-card link-approval" role="alert">
      <div className="link-approval-head">
        <ShieldAlert size={20} aria-hidden />
        <span>Approval needed</span>
        <span className={`link-risk ${req.risk}`}>{req.risk}</span>
      </div>
      <p className="link-approval-tool">{req.toolName}</p>
      {req.preview && <p className="link-approval-preview">{req.preview.slice(0, 280)}</p>}
      <div className="link-approval-actions">
        <button type="button" className="link-btn deny touch" onClick={() => onResolve(false)}>
          Deny
        </button>
        <button type="button" className="link-btn approve touch" onClick={() => onResolve(true)}>
          Approve
        </button>
      </div>
    </div>
  )
}

function PairScreen() {
  const [nestUrl, setNestUrl] = useState(useLinkStore.getState().nestUrl || 'http://127.0.0.1:42617')
  const [code, setCode] = useState('')
  const { pair, connecting, error } = useLinkStore()

  const digits = code.replace(/\D/g, '').slice(0, 6)

  return (
    <div className="link-shell link-shell--pair">
      <div className="link-pair-scroll">
        <div className="link-pair-glow" aria-hidden />
        <div className="link-logo">🦖</div>
        <h1>Dino Link</h1>
        <p className="link-tagline">Text your dino. It works on your computer.</p>

        <div className="link-pair-form">
          <label className="link-field">
            <span>Nest URL</span>
            <input
              value={nestUrl}
              onChange={e => setNestUrl(e.target.value)}
              placeholder="http://192.168.1.5:42617"
              autoComplete="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
            />
          </label>

          <label className="link-field">
            <span>Pairing code</span>
            <input
              className="link-code-input"
              value={digits}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              maxLength={6}
              enterKeyHint="go"
              onKeyDown={e => {
                if (e.key === 'Enter' && digits.length === 6) void pair(nestUrl, digits)
              }}
            />
            <div className="link-code-dots" aria-hidden>
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className={i < digits.length ? 'filled' : ''} />
              ))}
            </div>
          </label>

          {error && <p className="link-error" role="alert">{error}</p>}
        </div>
      </div>

      <div className="link-dock link-dock--pair">
        <button
          type="button"
          className="link-btn primary touch full"
          disabled={connecting || digits.length < 6}
          onClick={() => void pair(nestUrl, digits)}
        >
          {connecting ? 'Pairing…' : 'Connect to Nest'}
        </button>
        <p className="link-hint">
          DinoClaw → Infra → Start Gateway. Use LAN IP or tunnel URL.
        </p>
      </div>
    </div>
  )
}

function MainScreen() {
  const {
    status, activeRun, queue, recent, approvals, memory, goalDraft,
    setGoalDraft, submitGoal, refresh, disconnect, resolveApproval, error,
  } = useLinkStore()

  const [refreshing, setRefreshing] = useState(false)
  const [composerFocused, setComposerFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleRefresh = async () => {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }

  const resizeComposer = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  useEffect(() => {
    resizeComposer()
  }, [goalDraft])

  const isRunning = activeRun
    && activeRun.status !== 'completed'
    && activeRun.status !== 'failed'

  const isDone = activeRun
    && (activeRun.status === 'completed' || activeRun.status === 'failed')

  return (
    <div className={`link-shell link-shell--main${composerFocused ? ' link-shell--keyboard' : ''}`}>
      <header className="link-header link-safe-top">
        <div className="link-header-left">
          <span className="link-logo-sm" aria-hidden>🦖</span>
          <div className="link-header-text">
            <strong>{status?.creed.name ?? 'Dino'}</strong>
            <span className="link-mood">
              {moodEmoji(status?.mood ?? '')} {status?.mood ?? '…'}
            </span>
          </div>
        </div>
        <div className="link-header-actions">
          <button
            type="button"
            className={`link-icon-btn touch${refreshing ? ' spin' : ''}`}
            onClick={() => void handleRefresh()}
            aria-label="Refresh"
          >
            <RefreshCw size={20} />
          </button>
          <button type="button" className="link-icon-btn touch" onClick={disconnect} aria-label="Disconnect">
            <Unplug size={20} />
          </button>
        </div>
      </header>

      <div className="link-status-bar">
        <span className="link-pill online"><Activity size={12} aria-hidden /> Nest online</span>
        {status && status.queueDepth > 0 && (
          <span className="link-pill"><ListOrdered size={12} aria-hidden /> {status.queueDepth} queued</span>
        )}
        {approvals.length > 0 && (
          <span className="link-pill warn">
            <ShieldAlert size={12} aria-hidden />
            {approvals.length} pending
          </span>
        )}
      </div>

      <main className="link-feed" role="main">
        {error && <p className="link-error banner" role="alert">{error}</p>}

        {approvals.map(req => (
          <ApprovalCard
            key={req.stepId}
            req={req}
            onResolve={approved => void resolveApproval(req.stepId, req.runId, approved)}
          />
        ))}

        {isRunning && activeRun && (
          <section className="link-card link-active">
            <div className="link-active-head">
              <h3>Active mission</h3>
              <span className={`link-status ${activeRun.status}`}>
                {statusLabel(activeRun.status)}
              </span>
            </div>
            <p className="link-goal">{activeRun.goal}</p>
            {activeRun.steps.length > 0 && (
              <p className="link-step">
                {activeRun.steps[activeRun.steps.length - 1].summary}
              </p>
            )}
            <div className="link-progress" aria-hidden>
              <div className="link-progress-bar" />
            </div>
          </section>
        )}

        {isDone && activeRun && (
          <section className={`link-card result ${activeRun.status}`}>
            <h3>{activeRun.status === 'completed' ? '✓ Stomped' : '✗ Failed'}</h3>
            <p className="link-result-msg">
              {activeRun.finalMessage ?? activeRun.error ?? 'Done.'}
            </p>
          </section>
        )}

        {queue.length > 0 && (
          <Collapsible title="Queue" icon={<ListOrdered size={16} />} badge={queue.length} defaultOpen={queue.length <= 3}>
            <ul className="link-list">
              {queue.map(item => (
                <li key={item.runId}>{item.goal}</li>
              ))}
            </ul>
          </Collapsible>
        )}

        <Collapsible
          title="Memory"
          icon={<Brain size={16} />}
          badge={memory.length}
          defaultOpen={memory.length > 0 && memory.length <= 4}
        >
          {memory.length === 0 ? (
            <p className="link-muted">No memories yet.</p>
          ) : (
            <ul className="link-memory">
              {memory.map(m => (
                <li key={m.id}>
                  <span className="link-memory-cat">{m.category}</span>
                  {m.fact}
                </li>
              ))}
            </ul>
          )}
        </Collapsible>

        {recent.length > 0 && (
          <Collapsible title="Recent" icon={<Clock size={16} />} defaultOpen={false}>
            <ul className="link-list">
              {recent.slice(0, 6).map(run => (
                <li key={run.id} className={run.status}>
                  <span className="link-recent-status">{statusLabel(run.status)}</span>
                  {run.goal}
                </li>
              ))}
            </ul>
          </Collapsible>
        )}

        {status?.creed.motto && (
          <p className="link-motto">&ldquo;{status.creed.motto}&rdquo;</p>
        )}
      </main>

      <div className="link-dock link-safe-bottom">
        <div className="link-composer">
          <textarea
            ref={textareaRef}
            value={goalDraft}
            onChange={e => setGoalDraft(e.target.value)}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            placeholder="Tell your Nest what to do…"
            rows={1}
            enterKeyHint="send"
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void submitGoal()
              }
            }}
          />
          <button
            type="button"
            className="link-send-btn touch"
            onClick={() => void submitGoal()}
            disabled={!goalDraft.trim()}
            aria-label="Send to Nest"
          >
            <Send size={22} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function LinkApp() {
  const connected = useLinkStore(s => s.connected)
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    document.documentElement.classList.add('link-app')
    return () => { document.documentElement.classList.remove('link-app') }
  }, [])

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      const swUrl = `${import.meta.env.BASE_URL}link-sw.js`
      void navigator.serviceWorker.register(swUrl).catch(() => {})
    }
  }, [])

  useEffect(() => {
    const restored = tryRestoreSession()
    if (restored) {
      void useLinkStore.getState().refresh().finally(() => setBooting(false))
    } else {
      setBooting(false)
    }
  }, [])

  useEffect(() => {
    if (!connected) return
    const stop = useLinkStore.getState().startEventStream()
    return stop
  }, [connected])

  if (booting) {
    return (
      <div className="link-boot link-safe-top link-safe-bottom">
        <span className="link-logo" aria-hidden>🦖</span>
        <p>Connecting to Nest…</p>
        <div className="link-boot-dots" aria-hidden>
          <span /><span /><span />
        </div>
      </div>
    )
  }

  return connected ? <MainScreen /> : <PairScreen />
}
