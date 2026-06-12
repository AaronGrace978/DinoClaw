import { exec, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { shell } from 'electron'
import type {
  ExecutionPolicy,
  MemoryCategory,
  MemoryEntry,
  ToolArtifact,
  ToolCatalogItem,
  ToolName,
  ToolResult,
} from '../src/shared/contracts'
import {
  browserClick,
  browserClose,
  browserFill,
  browserNavigate,
  browserScreenshot,
  browserSearch,
  browserSnapshot,
  browserType,
  browserWait,
  type BrowserConfig,
  DEFAULT_BROWSER_CONFIG,
  clearBrowserSession,
  getBrowserSessionInfo,
} from './browser-tool'
import { getHardwareInfo } from './hardware'
import { DockerSandbox } from './docker-runtime'
import {
  captureDesktopScreenshot,
  clickMouse,
  focusWindow,
  getCursorPosition,
  getPrimaryScreenSize,
  launchDesktopApp,
  listDesktopWindows,
  moveMouseAbsolute,
  pasteTextAtFocus,
  pressHotkeyAtFocus,
  pressKeyAtFocus,
  scrollMouseWheel,
  typeKeysAtFocus,
  waitForWindow,
  type MouseButton,
} from './desktop-automation'

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
  { name: 'execute_command',   risk: 'risky',    description: 'Run a command in the local shell. Args: {command, cwd?}' },
  { name: 'run_script',        risk: 'risky',    description: 'Write script to .dinoclaw/scripts, validate policy, optionally run in Docker sandbox. Args: {content, language?, path?, execute?, useDocker?, cwd?}' },
  { name: 'open_url',          risk: 'moderate', description: 'Open URL in system browser (operator handoff). Cannot automate. For posting/typing on sites use browser_navigate + browser_click/browser_type. Args: {url}' },
  { name: 'web_fetch',         risk: 'safe',     description: 'Fetch text content from a web URL. Args: {url}' },
  { name: 'save_memory',       risk: 'safe',     description: 'Store a durable fact/preference. Args: {fact, category?, importance?, tags?}' },
  { name: 'recall_memory',     risk: 'safe',     description: 'Search stored memories. Args: {query}' },
  { name: 'git_status',        risk: 'safe',     description: 'Show git status of the workspace. Args: {cwd?}' },
  { name: 'git_log',           risk: 'safe',     description: 'Show recent git commits. Args: {count?, cwd?}' },
  { name: 'git_diff',          risk: 'safe',     description: 'Show git diff (staged or unstaged). Args: {staged?, cwd?}' },
  { name: 'code_search',       risk: 'safe',     description: 'Search files for a text pattern (regex). Args: {pattern, directory?, glob?}' },
  { name: 'system_info',       risk: 'safe',     description: 'Get system info (OS, CPU, memory, cwd). No args needed.' },
  { name: 'browser_navigate',  risk: 'moderate', description: 'Navigate in the DinoClaw browser session. Args: {url}' },
  { name: 'browser_snapshot',  risk: 'safe',     description: 'Capture current browser page state. No args needed.' },
  { name: 'browser_click',     risk: 'risky',    description: 'Click an element in the browser session. Args: {target}' },
  { name: 'browser_fill',      risk: 'risky',    description: 'Replace text in an input/editor. Args: {target, value}' },
  { name: 'browser_type',      risk: 'risky',    description: 'Append text in an input/editor. Args: {target, value}' },
  { name: 'browser_wait',      risk: 'safe',     description: 'Wait briefly and capture browser state. Args: {ms}' },
  { name: 'browser_close',     risk: 'safe',     description: 'Close the DinoClaw browser session. No args needed.' },
  { name: 'browser_screenshot', risk: 'safe',    description: 'Capture a screenshot of the browser page. Args: {label?}' },
  { name: 'browser_search',    risk: 'safe',     description: 'Search the web via DuckDuckGo. Args: {query}' },
  { name: 'hardware_info',     risk: 'safe',     description: 'Get detailed hardware info. No args needed.' },
  { name: 'docker_exec',       risk: 'risky',    description: 'Execute a command in Docker sandbox. Args: {command}' },
  { name: 'desktop_screen_size', risk: 'safe',   description: 'Primary monitor width/height in pixels (planning). No args. Windows only in this build.' },
  { name: 'desktop_mouse_move', risk: 'risky',   description: 'Move OS mouse cursor to absolute screen coordinates. Requires desktop automation enabled in policy. Args: {x, y}' },
  { name: 'desktop_click',      risk: 'risky',   description: 'Click at current cursor position (call desktop_mouse_move first). Args: {button?: "left"|"right"|"middle"}' },
  { name: 'desktop_type_text',  risk: 'risky',   description: 'Insert text into the OS-focused control (clipboard paste). Click/focus the field first — true copilot typing. Requires desktop automation. Args: {text}' },
  { name: 'open_file_external', risk: 'moderate', description: 'Open a workspace file or folder with the default app (Notepad, Explorer, etc.). Args: {path}' },
  { name: 'reveal_in_explorer', risk: 'moderate', description: 'Reveal a workspace file in the system file manager (select/highlight it). Args: {path}' },
  { name: 'desktop_cursor_position', risk: 'safe', description: 'Get the current OS cursor coordinates. No args. Windows only in this build.' },
  { name: 'desktop_list_windows', risk: 'safe', description: 'List visible desktop windows with title, process name, and pid. No args. Windows only in this build.' },
  { name: 'desktop_focus_window', risk: 'risky', description: 'Focus a visible desktop window by matching its title or process name. Requires desktop automation. Args: {query}' },
  { name: 'desktop_screenshot', risk: 'moderate', description: 'Capture a screenshot of the full virtual desktop. Args: {label?}. Windows only in this build.' },
  { name: 'desktop_open_app', risk: 'risky', description: 'Launch a desktop application or executable directly. Args: {command, args?}' },
  { name: 'desktop_wait_for_window', risk: 'safe', description: 'Wait until a visible desktop window appears by title or process name. Args: {query, timeoutMs?, pollMs?}' },
  { name: 'desktop_press_key', risk: 'risky', description: 'Press a single key in the focused app. Args: {key, count?, delayMs?}. Good for Enter, Tab, arrows, PageDown, etc.' },
  { name: 'desktop_hotkey', risk: 'risky', description: 'Send a hotkey chord to the focused app. Args: {modifiers:["ctrl"|"alt"|"shift"], key}. Good for Ctrl+L, Ctrl+T, Ctrl+W, etc.' },
  { name: 'desktop_scroll', risk: 'risky', description: 'Scroll the mouse wheel in the active window. Args: {direction:"up"|"down", clicks?}.' },
]

