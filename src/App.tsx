import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Flame,
  Zap,
  ScrollText,
  Brain,
  Settings,
  FolderOpen,
  ChevronRight,
  BarChart3,
  Shield,
  Package,
  Trash2,
  Search,
  Download,
  Upload,
  X,
  Check,
  AlertTriangle,
  Activity,
  FolderSync,
  ArrowLeft,
  Server,
  Radio,
  Clock,
  Globe,
  Container,
  Compass,
  Play,
  Square,
  Plus,
  Heart,
  Smartphone,
  Mic,
} from 'lucide-react'
import type {
  DinoCreed,
  ModelSettings,
  ModelProvider,
  ApprovalRequest,
  ExecutionMode,
  ToolRisk,
  StompPresence,
  TidyFolderPreview,
  LinkSetupInfo,
} from './shared/contracts'
import { PROVIDER_DEFAULTS, OLLAMA_CLOUD_MODELS } from './shared/contracts'
import { parseStompPathLines } from './shared/stomp-paths'
import CreedPanel from './components/CreedPanel'
import VoiceTalkPanel, { speakIfEnabled } from './components/VoiceTalkPanel'
import { stopSpeech } from './lib/voice-speak'
import WebPreviewBanner from './components/WebPreviewBanner'
import { useDinoStore } from './store/useDinoStore'
import './App.css'

type Tab = 'dashboard' | 'mission' | 'creed' | 'memory' | 'stomp' | 'skills' | 'infra' | 'settings'
const TABS: Tab[] = ['dashboard', 'mission', 'creed', 'memory', 'stomp', 'skills', 'infra', 'settings']
const DINO_ICON = `${import.meta.env.BASE_URL}dino.svg`

function stompPresenceLabel(presence: StompPresence): string {
  switch (presence) {
    case 'thinking': return 'Thinking…'
    case 'holding': return 'Holding a helpful thought'
    case 'stomped': return 'Happy stomp! 🦖'
    default: return 'Quiet — watching the nest'
  }
}

function stompCanTidy(autonomy: string): boolean {
  return autonomy === 'gentle' || autonomy === 'helpful' || autonomy === 'full'
}

