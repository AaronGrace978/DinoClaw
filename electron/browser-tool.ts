import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export interface BrowserConfig {
  enabled: boolean
  allowedDomains: string[]
}

export const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
  enabled: false,
  allowedDomains: [],
}

export async function browserNavigate(url: string, config: BrowserConfig): Promise<string> {
  if (!config.enabled) return 'Browser tools are disabled. Enable them in Settings > Browser.'

  const domain = extractDomain(url)
  if (config.allowedDomains.length > 0 &&
      !config.allowedDomains.includes('*') &&
      !config.allowedDomains.includes(domain)) {
    return `Domain "${domain}" not in allowed domains list.`
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'DinoClaw/0.3 (+https://github.com/AaronGrace978/DinoClaw)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })
    clearTimeout(timeout)

    const html = await response.text()
    const text = extractContent(html)
    const title = extractTitle(html)

    return [
      `URL: ${url}`,
      `Status: ${response.status}`,
      `Title: ${title}`,
      `Content-Type: ${response.headers.get('content-type') ?? 'unknown'}`,
      '',
      text.slice(0, 24_000),
    ].join('\n')
  } catch (err) {
    return `Browser fetch failed: ${err instanceof Error ? err.message : 'Unknown error'}`
  }
}

export async function browserScreenshot(url: string): Promise<string> {
  try {
    if (process.platform === 'win32') {
      await execAsync(`Start-Process "${url}"`, { timeout: 5000, shell: 'powershell.exe' })
    } else if (process.platform === 'darwin') {
      await execAsync(`open "${url}"`, { timeout: 5000 })
    } else {
      await execAsync(`xdg-open "${url}" 2>/dev/null || echo "no browser"`, { timeout: 5000 })
    }
    return `Opened ${url} in default browser.`
  } catch (err) {
    return `Failed to open browser: ${err instanceof Error ? err.message : 'Unknown'}`
  }
}

export async function browserSearch(query: string, config: BrowserConfig): Promise<string> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  return browserNavigate(searchUrl, { ...config, allowedDomains: [...config.allowedDomains, 'html.duckduckgo.com'] })
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match?.[1]?.replace(/\s+/g, ' ').trim() ?? 'No title'
}

function extractContent(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