const toolSchemas = {
  list_directory: z.object({ path: z.string().min(1) }),
  read_file: z.object({ path: z.string().min(1) }),
  write_file: z.object({ path: z.string().min(1), content: z.string() }),
  delete_file: z.object({ path: z.string().min(1) }),
  execute_command: z.object({ command: z.string().min(1), cwd: z.string().optional() }),
  run_script: z.object({
    content: z.string().min(1),
    language: z.enum(['powershell', 'bash', 'python', 'node']).optional(),
    path: z.string().optional(),
    execute: z.boolean().optional(),
    useDocker: z.boolean().optional(),
    cwd: z.string().optional(),
  }),
  open_url: z.object({ url: z.string().url() }).strict(),
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
  browser_navigate: z.object({ url: z.string().url() }).strict(),
  browser_snapshot: z.object({}).optional(),
  browser_click: z.object({ target: z.string().min(1) }).strict(),
  browser_fill: z.object({ target: z.string().min(1), value: z.string() }).strict(),
  browser_type: z.object({ target: z.string().min(1), value: z.string() }).strict(),
  browser_wait: z.object({ ms: z.number().min(0).max(10_000) }).strict(),
  browser_close: z.object({}).optional(),
  browser_screenshot: z.object({ label: z.string().optional() }).optional(),
  browser_search: z.object({ query: z.string().min(1) }).strict(),
  hardware_info: z.object({}).optional(),
  docker_exec: z.object({ command: z.string().min(1) }),
  desktop_screen_size: z.object({}).optional(),
  desktop_mouse_move: z.object({ x: z.number(), y: z.number() }).strict(),
  desktop_click: z.object({ button: z.enum(['left', 'right', 'middle']).optional() }).strict(),
  desktop_type_text: z.object({
    text: z.string().min(1).max(16_384),
    mode: z.enum(['paste', 'keys']).optional(),
    delayMs: z.number().min(0).max(500).optional(),
  }).strict(),
  open_file_external: z.object({ path: z.string().min(1) }).strict(),
  reveal_in_explorer: z.object({ path: z.string().min(1) }).strict(),
  desktop_cursor_position: z.object({}).optional(),
  desktop_list_windows: z.object({}).optional(),
  desktop_focus_window: z.object({ query: z.string().min(1) }).strict(),
  desktop_screenshot: z.object({ label: z.string().optional() }).optional(),
  desktop_open_app: z.object({ command: z.string().min(1), args: z.array(z.string()).optional() }).strict(),
  desktop_wait_for_window: z.object({
    query: z.string().min(1),
    timeoutMs: z.number().min(100).max(60_000).optional(),
    pollMs: z.number().min(25).max(5_000).optional(),
  }).strict(),
  desktop_press_key: z.object({
    key: z.string().min(1),
    count: z.number().min(1).max(50).optional(),
    delayMs: z.number().min(0).max(500).optional(),
  }).strict(),
  desktop_hotkey: z.object({
    modifiers: z.array(z.enum(['ctrl', 'control', 'alt', 'shift'])).min(1).max(3),
    key: z.string().min(1),
  }).strict(),
  desktop_scroll: z.object({
    direction: z.enum(['up', 'down']),
    clicks: z.number().min(1).max(50).optional(),
  }).strict(),
} satisfies Record<ToolName, z.ZodTypeAny>

export interface ToolContext {
  workspaceRoot: string
  memory: MemoryEntry[]
  policy: ExecutionPolicy
  saveMemory: (fact: string, category?: MemoryCategory, importance?: number, tags?: string[]) => MemoryEntry
}

