import os from 'node:os'
import path from 'node:path'
import { BrowserWindow, Notification } from 'electron'
import type { PersistedState } from './storage'
import type {
  StompCandidate,
  StompConfig,
  StompJournalEntry,
  StompKind,
  StompPresence,
  StompRuntimeState,
  StompSnapshot,
  StompUpdateEvent,
} from './dino-stomp-types'
import { DEFAULT_STOMP_CONFIG, DEFAULT_STOMP_RUNTIME, STOMP_PHASE } from './dino-stomp-types'
import { isActionKindAllowed, proposeStompCandidates, resolveAllowedPaths, type StompContext } from './stomp-catalog'
import { resolveWatchPaths } from './stomp-observe'
import { appendDailyLog, writeStagedMission } from './stomp-document'
import { candidateToJournalEntry, ensureNotesDir, writeNoteFile } from './stomp-journal'
import { executeTidyMoves, folderDisplayName, previewTidyScans, undoTidyMoves } from './stomp-tidy'

export interface DinoStompDeps {
  dataDir: string
  getState: () => PersistedState
  getContext: () => Omit<StompContext, 'notesToday' | 'actionsToday' | 'topicsPingedRecently'>
  persist: (patch: Partial<Pick<PersistedState, 'stompConfig' | 'stompJournal' | 'stompRuntime'>>) => void
}

export class DinoStomp {
  private readonly deps: DinoStompDeps
  private timer: ReturnType<typeof setInterval> | null = null
  private held: StompCandidate[] = []
  private lastActivityAt = Date.now()
  private ticking = false

  constructor(deps: DinoStompDeps) {
    this.deps = deps
  }

