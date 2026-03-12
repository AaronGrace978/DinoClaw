import type { RunStep, RunRecord } from '../src/shared/contracts'
import path from 'node:path'
import fs from 'node:fs'

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

let loadedPlugin: PluginHooks | null = null
let pluginLoaded = false

export function getPlugin(): PluginHooks | null {
  if (pluginLoaded) return loadedPlugin
  pluginLoaded = true

  for (const relative of SEARCH_PATHS) {
    const absolute = path.resolve(__dirname, relative)
    if (fs.existsSync(absolute)) {
      try {
        const mod = require(absolute) as { default?: PluginHooks; create?: () => PluginHooks }
        loadedPlugin = mod.default ?? mod.create?.() ?? null
        if (loadedPlugin) {
          console.log(`[plugin-loader] Plugin loaded from ${absolute}`)
          return loadedPlugin
        }
      } catch (err) {
        console.warn(`[plugin-loader] Failed to load plugin from ${absolute}:`, err)
      }
    }
  }

  const envPath = process.env.DINOCLAW_PLUGIN_PATH
  if (envPath && fs.existsSync(envPath)) {
    try {
      const mod = require(envPath) as { default?: PluginHooks; create?: () => PluginHooks }
      loadedPlugin = mod.default ?? mod.create?.() ?? null
      if (loadedPlugin) {
        console.log(`[plugin-loader] Plugin loaded from env path: ${envPath}`)
      }
    } catch (err) {
      console.warn(`[plugin-loader] Failed to load plugin from env path:`, err)
    }
  }

  return loadedPlugin
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