function assertDesktopAutomationEnabled(context: ToolContext): void {
  if (!context.policy.desktopAutomationEnabled) {
    throw new Error(
      'Desktop mouse automation is disabled. Turn on "Desktop mouse automation" in Settings → Execution Policy.',
    )
  }
}

export function getToolRisk(toolName: ToolName): ToolCatalogItem['risk'] {
  return toolCatalog.find(t => t.name === toolName)?.risk ?? 'safe'
}

export async function executeTool(
  toolName: ToolName,
  rawArgs: unknown,
  context: ToolContext,
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case 'list_directory': {
        const args = toolSchemas.list_directory.parse(rawArgs)
        const resolved = resolveLocalPath(args.path, context.workspaceRoot)
        assertPathAllowed(resolved, context)
        if (!fs.existsSync(resolved)) return failResult(`Directory not found: ${resolved}`, 'directory_not_found', false)
        const entries = fs.readdirSync(resolved, { withFileTypes: true })
        const lines = entries.slice(0, 300).map(e => {
          const icon = e.isDirectory() ? '[dir] ' : '[file]'
          const size = e.isFile() ? ` (${formatBytes(fs.statSync(path.join(resolved, e.name)).size)})` : ''
          return `${icon} ${e.name}${size}`
        })
        return okResult(
          `Listed ${entries.length} entries.`,
          [`Directory: ${resolved}`, ...lines].join('\n'),
          { path: resolved, count: entries.length },
        )
      }

      case 'read_file': {
        const args = toolSchemas.read_file.parse(rawArgs)
        const resolved = resolveLocalPath(args.path, context.workspaceRoot)
        assertPathAllowed(resolved, context)
        if (!fs.existsSync(resolved)) return failResult(`File not found: ${resolved}`, 'file_not_found', false)
        const stat = fs.statSync(resolved)
        const content = fs.readFileSync(resolved, 'utf8').slice(0, 16_000)
        return okResult(
          `Read file ${path.basename(resolved)}.`,
          `File: ${resolved} (${formatBytes(stat.size)})\n\n${content}`,
          { path: resolved, bytes: stat.size },
        )
      }

      case 'write_file': {
        const args = toolSchemas.write_file.parse(rawArgs)
        const resolved = resolveLocalPath(args.path, context.workspaceRoot)
        assertPathAllowed(resolved, context)
        fs.mkdirSync(path.dirname(resolved), { recursive: true })
        fs.writeFileSync(resolved, args.content, 'utf8')
        return okResult(
          `Wrote ${args.content.length} characters.`,
          `Wrote file: ${resolved}`,
          { path: resolved, chars: args.content.length },
          [{ path: resolved, description: 'Written file' }],
        )
      }

      case 'delete_file': {
        const args = toolSchemas.delete_file.parse(rawArgs)
        const resolved = resolveLocalPath(args.path, context.workspaceRoot)
        assertPathAllowed(resolved, context)
        if (!fs.existsSync(resolved)) return failResult(`File not found: ${resolved}`, 'file_not_found', false)
        fs.unlinkSync(resolved)
        return okResult(`Deleted file ${path.basename(resolved)}.`, `Deleted: ${resolved}`, { path: resolved })
      }

      case 'execute_command': {
        const args = toolSchemas.execute_command.parse(rawArgs)
        const cwd = args.cwd ? resolveLocalPath(args.cwd, context.workspaceRoot) : context.workspaceRoot
        assertPathAllowed(cwd, context)
        assertCommandAllowed(args.command, context)

        const result = await runCommand(args.command, cwd)
        const output = formatCommandResult(args.command, cwd, result)
        if (result.exitCode !== 0) {
          return failResult(`Command failed with exit code ${result.exitCode}.`, 'command_failed', true, output, {
            cwd,
            command: args.command,
            exitCode: result.exitCode,
            mode: result.mode,
          })
        }
        return okResult('Command executed successfully.', output, {
          cwd,
          command: args.command,
          exitCode: result.exitCode,
          mode: result.mode,
        })
      }

      case 'run_script': {
        const args = toolSchemas.run_script.parse(rawArgs)
        const language = args.language ?? (process.platform === 'win32' ? 'powershell' : 'bash')
        const execute = args.execute ?? true
        const cwd = args.cwd ? resolveLocalPath(args.cwd, context.workspaceRoot) : context.workspaceRoot
        assertPathAllowed(cwd, context)

        const policyViolation = assertScriptContentAllowed(args.content)
        if (policyViolation) {
          return failResult(
            `Script content blocked by policy: ${policyViolation}`,
            'script_policy_blocked',
            false,
            undefined,
            { pattern: policyViolation },
          )
        }

        const scriptPath = resolveScriptPath(args.path, language, context.workspaceRoot)
        assertPathAllowed(scriptPath, context)
        fs.mkdirSync(path.dirname(scriptPath), { recursive: true })
        fs.writeFileSync(scriptPath, args.content, 'utf8')
        const artifacts: ToolArtifact[] = [{ path: scriptPath, description: `${language} script` }]

        if (!execute) {
          return okResult('Script written but not executed.', `Script path: ${scriptPath}`, { language, execute }, artifacts)
        }

        if (args.useDocker) {
          const available = await dockerSandbox.isAvailable()
          if (!available) {
            return failResult('Docker is not installed or not running.', 'docker_unavailable', false, undefined, { requestedDocker: true }, artifacts)
          }
          const containerPath = toDockerPath(scriptPath, context.workspaceRoot)
          const dockerCommand = buildScriptCommand(language, containerPath)
          const dockerRun = await dockerSandbox.executeCommand(dockerCommand, context.workspaceRoot)
          const dockerOutput = [
            `Script: ${scriptPath}`,
            `Language: ${language}`,
            `Execution: Docker sandbox`,
            `Exit code: ${dockerRun.exitCode}`,
            dockerRun.stdout ? `stdout:\n${dockerRun.stdout}` : '',
            dockerRun.stderr ? `stderr:\n${dockerRun.stderr}` : '',
          ].filter(Boolean).join('\n')
          if (dockerRun.exitCode !== 0) {
            return failResult('Script failed in Docker sandbox.', 'script_failed', true, dockerOutput, {
              language,
              exitCode: dockerRun.exitCode,
              docker: true,
            }, artifacts)
          }
          return okResult('Script executed in Docker sandbox.', dockerOutput, {
            language,
            exitCode: dockerRun.exitCode,
            docker: true,
          }, artifacts)
        }

        const command = buildScriptCommand(language, scriptPath)
        assertCommandAllowed(command, context)
        const run = await runCommand(command, cwd)
        const output = formatCommandResult(command, cwd, run)
        if (run.exitCode !== 0) {
          return failResult('Script execution failed.', 'script_failed', true, output, {
            language,
            exitCode: run.exitCode,
            docker: false,
          }, artifacts)
        }
        return okResult('Script executed successfully.', output, {
          language,
          exitCode: run.exitCode,
          docker: false,
        }, artifacts)
      }

      case 'open_url': {
        const args = toolSchemas.open_url.parse(rawArgs)
        const cmd = process.platform === 'win32' ? `Start-Process "${args.url}"`
          : process.platform === 'darwin' ? `open "${args.url}"`
            : `xdg-open "${args.url}"`
        await runShellCommand(cmd, context.workspaceRoot)
        return okResult('Opened URL in default browser.', args.url, { url: args.url })
      }

      case 'web_fetch': {
        const args = toolSchemas.web_fetch.parse(rawArgs)
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 15_000)
        try {
          const response = await fetch(args.url, { signal: controller.signal })
          const html = await response.text()
          if (!response.ok) {
            return failResult(`Web fetch returned ${response.status}.`, 'web_fetch_http_error', true, html.slice(0, 4000), {
              url: args.url,
              status: response.status,
            })
          }
          return okResult('Fetched web content.', stripHtml(html).slice(0, 16_000), {
            url: args.url,
            status: response.status,
          })
        } finally {
          clearTimeout(timeout)
        }
      }

      case 'save_memory': {
        const args = toolSchemas.save_memory.parse(rawArgs)
        const entry = context.saveMemory(args.fact, args.category, args.importance, args.tags)
        return okResult(
          `Memory saved [${entry.category}].`,
          `Memory saved [${entry.category}] (importance: ${entry.importance}): ${entry.fact}`,
          { id: entry.id, category: entry.category, importance: entry.importance },
        )
      }

      case 'recall_memory': {
        const args = toolSchemas.recall_memory.parse(rawArgs)
        const query = args.query.toLowerCase()
        const matches = context.memory
          .filter(m => m.fact.toLowerCase().includes(query) || m.tags.some(t => t.toLowerCase().includes(query)))
          .sort((a, b) => b.importance - a.importance)
          .slice(0, 10)
        if (matches.length === 0) return okResult('No matching memories found.', 'No matching memories found.', { matches: 0 })
        return okResult(
          `Found ${matches.length} matching memories.`,
          matches.map(m => `[${m.category}] (★${m.importance}) ${m.fact}`).join('\n'),
          { matches: matches.length },
        )
      }

      case 'git_status': {
        const args = toolSchemas.git_status.parse(rawArgs)
        const cwd = args?.cwd ? resolveLocalPath(args.cwd, context.workspaceRoot) : context.workspaceRoot
        const output = await runShellCommand('git status --short --branch', cwd)
        return okResult('Git status collected.', output || '(no output)', { cwd })
      }

      case 'git_log': {
        const args = toolSchemas.git_log.parse(rawArgs)
        const count = args?.count ?? 10
        const cwd = args?.cwd ? resolveLocalPath(args.cwd, context.workspaceRoot) : context.workspaceRoot
        const output = await runShellCommand(`git log --oneline --graph -${count}`, cwd)
        return okResult('Git log collected.', output || '(no output)', { cwd, count })
      }

      case 'git_diff': {
        const args = toolSchemas.git_diff.parse(rawArgs)
        const staged = args?.staged ? '--staged' : ''
        const cwd = args?.cwd ? resolveLocalPath(args.cwd, context.workspaceRoot) : context.workspaceRoot
        const output = await runShellCommand(`git diff ${staged} --stat`, cwd)
        return okResult('Git diff collected.', output || 'No changes.', { cwd, staged: Boolean(args?.staged) })
      }

      case 'code_search': {
        const args = toolSchemas.code_search.parse(rawArgs)
        const dir = args.directory ? resolveLocalPath(args.directory, context.workspaceRoot) : context.workspaceRoot
        return okResult('Code search completed.', searchFiles(dir, args.pattern, args.glob), {
          directory: dir,
          pattern: args.pattern,
        })
      }

      case 'system_info': {
        const cpus = os.cpus()
        return okResult('System info collected.', [
          `OS: ${os.type()} ${os.release()} (${os.arch()})`,
          `Hostname: ${os.hostname()}`,
          `CPU: ${cpus[0]?.model ?? 'unknown'} (${cpus.length} cores)`,
          `Memory: ${formatBytes(os.freemem())} free / ${formatBytes(os.totalmem())} total`,
          `Uptime: ${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`,
          `CWD: ${process.cwd()}`,
          `Node: ${process.version}`,
          `Platform: ${process.platform}`,
          `User: ${os.userInfo().username}`,
        ].join('\n'))
      }

      case 'browser_navigate': {
        const args = toolSchemas.browser_navigate.parse(rawArgs)
        return browserNavigate(args.url, browserConfig)
      }

      case 'browser_snapshot': {
        toolSchemas.browser_snapshot.parse(rawArgs)
        return browserSnapshot(browserConfig)
      }

      case 'browser_click': {
        const args = toolSchemas.browser_click.parse(rawArgs)
        return browserClick(args.target, browserConfig)
      }

      case 'browser_fill': {
        const args = toolSchemas.browser_fill.parse(rawArgs)
        return browserFill(args.target, args.value, browserConfig)
      }

      case 'browser_type': {
        const args = toolSchemas.browser_type.parse(rawArgs)
        return browserType(args.target, args.value, browserConfig)
      }

      case 'browser_wait': {
        const args = toolSchemas.browser_wait.parse(rawArgs)
        return browserWait(args.ms, browserConfig)
      }

      case 'browser_close': {
        toolSchemas.browser_close.parse(rawArgs)
        return browserClose()
      }

      case 'browser_screenshot': {
        const args = toolSchemas.browser_screenshot.parse(rawArgs)
        return browserScreenshot(browserConfig, args?.label)
      }

      case 'browser_search': {
        const args = toolSchemas.browser_search.parse(rawArgs)
        return browserSearch(args.query, browserConfig)
      }

      case 'hardware_info': {
        const info = await getHardwareInfo()
        return okResult('Hardware info collected.', [
          `OS: ${info.os} (${info.arch})`,
          `CPU: ${info.cpuModel} (${info.cpuCores} cores @ ${info.cpuSpeed} MHz)`,
          `Memory: ${info.freeMemory} free / ${info.totalMemory} total (${info.memoryUsage}% used)`,
          `Uptime: ${info.uptime}`,
          `Network: ${info.networkInterfaces.map(n => `${n.name}: ${n.address}`).join(', ') || 'none'}`,
          `Disks: ${info.disks.map(d => `${d.mount} ${d.free}/${d.total}`).join(', ') || 'none'}`,
          `USB: ${info.usbDevices.slice(0, 5).join(', ') || 'none detected'}`,
        ].join('\n'))
      }

      case 'docker_exec': {
        const args = toolSchemas.docker_exec.parse(rawArgs)
        const available = await dockerSandbox.isAvailable()
        if (!available) return failResult('Docker is not installed or not running.', 'docker_unavailable', false)
        const result = await dockerSandbox.executeCommand(args.command, context.workspaceRoot)
        const output = [
          `Exit code: ${result.exitCode}`,
          result.stdout ? `stdout:\n${result.stdout}` : '',
          result.stderr ? `stderr:\n${result.stderr}` : '',
        ].filter(Boolean).join('\n')
        if (result.exitCode !== 0) {
          return failResult('Docker command failed.', 'docker_command_failed', true, output, { exitCode: result.exitCode })
        }
        return okResult('Docker command completed.', output, { exitCode: result.exitCode })
      }

      case 'desktop_screen_size': {
        toolSchemas.desktop_screen_size.parse(rawArgs)
        const size = await getPrimaryScreenSize()
        if ('error' in size) {
          return failResult(size.error, 'desktop_automation_unsupported', false)
        }
        return okResult(
          `Primary screen: ${size.width}×${size.height}`,
          `width: ${size.width}, height: ${size.height}`,
          { width: size.width, height: size.height },
        )
      }

      case 'desktop_mouse_move': {
        assertDesktopAutomationEnabled(context)
        const args = toolSchemas.desktop_mouse_move.parse(rawArgs)
        const moved = await moveMouseAbsolute(args.x, args.y)
        if ('error' in moved) {
          return failResult(moved.error, 'desktop_mouse_failed', true)
        }
        return okResult(`Moved cursor to (${Math.round(args.x)}, ${Math.round(args.y)}).`, `x: ${args.x}, y: ${args.y}`, {
          x: args.x,
          y: args.y,
        })
      }

      case 'desktop_click': {
        assertDesktopAutomationEnabled(context)
        const args = toolSchemas.desktop_click.parse(rawArgs)
        const button = (args.button ?? 'left') as MouseButton
        const clicked = await clickMouse(button)
        if ('error' in clicked) {
          return failResult(clicked.error, 'desktop_click_failed', true)
        }
        return okResult(`Clicked ${button} button at current position.`, `button: ${button}`, { button })
      }

      case 'desktop_type_text': {
        assertDesktopAutomationEnabled(context)
        const args = toolSchemas.desktop_type_text.parse(rawArgs)
        const mode = args.mode ?? 'paste'
        const typed = mode === 'keys'
          ? await typeKeysAtFocus(args.text, args.delayMs ?? 35)
          : await pasteTextAtFocus(args.text)
        if ('error' in typed) {
          return failResult(typed.error, 'desktop_type_failed', true)
        }
        const preview = args.text.length > 200 ? `${args.text.slice(0, 200)}…` : args.text
        return okResult(`${mode === 'keys' ? 'Typed' : 'Pasted'} ${args.text.length} characters into focused control.`, preview, {
          chars: args.text.length,
          mode,
        })
      }

      case 'open_file_external': {
        const args = toolSchemas.open_file_external.parse(rawArgs)
        const resolved = resolveLocalPath(args.path, context.workspaceRoot)
        assertPathAllowed(resolved, context)
        if (!fs.existsSync(resolved)) {
          return failResult(`Path not found: ${resolved}`, 'path_not_found', false)
        }
        const errMsg = await shell.openPath(resolved)
        if (errMsg) {
          return failResult(`Could not open: ${errMsg}`, 'open_external_failed', false, undefined, { path: resolved })
        }
        return okResult(`Opened: ${resolved}`, resolved, { path: resolved })
      }

      case 'reveal_in_explorer': {
        const args = toolSchemas.reveal_in_explorer.parse(rawArgs)
        const resolved = resolveLocalPath(args.path, context.workspaceRoot)
        assertPathAllowed(resolved, context)
        if (!fs.existsSync(resolved)) {
          return failResult(`Path not found: ${resolved}`, 'path_not_found', false)
        }
        const stat = fs.statSync(resolved)
        if (stat.isDirectory()) {
          const errMsg = await shell.openPath(resolved)
          if (errMsg) {
            return failResult(`Could not open folder: ${errMsg}`, 'reveal_failed', false, undefined, { path: resolved })
          }
          return okResult(`Opened folder: ${resolved}`, resolved, { path: resolved, kind: 'directory' })
        }
        shell.showItemInFolder(resolved)
        return okResult(`Revealed in file manager: ${resolved}`, resolved, { path: resolved, kind: 'file' })
      }

      case 'desktop_cursor_position': {
        toolSchemas.desktop_cursor_position.parse(rawArgs)
        const pos = await getCursorPosition()
        if ('error' in pos) {
          return failResult(pos.error, 'desktop_automation_unsupported', false)
        }
        return okResult(`Cursor position: (${pos.x}, ${pos.y})`, `x: ${pos.x}, y: ${pos.y}`, {
          x: pos.x,
          y: pos.y,
        })
      }

      case 'desktop_list_windows': {
        toolSchemas.desktop_list_windows.parse(rawArgs)
        const windows = await listDesktopWindows()
        if ('error' in windows) {
          return failResult(windows.error, 'desktop_window_list_failed', false)
        }
        const lines = windows.slice(0, 50).map((win, index) => (
          `${index + 1}. [${win.processName}] ${win.title} (pid ${win.pid})`
        ))
        return okResult(
          `Found ${windows.length} visible desktop windows.`,
          lines.join('\n') || 'No visible windows found.',
          { count: windows.length, windows: windows.slice(0, 50) },
        )
      }

      case 'desktop_focus_window': {
        assertDesktopAutomationEnabled(context)
        const args = toolSchemas.desktop_focus_window.parse(rawArgs)
        const focused = await focusWindow(args.query)
        if ('error' in focused) {
          return failResult(focused.error, 'desktop_focus_failed', true)
        }
        return okResult(
          `Focused window: ${focused.title}`,
          `[${focused.processName}] ${focused.title} (pid ${focused.pid})`,
          {
            title: focused.title,
            processName: focused.processName,
            pid: focused.pid,
          },
        )
      }

      case 'desktop_screenshot': {
        const args = toolSchemas.desktop_screenshot.parse(rawArgs)
        const safeLabel = (args?.label ?? 'desktop').replace(/[^a-z0-9-_]+/gi, '-').slice(0, 48) || 'desktop'
        const outputPath = path.join(
          context.workspaceRoot,
          '.dinoclaw',
          'desktop-artifacts',
          `${safeLabel}-${Date.now()}.png`,
        )
        assertPathAllowed(outputPath, context)
        const screenshot = await captureDesktopScreenshot(outputPath)
        if ('error' in screenshot) {
          return failResult(screenshot.error, 'desktop_screenshot_failed', true)
        }
        return okResult(
          'Desktop screenshot captured.',
          `Saved: ${screenshot.path}`,
          { path: screenshot.path },
          [{ path: screenshot.path, description: 'Desktop screenshot' }],
        )
      }

      case 'desktop_open_app': {
        assertDesktopAutomationEnabled(context)
        const args = toolSchemas.desktop_open_app.parse(rawArgs)
        const launched = await launchDesktopApp(args.command, args.args ?? [])
        if ('error' in launched) {
          return failResult(launched.error, 'desktop_open_app_failed', true)
        }
        return okResult(
          `Launched app: ${args.command}`,
          [args.command, ...(args.args ?? [])].join(' '),
          { command: args.command, args: args.args ?? [] },
        )
      }

      case 'desktop_wait_for_window': {
        const args = toolSchemas.desktop_wait_for_window.parse(rawArgs)
        const result = await waitForWindow(args.query, args.timeoutMs, args.pollMs)
        if ('error' in result) {
          return failResult(result.error, 'desktop_wait_for_window_failed', true)
        }
        return okResult(
          `Window is visible: ${result.title}`,
          `[${result.processName}] ${result.title} (pid ${result.pid})`,
          { title: result.title, processName: result.processName, pid: result.pid },
        )
      }

      case 'desktop_press_key': {
        assertDesktopAutomationEnabled(context)
        const args = toolSchemas.desktop_press_key.parse(rawArgs)
        const result = await pressKeyAtFocus(args.key, args.count ?? 1, args.delayMs ?? 35)
        if ('error' in result) {
          return failResult(result.error, 'desktop_press_key_failed', true)
        }
        return okResult(
          `Pressed key ${args.key}${args.count ? ` ×${args.count}` : ''}.`,
          `key: ${args.key}, count: ${args.count ?? 1}, delayMs: ${args.delayMs ?? 35}`,
          { key: args.key, count: args.count ?? 1, delayMs: args.delayMs ?? 35 },
        )
      }

      case 'desktop_hotkey': {
        assertDesktopAutomationEnabled(context)
        const args = toolSchemas.desktop_hotkey.parse(rawArgs)
        const result = await pressHotkeyAtFocus(args.modifiers, args.key)
        if ('error' in result) {
          return failResult(result.error, 'desktop_hotkey_failed', true)
        }
        return okResult(
          `Sent hotkey ${args.modifiers.join('+')}+${args.key}.`,
          `modifiers: ${args.modifiers.join(', ')}, key: ${args.key}`,
          { modifiers: args.modifiers, key: args.key },
        )
      }

      case 'desktop_scroll': {
        assertDesktopAutomationEnabled(context)
        const args = toolSchemas.desktop_scroll.parse(rawArgs)
        const result = await scrollMouseWheel(args.direction, args.clicks ?? 3)
        if ('error' in result) {
          return failResult(result.error, 'desktop_scroll_failed', true)
        }
        return okResult(
          `Scrolled ${args.direction} ${args.clicks ?? 3} clicks.`,
          `direction: ${args.direction}, clicks: ${args.clicks ?? 3}`,
          { direction: args.direction, clicks: args.clicks ?? 3 },
        )
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown tool execution error'
    return failResult(message, 'tool_runtime_error', true)
  }
}

