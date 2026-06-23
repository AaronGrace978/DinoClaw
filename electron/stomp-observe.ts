import fs from 'node:fs'
import path from 'node:path'
import { expandConfiguredPaths } from './stomp-tidy'

const MAX_LIST = 400

export interface FolderCheckup {
  folder: string
  displayName: string
  exists: boolean
  looseFiles: number
  subfolders: number
  sampleNames: string[]
  salience: number
}

export function defaultWatchPaths(homeDir: string): string[] {
  return [
    path.join(homeDir, 'Documents'),
    path.join(homeDir, 'Pictures'),
    path.join(homeDir, 'Videos'),
    path.join(homeDir, 'Videos', 'Screen Recordings'),
    path.join(homeDir, 'Music'),
    path.join(homeDir, 'Downloads'),
    path.join(homeDir, 'Desktop'),
  ]
}

export function resolveWatchPaths(configured: string[], homeDir: string): string[] {
  const expanded = expandConfiguredPaths(configured)
  const paths = expanded.length > 0 ? expanded : defaultWatchPaths(homeDir)
  return paths
    .map(p => p.replace(/^~(?=$|[\\/])/, homeDir))
    .filter(p => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isDirectory()
      } catch {
        return false
      }
    })
}

export function observeFolder(folder: string): FolderCheckup | null {
  const resolved = path.resolve(folder)
  const displayName = path.basename(resolved) || resolved

  if (!fs.existsSync(resolved)) {
    return null
  }

  let stat: fs.Stats
  try {
    stat = fs.statSync(resolved)
  } catch {
    return null
  }
  if (!stat.isDirectory()) return null

  let looseFiles = 0
  let subfolders = 0
  const sampleNames: string[] = []

  try {
    for (const name of fs.readdirSync(resolved)) {
      if (name === 'DinoSorted' || name.startsWith('.')) continue
      const full = path.join(resolved, name)
      try {
        const s = fs.statSync(full)
        if (s.isFile()) {
          looseFiles += 1
          if (sampleNames.length < 5) sampleNames.push(name)
        } else if (s.isDirectory()) {
          subfolders += 1
        }
      } catch {
        continue
      }
      if (looseFiles + subfolders > MAX_LIST) break
    }
  } catch {
    return null
  }

  let salience = 0.56
  if (looseFiles >= 40) salience = 0.8
  else if (looseFiles >= 20) salience = 0.72
  else if (looseFiles >= 8) salience = 0.64
  else if (looseFiles === 0 && subfolders > 0) salience = 0.55
  else salience = 0.58

  return {
    folder: resolved,
    displayName,
    exists: true,
    looseFiles,
    subfolders,
    sampleNames,
    salience,
  }
}

export function pickRandomWatchFolder(paths: string[]): string | null {
  if (paths.length === 0) return null
  return paths[Math.floor(Math.random() * paths.length)]
}

export function buildCheckupNote(checkup: FolderCheckup, inTidyWhitelist: boolean): { title: string; body: string } {
  const { displayName, looseFiles, subfolders, sampleNames } = checkup

  if (looseFiles >= 20) {
    const samples = sampleNames.length > 0
      ? `\n\nSpotted names like: ${sampleNames.map(n => `\`${n}\``).join(', ')}`
      : ''
    const tidyHint = inTidyWhitelist
      ? 'I can tidy here when Gentle+ is on — move only, never delete.'
      : 'Add this folder under **Tidy folders** in Settings if you want me to sort it later.'
    return {
      title: `Checked ${displayName} — bit cluttered 📁🦖`,
      body: `*peeks around with tiny dino eyes*\n\nI did a **read-only check-in** on **${displayName}** — **${looseFiles}** loose files at the top level, **${subfolders}** folders.${samples}\n\nI didn't change anything. ${tidyHint}\n\nJust looking out for you, buddy. 💙`,
    }
  }

  if (looseFiles >= 8) {
    return {
      title: `${displayName} check-in 👀🦖`,
      body: `*soft stomp*\n\nPeeked at **${displayName}** — **${looseFiles}** files loose, **${subfolders}** subfolders. Not urgent, but I'm keeping an eye on it for you.\n\nRead-only. No files touched. ✨`,
    }
  }

  return {
    title: `${displayName} looks okay ✨🦖`,
    body: `*happy little stomp*\n\nRandom check-in on **${displayName}**: **${looseFiles}** loose files, **${subfolders}** folders. Looks calm from here.\n\nI'm not watching everything on your PC — just the spots you let me peek at. 💙`,
  }
}
