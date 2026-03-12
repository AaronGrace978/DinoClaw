import fs from 'node:fs'
import path from 'node:path'
import type {
  DinoCreed,
  ExecutionPolicy,
  MemoryEntry,
  ModelSettings,
  RunRecord,
  Skill,
  AuditEntry,
} from '../src/shared/contracts'
import { defaultCreed } from './creed'

export interface PersistedState {
  creed: DinoCreed
  model: ModelSettings
  policy: ExecutionPolicy
  memory: MemoryEntry[]
  runs: RunRecord[]
  skills: Skill[]
  auditLog: AuditEntry[]
}

const DEFAULT_STATE: PersistedState = {
  creed: defaultCreed,
  model: {
    provider: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'llama3.2',
    apiKey: '',
    temperature: 0.2,
    maxTokens: 4096,
  },
  policy: {
    mode: 'review-risky',
    maxSteps: 12,
    allowedCommands: [],
    blockedPaths: [],
    requireApprovalAboveRisk: 'risky',
  },
  memory: [],
  runs: [],
  skills: [],
  auditLog: [],
}

export function createStorage(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true })

  const statePath = path.join(dataDir, 'state.json')
  const backupDir = path.join(dataDir, 'backups')

  const load = (): PersistedState => {
    if (!fs.existsSync(statePath)) return structuredClone(DEFAULT_STATE)

    try {
      const raw = fs.readFileSync(statePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<PersistedState>
      return migrate({
        creed:    parsed.creed    ?? structuredClone(DEFAULT_STATE.creed),
        model:    parsed.model    ?? structuredClone(DEFAULT_STATE.model),
        policy:   parsed.policy   ?? structuredClone(DEFAULT_STATE.policy),
        memory:   parsed.memory   ?? [],
        runs:     parsed.runs     ?? [],
        skills:   parsed.skills   ?? [],
        auditLog: parsed.auditLog ?? [],
      })
    } catch {
      return structuredClone(DEFAULT_STATE)
    }
  }

  const save = (state: PersistedState): void => {
    const json = JSON.stringify(state, null, 2)
    const tmp = statePath + '.tmp'
    fs.writeFileSync(tmp, json, 'utf8')
    fs.renameSync(tmp, statePath)
  }

  const backup = (): string => {
    fs.mkdirSync(backupDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dest = path.join(backupDir, `state-${stamp}.json`)
    if (fs.existsSync(statePath)) {
      fs.copyFileSync(statePath, dest)
    }
    return dest
  }

  return { load, save, backup, statePath }
}

function migrate(state: PersistedState): PersistedState {
  for (const mem of state.memory) {
    if (!mem.category) mem.category = 'fact'
    if (!mem.importance) mem.importance = 3
    if (!mem.tags) mem.tags = []
    if (!mem.accessCount) mem.accessCount = 0
    if (!mem.lastAccessedAt) mem.lastAccessedAt = mem.createdAt
  }

  const creed = state.creed
  if (!creed.motto) creed.motto = 'The pain was not wasted. The pain was research.'
  if (!creed.traits) creed.traits = structuredClone(DEFAULT_STATE.creed.traits)
  if (!creed.mood) creed.mood = 'focused'

  const model = state.model
  if (!model.maxTokens) model.maxTokens = 4096

  const policy = state.policy
  if (!policy.allowedCommands) policy.allowedCommands = []
  if (!policy.blockedPaths) policy.blockedPaths = []
  if (!policy.requireApprovalAboveRisk) policy.requireApprovalAboveRisk = 'risky'

  for (const run of state.runs) {
    if (!run.toolsUsed) run.toolsUsed = []
  }

  return state
}