export function getBrowserSession() {
  return getBrowserSessionInfo()
}

export async function resetBrowserSession(): Promise<ToolResult> {
  return clearBrowserSession()
}

interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
  mode: 'spawn' | 'shell'
}

async function runCommand(command: string, cwd: string): Promise<CommandResult> {
  const parsed = splitCommand(command)
  if (parsed && parsed.args.every(arg => !/[|&;<>]/.test(arg))) {
    return runSpawn(parsed.command, parsed.args, cwd)
  }
  return runShellCommandDetailed(command, cwd)
}

async function runShellCommand(command: string, cwd: string): Promise<string> {
  const result = await runShellCommandDetailed(command, cwd)
  return [result.stdout, result.stderr ? `stderr: ${result.stderr}` : ''].filter(Boolean).join('\n\n')
}

async function runShellCommandDetailed(command: string, cwd: string): Promise<CommandResult> {
  const { shell } = getShell()
  try {
    const result = await execAsync(command, {
      cwd,
      shell,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4,
      timeout: 30_000,
    })
    return {
      stdout: result.stdout?.trim() ?? '',
      stderr: result.stderr?.trim() ?? '',
      exitCode: 0,
      mode: 'shell',
    }
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; code?: number; message?: string }
    return {
      stdout: error.stdout?.trim() ?? '',
      stderr: error.stderr?.trim() ?? error.message ?? '',
      exitCode: error.code ?? 1,
      mode: 'shell',
    }
  }
}

