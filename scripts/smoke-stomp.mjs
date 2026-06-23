/**
 * Dino Stomp smoke test — run: node scripts/smoke-stomp.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dinoclaw-stomp-smoke-'))

function ok(label) {
  console.log(`  ✓ ${label}`)
}
function fail(label, err) {
  console.error(`  ✗ ${label}:`, err)
  process.exitCode = 1
}

console.log('\n🦖 Dino Stomp smoke test\n')
console.log(`Temp dir: ${tmp}\n`)

// Dynamic import compiled modules via tsx on source - use node with tsx
const { proposeStompCandidates, isActionKindAllowed } = await import('../electron/stomp-catalog.ts')
const { scanFolderForTidy, findBestTidyScan, executeTidyMoves, undoTidyMoves } = await import('../electron/stomp-tidy.ts')
const { appendDailyLog, writeStagedMission } = await import('../electron/stomp-document.ts')
const { writeNoteFile, ensureNotesDir, candidateToJournalEntry } = await import('../electron/stomp-journal.ts')
const { DEFAULT_STOMP_CONFIG, STOMP_PHASE } = await import('../electron/dino-stomp-types.ts')

try {
  ok(`STOMP_PHASE = ${STOMP_PHASE}`)
  ok(`DEFAULT_STOMP_CONFIG.autonomy = ${DEFAULT_STOMP_CONFIG.autonomy}`)

  // Autonomy gates
  if (!isActionKindAllowed('note', 'notes_only')) throw new Error('notes_only should allow note')
  if (isActionKindAllowed('tidy', 'notes_only')) throw new Error('notes_only should block tidy')
  if (!isActionKindAllowed('tidy', 'gentle')) throw new Error('gentle should allow tidy')
  if (!isActionKindAllowed('document', 'helpful')) throw new Error('helpful should allow document')
  if (!isActionKindAllowed('prepare', 'helpful')) throw new Error('helpful should allow prepare')
  ok('autonomy gates')

  // Tidy scan + execute + undo
  const tidyRoot = path.join(tmp, 'Downloads')
  fs.mkdirSync(tidyRoot, { recursive: true })
  for (let i = 0; i < 22; i++) {
    fs.writeFileSync(path.join(tidyRoot, `file-${i}.png`), 'x')
  }
  const allowed = [tidyRoot]
  const scan = scanFolderForTidy(tidyRoot, allowed)
  if (!scan || scan.looseCount < 20) throw new Error(`expected scan, got ${scan?.looseCount}`)
  ok(`tidy scan: ${scan.looseCount} loose files, ${scan.moves.length} moves planned`)

  const exec = executeTidyMoves(scan.moves.slice(0, 5), allowed)
  if (!exec.ok || exec.applied.length !== 5) throw new Error('execute failed')
  ok(`tidy execute: ${exec.applied.length} files moved`)

  const undo = undoTidyMoves(exec.applied, allowed)
  if (!undo.ok) throw new Error(`undo failed: ${undo.error}`)
  ok('tidy undo')

  const subTidy = path.join(tmp, 'Videos', 'Screen Recordings')
  fs.mkdirSync(subTidy, { recursive: true })
  for (let i = 0; i < 10; i++) {
    fs.writeFileSync(path.join(subTidy, `clip-${i}.mp4`), 'x')
  }
  const videoRoot = path.join(tmp, 'Videos')
  const subScan = findBestTidyScan([videoRoot])
  if (!subScan || subScan.folder !== subTidy || subScan.looseCount < 8) {
    throw new Error(`expected subfolder scan, got ${subScan?.folder} / ${subScan?.looseCount}`)
  }
  ok(`tidy subfolder scan: Screen Recordings, ${subScan.looseCount} files`)

  // Note + document
  const notesDir = ensureNotesDir(path.join(tmp, 'data'))
  const notePath = writeNoteFile(notesDir, {
    id: 'smoke',
    kind: 'note',
    topic: 'smoke',
    salience: 1,
    title: 'Smoke test',
    body: '*happy stomp*',
    register: 'personal',
  })
  if (!fs.existsSync(notePath)) throw new Error('note file missing')
  ok('note write')

  const logPath = appendDailyLog(notesDir, {
    date: new Date(),
    runsToday: [{ id: '1', goal: 'smoke', status: 'completed', startedAt: Date.now(), steps: [], toolsUsed: [] }],
    mood: 'focused',
    memoryCount: 3,
  })
  if (!fs.existsSync(logPath)) throw new Error('daily log missing')
  ok('daily log append')

  const staged = writeStagedMission(notesDir, 'Retry smoke test', 'context')
  if (!fs.existsSync(staged)) throw new Error('staged mission missing')
  ok('staged mission')

  // Catalog proposals
  const ctx = {
    creed: { mood: 'focused', traits: [] },
    runs: [{ id: '1', goal: 'test', status: 'completed', startedAt: Date.now(), finishedAt: Date.now(), steps: [], toolsUsed: [] }],
    memory: [{ id: 'm1', fact: 'likes tests', category: 'preference', importance: 5, tags: [], createdAt: Date.now(), accessCount: 0, lastAccessedAt: Date.now() }],
    runsToday: 1,
    successRate: 1,
    activeRunId: null,
    queueDepth: 0,
    idleMs: 60 * 60 * 1000,
    hourLocal: 8,
    notesToday: 0,
    actionsToday: 0,
    topicsPingedRecently: new Set(),
    allowedPaths: allowed,
    watchPaths: [],
    watchEnabled: false,
    memoryCount: 1,
    autonomy: 'helpful',
  }
  const candidates = proposeStompCandidates(ctx)
  if (candidates.length === 0) throw new Error('expected candidates')
  ok(`catalog: ${candidates.length} candidates (top: ${candidates[0].kind} / ${candidates[0].topic})`)

  const journal = candidateToJournalEntry(candidates[0], notePath)
  if (!journal.id || !journal.title) throw new Error('journal entry invalid')
  ok('journal entry')

  // Dist check
  const distMain = path.join(root, 'dist-electron', 'main.js')
  const distPreload = path.join(root, 'dist-electron', 'preload.mjs')
  if (!fs.existsSync(distMain)) throw new Error('dist-electron/main.js missing — run npm run build')
  if (!fs.existsSync(distPreload)) throw new Error('preload missing')
  const mainSrc = fs.readFileSync(distMain, 'utf8')
  if (!mainSrc.includes('dinoclaw:stompNow') && !mainSrc.includes('stompNow')) {
    // bundled names may differ — check undo handler
    if (!mainSrc.includes('undoStomp') && !mainSrc.includes('undoStomp')) throw new Error('stomp IPC not in bundle')
  }
  ok('electron bundle contains stomp handlers')

  console.log('\n✅ Smoke test passed\n')
} catch (e) {
  fail('smoke', e instanceof Error ? e.message : e)
  console.log('')
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
}

process.exit(process.exitCode ?? 0)
