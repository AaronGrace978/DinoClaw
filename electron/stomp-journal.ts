import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { StompCandidate } from './dino-stomp-types'

export function ensureNotesDir(dataDir: string): string {
  const notesDir = path.join(dataDir, 'notes')
  fs.mkdirSync(notesDir, { recursive: true })
  return notesDir
}

export function writeNoteFile(notesDir: string, candidate: StompCandidate): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16)
  const safeTopic = candidate.topic.replace(/[^a-z0-9_-]/gi, '_').slice(0, 40)
  const fileName = `${stamp}-${safeTopic}.md`
  const filePath = path.join(notesDir, fileName)
  const content = [
    `# ${candidate.title}`,
    '',
    `_Dino Stomp · ${new Date().toLocaleString()}_`,
    '',
    candidate.body,
    '',
    '---',
    '*Written with love by Dino Buddy 🦖💙*',
    '',
  ].join('\n')
  fs.writeFileSync(filePath, content, 'utf8')
  return filePath
}

export function candidateToJournalEntry(
  candidate: StompCandidate,
  filePath?: string,
): import('./dino-stomp-types').StompJournalEntry {
  return {
    id: randomUUID(),
    kind: candidate.kind,
    title: candidate.title,
    body: candidate.body,
    topic: candidate.topic,
    salience: candidate.salience,
    surfacedAt: Date.now(),
    filePath,
  }
}
