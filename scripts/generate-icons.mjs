#!/usr/bin/env node
/**
 * Generate Linux/Windows icon PNGs from public/dino.svg for electron-builder.
 * Uses npx @resvg/resvg-js-cli (no extra devDependency).
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const svg = path.join(root, 'public', 'dino.svg')
const iconsDir = path.join(root, 'build', 'icons')

if (!fs.existsSync(svg)) {
  console.error('[icons] Missing public/dino.svg')
  process.exit(1)
}

fs.mkdirSync(iconsDir, { recursive: true })

for (const size of [128, 256, 512]) {
  const out = path.join(iconsDir, `${size}x${size}.png`)
  execSync(
    `npx --yes @resvg/resvg-js-cli --fit-width ${size} "${svg}" "${out}"`,
    { stdio: 'inherit', cwd: root },
  )
}

console.log('[icons] Wrote build/icons/*.png')
