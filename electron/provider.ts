import type { ModelSettings, ModelProvider } from '../src/shared/contracts'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const MAX_RETRIES = 2
const RETRY_DELAY_MS = 1500

export async function callModel(
  settings: ModelSettings,
  messages: ChatMessage[],
): Promise<string> {
  const router: Record<ModelProvider, (s: ModelSettings, m: ChatMessage[]) => Promise<string>> = {
    'ollama': callOllama,
    'ollama-cloud': callOllamaCloud,
    'openai-compatible': callOpenAiCompatible,
    'anthropic': callAnthropic,
    'google-gemini': callGemini,
    'groq': callOpenAiCompatible,
    'openrouter': callOpenAiCompatible,
  }

  const handler = router[settings.provider]
  return withRetry(() => handler(settings, messages), MAX_RETRIES)
}

async function callOllama(settings: ModelSettings, messages: ChatMessage[]): Promise<string> {
  const response = await fetch(trimSlash(settings.baseUrl) + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.model,
      messages,
      stream: false,
      options: {
        temperature: settings.temperature,
        num_predict: settings.maxTokens > 0 ? settings.maxTokens : undefined,
      },
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new ProviderError('ollama', response.status, body)
  }

  const data = (await response.json()) as { message?: { content?: string } }
  return data.message?.content?.trim() ?? ''
}

async function callOllamaCloud(settings: ModelSettings, messages: ChatMessage[]): Promise<string> {
  const model = settings.model.replace(/:cloud$/, '')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (settings.apiKey.trim()) {
    headers['Authorization'] = `Bearer ${settings.apiKey}`
  }

  const response = await fetch(trimSlash(settings.baseUrl) + '/api/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature: settings.temperature,
        num_predict: settings.maxTokens > 0 ? settings.maxTokens : undefined,
      },
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new ProviderError('ollama-cloud', response.status, body)
  }

  const data = (await response.json()) as { message?: { content?: string } }
  return data.message?.content?.trim() ?? ''
}

async function callOpenAiCompatible(settings: ModelSettings, messages: ChatMessage[]): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  if (settings.apiKey.trim()) {
    headers['Authorization'] = `Bearer ${settings.apiKey}`
  }

  if (settings.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://dinoclaw.io'
    headers['X-Title'] = 'DinoClaw'
  }

  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    temperature: settings.temperature,
    response_format: { type: 'json_object' },
  }

  if (settings.maxTokens > 0) body.max_tokens = settings.maxTokens

  const response = await fetch(trimSlash(settings.baseUrl) + '/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new ProviderError(settings.provider, response.status, errBody)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { total_tokens?: number }
  }

  return data.choices?.[0]?.message?.content?.trim() ?? ''
}

async function callAnthropic(settings: ModelSettings, messages: ChatMessage[]): Promise<string> {
  const systemMessage = messages.find(m => m.role === 'system')
  const nonSystemMessages = messages.filter(m => m.role !== 'system')

  const body: Record<string, unknown> = {
    model: settings.model,
    max_tokens: settings.maxTokens > 0 ? settings.maxTokens : 4096,
    temperature: settings.temperature,
    messages: nonSystemMessages.map(m => ({ role: m.role, content: m.content })),
  }

  if (systemMessage) {
    body.system = systemMessage.content
  }

  const response = await fetch(trimSlash(settings.baseUrl) + '/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new ProviderError('anthropic', response.status, errBody)
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>
  }

  return data.content?.find(b => b.type === 'text')?.text?.trim() ?? ''
}

async function callGemini(settings: ModelSettings, messages: ChatMessage[]): Promise<string> {
  const systemInstruction = messages.find(m => m.role === 'system')
  const conversationMessages = messages.filter(m => m.role !== 'system')

  const contents = conversationMessages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: settings.temperature,
      responseMimeType: 'application/json',
      maxOutputTokens: settings.maxTokens > 0 ? settings.maxTokens : 4096,
    },
  }

  if (systemInstruction) {
    body.system_instruction = { parts: [{ text: systemInstruction.content }] }
  }

  const url = `${trimSlash(settings.baseUrl)}/v1beta/models/${settings.model}:generateContent?key=${settings.apiKey}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new ProviderError('google-gemini', response.status, errBody)
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }

  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
}

class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    const preview = body.slice(0, 200)
    super(`${provider} returned ${status}: ${preview}`)
    this.name = 'ProviderError'
  }
}

async function withRetry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (err instanceof ProviderError && err.status >= 400 && err.status < 500) {
        throw err
      }
      if (attempt < retries) {
        await sleep(RETRY_DELAY_MS * (attempt + 1))
      }
    }
  }
  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function trimSlash(input: string): string {
  return input.replace(/\/+$/, '')
}