async function runSpawn(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: false,
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    let settled = false

    const timeout = setTimeout(() => {
      if (!settled) child.kill()
    }, 30_000)

    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })

    child.on('error', err => {
      clearTimeout(timeout)
      if (settled) return
      settled = true
      resolve({
        stdout: stdout.trim(),
        stderr: [stderr.trim(), err.message].filter(Boolean).join('\n'),
        exitCode: 1,
        mode: 'spawn',
      })
    })

    child.on('close', code => {
      clearTimeout(timeout)
      if (settled) return
      settled = true
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 0,
        mode: 'spawn',
      })
    })
  })
}

function splitCommand(command: string): { command: string; args: string[] } | null {
  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false

  for (const ch of command.trim()) {
    if (escaped) {
      current += ch
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current) {
        parts.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }

  if (quote) return null
  if (current) parts.push(current)
  if (parts.length === 0) return null
  return { command: parts[0], args: parts.slice(1) }
}

function formatCommandResult(command: string, cwd: string, result: CommandResult): string {
  return [
    `cwd: ${cwd}`,
    `mode: ${result.mode}`,
    `$ ${command}`,
    '',
    `exitCode: ${result.exitCode}`,
    result.stdout ? `stdout:\n${result.stdout}` : 'stdout:\n(no output)',
    result.stderr ? `stderr:\n${result.stderr}` : '',
  ].filter(Boolean).join('\n')
}

function resolveScriptPath(customPath: string | undefined, language: ScriptLanguage, workspaceRoot: string): string {
  if (customPath) return resolveLocalPath(customPath, workspaceRoot)
  const ext = { powershell: 'ps1', bash: 'sh', python: 'py', node: 'js' }[language]
  const scriptDir = path.join(workspaceRoot, '.dinoclaw', 'scripts')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join(scriptDir, `run-${stamp}.${ext}`)
}

function buildScriptCommand(language: ScriptLanguage, scriptPath: string): string {
  const quoted = `"${scriptPath}"`
  switch (language) {
    case 'powershell':
      return `powershell -ExecutionPolicy Bypass -File ${quoted}`
    case 'bash':
      return `bash ${quoted}`
    case 'python':
      return `python ${quoted}`
    case 'node':
      return `node ${quoted}`
  }
}

function toDockerPath(scriptPath: string, workspaceRoot: string): string {
  const relative = path.relative(workspaceRoot, scriptPath).replace(/\\/g, '/')
  return `/workspace/${relative}`
}

type ScriptLanguage = 'powershell' | 'bash' | 'python' | 'node'

function okResult(
  summary: string,
  output?: string,
  evidence?: Record<string, unknown>,
  artifacts?: ToolArtifact[],
): ToolResult {
  return { ok: true, summary, output, evidence, artifacts }
}

function failResult(
  summary: string,
  errorCode: string,
  retryable = true,
  output?: string,
  evidence?: Record<string, unknown>,
  artifacts?: ToolArtifact[],
): ToolResult {
  return { ok: false, summary, errorCode, retryable, output, evidence, artifacts }
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
        } catch {
          // skip unreadable files
        }
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

function getShell(): { shell: string } {
  if (process.platform === 'win32') return { shell: 'powershell.exe' }
  return { shell: '/bin/sh' }
}

function resolveLocalPath(input: string, workspaceRoot: string): string {
  if (path.isAbsolute(input)) return path.normalize(input)
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2))
  return path.resolve(workspaceRoot, input)
}

