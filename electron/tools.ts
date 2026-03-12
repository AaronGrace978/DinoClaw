import { exec } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { MemoryEntry, ToolCatalogItem, ToolName, MemoryCategory } from '../src/shared/contracts'
import { browserNavigate, browserSearch, type BrowserConfig, DEFAULT_BROWSER_CONFIG } from './browser-tool'
import { getHardwareInfo } from './hardware'
import { DockerSandbox, type DockerConfig, DEFAULT_DOCKER_CONFIG } from './docker-runtime'

const execAsync = promisify(exec)

let browserConfig: BrowserConfig = { ...DEFAULT_BROWSER_CONFIG }
let dockerSandbox: DockerSandbox = new DockerSandbox()

export function setBrowserConfig(config: BrowserConfig): void { browserConfig = config }
export function setDockerSandbox(sandbox: DockerSandbox): void { dockerSandbox = sandbox }

export const toolCatalog: ToolCatalogItem[] = [
  { name: 'list_directory',    risk: 'safe',     description: 'List files and folders in a directory. Args: {path}' },
  { name: 'read_file',         risk: 'safe',     description: 'Read a text file (up to 16 KB). Args: {path}' },
  { name: 'write_file',        risk: 'moderate', description: 'Write or overwrite a text file. Args: {path, content}' },
  { name: 'delete_file',       risk: 'risky',    description: 'Delete a file. Args: {path}' },
  { name: 'execute_command',   risk: 'risky',    description: 'Run a shell command. Args: {command, cwd?}' },
  { name: 'open_url',          risk: 'moderate', description: 'Open a URL in the default browser. Args: {url}' },
  { name: 'web_fetch',         risk: 'safe',     description: 'Fetch text content from a web URL. Args: {url}' },
  { name: 'save_memory',       risk: 'safe',     description: 'Store a durable fact/preference. Args: {fact, category?, importance?, tags?}' },
  { name: 'recall_memory',     risk: 'safe',     description: 'Search stored memories. Args: {query}' },
  { name: 'git_status',        risk: 'safe',     description: 'Show git status of the workspace. Args: {cwd?}' },
  { name: 'git_log',           risk: 'safe',     description: 'Show recent git commits. Args: {count?, cwd?}' },
  { name: 'git_diff',          risk: 'safe',     description: 'Show git diff (staged or unstaged). Args: {staged?, cwd?}' },
  { name: 'code_search',       risk: 'safe',     description: 'Search files for a text pattern (regex). Args: {pattern, directory?, glob?}' },
  { name: 'system_info',       risk: 'safe',     description: 'Get system info (OS, CPU, memory, cwd). No args needed.' },
  { name: 'browser_navigate',  risk: 'moderate', description: 'Navigate to a URL and extract page content. Args: {url}' },
  { name: 'browser_search',    risk: 'safe',     description: 'Search the web via DuckDuckGo. Args: {query}' },
  { name: 'hardware_info',     risk: 'safe',     description: 'Get detailed hardware info: CPU, memory, disks, USB, network. No args needed.' },
  { name: 'docker_exec',       risk: 'risky',    description: 'Execute a command inside a Docker container sandbox. Args: {command}' },
]

const toolSchemas = {
  list_directory: z.object({ path: z.string().min(1) }),
  read_file: z.object({ path: z.string().min(1) }),
  write_file: z.object({ path: z.string().min(1), content: z.string() }),
  delete_file: z.object({ path: z.string().min(1) }),
  execute_command: z.object({ command: z.string().min(1), cwd: z.string().optional() }),
  open_url: z.object({ url: z.string().url() }),
  web_fetch: z.object({ url: z.string().url() }),
  save_memory: z.object({
    fact: z.string().min(1),
    category: z.enum(['fact', 'preference', 'pattern', 'context', 'skill']).optional(),
    importance: z.number().min(1).max(5).optional(),
    tags: z.array(z.string()).optional(),
  }),
  recall_memory: z.object({ query: z.string().min(1) }),
  git_status: z.object({ cwd: z.string().optional() }),
  git_log: z.object({ count: z.number().optional(), cwd: z.string().optional() }),
  git_diff: z.object({ staged: z.boolean().optional(), cwd: z.string().optional() }),
  code_search: z.object({
    pattern: z.string().min(1),
    directory: z.string().optional(),
    glob: z.string().optional(),
  }),
  system_info: z.object({}).optional(),
  browser_navigate: z.object({ url: z.string().url() }),
  browser_search: z.object({ query: z.string().min(1) }),
  hardware_info: z.object({}).optional(),
  docker_exec: z.object({ command: z.string().min(1) }),
} satisfies Record<ToolName, z.ZodTypeAny>

export interface ToolContext {
  workspaceRoot: string
  memory: MemoryEntry[]
  saveMemory: (fact: string, category?: MemoryCategory, importance?: number, tags?: string[]) => MemoryEntry
}

