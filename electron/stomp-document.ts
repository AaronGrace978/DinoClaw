import fs from 'node:fs'
import path from 'node:path'
import type { CreedMood, RunRecord } from '../src/shared/contracts'

export function appendDailyLog(
  notesDir: string,
  input: {
    date: Date
    runsToday: RunRecord[]
    mood: CreedMood
    memoryCount: number
  },
): string {
  const stamp = input.date.toISOString().slice(0, 10)
  const filePath = path.join(notesDir, `daily-log-${stamp}.md`)
  const completed = input.runsToday.filter(r => r.status === 'completed')
  const failed = input.runsToday.filter(r => r.status === 'failed')

  const lines = [
    `# Dino Daily Log — ${stamp}`,
    '',
    `_Written with love by Dino Buddy 🦖_`,
    '',
    `**Mood:** ${input.mood}`,
    `**Missions:** ${input.runsToday.length} total · ${completed.length} completed · ${failed.length} failed`,
    `**Memories stored:** ${input.memoryCount}`,
    '',
  ]

  if (completed.length > 0) {
    lines.push('## Wins', '')
    for (const run of completed.slice(0, 8)) {
      const goal = run.goal.length > 100 ? `${run.goal.slice(0, 97)}…` : run.goal
      lines.push(`- ✅ ${goal}`)
    }
    lines.push('')
  }

  if (failed.length > 0) {
    lines.push('## Bumps', '')
    for (const run of failed.slice(0, 4)) {
      lines.push(`- ⚠️ ${run.goal.slice(0, 80)}`)
    }
    lines.push('')
  }

  lines.push(
    '## Dino says',
    '',
    '*quiet happy stomp* Proud of you for showing up today, buddy. Tomorrow we get sharper. 💙🦖',
    '',
  )

  const block = lines.join('\n')
  if (fs.existsSync(filePath)) {
    fs.appendFileSync(filePath, `\n---\n\n${block}`, 'utf8')
  } else {
    fs.writeFileSync(filePath, block, 'utf8')
  }

  return filePath
}

export function writeStagedMission(
  notesDir: string,
  goal: string,
  context: string,
): string {
  const id = Date.now()
  const filePath = path.join(notesDir, `staged-mission-${id}.md`)
  const content = [
    '# Staged Mission (Dino Prepare)',
    '',
    '_Dino thought this might help — run it from Mission when you\'re ready._',
    '',
    '## Goal',
    goal,
    '',
    '## Context',
    context,
    '',
    '---',
    '*Approve by copying the goal into Mission, or dismiss in Stomp journal.* 🦖',
    '',
  ].join('\n')
  fs.writeFileSync(filePath, content, 'utf8')
  return filePath
}
