export type StompAutonomy = 'off' | 'notes_only' | 'gentle' | 'helpful' | 'full'

export type StompKind = 'note' | 'tidy' | 'document' | 'prepare'

export type StompPresence = 'quiet' | 'thinking' | 'holding' | 'stomped'

export interface StompTidyMove {
  from: string
  to: string
}

export interface StompConfig {
  enabled: boolean
  autonomy: StompAutonomy
  /** Heartbeat period in seconds. */
  tickSeconds: number
  dailyNoteCap: number
  dailyActionCap: number
  minSpacingMs: number
  idleFloorMs: number
  quietHoursStart: number
  quietHoursEnd: number
  dismissStreakThreshold: number
  dismissCooldownMs: number
  salienceThreshold: number
  topicCooldownMs: number
  /** Absolute paths Dino may tidy (gentle+). */
  allowedPaths: string[]
  /** Read-only check-in paths (notes_only+). Empty = Documents, Pictures, Videos, Music. */
  watchPaths: string[]
  /** Random folder check-ins without moving files. */
  watchEnabled: boolean
}

export interface StompJournalEntry {
  id: string
  kind: StompKind
  title: string
  body: string
  topic: string
  salience: number
  surfacedAt: number
  dismissedAt?: number
  engagedAt?: number
  filePath?: string
  undoManifest?: StompTidyMove[]
  undoneAt?: number
  prepareGoal?: string
}

export interface StompCandidate {
  id: string
  kind: StompKind
  title: string
  body: string
  topic: string
  salience: number
  register: 'personal' | 'play' | 'task'
  heldAt?: number
  tidyMoves?: StompTidyMove[]
  documentMeta?: { runsTodayIds: string[] }
  prepareGoal?: string
  prepareContext?: string
}

export interface StompRuntimeState {
  presence: StompPresence
  dismissStreak: number
  lastStompAt?: number
  lastDismissAt?: number
  topicPings: Array<{ topic: string; at: number }>
}

export interface StompSnapshot {
  config: StompConfig
  journal: StompJournalEntry[]
  presence: StompPresence
  heldCount: number
  dismissStreak: number
  notesToday: number
  actionsToday: number
  lastStompAt?: number
  phase: string
}

export const DEFAULT_STOMP_CONFIG: StompConfig = {
  enabled: true,
  autonomy: 'notes_only',
  tickSeconds: 300,
  dailyNoteCap: 8,
  dailyActionCap: 3,
  minSpacingMs: 90 * 60 * 1000,
  idleFloorMs: 5 * 60 * 1000,
  quietHoursStart: 22,
  quietHoursEnd: 7,
  dismissStreakThreshold: 2,
  dismissCooldownMs: 6 * 60 * 60 * 1000,
  salienceThreshold: 0.55,
  topicCooldownMs: 12 * 60 * 60 * 1000,
  allowedPaths: [],
  watchPaths: [],
  watchEnabled: true,
}

export const STOMP_PHASE = 'v0.4'

export const DEFAULT_STOMP_RUNTIME: StompRuntimeState = {
  presence: 'quiet',
  dismissStreak: 0,
  topicPings: [],
}

export interface StompUpdateEvent {
  type: 'stomped' | 'presence' | 'journal'
  entry?: StompJournalEntry
  presence: StompPresence
}
