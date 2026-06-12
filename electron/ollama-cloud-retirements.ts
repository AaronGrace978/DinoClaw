/**
 * Ollama Cloud model retirements (effective 2026-06-16).
 * Auto-migrates retired model ids on load. Ported from AgentPrime.
 */

export const OLLAMA_CLOUD_RETIRED_MODEL_MIGRATIONS: Readonly<Record<string, string>> = {
  'kimi-k2-thinking': 'kimi-k2.6:cloud',
  'kimi-k2-thinking:cloud': 'kimi-k2.6:cloud',
  'kimi-k2:1t': 'kimi-k2.6:cloud',
  'kimi-k2:1t:cloud': 'kimi-k2.6:cloud',
  'minimax-m2': 'minimax-m3:cloud',
  'minimax-m2:cloud': 'minimax-m3:cloud',
  'glm-4.6': 'glm-5.1:cloud',
  'glm-4.6:cloud': 'glm-5.1:cloud',
  'qwen3-next:80b': 'qwen3.5:cloud',
  'qwen3-next:80b:cloud': 'qwen3.5:cloud',
  'qwen3-next:80b-cloud': 'qwen3.5:cloud',
  'qwen3-vl:235b': 'qwen3.5:cloud',
  'qwen3-vl:235b:cloud': 'qwen3.5:cloud',
  'qwen3-vl:235b-cloud': 'qwen3.5:cloud',
  'qwen3-vl:235b-instruct': 'qwen3.5:cloud',
  'qwen3-vl:235b-instruct:cloud': 'qwen3.5:cloud',
  'cogito-2.1:671b': 'deepseek-v4-pro:cloud',
  'cogito-2.1:671b:cloud': 'deepseek-v4-pro:cloud',
  'cogito-2.1:671b-cloud': 'deepseek-v4-pro:cloud',
}

export const OLLAMA_CLOUD_RETIREMENT_DATE = '2026-06-16'

function normalizeLookupKey(model: string): string {
  return model.trim().replace(/^ollama\//i, '').toLowerCase()
}

export function getRetiredOllamaCloudReplacement(model: string): string | undefined {
  return OLLAMA_CLOUD_RETIRED_MODEL_MIGRATIONS[normalizeLookupKey(model)]
}

export function migrateRetiredOllamaCloudModel(model: string): {
  model: string
  migrated: boolean
  from?: string
} {
  const trimmed = model.trim().replace(/^ollama\//i, '')
  const replacement = getRetiredOllamaCloudReplacement(trimmed)
  if (!replacement || replacement === trimmed) {
    return { model: trimmed, migrated: false }
  }
  return { model: replacement, migrated: true, from: trimmed }
}

/** Migrate retired Ollama Cloud model ids in persisted settings. Returns true if changed. */
export function applyRetiredOllamaCloudModelMigrations(model: {
  provider?: string
  model?: string
}): boolean {
  if (model.provider !== 'ollama-cloud' || !model.model) return false
  const result = migrateRetiredOllamaCloudModel(model.model)
  if (!result.migrated) return false
  model.model = result.model
  return true
}