function App() {
  const store = useDinoStore()
  const hydrate = useDinoStore(state => state.hydrate)
  const [tab, setTab] = useState<Tab>('dashboard')
  const [goal, setGoal] = useState('')
  const [creedEdits, setCreedEdits] = useState<CreedDraft | null>(null)
  const [modelEdits, setModelEdits] = useState<ModelDraft | null>(null)
  const [memorySearch, setMemorySearch] = useState('')
  const [telegramToken, setTelegramToken] = useState('')
  const [telegramUsers, setTelegramUsers] = useState('')
  const [discordToken, setDiscordToken] = useState('')
  const [discordUsers, setDiscordUsers] = useState('')
  const [cronName, setCronName] = useState('')
  const [cronSchedule, setCronSchedule] = useState('')
  const [cronGoal, setCronGoal] = useState('')
  const [gatewayPairingCode, setGatewayPairingCode] = useState('')
  const [linkSetup, setLinkSetup] = useState<LinkSetupInfo | null>(null)
  const [browserDomainsInput, setBrowserDomainsInput] = useState('')
  const [tidyPreview, setTidyPreview] = useState<TidyFolderPreview[]>([])
  const [tidyPreviewLoading, setTidyPreviewLoading] = useState(false)
  const [talkMode, setTalkMode] = useState(false)
  const lastSpokenRef = useRef('')

  const refreshTidyPreview = useCallback(async () => {
    if (!window.dinoClaw?.previewTidyFolders) return
    setTidyPreviewLoading(true)
    try {
      setTidyPreview(await window.dinoClaw.previewTidyFolders())
    } catch {
      setTidyPreview([])
    } finally {
      setTidyPreviewLoading(false)
    }
  }, [])

  const launchMission = useCallback((missionGoal: string) => {
    setGoal(missionGoal)
    setTab('mission')
  }, [])

  useEffect(() => { void hydrate() }, [hydrate])

  useEffect(() => {
    if (tab !== 'infra' || !window.dinoClaw?.getLinkSetup) return
    void window.dinoClaw.getLinkSetup().then(setLinkSetup)
  }, [tab, store.gateway.running, store.gateway.paired, store.tunnel.running, store.tunnel.url, gatewayPairingCode])

  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* clipboard unavailable */
    }
  }, [])

  useEffect(() => {
    if (tab === 'stomp' || tab === 'dashboard') void refreshTidyPreview()
  }, [tab, store.stomp.config.allowedPaths, store.stomp.config.autonomy, refreshTidyPreview])

  const browserDomainsKey = useMemo(() => store.browser.allowedDomains.join(','), [store.browser.allowedDomains])
  useEffect(() => {
    const next = store.browser.allowedDomains.join(', ')
    queueMicrotask(() => setBrowserDomainsInput(next))
  }, [browserDomainsKey, store.browser.allowedDomains])

  const handleKeyboard = useCallback((e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const num = parseInt(e.key)
      if (num >= 1 && num <= 7) {
        e.preventDefault()
        setTab(TABS[num - 1])
        return
      }
    }
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyboard)
    return () => window.removeEventListener('keydown', handleKeyboard)
  }, [handleKeyboard])

  const creedDraft = creedEdits ?? makeCreedDraft(store.creed)
  const modelDraft = modelEdits ?? makeModelDraft(store.model)
  const selectedRun = store.selectedRunId ? store.runs.find(r => r.id === store.selectedRunId) : null
  const latestRun = selectedRun ?? store.runs[0]
  const memoryList = useMemo(() => {
    if (store.memorySearchResults) return store.memorySearchResults.slice(0, 30)
    return store.memory.slice(0, 30)
  }, [store.memory, store.memorySearchResults])

  const handleRun = useCallback(async (overrideGoal?: string) => {
    const t = (overrideGoal ?? goal).trim()
    if (!t) return
    lastSpokenRef.current = ''
    const r = await store.runGoal({ goal: t })
    if (r?.ok) {
      setGoal('')
      if (r.run.finalMessage) void speakIfEnabled(store.voice, r.run.finalMessage, lastSpokenRef)
    }
  }, [goal, store])

  const handleVoiceSubmit = useCallback((transcript: string) => {
    const t = transcript.trim()
    if (!t) return
    setGoal(t)
    if (store.voice.autoSubmit) void handleRun(t)
  }, [store.voice.autoSubmit, handleRun])

  useEffect(() => {
    const finals = store.liveSteps.filter(e => e.step.kind === 'final')
    const last = finals[finals.length - 1]
    if (!last?.step.summary) return
    void speakIfEnabled(store.voice, last.step.summary, lastSpokenRef)
  }, [store.liveSteps, store.voice])

  const handleStop = async () => {
    await store.runGoal({ goal: 'stop' })
  }

  const handleSaveCreed = async () => {
    await store.saveCreed({
      name: creedDraft.name.trim(),
      title: creedDraft.title.trim(),
      identity: creedDraft.identity.trim(),
      relationship: creedDraft.relationship.trim(),
      directives: splitLines(creedDraft.directives),
      vows: splitLines(creedDraft.vows),
      motto: creedDraft.motto.trim(),
      traits: store.creed.traits,
      mood: store.creed.mood,
    })
    setCreedEdits(null)
  }

  const handleSaveModel = async () => {
    await store.saveModel({
      provider: modelDraft.provider as ModelProvider,
      baseUrl: modelDraft.baseUrl.trim(),
      model: modelDraft.model.trim(),
      apiKey: modelDraft.apiKey,
      temperature: Number(modelDraft.temperature || 0.2),
      maxTokens: Number(modelDraft.maxTokens || 4096),
    })
    setModelEdits(null)
  }

  const handleProviderChange = (provider: string) => {
    const defaults = PROVIDER_DEFAULTS[provider as ModelProvider]
    if (defaults) {
      setModelEdits({
        ...modelDraft,
        provider: provider as ModelProvider,
        baseUrl: defaults.baseUrl,
        model: defaults.model,
      })
    }
  }

  const handleMemorySearch = (query: string) => {
    setMemorySearch(query)
    if (query.trim().length >= 2) {
      void store.searchMemory(query)
    } else {
      store.clearMemorySearch()
    }
  }

  const handleExportMemory = async () => {
    const json = await store.exportMemory()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dinoclaw-memory-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportMemory = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const text = await file.text()
      await store.importMemory(text)
    }
    input.click()
  }

  if (store.isLoading) {
    return (
      <div className="boot">
        <div className="boot-glow" />
        <img src={DINO_ICON} alt="" width={64} height={64} className="boot-dino" />
        <span className="boot-text">DINOCLAW</span>
        <span className="boot-sub">AI for Regular People</span>
        <span className="boot-org">BostonAi.io</span>
      </div>
    )
  }

  return (
    <div className="shell">
      {import.meta.env.VITE_WEB_PREVIEW === 'true' && <WebPreviewBanner />}
      <div className="ambient-tl" />
      <div className="ambient-br" />

      {/* Approval Modal */}
      {store.approvalQueue.length > 0 && (
        <ApprovalModal
          request={store.approvalQueue[0]}
          onApprove={(r) => void store.approveToolUse(r.runId, r.stepId, true)}
          onDeny={(r) => void store.approveToolUse(r.runId, r.stepId, false)}
        />
      )}

      <header className="topbar">
        <div className="topbar-brand">
          <img src={DINO_ICON} alt="" width={28} height={28} />
          <span className="topbar-name">DinoClaw</span>
          <span className="topbar-tag">v0.3</span>
          <span className="topbar-org">BostonAi.io</span>
        </div>

        <nav className="topbar-nav">
          {([
            ['dashboard', BarChart3, 'Dashboard'],
            ['mission', Zap, 'Mission'],
            ['creed', ScrollText, 'Creed'],
            ['memory', Brain, 'Memory'],
            ['stomp', Heart, 'Stomp'],
            ['skills', Package, 'Skills'],
            ['infra', Server, 'Infra'],
            ['settings', Settings, 'Settings'],
          ] as const).map(([id, Icon, label]) => (
            <button
              key={id}
              className={`nav-btn ${tab === id ? 'active' : ''}`}
              onClick={() => setTab(id as Tab)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>

        <div className="topbar-status">
          <button className="workspace-btn" onClick={() => void store.pickWorkspace()} title={store.workspace || 'Select workspace'}>
            <FolderSync size={13} />
            <span className="workspace-label">{store.workspace ? store.workspace.split(/[\\/]/).pop() : 'workspace'}</span>
          </button>
          <span className={`indicator ${store.isRunning ? 'pulse' : ''}`} />
          <span className="indicator-label">{store.isRunning ? 'Running' : 'Ready'}</span>
          <span className="mood-badge" data-mood={store.creed.mood}>{store.creed.mood}</span>
          <span className="mode-badge">{store.policy.mode}</span>
        </div>
      </header>

      <main className="page">

        {/* ── DASHBOARD ──────────────────────────── */}
        {tab === 'dashboard' && (
          <div className="page-scroll">
            <section className="page-header">
              <BarChart3 size={32} className="hero-icon" />
              <h1>Command Center</h1>
              <p>Your AI. Your machine. Your data. Real-time overview.</p>
            </section>

            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value">{store.stats.totalRuns}</div>
                <div className="stat-label">Total Runs</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{Math.round(store.stats.successRate * 100)}%</div>
                <div className="stat-label">Success Rate</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{store.stats.runsToday}</div>
                <div className="stat-label">Runs Today</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{store.stats.memoryCount}</div>
                <div className="stat-label">Memories</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{store.stats.avgStepsPerRun.toFixed(1)}</div>
                <div className="stat-label">Avg Steps</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{formatUptime(store.stats.uptime)}</div>
                <div className="stat-label">Uptime</div>
              </div>
            </div>

            <div className="dash-grid">
              <section className="card stomp-presence-card">
                <h3 className="card-heading"><Heart size={14} /> Dino Stomp</h3>
                <div className={`stomp-orb stomp-orb-${store.stomp.presence}`} title={stompPresenceLabel(store.stomp.presence)} />
                <p className="stomp-presence-text">{stompPresenceLabel(store.stomp.presence)}</p>
                <p className="stomp-presence-sub">
                  {store.stomp.config.enabled
                    ? `${store.stomp.notesToday} note${store.stomp.notesToday === 1 ? '' : 's'} · ${store.stomp.actionsToday} action${store.stomp.actionsToday === 1 ? '' : 's'} today · ${store.stomp.config.autonomy.replace('_', ' ')}`
                    : 'Autonomous care is off'}
                </p>
                <div className="stomp-presence-actions">
                  <button
                    className="btn-primary btn-sm"
                    disabled={!store.stomp.config.enabled}
                    onClick={() => void store.stompNow()}
                  >
                    Stomp now 🦖
                  </button>
                  {stompCanTidy(store.stomp.config.autonomy) && tidyPreview.length > 0 && (
                    <button
                      className="btn-ghost btn-sm"
                      disabled={!store.stomp.config.enabled}
                      onClick={() => void store.stompTidyNow().then(() => refreshTidyPreview())}
                    >
                      Tidy now 📁
                    </button>
                  )}
                  <button className="btn-ghost btn-sm" onClick={() => setTab('stomp')}>
                    Journal
                  </button>
                </div>
                {tidyPreview.length > 0 && (
                  <p className="stomp-folder-health-hint">
                    {tidyPreview[0].label}: {tidyPreview[0].looseCount} loose files ready to sort
                  </p>
                )}
              </section>

              <section className="card">
                <h3 className="card-heading"><Activity size={14} /> Tool Usage</h3>
                {Object.keys(store.stats.toolUsage).length > 0 ? (
                  <div className="tool-usage-list">
                    {Object.entries(store.stats.toolUsage)
                      .sort(([,a],[,b]) => b - a)
                      .map(([tool, count]) => (
                        <div key={tool} className="tool-usage-item">
                          <span className="tool-usage-name">{tool}</span>
                          <div className="tool-usage-bar">
                            <div
                              className="tool-usage-fill"
                              style={{
                                width: `${Math.min(100, (count / Math.max(...Object.values(store.stats.toolUsage))) * 100)}%`
                              }}
                            />
                          </div>
                          <span className="tool-usage-count">{count}</span>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="empty">No tools used yet.</div>
                )}
              </section>

              <section className="card">
                <h3 className="card-heading"><Shield size={14} /> Security Audit</h3>
                {store.auditLog.length > 0 ? (
                  <div className="audit-list">
                    {store.auditLog.slice(0, 8).map(entry => (
                      <div key={entry.id} className={`audit-item ${entry.approved ? 'approved' : 'denied'}`}>
                        <span className={`audit-dot ${entry.approved ? 'approved' : 'denied'}`} />
                        <span className="audit-action">{entry.action}</span>
                        <span className="audit-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty">No audit events yet.</div>
                )}
              </section>

              <section className="card">
                <h3 className="card-heading"><Flame size={14} /> Creed Traits</h3>
                <div className="traits-list">
                  {store.creed.traits.map(t => (
                    <div key={t.name} className="trait-item">
                      <span className="trait-name">{t.name}</span>
                      <div className="trait-bar">
                        <div className="trait-fill" style={{ width: `${t.score * 100}%` }} />
                      </div>
                      <span className="trait-score">{Math.round(t.score * 100)}%</span>
                    </div>
                  ))}
                </div>
                <div className="mood-display">
                  <span className="mood-label">Mood:</span>
                  <span className="mood-value" data-mood={store.creed.mood}>{store.creed.mood}</span>
                </div>
              </section>

              <section className="card">
                <h3 className="card-heading">Recent Runs</h3>
                {store.runs.length > 0 ? (
                  <div className="history-list">
                    {store.runs.slice(0, 6).map(r => (
                      <div key={r.id} className="history-item">
                        <span className={`hist-dot ${r.status}`} />
                        <span className="hist-goal">{r.goal}</span>
                        <span className="hist-steps">{r.steps.length} steps</span>
                        <span className="hist-time">{new Date(r.startedAt).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty">No runs yet.</div>
                )}
              </section>
            </div>
          </div>
        )}

        {/* ── MISSION ────────────────────────────── */}
        {tab === 'mission' && (
          <div className="page-scroll">
            <section className="mission-hero">
              <div className="hero-glow" />
              <Flame size={40} className="hero-icon" />
              <h1>Give DinoBuddy a mission</h1>
              <p>Plan, execute, observe, reflect. {store.tools.length} tools at the ready.</p>
              <VoiceTalkPanel
                config={store.voice}
                talkMode={talkMode}
                onTalkModeChange={setTalkMode}
                onUpdateConfig={patch => void store.updateVoice(patch)}
                onSubmitTranscript={handleVoiceSubmit}
                disabled={!store.voice.enabled}
                isRunning={store.isRunning}
              />
              <div className="composer">
                <textarea
                  rows={4}
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="e.g. List all TypeScript files in this project and summarize the architecture. (Ctrl+Enter to execute)"
                  onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void handleRun() } }}
                />
                <div className="composer-bar">
                  <button className="btn-primary" disabled={store.isRunning} onClick={() => void handleRun()}>
                    <Zap size={16} />
                    {store.isRunning ? 'Running...' : 'Execute'}
                  </button>
                  {store.isRunning && (
                    <button className="btn-ghost" onClick={() => void handleStop()}>
                      <Square size={16} />
                      Stop
                    </button>
                  )}
                  <button className="btn-ghost" onClick={() => void store.openDataDirectory()}>
                    <FolderOpen size={16} /> Data
                  </button>
                  {store.error && (
                    <span className="inline-error" onClick={() => store.clearError()} title="Click to dismiss">
                      {store.error}
                    </span>
                  )}
                </div>
              </div>
            </section>

            {/* Live Steps (streaming) */}
            {store.isRunning && store.liveSteps.length > 0 && (
              <section className="card live-card">
                <h3 className="card-heading"><Activity size={14} className="live-pulse" /> Live Execution</h3>
                <div className="steps">
                  {store.liveSteps.map(e => (
                    <div key={e.step.id} className={`step ${e.step.kind}`}>
                      <div className="step-head">
                        <ChevronRight size={14} />
                        <strong>{e.step.summary}</strong>
                        <span className="step-tag">{e.step.toolName ?? e.step.kind}</span>
                        {e.step.durationMs != null && e.step.durationMs > 0 && (
                          <span className="step-duration">{e.step.durationMs}ms</span>
                        )}
                      </div>
                      {e.step.payload && <pre className="step-pre">{e.step.payload}</pre>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="run-grid">
              <section className="card run-detail">
                <h3 className="card-heading">
                  {selectedRun && (
                    <button className="btn-icon-sm" onClick={() => store.selectRun(null)} title="Back to latest">
                      <ArrowLeft size={14} />
                    </button>
                  )}
                  {selectedRun ? 'Run Detail' : 'Latest Run'}
                </h3>
                {latestRun ? (
                  <>
                    <div className="run-meta">
                      <span className="run-goal">{latestRun.goal}</span>
                      <span className={`pill ${latestRun.status}`}>{latestRun.status}</span>
                      {latestRun.finishedAt && latestRun.startedAt && (
                        <span className="run-duration">{((latestRun.finishedAt - latestRun.startedAt) / 1000).toFixed(1)}s</span>
                      )}
                    </div>
                    {latestRun.toolsUsed.length > 0 && (
                      <div className="run-tools-used">
                        {latestRun.toolsUsed.map(t => (
                          <span key={t} className="tool-used-badge">{t}</span>
                        ))}
                      </div>
                    )}
                    <div className="steps">
                      {latestRun.steps.map(s => (
                        <div key={s.id} className={`step ${s.kind}`}>
                          <div className="step-head">
                            <ChevronRight size={14} />
                            <strong>{s.summary}</strong>
                            <span className="step-tag">{s.toolName ?? s.kind}</span>
                            {s.durationMs != null && s.durationMs > 0 && (
                              <span className="step-duration">{s.durationMs}ms</span>
                            )}
                          </div>
                          {s.payload && <pre className="step-pre">{s.payload}</pre>}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="empty">No runs yet. Type a goal above and hit Execute.</div>
                )}
              </section>

              <aside className="run-sidebar">
                <section className="card">
                  <h3 className="card-heading">Run History</h3>
                  {store.runs.length > 0 ? (
                    <div className="history-list">
                      {store.runs.slice(0, 10).map(r => (
                        <div
                          key={r.id}
                          className={`history-item clickable ${store.selectedRunId === r.id ? 'selected' : ''}`}
                          onClick={() => store.selectRun(r.id)}
                        >
                          <span className={`hist-dot ${r.status}`} />
                          <span className="hist-goal">{r.goal}</span>
                          <span className="hist-time">{new Date(r.startedAt).toLocaleTimeString()}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty">History appears here after your first run.</div>
                  )}
                </section>

                <section className="card">
                  <h3 className="card-heading">Tool Surface</h3>
                  <div className="tool-row">
                    {store.tools.map(t => (
                      <div key={t.name} className={`tool-badge risk-${t.risk}`}>
                        <span>{t.name}</span>
                        <small>{t.risk}</small>
                      </div>
                    ))}
                  </div>
                </section>
              </aside>
            </div>
          </div>
        )}

        {/* ── CREED ──────────────────────────────── */}
        {tab === 'creed' && (
          <div className="page-scroll">
            <CreedPanel
              creed={store.creed}
              creedDraft={creedDraft}
              onEdit={(field, value) =>
                setCreedEdits(prev => ({ ...(prev ?? makeCreedDraft(store.creed)), [field]: value }))
              }
              onSave={() => void handleSaveCreed()}
            />
          </div>
        )}

        {/* ── MEMORY ─────────────────────────────── */}
        {tab === 'memory' && (
          <div className="page-scroll">
            <section className="page-header">
              <Brain size={32} className="hero-icon" />
              <h1>Durable Memory</h1>
              <p>{store.stats.memoryCount} memories stored. Facts, preferences, and patterns across sessions.</p>
            </section>

            <div className="memory-toolbar">
              <div className="memory-search-wrap">
                <Search size={16} />
                <input
                  placeholder="Search memories..."
                  value={memorySearch}
                  onChange={e => handleMemorySearch(e.target.value)}
                />
                {memorySearch && (
                  <button className="btn-icon" onClick={() => { setMemorySearch(''); store.clearMemorySearch() }}>
                    <X size={14} />
                  </button>
                )}
              </div>
              <button className="btn-ghost" onClick={() => void handleExportMemory()}>
                <Download size={14} /> Export
              </button>
              <button className="btn-ghost" onClick={() => handleImportMemory()}>
                <Upload size={14} /> Import
              </button>
            </div>

            {memoryList.length > 0 ? (
              <div className="memory-grid">
                {memoryList.map(m => (
                  <div key={m.id} className="card memory-card">
                    <div className="memory-card-head">
                      <span className={`memory-cat cat-${m.category}`}>{m.category}</span>
                      <span className="memory-stars">{'★'.repeat(m.importance)}{'☆'.repeat(5 - m.importance)}</span>
                      <button className="btn-icon-sm" onClick={() => void store.deleteMemory(m.id)} title="Delete">
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <p>{m.fact}</p>
                    {m.tags.length > 0 && (
                      <div className="memory-tags">
                        {m.tags.map(t => <span key={t} className="memory-tag">{t}</span>)}
                      </div>
                    )}
                    <small>{new Date(m.createdAt).toLocaleString()}</small>
                  </div>
                ))}
              </div>
            ) : (
              <div className="card"><div className="empty">No memories stored yet. DinoClaw learns as it runs.</div></div>
            )}
          </div>
        )}

        {/* ── DINO STOMP ─────────────────────────── */}
        {tab === 'stomp' && (
          <div className="page-scroll">
            <section className="page-header">
              <Heart size={32} className="hero-icon" />
              <h1>Dino Stomp</h1>
              <p>
                Autonomous beneficial care — notes, random check-ins on your folders, gentle tidying, daily logs.
                *happy stomps* 🦖❤️ · Phase {store.stomp.phase}
              </p>
            </section>

            <div className="stomp-toolbar">
              <div className={`stomp-orb stomp-orb-${store.stomp.presence}`} />
              <div className="stomp-toolbar-copy">
                <strong>{stompPresenceLabel(store.stomp.presence)}</strong>
                <span>
                  {store.stomp.heldCount > 0
                    ? `${store.stomp.heldCount} held thought${store.stomp.heldCount === 1 ? '' : 's'} waiting for a good moment`
                    : 'Dino checks in when it helps — never when you\'re busy.'}
                </span>
              </div>
              <button
                className="btn-primary"
                disabled={!store.stomp.config.enabled}
                onClick={() => void store.stompNow()}
              >
                Stomp now 🦖
              </button>
              {stompCanTidy(store.stomp.config.autonomy) && (
                <button
                  className="btn-ghost"
                  disabled={!store.stomp.config.enabled || tidyPreview.length === 0}
                  title={tidyPreview.length === 0 ? 'No cluttered folders in your tidy list' : 'Sort loose files into DinoSorted/'}
                  onClick={() => void store.stompTidyNow().then(() => refreshTidyPreview())}
                >
                  Tidy now 📁
                </button>
              )}
              <button className="btn-ghost" onClick={() => void store.openStompNotesDirectory()}>
                <FolderOpen size={14} /> Notes folder
              </button>
            </div>

            {stompCanTidy(store.stomp.config.autonomy) && (
              <div className="card stomp-health-card">
                <div className="stomp-health-head">
                  <h3 className="card-heading">Folder health</h3>
                  <button
                    className="btn-ghost btn-sm"
                    disabled={tidyPreviewLoading}
                    onClick={() => void refreshTidyPreview()}
                  >
                    Refresh
                  </button>
                </div>
                {tidyPreviewLoading ? (
                  <p className="infra-desc">Scanning tidy folders…</p>
                ) : tidyPreview.length > 0 ? (
                  <ul className="stomp-health-list">
                    {tidyPreview.map(item => (
                      <li key={item.folder} className="stomp-health-item">
                        <div className="stomp-health-copy">
                          <strong>{item.label}</strong>
                          <span>{item.looseCount} loose · up to {item.moveCount} moves</span>
                        </div>
                        <button
                          className="btn-ghost btn-sm"
                          onClick={() => void store.openStompFolder(item.folder)}
                        >
                          Open
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="infra-desc">
                    No cluttered folders right now — or add paths under <strong>Tidy folders</strong> below.
                  </p>
                )}
              </div>
            )}

            <div className="card stomp-settings-inline">
              <label className="stomp-toggle">
                <input
                  type="checkbox"
                  checked={store.stomp.config.enabled}
                  onChange={e => void store.updateStompConfig({ enabled: e.target.checked })}
                />
                <span>Enable Dino Stomp (autonomous notes)</span>
              </label>
              <label>
                <span>Autonomy</span>
                <select
                  value={store.stomp.config.autonomy}
                  onChange={e => void store.updateStompConfig({
                    autonomy: e.target.value as typeof store.stomp.config.autonomy,
                  })}
                >
                  <option value="off">Off</option>
                  <option value="notes_only">Notes only</option>
                  <option value="gentle">Gentle — notes + tidy allowed folders</option>
                  <option value="helpful">Helpful — + daily log + staged missions</option>
                  <option value="full">Full buddy (same as helpful; custom paths in Settings)</option>
                </select>
              </label>
              <label className="stomp-toggle">
                <input
                  type="checkbox"
                  checked={store.stomp.config.watchEnabled !== false}
                  onChange={e => void store.updateStompConfig({ watchEnabled: e.target.checked })}
                />
                <span>Random folder check-ins (read-only)</span>
              </label>
            </div>

            <div className="card stomp-how-card">
              <h3 className="card-heading">How Dino works</h3>
              <ul className="stomp-how-list">
                <li><strong>Check-ins</strong> — read-only peeks at check-in folders (counts, filenames). Dino writes a note; nothing moves.</li>
                <li><strong>Tidy</strong> — needs <strong>Gentle</strong> autonomy or higher. Scans tidy folders <em>and one level of subfolders</em> (e.g. Videos/Screen Recordings). Moves loose files into <code>DinoSorted/</code>; never deletes.</li>
                <li><strong>When</strong> — idle moments, spacing caps, quiet hours (no file moves at night). Engage or tap Stomp now to act sooner.</li>
              </ul>
            </div>

            <div className="card stomp-watch-card">
              <h3 className="card-heading">Tidy folders</h3>
              <p className="infra-desc">
                Dino moves loose files into <code>DinoSorted/</code> subfolders (videos, images, documents…).
                Needs <strong>Gentle</strong> autonomy or higher. One path per line.
              </p>
              <label>
                <span>Tidy folders (empty = Downloads, Desktop, Documents, Videos + subfolders)</span>
                <textarea
                  className="stomp-paths-textarea"
                  rows={4}
                  value={(store.stomp.config.allowedPaths ?? []).join('\n')}
                  onChange={e => void store.updateStompConfig({
                    allowedPaths: parseStompPathLines(e.target.value),
                  })}
                  placeholder={'C:\\Users\\You\\Downloads\nC:\\Users\\You\\Videos\\Screen Recordings'}
                />
              </label>
            </div>

            <div className="card stomp-watch-card">
              <h3 className="card-heading">Where Dino peeks</h3>
              <p className="infra-desc">
                Check-ins are <strong>read-only</strong> — filenames and counts only, no file contents, no whole-disk scan.
                Default includes Documents, Pictures, Videos, Screen Recordings, Music, Downloads, Desktop.
              </p>
              <label>
                <span>Check-in folders (one per line, empty = defaults)</span>
                <textarea
                  className="stomp-paths-textarea"
                  rows={4}
                  value={(store.stomp.config.watchPaths ?? []).join('\n')}
                  onChange={e => void store.updateStompConfig({
                    watchPaths: parseStompPathLines(e.target.value),
                  })}
                  placeholder="Documents, Pictures, Videos, Music"
                />
              </label>
            </div>

            <div className="card stomp-roadmap-card">
              <h3 className="card-heading">Roadmap</h3>
              <ul className="stomp-roadmap-list">
                <li className="done">v0.1 — Warm notes + journal</li>
                <li className="done">v0.2 — Gentle tidy (move only, undo)</li>
                <li className="done">v0.3 — Daily log + staged missions</li>
                <li className="done">v0.4 — Random folder check-ins</li>
                <li>v0.5 — Pattern learning + Pantheon handoffs</li>
              </ul>
            </div>

            {store.stomp.journal.length > 0 ? (
              <div className="stomp-journal">
                {store.stomp.journal.map(entry => (
                  <article
                    key={entry.id}
                    className={`card stomp-entry ${entry.dismissedAt ? 'dismissed' : ''} ${entry.engagedAt ? 'engaged' : ''}`}
                  >
                    <header className="stomp-entry-head">
                      <span className="stomp-entry-kind">{entry.kind}</span>
                      <time>{new Date(entry.surfacedAt).toLocaleString()}</time>
                    </header>
                    <h3>{entry.title}</h3>
                    <div className="stomp-entry-body">
                      {entry.body.split('\n').map((line, i) => (
                        <p key={i}>{line}</p>
                      ))}
                    </div>
                    <footer className="stomp-entry-actions">
                      {entry.kind === 'prepare' && entry.prepareGoal && (
                        <button
                          className="btn-ghost btn-sm"
                          onClick={() => launchMission(entry.prepareGoal!)}
                        >
                          <Play size={12} /> Run mission
                        </button>
                      )}
                      {entry.filePath && entry.kind === 'tidy' && (
                        <button
                          className="btn-ghost btn-sm"
                          onClick={() => void store.openStompFolder(entry.filePath!)}
                        >
                          <FolderOpen size={12} /> Open folder
                        </button>
                      )}
                      {entry.filePath && (entry.kind === 'document' || entry.kind === 'prepare' || entry.kind === 'note') && (
                        <button
                          className="btn-ghost btn-sm"
                          onClick={() => void store.openStompNotesDirectory()}
                        >
                          <FolderOpen size={12} /> Open note
                        </button>
                      )}
                      {entry.kind === 'tidy' && entry.undoManifest && entry.undoManifest.length > 0 && !entry.undoneAt && (
                        <button className="btn-ghost btn-sm" onClick={() => void store.undoStomp(entry.id)}>
                          Undo tidy
                        </button>
                      )}
                      {entry.undoneAt && (
                        <span className="stomp-undone-label">Undone ✓</span>
                      )}
                      {!entry.engagedAt && (
                        <button className="btn-ghost btn-sm" onClick={() => void store.engageStomp(entry.id)}>
                          <Heart size={12} /> Thanks, Dino
                        </button>
                      )}
                      {!entry.dismissedAt && (
                        <button className="btn-ghost btn-sm" onClick={() => void store.dismissStomp(entry.id)}>
                          Not now
                        </button>
                      )}
                    </footer>
                  </article>
                ))}
              </div>
            ) : (
              <div className="card">
                <div className="empty">
                  No stomps yet. Leave DinoClaw open — when the moment is right, you'll get a note. Or hit Stomp now!
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── SKILLS ─────────────────────────────── */}
        {tab === 'skills' && (
          <div className="page-scroll">
            <section className="page-header">
              <Package size={32} className="hero-icon" />
              <h1>Skill Packs</h1>
              <p>Extend DinoClaw's capabilities with loadable skill modules.</p>
            </section>

            {store.skills.length > 0 ? (
              <div className="skills-grid">
                {store.skills.map(skill => (
                  <div key={skill.id} className={`card skill-card ${skill.enabled ? 'enabled' : 'disabled'}`}>
                    <div className="skill-header">
                      <Package size={18} className="skill-icon" />
                      <div>
                        <h4 className="skill-name">{skill.name}</h4>
                        <span className="skill-version">v{skill.version}</span>
                      </div>
                      {skill.builtin ? (
                        <button
                          className="btn-icon-sm"
                          onClick={() => void store.installSkill({ ...skill, enabled: !skill.enabled })}
                          title={skill.enabled ? 'Disable core skill' : 'Enable core skill'}
                        >
                          {skill.enabled ? <X size={14} /> : <Check size={14} />}
                        </button>
                      ) : (
                        <button className="btn-icon-sm danger" onClick={() => void store.removeSkill(skill.id)} title="Remove">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                    <p className="skill-desc">{skill.description}</p>
                    <div className="skill-meta">
                      {skill.category && <span>{skill.category}</span>}
                      <span>by {skill.author}</span>
                      <span>{skill.tools.length} tools</span>
                      {skill.builtin && <span>core pack</span>}
                    </div>
                    {skill.triggers && skill.triggers.length > 0 && (
                      <div className="memory-tags">
                        {skill.triggers.slice(0, 4).map(trigger => <span key={trigger} className="memory-tag">{trigger}</span>)}
                      </div>
                    )}
                    <pre className="step-pre">{skill.instructions}</pre>
                    {skill.workflow && skill.workflow.length > 0 && (
                      <div className="field-stack compact">
                        <strong>Workflow</strong>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {skill.workflow.map(step => <li key={step}>{step}</li>)}
                        </ul>
                      </div>
                    )}
                    {skill.recovery && skill.recovery.length > 0 && (
                      <div className="field-stack compact">
                        <strong>Recovery</strong>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {skill.recovery.map(step => <li key={step}>{step}</li>)}
                        </ul>
                      </div>
                    )}
                    {skill.outputStyle && skill.outputStyle.length > 0 && (
                      <div className="field-stack compact">
                        <strong>Output style</strong>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {skill.outputStyle.map(step => <li key={step}>{step}</li>)}
                        </ul>
                      </div>
                    )}
                    {skill.examples && skill.examples.length > 0 && (
                      <div className="field-stack compact">
                        <strong>Example missions</strong>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {skill.examples.map(step => <li key={step}>{step}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="card">
                <div className="empty">
                  No skills installed yet. Skills extend DinoClaw with specialized behaviors and instructions.
                </div>
              </div>
            )}

            <section className="card" style={{ marginTop: 16 }}>
              <h3 className="card-heading">Built-in Tools ({store.tools.length})</h3>
              <div className="tool-row">
                {store.tools.map(t => (
                  <div key={t.name} className={`tool-badge risk-${t.risk}`}>
                    <span>{t.name}</span>
                    <small>{t.risk}</small>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ── INFRASTRUCTURE ────────────────────── */}
        {tab === 'infra' && (
          <div className="page-scroll">
            <section className="page-header">
              <Server size={32} className="hero-icon" />
              <h1>Infrastructure</h1>
              <p>Gateway API, channels, scheduler, tunnels, Docker sandbox, browser, and service management.</p>
            </section>

            <div className="infra-grid">
              {/* Gateway */}
              <section className="card">
                <h3 className="card-heading"><Globe size={14} /> Gateway API</h3>
                <div className="infra-status">
                  <span className={`indicator ${store.gateway.running ? 'pulse' : ''}`} />
                  <span>{store.gateway.running ? `Running on :${store.gateway.port}` : 'Stopped'}</span>
                  {store.gateway.paired && <span className="pill completed">Paired</span>}
                </div>
                {gatewayPairingCode && (
                  <div className="infra-pairing">Pairing Code: <code>{gatewayPairingCode}</code></div>
                )}
                <div className="infra-actions">
                  {!store.gateway.running ? (
                    <button className="btn-primary" onClick={async () => {
                      const result = await store.startGateway(42617)
                      if (result) setGatewayPairingCode(result.pairingCode)
                    }}>
                      <Play size={14} /> Start Gateway
                    </button>
                  ) : (
                    <button className="btn-ghost" onClick={() => { void store.stopGateway(); setGatewayPairingCode('') }}>
                      <Square size={14} /> Stop
                    </button>
                  )}
                </div>
                <p className="infra-desc">REST API with pairing security. Endpoints: /health, /pair, /webhook, /status</p>
              </section>

              {/* Dino Link (Phone) */}
              <section className="card link-setup-card">
                <h3 className="card-heading"><Smartphone size={14} /> Dino Link (Phone)</h3>
                <p className="infra-desc link-setup-warn">
                  GitHub Pages is HTTPS — it cannot reach an <code>http://</code> Nest. That is why you see &quot;failed to fetch&quot;.
                </p>
                {linkSetup?.gatewayRunning ? (
                  <div className="link-setup-steps">
                    <p className="link-setup-title">Easiest fix (same Wi‑Fi)</p>
                    <ol className="link-setup-list">
                      <li>
                        On PC, open a <strong>second</strong> terminal in DinoClaw folder and run:
                        <code className="link-setup-code">npm run serve:link</code>
                      </li>
                      <li>
                        On phone, open:
                        {linkSetup.linkLanUrl ? (
                          <button type="button" className="link-setup-copy" onClick={() => void copyText(linkSetup.linkLanUrl!)}>
                            <code>{linkSetup.linkLanUrl}</code>
                          </button>
                        ) : (
                          <code>http://YOUR-PC-IP:8808/link.html</code>
                        )}
                      </li>
                      <li>
                        Nest URL:
                        {linkSetup.tunnelHttpsUrl ? (
                          <button type="button" className="link-setup-copy" onClick={() => void copyText(linkSetup.tunnelHttpsUrl!)}>
                            <code>{linkSetup.tunnelHttpsUrl}</code> (tunnel)
                          </button>
                        ) : linkSetup.nestHttpUrl ? (
                          <button type="button" className="link-setup-copy" onClick={() => void copyText(linkSetup.nestHttpUrl!)}>
                            <code>{linkSetup.nestHttpUrl}</code>
                          </button>
                        ) : (
                          <code>http://LAN-IP:42617</code>
                        )}
                      </li>
                      <li>
                        Pairing code:
                        <code>{gatewayPairingCode || linkSetup.pairingCode || 'start gateway'}</code>
                      </li>
                    </ol>
                    <p className="infra-desc">
                      LAN IP{linkSetup.lanIps.length > 1 ? 's' : ''}: {linkSetup.lanIps.join(', ') || 'none found'}
                    </p>
                  </div>
                ) : (
                  <p className="infra-desc">Start Gateway above first, then follow the phone steps.</p>
                )}
                <p className="infra-desc">
                  Or install <code>cloudflared</code> (<code>winget install Cloudflare.cloudflared</code>), start Tunnel below, and use the <code>https://</code> URL with GitHub Pages Dino Link.
                </p>
              </section>

              {/* Telegram */}
              <section className="card">
                <h3 className="card-heading"><Radio size={14} /> Telegram</h3>
                <div className="infra-status">
                  <span className={`indicator ${store.channels.telegram.enabled ? 'pulse' : ''}`} />
                  <span>{store.channels.telegram.enabled ? 'Connected' : 'Offline'}</span>
                </div>
                {!store.channels.telegram.enabled ? (
                  <div className="field-stack compact">
                    <input placeholder="Bot Token" value={telegramToken} onChange={e => setTelegramToken(e.target.value)} />
                    <input placeholder="Allowed users (comma-sep, or * for all)" value={telegramUsers} onChange={e => setTelegramUsers(e.target.value)} />
                    <button className="btn-primary" onClick={() => {
                      if (telegramToken.trim()) void store.startTelegram(telegramToken.trim(), telegramUsers.split(',').map(s => s.trim()).filter(Boolean))
                    }}>
                      <Play size={14} /> Connect
                    </button>
                  </div>
                ) : (
                  <button className="btn-ghost" onClick={() => void store.stopTelegram()}>
                    <Square size={14} /> Disconnect
                  </button>
                )}
              </section>

              {/* Discord */}
              <section className="card">
                <h3 className="card-heading"><Radio size={14} /> Discord</h3>
                <div className="infra-status">
                  <span className={`indicator ${store.channels.discord.enabled ? 'pulse' : ''}`} />
                  <span>{store.channels.discord.enabled ? 'Connected' : 'Offline'}</span>
                </div>
                {!store.channels.discord.enabled ? (
                  <div className="field-stack compact">
                    <input placeholder="Bot Token" value={discordToken} onChange={e => setDiscordToken(e.target.value)} />
                    <input placeholder="Allowed users: * for all, or your username" value={discordUsers} onChange={e => setDiscordUsers(e.target.value)} />
                    <button className="btn-primary" onClick={() => {
                      if (discordToken.trim()) void store.startDiscord(discordToken.trim(), discordUsers.split(',').map(s => s.trim()).filter(Boolean))
                    }}>
                      <Play size={14} /> Connect
                    </button>
                  </div>
                ) : (
                  <button className="btn-ghost" onClick={() => void store.stopDiscord()}>
                    <Square size={14} /> Disconnect
                  </button>
                )}
              </section>

              {/* Scheduler */}
              <section className="card">
                <h3 className="card-heading"><Clock size={14} /> Scheduled Tasks</h3>
                {store.cronJobs.length > 0 && (
                  <div className="cron-list">
                    {store.cronJobs.map(job => (
                      <div key={job.id} className="cron-item">
                        <span className={`indicator ${job.enabled ? 'pulse' : ''}`} />
                        <span className="cron-name">{job.name}</span>
                        <span className="cron-schedule">{job.schedule}</span>
                        <button className="btn-icon-sm danger" onClick={() => void store.removeCronJob(job.id)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="field-stack compact">
                  <input placeholder="Task name" value={cronName} onChange={e => setCronName(e.target.value)} />
                  <input placeholder="Schedule (e.g. every 30m, daily at 09:00)" value={cronSchedule} onChange={e => setCronSchedule(e.target.value)} />
                  <input placeholder="Goal to execute" value={cronGoal} onChange={e => setCronGoal(e.target.value)} />
                  <button className="btn-primary" onClick={() => {
                    if (cronName && cronSchedule && cronGoal) {
                      void store.addCronJob(cronName, cronSchedule, cronGoal)
                      setCronName(''); setCronSchedule(''); setCronGoal('')
                    }
                  }}>
                    <Plus size={14} /> Add Task
                  </button>
                </div>
              </section>

              {/* Tunnel */}
              <section className="card">
                <h3 className="card-heading"><Compass size={14} /> Tunnel</h3>
                <div className="infra-status">
                  <span className={`indicator ${store.tunnel.running ? 'pulse' : ''}`} />
                  <span>{store.tunnel.running ? store.tunnel.url : 'Not active'}</span>
                </div>
                <div className="infra-actions">
                  {!store.tunnel.running ? (
                    <>
                      <button className="btn-ghost" onClick={() => void store.startTunnel('cloudflare', 42617)}>
                        Cloudflare
                      </button>
                      <button className="btn-ghost" onClick={() => void store.startTunnel('ngrok', 42617)}>
                        ngrok
                      </button>
                    </>
                  ) : (
                    <button className="btn-ghost" onClick={() => void store.stopTunnel()}>
                      <Square size={14} /> Stop Tunnel
                    </button>
                  )}
                </div>
                <p className="infra-desc">Expose gateway via Cloudflare or ngrok. Requires cloudflared/ngrok installed on PATH.</p>
              </section>

              {/* Docker */}
              <section className="card">
                <h3 className="card-heading"><Container size={14} /> Docker Sandbox</h3>
                <div className="infra-status">
                  <span>{store.docker.image}</span>
                  <span className="pill">{store.docker.network}</span>
                </div>
                <p className="infra-desc">
                  Sandboxed command execution via Docker containers. Read-only rootfs, network isolation, memory limits.
                  The docker_exec tool uses this sandbox automatically.
                </p>
              </section>

              {/* Browser */}
              <section className="card">
                <h3 className="card-heading"><Globe size={14} /> Browser Tools</h3>
                <div className="infra-status">
                  <span className={`indicator ${store.browser.enabled ? 'pulse' : ''}`} />
                  <span>{store.browser.enabled ? 'Enabled' : 'Disabled'}</span>
                  {store.browserSession.open && <span className="pill completed">Session Active</span>}
                </div>
                {store.browserSession.open && (
                  <div className="infra-pairing">
                    Session: <code>{store.browserSession.domain || store.browserSession.url}</code>
                  </div>
                )}
                <div className="infra-actions">
                  <button
                    className={`btn-ghost ${store.browser.enabled ? 'active' : ''}`}
                    onClick={() => void store.updateBrowser({ ...store.browser, enabled: !store.browser.enabled })}
                  >
                    {store.browser.enabled ? 'Disable' : 'Enable'} Browser
                  </button>
                  <button className="btn-ghost" onClick={() => void store.clearBrowserSession()}>
                    Clear Session
                  </button>
                </div>
                <div className="field-stack compact">
                  <label>
                    <span>Allowed Domains (comma-separated, * for all)</span>
                    <input
                      value={browserDomainsInput}
                      onChange={e => setBrowserDomainsInput(e.target.value)}
                      placeholder="linkedin.com, github.com"
                    />
                  </label>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      const allowedDomains = browserDomainsInput
                        .split(',')
                        .map(s => s.trim())
                        .filter(Boolean)
                      void store.updateBrowser({ ...store.browser, allowedDomains })
                    }}
                  >
                    Save Domain Allowlist
                  </button>
                  <button
                    className={`btn-ghost ${store.browser.requireApprovalForWrites ? 'active' : ''}`}
                    onClick={() => void store.updateBrowser({
                      ...store.browser,
                      requireApprovalForWrites: !store.browser.requireApprovalForWrites,
                    })}
                  >
                    {store.browser.requireApprovalForWrites ? 'Browser Writes Require Approval' : 'Browser Writes Auto-Run'}
                  </button>
                </div>
                <p className="infra-desc">Persistent DinoClaw browser session with navigate, snapshot, click, fill, type, wait, and search tools.</p>
              </section>

              {/* Service */}
              <section className="card">
                <h3 className="card-heading"><Settings size={14} /> Service Management</h3>
                <div className="infra-status">
                  <span>Status: {store.serviceStatus}</span>
                </div>
                <p className="infra-desc">
                  {navigator.platform.startsWith('Win')
                    ? 'Windows Task Scheduler for auto-start on login.'
                    : 'Systemd user service for background daemon.'}
                </p>
              </section>
            </div>
          </div>
        )}

        {/* ── SETTINGS ───────────────────────────── */}
        {tab === 'settings' && (
          <div className="page-scroll">
            <section className="page-header">
              <Settings size={32} className="hero-icon" />
              <h1>Configuration</h1>
              <p>Model provider, execution policy, and security settings.</p>
            </section>
            <div className="settings-grid">
              <div className="card">
                <h3 className="card-heading">AI Provider</h3>
                <div className="field-stack">
                  <label>
                    <span>Provider</span>
                    <select
                      value={modelDraft.provider}
                      onChange={e => handleProviderChange(e.target.value)}
                    >
                      <option value="ollama">Ollama (local)</option>
                      <option value="ollama-cloud">Ollama Cloud</option>
                      <option value="openai-compatible">OpenAI / GPT</option>
                      <option value="anthropic">Anthropic / Claude</option>
                      <option value="google-gemini">Google Gemini</option>
                      <option value="groq">Groq</option>
                      <option value="openrouter">OpenRouter</option>
                    </select>
                  </label>
                  <label>
                    <span>Base URL</span>
                    <input value={modelDraft.baseUrl} onChange={e => setModelEdits({ ...modelDraft, baseUrl: e.target.value })} />
                  </label>
                  <label>
                    <span>Model</span>
                    {modelDraft.provider === 'ollama-cloud' ? (
                      <select
                        value={modelDraft.model}
                        onChange={e => setModelEdits({ ...modelDraft, model: e.target.value })}
                      >
                        {OLLAMA_CLOUD_MODELS.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    ) : (
                      <input value={modelDraft.model} onChange={e => setModelEdits({ ...modelDraft, model: e.target.value })} />
                    )}
                  </label>
                  <label>
                    <span>API Key</span>
                    <input type="password" value={modelDraft.apiKey} onChange={e => setModelEdits({ ...modelDraft, apiKey: e.target.value })} />
                  </label>
                  <div className="field-row">
                    <label>
                      <span>Temperature</span>
                      <input value={modelDraft.temperature} onChange={e => setModelEdits({ ...modelDraft, temperature: e.target.value })} />
                    </label>
                    <label>
                      <span>Max Tokens</span>
                      <input value={modelDraft.maxTokens} onChange={e => setModelEdits({ ...modelDraft, maxTokens: e.target.value })} />
                    </label>
                  </div>
                  <button className="btn-primary" onClick={() => void handleSaveModel()}>Save Model</button>
                </div>
              </div>

              <div className="settings-right">
                <div className="card">
                  <h3 className="card-heading"><Shield size={14} /> Execution Policy</h3>
                  <div className="field-stack">
                    <div className="policy-current">
                      <span>Mode:</span>
                      <span className={`pill ${store.policy.mode === 'open' ? 'completed' : store.policy.mode === 'lockdown' ? 'failed' : 'guarded'}`}>
                        {store.policy.mode}
                      </span>
                    </div>
                    <div className="policy-modes">
                      {(['open', 'review-risky', 'lockdown'] as ExecutionMode[]).map(mode => (
                        <button
                          key={mode}
                          className={`policy-mode-btn ${store.policy.mode === mode ? 'active' : ''}`}
                          onClick={() => void store.savePolicy({ ...store.policy, mode })}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                    <p className="policy-desc">
                      <strong>open</strong> — all tools run freely<br />
                      <strong>review-risky</strong> — risky tools require approval<br />
                      <strong>lockdown</strong> — all tools require approval
                    </p>
                    <label className="field-row" style={{ alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(store.policy.desktopAutomationEnabled)}
                        onChange={e =>
                          void store.savePolicy({ ...store.policy, desktopAutomationEnabled: e.target.checked })
                        }
                      />
                      <span>
                        <strong>Desktop copilot (OS assist)</strong> — launch apps, wait for windows, inspect screens, focus a real
                        app, move/click the mouse, type, send keys/hotkeys, and scroll via <code>desktop_open_app</code>,{' '}
                        <code>desktop_wait_for_window</code>, <code>desktop_list_windows</code>, <code>desktop_screenshot</code>,{' '}
                        <code>desktop_focus_window</code>, <code>desktop_mouse_move</code>, <code>desktop_click</code>,{' '}
                        <code>desktop_type_text</code>, <code>desktop_press_key</code>, <code>desktop_hotkey</code>, and{' '}
                        <code>desktop_scroll</code>. Also use <code>open_file_external</code> / <code>reveal_in_explorer</code> to
                        pull up workspace files. Still respects approval when policy requires it.
                      </span>
                    </label>
                  </div>
                </div>

                <div className="card">
                  <h3 className="card-heading"><Mic size={14} /> Talk Mode</h3>
                  <p className="infra-desc">
                    Tap the mic on the Mission tab to talk. Replies can be spoken aloud using your
                    system voice (espeak-ng on Steam Deck). First speech download is ~40 MB, one-time.
                  </p>
                  <div className="field-stack">
                    <label className="stomp-toggle">
                      <input
                        type="checkbox"
                        checked={store.voice.enabled}
                        onChange={e => void store.updateVoice({ enabled: e.target.checked })}
                      />
                      <span>Enable voice / talk mode</span>
                    </label>
                    <label className="stomp-toggle">
                      <input
                        type="checkbox"
                        checked={store.voice.inputEnabled}
                        disabled={!store.voice.enabled}
                        onChange={e => void store.updateVoice({ inputEnabled: e.target.checked })}
                      />
                      <span>Microphone input (speech-to-text)</span>
                    </label>
                    <label className="stomp-toggle">
                      <input
                        type="checkbox"
                        checked={store.voice.outputEnabled}
                        disabled={!store.voice.enabled}
                        onChange={e => {
                          if (!e.target.checked) stopSpeech()
                          void store.updateVoice({ outputEnabled: e.target.checked })
                        }}
                      />
                      <span>Speak DinoBuddy&apos;s replies aloud (uses system TTS — install <code>espeak-ng</code> on Deck if silent)</span>
                    </label>
                    <label className="stomp-toggle">
                      <input
                        type="checkbox"
                        checked={store.voice.continuous}
                        disabled={!store.voice.enabled}
                        onChange={e => void store.updateVoice({ continuous: e.target.checked })}
                      />
                      <span>Keep listening between missions (hands-free)</span>
                    </label>
                  </div>
                </div>

                <div className="card">
                  <h3 className="card-heading"><Heart size={14} /> Dino Stomp</h3>
                  <p className="infra-desc">
                    Proactive beneficial care — Dino writes warm notes when it helps.
                    Quiet hours, daily caps, and dismiss cooldown keep it respectful.
                  </p>
                  <div className="field-stack">
                    <label className="stomp-toggle">
                      <input
                        type="checkbox"
                        checked={store.stomp.config.enabled}
                        onChange={e => void store.updateStompConfig({ enabled: e.target.checked })}
                      />
                      <span>Enable autonomous notes</span>
                    </label>
                    <label>
                      <span>Check-in interval (seconds)</span>
                      <input
                        type="number"
                        min={60}
                        value={store.stomp.config.tickSeconds}
                        onChange={e => void store.updateStompConfig({
                          tickSeconds: Math.max(60, Number(e.target.value) || 300),
                        })}
                      />
                    </label>
                    <label>
                      <span>Daily note cap</span>
                      <input
                        type="number"
                        min={1}
                        max={24}
                        value={store.stomp.config.dailyNoteCap}
                        onChange={e => void store.updateStompConfig({
                          dailyNoteCap: Math.max(1, Number(e.target.value) || 8),
                        })}
                      />
                    </label>
                    <label>
                      <span>Daily action cap (tidy, log, prepare)</span>
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={store.stomp.config.dailyActionCap}
                        onChange={e => void store.updateStompConfig({
                          dailyActionCap: Math.max(1, Number(e.target.value) || 3),
                        })}
                      />
                    </label>
                    <label>
                      <span>Tidy folders (one path per line, empty = Downloads, Desktop, Documents, Videos + subfolders)</span>
                      <textarea
                        rows={3}
                        value={(store.stomp.config.allowedPaths ?? []).join('\n')}
                        onChange={e => void store.updateStompConfig({
                          allowedPaths: parseStompPathLines(e.target.value),
                        })}
                        placeholder="Leave empty for defaults (includes Videos/Screen Recordings)"
                      />
                    </label>
                    <label className="stomp-toggle">
                      <input
                        type="checkbox"
                        checked={store.stomp.config.watchEnabled !== false}
                        onChange={e => void store.updateStompConfig({ watchEnabled: e.target.checked })}
                      />
                      <span>Random folder check-ins (read-only peek)</span>
                    </label>
                    <label>
                      <span>Check-in folders (one per line, empty = defaults incl. Screen Recordings)</span>
                      <textarea
                        rows={4}
                        value={(store.stomp.config.watchPaths ?? []).join('\n')}
                        onChange={e => void store.updateStompConfig({
                          watchPaths: parseStompPathLines(e.target.value),
                        })}
                        placeholder="Add paths like D:\Projects or ~/Documents"
                      />
                    </label>
                  </div>
                </div>

                <div className="card">
                  <h3 className="card-heading">Runtime Limits</h3>
                  <div className="field-stack">
                    <label>
                      <span>Max Steps per Run</span>
                      <input
                        type="number"
                        value={store.policy.maxSteps}
                        onChange={e => void store.savePolicy({ ...store.policy, maxSteps: Number(e.target.value) || 12 })}
                      />
                    </label>
                    <label>
                      <span>Require Approval Above Risk</span>
                      <select
                        value={store.policy.requireApprovalAboveRisk}
                        onChange={e => void store.savePolicy({ ...store.policy, requireApprovalAboveRisk: e.target.value as ToolRisk })}
                      >
                        <option value="safe">Safe (approve everything)</option>
                        <option value="moderate">Moderate</option>
                        <option value="risky">Risky (default)</option>
                      </select>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

/* ── Approval Modal ──────────────────────────────────────── */
function ApprovalModal({
  request,
  onApprove,
  onDeny,
}: {
  request: ApprovalRequest
  onApprove: (r: ApprovalRequest) => void
  onDeny: (r: ApprovalRequest) => void
}) {
  const title = request.title
    ?? (request.kind === 'browser_checkpoint' ? 'Browser Checkpoint Approval' : 'Tool Approval Required')
  const kindLabel = request.kind === 'browser_checkpoint' ? 'browser checkpoint' : 'tool'
  const checkpointLabel = request.checkpointType?.replace(/_/g, ' ')

  return (
    <div className="modal-overlay">
      <div className="modal approval-modal">
        <div className="approval-header">
          <AlertTriangle size={24} className="approval-icon" />
          <h2>{title}</h2>
        </div>
        <div className="approval-body">
          <div className="approval-field">
            <span className="approval-label">Type:</span>
            <span className="pill">{kindLabel}</span>
            {checkpointLabel && <span className="pill">{checkpointLabel}</span>}
          </div>
          <div className="approval-field">
            <span className="approval-label">Tool:</span>
            <span className={`pill risk-${request.risk}`}>{request.toolName}</span>
            <span className={`pill ${request.risk}`}>{request.risk}</span>
          </div>
          <div className="approval-field">
            <span className="approval-label">Reason:</span>
            <p>{request.reason}</p>
          </div>
          <div className="approval-field">
            <span className="approval-label">Arguments:</span>
            <pre className="approval-args">{JSON.stringify(request.args, null, 2)}</pre>
          </div>
          {request.preview && (
            <div className="approval-field">
              <span className="approval-label">Preview:</span>
              <pre className="approval-args">{request.preview}</pre>
            </div>
          )}
        </div>
        <div className="approval-actions">
          <button className="btn-deny" onClick={() => onDeny(request)}>
            <X size={16} /> Deny
          </button>
          <button className="btn-approve" onClick={() => onApprove(request)}>
            <Check size={16} /> Approve
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Helpers ─────────────────────────────────────────────── */
function splitLines(v: string): string[] {
  return v.split('\n').map(s => s.trim()).filter(Boolean)
}

function formatUptime(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

type CreedDraft = {
  name: string; title: string; identity: string; relationship: string
  directives: string; vows: string; motto: string
}
type ModelDraft = {
  provider: ModelProvider; baseUrl: string; model: string
  apiKey: string; temperature: string; maxTokens: string
}

function makeCreedDraft(c: DinoCreed): CreedDraft {
  return {
    name: c.name, title: c.title, identity: c.identity,
    relationship: c.relationship, directives: c.directives.join('\n'),
    vows: c.vows.join('\n'), motto: c.motto,
  }
}

function makeModelDraft(m: ModelSettings): ModelDraft {
  return {
    provider: m.provider, baseUrl: m.baseUrl, model: m.model,
    apiKey: m.apiKey, temperature: String(m.temperature),
    maxTokens: String(m.maxTokens),
  }
}

export default App