export function getToolRisk(toolName: ToolName): ToolCatalogItem['risk'] {
  return toolCatalog.find(t => t.name === toolName)?.risk ?? 'safe'
}

function getShell(): { shell: string; flag?: string } {
  if (process.platform === 'win32') return { shell: 'powershell.exe' }
  return { shell: '/bin/sh' }
}

async function runShellCommand(command: string, cwd: string): Promise<string> {
  const { shell } = getShell()
  const result = await execAsync(command, {
    cwd,
    shell,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 4,
    timeout: 30_000,
  })
  const stdout = result.stdout?.trim() ?? ''
  const stderr = result.stderr?.trim() ?? ''
  return [stdout, stderr ? `stderr: ${stderr}` : ''].filter(Boolean).join('\n\n')
}

export async function executeTool(
  toolName: ToolName,
  rawArgs: unknown,
  context: ToolContext,
): Promise<string> {
  switch (toolName) {
    case 'list_directory': {
      const args = toolSchemas.list_directory.parse(rawArgs)
      const resolved = resolveLocalPath(args.path, context.workspaceRoot)
      if (!fs.existsSync(resolved)) return `Error: directory not found: ${resolved}`
      const entries = fs.readdirSync(resolved, { withFileTypes: true })
      const lines = entries
        .slice(0, 300)
        .map(e => {
          const icon = e.isDirectory() ? '[dir] ' : '[file]'
          const size = e.isFile() ? ` (${formatBytes(fs.statSync(path.join(resolved, e.name)).size)})` : ''
          return `${icon} ${e.name}${size}`
        })
      return [`Directory: ${resolved}  (${entries.length} entries)`, ...lines].join('\n')
    }

    case 'read_file': {
      const args = toolSchemas.read_file.parse(rawArgs)
      const resolved = resolveLocalPath(args.path, context.workspaceRoot)
      if (!fs.existsSync(resolved)) return `Error: file not found: ${resolved}`
      const stat = fs.statSync(resolved)
      const content = fs.readFileSync(resolved, 'utf8').slice(0, 16_000)
      return `File: ${resolved} (${formatBytes(stat.size)})\n\n${content}`
    }

    case 'write_file': {
      const args = toolSchemas.write_file.parse(rawArgs)
      const resolved = resolveLocalPath(args.path, context.workspaceRoot)
      fs.mkdirSync(path.dirname(resolved), { recursive: true })
      fs.writeFileSync(resolved, args.content, 'utf8')
      return `Wrote ${args.content.length} chars to ${resolved}`
    }

    case 'delete_file': {
      const args = toolSchemas.delete_file.parse(rawArgs)
      const resolved = resolveLocalPath(args.path, context.workspaceRoot)
      if (!fs.existsSync(resolved)) return `Error: file not found: ${resolved}`
      fs.unlinkSync(resolved)
      return `Deleted: ${resolved}`
    }

    case 'execute_command': {
      const args = toolSchemas.execute_command.parse(rawArgs)
      const cwd = args.cwd ? resolveLocalPath(args.cwd, context.workspaceRoot) : context.workspaceRoot
      const output = await runShellCommand(args.command, cwd)
      return `cwd: ${cwd}\n$ ${args.command}\n\n${output || '(no output)'}`
    }

    case 'open_url': {
      const args = toolSchemas.open_url.parse(rawArgs)
      const cmd = process.platform === 'win32' ? `Start-Process "${args.url}"`
                : process.platform === 'darwin' ? `open "${args.url}"`
                : `xdg-open "${args.url}"`
      await runShellCommand(cmd, context.workspaceRoot)
      return `Opened: ${args.url}`
    }

    case 'web_fetch': {
      const args = toolSchemas.web_fetch.parse(rawArgs)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15_000)
      try {
        const response = await fetch(args.url, { signal: controller.signal })
        const html = await response.text()
        return stripHtml(html).slice(0, 16_000)
      } finally {
        clearTimeout(timeout)
      }
    }

    case 'save_memory': {
      const args = toolSchemas.save_memory.parse(rawArgs)
      const entry = context.saveMemory(args.fact, args.category, args.importance, args.tags)
      return `Memory saved [${entry.category}] (importance: ${entry.importance}): ${entry.fact}`
    }

    case 'recall_memory': {
      const args = toolSchemas.recall_memory.parse(rawArgs)
      const query = args.query.toLowerCase()
      const matches = context.memory
        .filter(m => m.fact.toLowerCase().includes(query) || m.tags.some(t => t.toLowerCase().includes(query)))
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 10)
      if (matches.length === 0) return 'No matching memories found.'
      return matches.map(m => `[${m.category}] (★${m.importance}) ${m.fact}`).join('\n')
    }

    case 'git_status': {
      const args = toolSchemas.git_status.parse(rawArgs)
      const cwd = args?.cwd ? resolveLocalPath(args.cwd, context.workspaceRoot) : context.workspaceRoot
      return runShellCommand('git status --short --branch', cwd)
    }

    case 'git_log': {
      const args = toolSchemas.git_log.parse(rawArgs)
      const count = args?.count ?? 10
      const cwd = args?.cwd ? resolveLocalPath(args.cwd, context.workspaceRoot) : context.workspaceRoot
      return runShellCommand(`git log --oneline --graph -${count}`, cwd)
    }

    case 'git_diff': {
      const args = toolSchemas.git_diff.parse(rawArgs)
      const staged = args?.staged ? '--staged' : ''
      const cwd = args?.cwd ? resolveLocalPath(args.cwd, context.workspaceRoot) : context.workspaceRoot
      const output = await runShellCommand(`git diff ${staged} --stat`, cwd)
      return output || 'No changes.'
    }

    case 'code_search': {
      const args = toolSchemas.code_search.parse(rawArgs)
      const dir = args.directory ? resolveLocalPath(args.directory, context.workspaceRoot) : context.workspaceRoot
      return searchFiles(dir, args.pattern, args.glob)
    }

    case 'system_info': {
      const cpus = os.cpus()
      return [
        `OS: ${os.type()} ${os.release()} (${os.arch()})`,
        `Hostname: ${os.hostname()}`,
        `CPU: ${cpus[0]?.model ?? 'unknown'} (${cpus.length} cores)`,
        `Memory: ${formatBytes(os.freemem())} free / ${formatBytes(os.totalmem())} total`,
        `Uptime: ${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`,
        `CWD: ${process.cwd()}`,
        `Node: ${process.version}`,
        `Platform: ${process.platform}`,
        `User: ${os.userInfo().username}`,
      ].join('\n')
    }

    case 'browser_navigate': {
      const args = toolSchemas.browser_navigate.parse(rawArgs)
      return browserNavigate(args.url, browserConfig)
    }

    case 'browser_search': {
      const args = toolSchemas.browser_search.parse(rawArgs)
      return browserSearch(args.query, browserConfig)
    }

    case 'hardware_info': {
      const info = await getHardwareInfo()
      return [
        `OS: ${info.os} (${info.arch})`,
        `CPU: ${info.cpuModel} (${info.cpuCores} cores @ ${info.cpuSpeed} MHz)`,
        `Memory: ${info.freeMemory} free / ${info.totalMemory} total (${info.memoryUsage}% used)`,
        `Uptime: ${info.uptime}`,
        `Network: ${info.networkInterfaces.map(n => `${n.name}: ${n.address}`).join(', ') || 'none'}`,
        `Disks: ${info.disks.map(d => `${d.mount} ${d.free}/${d.total}`).join(', ') || 'none'}`,
        `USB: ${info.usbDevices.slice(0, 5).join(', ') || 'none detected'}`,
      ].join('\n')
    }

    case 'docker_exec': {
      const args = toolSchemas.docker_exec.parse(rawArgs)
      const available = await dockerSandbox.isAvailable()
      if (!available) return 'Docker is not installed or not running.'
      const result = await dockerSandbox.executeCommand(args.command, context.workspaceRoot)
      return [
        `Exit code: ${result.exitCode}`,
        result.stdout ? `stdout:\n${result.stdout}` : '',
        result.stderr ? `stderr:\n${result.stderr}` : '',
      ].filter(Boolean).join('\n')
    }
  }
}

