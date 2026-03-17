import type { RunStep, RunRecord } from '../src/shared/contracts'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

export interface PluginHooks {
  onGoalStart?(goal: string, context?: string): Promise<{ promptExtra?: string }>
  onStepComplete?(step: RunStep): Promise<void>
  onRunEnd?(run: RunRecord): Promise<void>
  onIdle?(): Promise<void>
  enrichSystemPrompt?(basePrompt: string): Promise<string>
  getStatus?(): Record<string, unknown>
  destroy?(): void
}

const SEARCH_PATHS = [
  '../SoulFrame/dist/index.js',
  '../../SoulFrame/dist/index.js',
  '../../../SoulFrame/dist/index.js',
]

const require = createRequire(import.meta.url)
const moduleDir = path.dirname(fileURLToPath(import.meta.url))

let loadedPlugin: PluginHooks | null = null
let pluginLoaded = false

export function getPlugin(): PluginHooks | null {
  if (pluginLoaded) return loadedPlugin
  pluginLoaded = true

  for (const relative of SEARCH_PATHS) {
    const absolute = path.resolve(moduleDir, relative)
    const plugin = loadPlugin(absolute)
    if (plugin) {
      loadedPlugin = plugin
      console.log(`[plugin-loader] Plugin loaded from ${absolute}`)
      return loadedPlugin
    }
  }

  const envPath = process.env.DINOCLAW_PLUGIN_PATH
  if (envPath && fs.existsSync(envPath)) {
    const plugin = loadPlugin(envPath)
    if (plugin) {
      loadedPlugin = plugin
      console.log(`[plugin-loader] Plugin loaded from env path: ${envPath}`)
    }
  }

  return loadedPlugin
}

function loadPlugin(absolutePath: string): PluginHooks | null {
  if (!fs.existsSync(absolutePath)) return null
  try {
    const mod = require(absolutePath) as { default?: PluginHooks; create?: () => PluginHooks }
    return mod.default ?? mod.create?.() ?? null
  } catch (err) {
    console.warn(`[plugin-loader] Failed to load plugin from ${absolutePath}:`, err)
    return null
  }
}

export function isPluginActive(): boolean {
  return getPlugin() !== null
}

export async function callPluginHook<K extends keyof PluginHooks>(
  hook: K,
  ...args: PluginHooks[K] extends ((...a: infer A) => unknown) ? A : never[]
): Promise<PluginHooks[K] extends ((...a: unknown[]) => infer R) ? Awaited<R> : undefined> {
  const plugin = getPlugin()
  if (!plugin) return undefined as never
  const fn = plugin[hook]
  if (typeof fn !== 'function') return undefined as never
  try {
    return await (fn as (...a: unknown[]) => Promise<unknown>).apply(plugin, args) as never
  } catch (err) {
    console.error(`[plugin-loader] Error in hook ${hook}:`, err)
    return undefined as never
  }
}
