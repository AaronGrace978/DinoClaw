import fs from 'node:fs'
import path from 'node:path'
import type { StompTidyMove } from './dino-stomp-types'

const MAX_SCAN_FILES = 600
const MAX_MOVES_PER_STOMP = 80
const LOOSE_FILE_THRESHOLD = 20
const RECORDING_FOLDER_THRESHOLD = 8

const CATEGORY_RULES: Array<{ dir: string; exts: string[] }> = [
  { dir: 'images', exts: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'] },
  { dir: 'documents', exts: ['.pdf', '.doc', '.docx', '.txt', '.md', '.rtf', '.xlsx', '.xls', '.pptx', '.csv'] },
  { dir: 'archives', exts: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'] },
  { dir: 'installers', exts: ['.exe', '.msi', '.dmg', '.pkg', '.deb', '.appimage'] },
  { dir: 'videos', exts: ['.mp4', '.mkv', '.mov', '.avi', '.webm'] },
  { dir: 'audio', exts: ['.mp3', '.wav', '.flac', '.m4a', '.ogg'] },
]

export interface TidyScanResult {
  folder: string
  looseCount: number
  salience: number
  moves: StompTidyMove[]
}

const SKIP_SUBFOLDER_NAMES = new Set([
  'DinoSorted',
  'My Music',
  'My Pictures',
  'My Videos',
  'My Games',
])

function canReadDirectory(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.R_OK)
    fs.readdirSync(dir)
    return true
  } catch {
    return false
  }
}

function isInsideAllowedRoot(target: string, allowedRoots: string[]): boolean {
  const resolved = path.resolve(target)
  return allowedRoots.some(root => {
    const r = path.resolve(root)
    return resolved === r || resolved.startsWith(r + path.sep)
  })
}

function looseThresholdForFolder(folder: string): number {
  const base = path.basename(folder).toLowerCase()
  if (base.includes('screen') && base.includes('recording')) return RECORDING_FOLDER_THRESHOLD
  if (base.includes('recording') || base.includes('capture') || base.includes('screenshot')) return 10
  return LOOSE_FILE_THRESHOLD
}

function categoryForFile(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase()
  for (const rule of CATEGORY_RULES) {
    if (rule.exts.includes(ext)) return rule.dir
  }
  return 'other'
}

export function scanFolderForTidy(folder: string, allowedRoots: string[]): TidyScanResult | null {
  const resolved = path.resolve(folder)
  if (!isInsideAllowedRoot(resolved, allowedRoots)) return null
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return null
  if (!canReadDirectory(resolved)) return null

  const loose: string[] = []
  let scanned = 0
  let entries: string[]
  try {
    entries = fs.readdirSync(resolved)
  } catch {
    return null
  }
  for (const name of entries) {
    if (name === 'DinoSorted') continue
    const full = path.join(resolved, name)
    try {
      const stat = fs.statSync(full)
      if (!stat.isFile()) continue
      scanned += 1
      if (scanned > MAX_SCAN_FILES) break
      loose.push(name)
    } catch {
      continue
    }
  }

  if (loose.length < looseThresholdForFolder(resolved)) return null

  const moves: StompTidyMove[] = []
  const sortedRoot = path.join(resolved, 'DinoSorted')

  for (const name of loose.slice(0, MAX_MOVES_PER_STOMP)) {
    const from = path.join(resolved, name)
    const cat = categoryForFile(name)
    const destDir = path.join(sortedRoot, cat)
    const to = path.join(destDir, name)
    if (from === to) continue
    moves.push({ from, to })
  }

  if (moves.length === 0) return null

  const salience = Math.min(0.92, 0.62 + loose.length / 200)

  return {
    folder: resolved,
    looseCount: loose.length,
    salience,
    moves,
  }
}

