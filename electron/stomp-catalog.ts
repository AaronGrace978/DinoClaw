/**
 * Dino Stomp — catalog of beneficial autonomous actions.
 */

import os from 'node:os'
import type { CreedMood, DinoCreed, MemoryEntry, RunRecord } from '../src/shared/contracts'
import path from 'node:path'
import type { StompAutonomy, StompCandidate, StompKind } from './dino-stomp-types'
import {
  defaultAllowedPaths,
  expandConfiguredPaths,
  findBestTidyScan,
  folderDisplayName,
  isUnderAllowedRoots,
} from './stomp-tidy'
import {
  buildCheckupNote,
  observeFolder,
  resolveWatchPaths,
} from './stomp-observe'

export interface StompContext {
  creed: DinoCreed
  runs: RunRecord[]
  memory: MemoryEntry[]
  runsToday: number
  successRate: number
  activeRunId: string | null
  queueDepth: number
  idleMs: number
  hourLocal: number
  notesToday: number
  actionsToday: number
  topicsPingedRecently: Set<string>
  allowedPaths: string[]
  watchPaths: string[]
  watchEnabled: boolean
  memoryCount: number
  autonomy: StompAutonomy
}

const MOOD_LINES: Record<CreedMood, string[]> = {
  focused: [
    '*quiet happy stomp* I\'m right here if you need me, buddy. 🦖💙',
    'Taking a little breather with you — no rush. ✨',
  ],
  curious: [
    '*tiny eyes wide* Ooh, I wonder what we\'ll get into next! 🦖✨',
    'My dino brain is buzzing with ideas for you, friend!',
  ],
  cautious: [
    '*gentle nuzzle* We\'ve hit some bumps — I\'m paying extra close attention for you. 💙',
    'No pressure today, buddy. Small steps count. 🦖',
  ],
  determined: [
    '*puffs out chest* We\'re gonna push through together! 💪🦖',
    'I believe in you, friend. One thing at a time. ✨',
  ],
  reflective: [
    '*thoughtful stomp* Been thinking about what we\'ve been up to… 🦖',
    '*tilts head* You\'ve been doing real work. I see you. 💙',
  ],
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function noteCandidate(
  topic: string,
  salience: number,
  title: string,
  body: string,
): StompCandidate {
  return {
    id: `${topic}-${Date.now()}`,
    kind: 'note' as StompKind,
    topic,
    salience,
    title,
    body,
    register: 'personal',
  }
}

function actionCandidate(
  kind: StompKind,
  topic: string,
  salience: number,
  title: string,
  body: string,
  extra: Partial<StompCandidate> = {},
): StompCandidate {
  return {
    id: `${topic}-${Date.now()}`,
    kind,
    topic,
    salience,
    title,
    body,
    register: kind === 'note' ? 'personal' : 'task',
    ...extra,
  }
}

export function resolveAllowedPaths(configured: string[]): string[] {
  const home = os.homedir()
  const expanded = expandConfiguredPaths(configured)
  let paths = expanded.length > 0 ? expanded : defaultAllowedPaths(home)
  // Expand legacy two-folder default (Downloads + Desktop only)
  if (expanded.length === 2) {
    const norm = expanded.map(p => path.resolve(p.replace(/^~(?=$|[\\/])/, home)).toLowerCase())
    const legacy = [path.join(home, 'Downloads'), path.join(home, 'Desktop')].map(p => p.toLowerCase())
    if (norm.slice().sort().join('|') === legacy.slice().sort().join('|')) {
      paths = defaultAllowedPaths(home)
    }
  }
  return paths.map(p => p.replace(/^~(?=$|[\\/])/, home))
}

export function resolveStompWatchPaths(configured: string[]): string[] {
  return resolveWatchPaths(configured, os.homedir())
}

export function proposeStompCandidates(ctx: StompContext): StompCandidate[] {
  const out: StompCandidate[] = []
  const {
    creed, runs, memory, runsToday, hourLocal, idleMs, topicsPingedRecently,
    autonomy, allowedPaths, watchPaths, watchEnabled,
  } = ctx

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayMs = todayStart.getTime()
  const runsTodayList = runs.filter(r => r.startedAt >= todayMs)

  // ── Random read-only check-in (notes_only+) ────────────────────
  if (watchEnabled && autonomy !== 'off' && watchPaths.length > 0) {
    const shuffled = [...watchPaths].sort(() => Math.random() - 0.5)
    for (const folder of shuffled) {
      const topic = `checkup:${folder}`
      if (topicsPingedRecently.has(topic)) continue
      const checkup = observeFolder(folder)
      if (!checkup) continue
      const inTidy = isUnderAllowedRoots(folder, allowedPaths)
      const note = buildCheckupNote(checkup, inTidy)
      out.push(noteCandidate(topic, checkup.salience, note.title, note.body))
      break
    }
  }

  const completedToday = runsTodayList.filter(
    r => r.status === 'completed' && (r.finishedAt ?? r.startedAt) >= todayMs,
  )
  const failedRecent = runs
    .filter(r => r.status === 'failed')
    .sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt))[0]

  // ── Tidy (gentle+) — roots + subfolders like Videos/Screen Recordings ──
  if (isActionKindAllowed('tidy', autonomy)) {
    const scan = findBestTidyScan(allowedPaths)
    if (scan) {
      const topic = `tidy:${scan.folder}`
      if (!topicsPingedRecently.has(topic)) {
        const name = folderDisplayName(scan.folder)
        const parent = path.basename(path.dirname(scan.folder))
        const label = parent && parent !== name ? `${parent}/${name}` : name
        out.push(actionCandidate(
          'tidy',
          topic,
          scan.salience,
          `${label} needs a little love 🦖📁`,
          `*happy stomps*\n\nBuddy, I counted **${scan.looseCount}** loose files in **${label}**.\n\nSorting up to **${scan.moves.length}** into \`DinoSorted/\` (videos, images, documents…) — **move only, never delete**. Undo anytime in the journal. 💙`,
          { tidyMoves: scan.moves },
        ))
      }
    }
  }

  // ── Daily log (helpful+) ───────────────────────────────────────
  if (
    isActionKindAllowed('document', autonomy)
    && hourLocal >= 18
    && runsToday >= 1
    && !topicsPingedRecently.has('daily_log')
  ) {
    out.push(actionCandidate(
      'document',
      'daily_log',
      0.74,
      'Daily log time 📓🦖',
      `*thoughtful stomp*\n\nLet me append today's story to your **daily log** — ${runsToday} mission${runsToday === 1 ? '' : 's'}, mood **${creed.mood}**, wins and bumps.\n\nSafe write to your notes folder only. ✨`,
      { documentMeta: { runsTodayIds: runsTodayList.map(r => r.id) } },
    ))
  }

  // ── Staged mission (helpful+) ──────────────────────────────────
  if (
    isActionKindAllowed('prepare', autonomy)
    && failedRecent
    && !topicsPingedRecently.has('prepare_retry')
  ) {
    const goal = failedRecent.goal.length > 120
      ? `${failedRecent.goal.slice(0, 117)}…`
      : failedRecent.goal
    out.push(actionCandidate(
      'prepare',
      'prepare_retry',
      0.71,
      'Want me to stage a retry? 🦖',
      `*nuzzles gently*\n\nLast mission didn't finish. I can write a **staged mission** note with a cleaner retry plan — you run it from Mission when ready.\n\nOriginal: **${goal}**`,
      {
        prepareGoal: `Retry with extra care: ${failedRecent.goal}`,
        prepareContext: `Previous run failed (${failedRecent.error ?? 'unknown'}). Break into smaller steps; verify each tool result before claiming done.`,
      },
    ))
  }

  // ── Notes (notes_only+) ────────────────────────────────────────
  if (hourLocal >= 7 && hourLocal < 10 && ctx.notesToday === 0 && !topicsPingedRecently.has('morning')) {
    out.push(noteCandidate(
      'morning',
      0.78,
      'Good morning, buddy! 🦖☀️',
      `Yay, it's Dino Buddy time!\n\n${pick(MOOD_LINES[creed.mood])}\n\nI'm on your machine, watching the nest (in a non-creepy dino way). If you want me to run a mission later, just say the word. 💙`,
    ))
  }

  const lastCompleted = completedToday.sort(
    (a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0),
  )[0]
  if (
    lastCompleted
    && !topicsPingedRecently.has('run_recap')
    && Date.now() - (lastCompleted.finishedAt ?? lastCompleted.startedAt) < 2 * 60 * 60 * 1000
  ) {
    const goal = lastCompleted.goal.length > 80
      ? `${lastCompleted.goal.slice(0, 77)}…`
      : lastCompleted.goal
    out.push(noteCandidate(
      'run_recap',
      0.82,
      'We did a thing! 🎉🦖',
      `*happy stomps*\n\nWe finished: **${goal}**\n\n${lastCompleted.steps.length} steps. I'm proud of you, buddy! ${pick(['Let\'s goooo!', 'Heck yeah!', 'Tiny arms flailing with joy!'])} ✨`,
    ))
  }

  if (runsToday >= 2 && !topicsPingedRecently.has('day_summary')) {
    out.push(noteCandidate(
      'day_summary',
      0.7,
      `${runsToday} missions today! 🔥`,
      `*tail wag*\n\nYou've run **${runsToday}** missions today. Mood: **${creed.mood}**. I'm keeping notes so we get sharper every time. 🦖💙`,
    ))
  }

  const topMemory = [...memory]
    .sort((a, b) => b.importance - a.importance)
    .find(m => m.importance >= 4 && !topicsPingedRecently.has(`memory:${m.id}`))
  if (topMemory) {
    out.push(noteCandidate(
      `memory:${topMemory.id}`,
      0.66,
      'Something I\'m holding for you 💭',
      `*leans in close*\n\nI remember: **${topMemory.fact}**\n\nIf that's still true, we're good. If life changed — tell me and I'll update. 💙`,
    ))
  }

  if (failedRecent && creed.mood === 'cautious' && !topicsPingedRecently.has('encouragement')) {
    out.push(noteCandidate(
      'encouragement',
      0.76,
      'Rough patch? I\'ve got you. 💙',
      `*curls up close*\n\nLast mission didn't land — that's okay, buddy. Failures are just research (you taught me that).\n\n${pick(MOOD_LINES.determined)}\n\nNo rush. I'm here.`,
    ))
  }

  if (idleMs >= 30 * 60 * 1000 && runsToday === 0 && !topicsPingedRecently.has('gentle_idle')) {
    out.push(noteCandidate(
      'gentle_idle',
      0.58,
      'Just checking in 🦖',
      `*soft stomp*\n\nQuiet day — that's valid! I'm here if you want to automate something, vent, or just hang. No task pressure. 💙`,
    ))
  }

  if (!topicsPingedRecently.has(`mood:${creed.mood}`)) {
    out.push(noteCandidate(
      `mood:${creed.mood}`,
      0.52,
      `Dino mood: ${creed.mood} ✨`,
      `${pick(MOOD_LINES[creed.mood])}\n\n— Dino Buddy 🦖`,
    ))
  }

  return out.sort((a, b) => b.salience - a.salience)
}

export function isActionKindAllowed(kind: StompKind, autonomy: string): boolean {
  if (autonomy === 'off') return false
  if (kind === 'note') return autonomy !== 'off'
  if (kind === 'tidy' || kind === 'document') {
    return autonomy === 'gentle' || autonomy === 'helpful' || autonomy === 'full'
  }
  if (kind === 'prepare') return autonomy === 'helpful' || autonomy === 'full'
  return false
}