function searchFiles(dir: string, pattern: string, glob?: string): string {
  const regex = new RegExp(pattern, 'gi')
  const results: string[] = []
  const maxResults = 50

  function walk(current: string) {
    if (results.length >= maxResults) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(current, { withFileTypes: true }) } catch { return }

    for (const entry of entries) {
      if (results.length >= maxResults) break
      const full = path.join(current, entry.name)

      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'target'].includes(entry.name)) continue
        walk(full)
      } else if (entry.isFile()) {
        if (glob && !matchGlob(entry.name, glob)) continue
        try {
          const content = fs.readFileSync(full, 'utf8')
          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              const rel = path.relative(dir, full)
              results.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 120)}`)
              regex.lastIndex = 0
              if (results.length >= maxResults) break
            }
          }
        } catch { /* skip binary/unreadable files */ }
      }
    }
  }

  walk(dir)
  if (results.length === 0) return `No matches for "${pattern}"`
  return `Found ${results.length} matches:\n${results.join('\n')}`
}

function matchGlob(filename: string, glob: string): boolean {
  const re = glob.replace(/\./g, '\\.').replace(/\*/g, '.*')
  return new RegExp(`^${re}$`, 'i').test(filename)
}

function resolveLocalPath(input: string, workspaceRoot: string): string {
  if (path.isAbsolute(input)) return path.normalize(input)
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2))
  return path.resolve(workspaceRoot, input)
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