export function executeTidyMoves(moves: StompTidyMove[], allowedRoots: string[]): { ok: boolean; applied: StompTidyMove[]; error?: string } {
  const applied: StompTidyMove[] = []

  for (const move of moves) {
    if (!isInsideAllowedRoot(move.from, allowedRoots) || !isInsideAllowedRoot(path.dirname(move.to), allowedRoots)) {
      return { ok: false, applied, error: `Path outside whitelist: ${move.from}` }
    }
    if (!fs.existsSync(move.from)) continue

    fs.mkdirSync(path.dirname(move.to), { recursive: true })
    if (fs.existsSync(move.to)) {
      const parsed = path.parse(move.to)
      const alt = path.join(parsed.dir, `${parsed.name}-${Date.now()}${parsed.ext}`)
      fs.renameSync(move.from, alt)
      applied.push({ from: move.from, to: alt })
    } else {
      fs.renameSync(move.from, move.to)
      applied.push(move)
    }
  }

  return { ok: true, applied }
}

export function undoTidyMoves(moves: StompTidyMove[], allowedRoots: string[]): { ok: boolean; error?: string } {
  for (const move of [...moves].reverse()) {
    if (!isInsideAllowedRoot(move.from, allowedRoots) && !isInsideAllowedRoot(move.to, allowedRoots)) {
      return { ok: false, error: 'Undo path outside whitelist' }
    }
    if (!fs.existsSync(move.to)) continue
    fs.mkdirSync(path.dirname(move.from), { recursive: true })
    if (fs.existsSync(move.from)) {
      return { ok: false, error: `Cannot undo — file exists at ${move.from}` }
    }
    fs.renameSync(move.to, move.from)
  }
  return { ok: true }
}

export function expandConfiguredPaths(entries: string[]): string[] {
  const out: string[] = []
  for (const entry of entries) {
    if (!entry?.trim()) continue
    for (const line of entry.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const parts = trimmed.split(/\s+(?=[A-Za-z]:[\\/])/)
      for (const part of parts) {
        const t = part.trim()
        if (t) out.push(t)
      }
    }
  }
  return out
}

export function defaultAllowedPaths(homeDir: string): string[] {
  return [
    path.join(homeDir, 'Downloads'),
    path.join(homeDir, 'Desktop'),
    path.join(homeDir, 'Documents'),
    path.join(homeDir, 'Videos'),
  ]
}

/** Roots plus one level of subfolders (e.g. Videos/Screen Recordings). */
export function listTidyScanTargets(allowedRoots: string[]): string[] {
  const targets: string[] = []
  for (const root of allowedRoots) {
    const resolved = path.resolve(root)
    if (!canReadDirectory(resolved)) continue
    targets.push(resolved)
    try {
      for (const name of fs.readdirSync(resolved)) {
        if (SKIP_SUBFOLDER_NAMES.has(name) || name.startsWith('.')) continue
        const sub = path.join(resolved, name)
        try {
          if (fs.statSync(sub).isDirectory() && canReadDirectory(sub)) targets.push(sub)
        } catch {
          continue
        }
      }
    } catch {
      continue
    }
  }
  return targets
}

export function previewTidyScans(allowedRoots: string[]): TidyScanResult[] {
  return listTidyScanTargets(allowedRoots)
    .map(folder => scanFolderForTidy(folder, allowedRoots))
    .filter((scan): scan is TidyScanResult => scan !== null)
    .sort((a, b) => b.looseCount - a.looseCount)
}

export function findBestTidyScan(allowedRoots: string[]): TidyScanResult | null {
  let best: TidyScanResult | null = null
  for (const folder of listTidyScanTargets(allowedRoots)) {
    const scan = scanFolderForTidy(folder, allowedRoots)
    if (!scan) continue
    if (!best || scan.looseCount > best.looseCount) best = scan
  }
  return best
}

export function isUnderAllowedRoots(folder: string, allowedRoots: string[]): boolean {
  return isInsideAllowedRoot(folder, allowedRoots)
}

export function folderDisplayName(folder: string): string {
  return path.basename(folder) || folder
}