function assertPathAllowed(targetPath: string, context: ToolContext): void {
  const blocked = context.policy.blockedPaths
    .map(entry => resolveLocalPath(entry, context.workspaceRoot))
    .map(entry => path.resolve(entry).toLowerCase())

  const resolved = path.resolve(targetPath).toLowerCase()
  for (const blockedPath of blocked) {
    if (resolved === blockedPath || resolved.startsWith(blockedPath + path.sep)) {
      throw new Error(`Path blocked by policy: ${targetPath}`)
    }
  }
}

const BLOCKED_SCRIPT_PATTERNS = [
  /\brm\s+-rf\s+\/\b/i,
  /\bformat\s+[a-z]:/i,
  /\bdel\s+\/\s*[sf]/i,
  /mkfs\.|fdisk|dd\s+if=.*of=\/dev/i,
  /chmod\s+-R\s+777\s+\//i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/,
  /curl\s+.*\|\s*(bash|sh|powershell)\s*-/i,
  /wget\s+.*\|\s*(bash|sh)\s+-/i,
]

function assertScriptContentAllowed(content: string): string | null {
  for (const pattern of BLOCKED_SCRIPT_PATTERNS) {
    if (pattern.test(content)) return pattern.toString()
  }
  return null
}

function assertCommandAllowed(command: string, context: ToolContext): void {
  const allowed = context.policy.allowedCommands
  if (allowed.length === 0) return

  const normalized = command.trim().toLowerCase()
  const firstToken = normalized.match(/^("?)([^"\s]+)\1/)?.[2] ?? ''

  const ok = allowed.some(entry => {
    const rule = entry.trim().toLowerCase()
    return (
      normalized === rule ||
      normalized.startsWith(rule + ' ') ||
      normalizeCommandToken(firstToken) === normalizeCommandToken(rule)
    )
  })

  if (!ok) {
    throw new Error(`Command blocked by policy: ${command}`)
  }
}

function normalizeCommandToken(value: string): string {
  return value.replace(/\.(exe|cmd|bat|ps1)$/i, '')
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