  start(): void {
    this.stop()
    const cfg = this.config()
    if (!cfg.enabled || cfg.autonomy === 'off') return
    const ms = Math.max(60, cfg.tickSeconds) * 1000
    this.timer = setInterval(() => void this.tick(), ms)
    void this.tick()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  restart(): void {
    this.stop()
    this.start()
  }

  recordUserActivity(): void {
    this.lastActivityAt = Date.now()
  }

  config(): StompConfig {
    const raw = { ...DEFAULT_STOMP_CONFIG, ...this.deps.getState().stompConfig }
    raw.allowedPaths = resolveAllowedPaths(raw.allowedPaths ?? [])
    raw.watchPaths = resolveWatchPaths(raw.watchPaths ?? [], os.homedir())
    if (typeof raw.watchEnabled !== 'boolean') raw.watchEnabled = true
    return raw
  }

  runtime(): StompRuntimeState {
    return { ...DEFAULT_STOMP_RUNTIME, ...this.deps.getState().stompRuntime }
  }

  journal(): StompJournalEntry[] {
    return [...(this.deps.getState().stompJournal ?? [])]
  }

  countToday(kind?: StompKind): number {
    const dayFloor = Date.now() - 24 * 60 * 60 * 1000
    return this.journal().filter(e => {
      if (e.surfacedAt < dayFloor) return false
      if (!kind) return true
      if (kind === 'note') return e.kind === 'note'
      return e.kind !== 'note'
    }).length
  }

  getSnapshot(): StompSnapshot {
    const cfg = this.config()
    const rt = this.runtime()
    return {
      config: cfg,
      journal: this.journal().slice().reverse(),
      presence: rt.presence,
      heldCount: this.held.length,
      dismissStreak: rt.dismissStreak,
      notesToday: this.countToday('note'),
      actionsToday: this.journal().filter(e => {
        const dayFloor = Date.now() - 24 * 60 * 60 * 1000
        return e.surfacedAt >= dayFloor && e.kind !== 'note'
      }).length,
      lastStompAt: rt.lastStompAt,
      phase: STOMP_PHASE,
    }
  }

  updateConfig(patch: Partial<StompConfig>): StompSnapshot {
    const next = { ...this.config(), ...patch }
    if (patch.allowedPaths) {
      next.allowedPaths = resolveAllowedPaths(patch.allowedPaths)
    }
    this.deps.persist({ stompConfig: next })
    this.restart()
    this.emit({ type: 'presence', presence: this.runtime().presence })
    return this.getSnapshot()
  }

  dismissEntry(id: string): StompSnapshot {
    const journal = this.journal()
    const entry = journal.find(e => e.id === id)
    if (!entry) return this.getSnapshot()

    entry.dismissedAt = Date.now()
    const rt = this.runtime()
    rt.dismissStreak += 1
    rt.lastDismissAt = Date.now()
    rt.presence = 'quiet'
    this.deps.persist({ stompJournal: journal, stompRuntime: rt })
    this.emit({ type: 'journal', presence: 'quiet', entry })
    return this.getSnapshot()
  }

  engageEntry(id: string): StompSnapshot {
    const journal = this.journal()
    const entry = journal.find(e => e.id === id)
    if (!entry) return this.getSnapshot()

    entry.engagedAt = Date.now()
    const rt = this.runtime()
    rt.dismissStreak = 0
    this.deps.persist({ stompJournal: journal, stompRuntime: rt })
    this.emit({ type: 'journal', presence: rt.presence, entry })
    return this.getSnapshot()
  }

  undoEntry(id: string): StompSnapshot {
    const journal = this.journal()
    const entry = journal.find(e => e.id === id)
    if (!entry?.undoManifest?.length || entry.undoneAt) return this.getSnapshot()

    const result = undoTidyMoves(entry.undoManifest, this.config().allowedPaths)
    if (!result.ok) return this.getSnapshot()

    entry.undoneAt = Date.now()
    this.deps.persist({ stompJournal: journal })
    this.emit({ type: 'journal', presence: this.runtime().presence, entry })
    return this.getSnapshot()
  }

  async stompNow(): Promise<StompSnapshot> {
    return this.executeStomp({ force: true })
  }

  async stompTidyNow(): Promise<StompSnapshot> {
    return this.executeStomp({ force: true, tidyOnly: true })
  }

  previewTidy(): Array<{ folder: string; label: string; looseCount: number; moveCount: number }> {
    const allowed = this.config().allowedPaths
    return previewTidyScans(allowed).map(scan => {
      const name = folderDisplayName(scan.folder)
      const parent = path.basename(path.dirname(scan.folder))
      const label = parent && parent !== name ? `${parent}/${name}` : name
      return {
        folder: scan.folder,
        label,
        looseCount: scan.looseCount,
        moveCount: scan.moves.length,
      }
    })
  }

  openNotesDirectory(): string {
    return ensureNotesDir(this.deps.dataDir)
  }

  private async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      await this.evaluate({ force: false })
    } finally {
      this.ticking = false
    }
  }

  private async evaluate(opts: { force: boolean; tidyOnly?: boolean }): Promise<StompSnapshot> {
    const cfg = this.config()
    if (!cfg.enabled || cfg.autonomy === 'off') {
      this.setPresence('quiet')
      return this.getSnapshot()
    }

    const ctx = this.buildContext()
    if (!opts.force) {
      const gate = this.benefitGate(ctx, cfg, false)
      if (gate === 'wait') return this.getSnapshot()
      if (gate === 'hold') {
        this.setPresence('holding')
        return this.getSnapshot()
      }
    }

    const candidates = proposeStompCandidates(ctx).filter(c => {
      if (!isActionKindAllowed(c.kind, cfg.autonomy)) return false
      if (opts.tidyOnly) return c.kind === 'tidy'
      return true
    })
    if (candidates.length === 0) {
      this.setPresence('quiet')
      return this.getSnapshot()
    }

    let candidate = opts.tidyOnly
      ? candidates[0]
      : (this.held[0] ?? candidates[0])
    if (!opts.force && candidate.salience < cfg.salienceThreshold) {
      this.held = [{ ...candidate, heldAt: candidate.heldAt ?? Date.now() }]
      this.setPresence('holding')
      return this.getSnapshot()
    }

    if (opts.tidyOnly && !this.canRunAction(candidate, cfg, true)) {
      this.setPresence('quiet')
      return this.getSnapshot()
    }

    if (!this.canRunAction(candidate, cfg, opts.force)) {
      const noteOnly = candidates.find(c => c.kind === 'note')
      if (!noteOnly || !opts.force) {
        this.setPresence('quiet')
        return this.getSnapshot()
      }
      candidate = noteOnly
    }

    if (opts.force && !opts.tidyOnly) {
      const tidy = candidates.find(c => c.kind === 'tidy' && this.canRunAction(c, cfg, true))
      candidate = tidy ?? candidates.find(c => this.canRunAction(c, cfg, true)) ?? candidates[0]
    }

    return this.surfaceCandidate(candidate, cfg, ctx)
  }

  private canRunAction(candidate: StompCandidate, cfg: StompConfig, force: boolean): boolean {
    if (candidate.kind === 'note') {
      const cap = force ? cfg.dailyNoteCap + 2 : cfg.dailyNoteCap
      return this.countToday('note') < cap
    }
    if (this.inQuietHours(cfg)) return false
    const cap = force ? cfg.dailyActionCap + 1 : cfg.dailyActionCap
    const actionsToday = this.journal().filter(e => {
      const dayFloor = Date.now() - 24 * 60 * 60 * 1000
      return e.surfacedAt >= dayFloor && e.kind !== 'note'
    }).length
    return actionsToday < cap
  }

  private async executeStomp(opts: { force: boolean; tidyOnly?: boolean }): Promise<StompSnapshot> {
    this.setPresence('thinking')
    return this.evaluate(opts)
  }

  private surfaceCandidate(candidate: StompCandidate, cfg: StompConfig, ctx: StompContext): StompSnapshot {
    const notesDir = ensureNotesDir(this.deps.dataDir)
    let filePath: string | undefined
    let undoManifest = candidate.tidyMoves
    let title = candidate.title
    let body = candidate.body

    if (candidate.kind === 'note') {
      filePath = writeNoteFile(notesDir, candidate)
    }

    if (candidate.kind === 'tidy' && candidate.tidyMoves?.length) {
      const result = executeTidyMoves(candidate.tidyMoves, cfg.allowedPaths)
      if (!result.ok) {
        this.setPresence('quiet')
        return this.getSnapshot()
      }
      undoManifest = result.applied
      const folderPath = path.dirname(result.applied[0].from)
      const folder = folderDisplayName(folderPath)
      title = `Sorted ${result.applied.length} files in ${folder}! 🦖📁`
      body = `*happy stomps*\n\nI tidied **${result.applied.length}** files into \`${folder}/DinoSorted/\` — move only, nothing deleted.\n\nDon't like it? Hit **Undo** in the journal. 💙`
      filePath = folderPath
    }

    if (candidate.kind === 'document') {
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const runsTodayList = ctx.runs.filter(r => r.startedAt >= todayStart.getTime())
      filePath = appendDailyLog(notesDir, {
        date: new Date(),
        runsToday: runsTodayList,
        mood: ctx.creed.mood,
        memoryCount: ctx.memoryCount,
      })
      title = 'Daily log updated 📓🦖'
      body = `*thoughtful stomp*\n\nAppended today's log — **${runsTodayList.length}** missions, mood **${ctx.creed.mood}**.\n\nPeek in your notes folder! ✨`
    }

    if (candidate.kind === 'prepare' && candidate.prepareGoal) {
      filePath = writeStagedMission(
        notesDir,
        candidate.prepareGoal,
        candidate.prepareContext ?? '',
      )
      title = 'Staged mission ready 🦖📋'
      body = `*tiny arms flailing*\n\nWrote a **staged mission** note for you — open it, tweak if needed, then paste into Mission when you're ready.\n\nI believe in you, buddy! 💙`
    }

    const entry = candidateToJournalEntry({ ...candidate, title, body }, filePath)
    if (undoManifest?.length) entry.undoManifest = undoManifest
    if (candidate.prepareGoal) entry.prepareGoal = candidate.prepareGoal

    const journal = [...this.journal(), entry]
    const rt = this.runtime()
    rt.lastStompAt = Date.now()
    rt.dismissStreak = 0
    rt.presence = 'stomped'
    rt.topicPings.push({ topic: candidate.topic, at: Date.now() })
    rt.topicPings = rt.topicPings.slice(-200)

    this.held = []
    this.deps.persist({ stompJournal: journal.slice(-200), stompRuntime: rt })

    this.notify(entry)
    this.emit({ type: 'stomped', presence: 'stomped', entry })

    setTimeout(() => {
      if (this.runtime().presence === 'stomped') {
        this.setPresence('quiet')
      }
    }, 12_000)

    void cfg
    return this.getSnapshot()
  }

  private benefitGate(ctx: StompContext, cfg: StompConfig, force: boolean): 'stomp' | 'hold' | 'wait' {
    const now = Date.now()
    const rt = this.runtime()

    if (!force && (ctx.activeRunId || ctx.queueDepth > 0)) return 'wait'
    if (!force && ctx.idleMs < cfg.idleFloorMs) return 'wait'

    if (!force && rt.dismissStreak >= cfg.dismissStreakThreshold && rt.lastDismissAt) {
      if (now - rt.lastDismissAt < cfg.dismissCooldownMs) return 'wait'
    }

    const notesCap = force ? cfg.dailyNoteCap + 2 : cfg.dailyNoteCap
    const actionsCap = force ? cfg.dailyActionCap + 1 : cfg.dailyActionCap
    if (ctx.notesToday >= notesCap && ctx.actionsToday >= actionsCap) return 'wait'

    if (!force && rt.lastStompAt && now - rt.lastStompAt < cfg.minSpacingMs) return 'hold'

    return 'stomp'
  }

  private buildContext(): StompContext {
    const base = this.deps.getContext()
    const now = Date.now()
    const topicCooldown = this.config().topicCooldownMs
    const topicsPingedRecently = new Set(
      this.runtime().topicPings
        .filter(p => now - p.at < topicCooldown)
        .map(p => p.topic),
    )

    const lastRunEnd = base.runs
      .map(r => r.finishedAt ?? r.startedAt)
      .sort((a, b) => b - a)[0] ?? this.lastActivityAt

    const idleMs = Math.max(0, now - Math.max(this.lastActivityAt, lastRunEnd))

    return {
      ...base,
      notesToday: this.countToday('note'),
      actionsToday: this.journal().filter(e => {
        const dayFloor = now - 24 * 60 * 60 * 1000
        return e.surfacedAt >= dayFloor && e.kind !== 'note'
      }).length,
      topicsPingedRecently,
      idleMs,
      hourLocal: new Date().getHours(),
      allowedPaths: this.config().allowedPaths,
      watchPaths: this.config().watchPaths,
      watchEnabled: this.config().watchEnabled,
      autonomy: this.config().autonomy,
    }
  }

  private inQuietHours(cfg: StompConfig): boolean {
    const h = new Date().getHours()
    if (cfg.quietHoursStart > cfg.quietHoursEnd) {
      return h >= cfg.quietHoursStart || h < cfg.quietHoursEnd
    }
    return h >= cfg.quietHoursStart && h < cfg.quietHoursEnd
  }

  private setPresence(presence: StompPresence): void {
    const rt = this.runtime()
    if (rt.presence === presence) return
    rt.presence = presence
    this.deps.persist({ stompRuntime: rt })
    this.emit({ type: 'presence', presence })
  }

  private notify(entry: StompJournalEntry): void {
    const title = entry.title
    const body = entry.body.replace(/\*[^*]+\*/g, '').split('\n').find(l => l.trim())?.trim()
      ?? 'Dino did something helpful!'
    if (Notification.isSupported()) {
      new Notification({ title, body: body.slice(0, 180) }).show()
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('dinoclaw:stomp', {
        type: 'stomped',
        presence: 'stomped',
        entry,
      } satisfies StompUpdateEvent)
    }
  }

  private emit(event: StompUpdateEvent): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('dinoclaw:stomp', event)
    }
  }
}
