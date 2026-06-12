/**
 * OS-level desktop assist for the operator's machine (opt-in via policy).
 * Mouse: PowerShell + user32 / System.Windows.Forms.
 * Typing: clipboard + Ctrl+V into the focused control (copilot-style, not a keylogger).
 * Other platforms: extend with platform-specific automation as needed.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface DesktopScreenSize {
  width: number
  height: number
}

export interface DesktopCursorPosition {
  x: number
  y: number
}

export interface DesktopWindowInfo {
  title: string
  processName: string
  pid: number
}

interface DesktopWindowRecord extends DesktopWindowInfo {
  handle: number
}

const SEND_KEYS_TOKEN_MAP: Record<string, string> = {
  enter: '{ENTER}',
  return: '{ENTER}',
  tab: '{TAB}',
  esc: '{ESC}',
  escape: '{ESC}',
  backspace: '{BACKSPACE}',
  delete: '{DELETE}',
  del: '{DELETE}',
  insert: '{INSERT}',
  ins: '{INSERT}',
  home: '{HOME}',
  end: '{END}',
  pageup: '{PGUP}',
  pgup: '{PGUP}',
  pagedown: '{PGDN}',
  pgdn: '{PGDN}',
  up: '{UP}',
  down: '{DOWN}',
  left: '{LEFT}',
  right: '{RIGHT}',
  space: ' ',
  f1: '{F1}',
  f2: '{F2}',
  f3: '{F3}',
  f4: '{F4}',
  f5: '{F5}',
  f6: '{F6}',
  f7: '{F7}',
  f8: '{F8}',
  f9: '{F9}',
  f10: '{F10}',
  f11: '{F11}',
  f12: '{F12}',
}

function toSendKeysToken(key: string): string | null {
  const normalized = key.trim().toLowerCase()
  if (!normalized) return null
  if (SEND_KEYS_TOKEN_MAP[normalized]) return SEND_KEYS_TOKEN_MAP[normalized]
  if (normalized.length === 1) {
    const ch = normalized
    if (ch === '+') return '{+}'
    if (ch === '^') return '{^}'
    if (ch === '%') return '{%}'
    if (ch === '~') return '{~}'
    if (ch === '(') return '{(}'
    if (ch === ')') return '{)}'
    if (ch === '[') return '{[}'
    if (ch === ']') return '{]}'
    if (ch === '{') return '{{}'
    if (ch === '}') return '{}}'
    return ch
  }
  return null
}

async function runPsFile(scriptBody: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const tmp = path.join(os.tmpdir(), `dinoclaw-desktop-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`)
  fs.writeFileSync(tmp, scriptBody, 'utf8')
  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp],
      { timeout: 15_000, windowsHide: true, maxBuffer: 1024 * 1024 },
    )
    return { ok: true, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return {
      ok: false,
      stdout: String(e.stdout ?? ''),
      stderr: [e.stderr, e.message].filter(Boolean).join('\n'),
    }
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {
      // ignore
    }
  }
}

async function getDesktopWindowsInternal(): Promise<DesktopWindowRecord[] | { error: string }> {
  if (process.platform !== 'win32') {
    return { error: 'Desktop window enumeration is only implemented on Windows in this build.' }
  }
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class DinoWindowInfo {
  public string title { get; set; }
  public string processName { get; set; }
  public int pid { get; set; }
  public long handle { get; set; }
}
public static class DinoWin32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  public static DinoWindowInfo[] GetWindows() {
    var windows = new List<DinoWindowInfo>();
    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) return true;
      int len = GetWindowTextLength(hWnd);
      if (len <= 0) return true;
      var sb = new StringBuilder(len + 1);
      GetWindowText(hWnd, sb, sb.Capacity);
      var title = sb.ToString().Trim();
      if (string.IsNullOrWhiteSpace(title)) return true;
      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);
      try {
        var proc = System.Diagnostics.Process.GetProcessById((int)pid);
        windows.Add(new DinoWindowInfo {
          title = title,
          processName = proc.ProcessName,
          pid = (int)pid,
          handle = hWnd.ToInt64(),
        });
      } catch {
      }
      return true;
    }, IntPtr.Zero);
    return windows.ToArray();
  }
}
"@
[DinoWin32]::GetWindows() | ConvertTo-Json -Compress
`.trim()
  const r = await runPsFile(script)
  if (!r.ok) return { error: r.stderr || r.stdout || 'PowerShell failed' }
  try {
    const parsed = JSON.parse(r.stdout.trim() || '[]') as DesktopWindowRecord[] | DesktopWindowRecord
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return { error: `Unexpected window list output: ${r.stdout.trim().slice(0, 500)}` }
  }
}

function findMatchingWindow(windows: DesktopWindowRecord[], query: string): DesktopWindowRecord | undefined {
  const needle = query.trim().toLowerCase()
  if (!needle) return undefined
  return windows.find(win => win.title.toLowerCase() === needle)
    ?? windows.find(win => win.processName.toLowerCase() === needle)
    ?? windows.find(win => win.title.toLowerCase().startsWith(needle))
    ?? windows.find(win => win.processName.toLowerCase().startsWith(needle))
    ?? windows.find(win => win.title.toLowerCase().includes(needle))
    ?? windows.find(win => win.processName.toLowerCase().includes(needle))
}

export async function getPrimaryScreenSize(): Promise<DesktopScreenSize | { error: string }> {
  if (process.platform !== 'win32') {
    return { error: 'desktop_screen_size is only implemented on Windows in this build.' }
  }
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
Write-Output ("{0},{1}" -f $b.Width, $b.Height)
`.trim()
  const r = await runPsFile(script)
  if (!r.ok) return { error: r.stderr || r.stdout || 'PowerShell failed' }
  const line = r.stdout.trim().split(/\r?\n/).pop() ?? ''
  const m = line.match(/^(\d+),(\d+)$/)
  if (!m) return { error: `Unexpected screen output: ${line}` }
  return { width: Number(m[1]), height: Number(m[2]) }
}

export async function moveMouseAbsolute(x: number, y: number): Promise<{ ok: true } | { error: string }> {
  if (process.platform !== 'win32') {
    return { error: 'desktop_mouse_move is only implemented on Windows in this build.' }
  }
  const xi = Math.round(Math.max(0, x))
  const yi = Math.round(Math.max(0, y))
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${xi}, ${yi})
Write-Output "OK"
`.trim()
  const r = await runPsFile(script)
  if (!r.ok || !r.stdout.includes('OK')) {
    return { error: r.stderr || r.stdout || 'Failed to move mouse' }
  }
  return { ok: true }
}

export type MouseButton = 'left' | 'right' | 'middle'

/** Click at current cursor position (move first with desktop_mouse_move). */
export async function clickMouse(button: MouseButton = 'left'): Promise<{ ok: true } | { error: string }> {
  if (process.platform !== 'win32') {
    return { error: 'desktop_click is only implemented on Windows in this build.' }
  }
  const flags = {
    left: { down: '0x0002', up: '0x0004' },
    right: { down: '0x0008', up: '0x0010' },
    middle: { down: '0x0020', up: '0x0040' },
  }[button]
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinMouse {
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
[WinMouse]::mouse_event(${flags.down},0,0,0,[UIntPtr]::Zero)
[WinMouse]::mouse_event(${flags.up},0,0,0,[UIntPtr]::Zero)
Write-Output "OK"
`.trim()
  const r = await runPsFile(script)
  if (!r.ok || !r.stdout.includes('OK')) {
    return { error: r.stderr || r.stdout || 'Failed to click' }
  }
  return { ok: true }
}

const MAX_PASTE_CHARS = 16_384
const MAX_KEYS_CHARS = 2_048

/**
 * Types arbitrary text into whatever control currently has keyboard focus (copilot-style).
 * Uses UTF-8 clipboard + Ctrl+V (replaces clipboard briefly). Windows only in this build.
 */
export async function pasteTextAtFocus(text: string): Promise<{ ok: true } | { error: string }> {
  if (process.platform !== 'win32') {
    return { error: 'desktop_type_text is only implemented on Windows in this build.' }
  }
  if (text.length > MAX_PASTE_CHARS) {
    return { error: `Text exceeds max length (${MAX_PASTE_CHARS} characters). Split into smaller calls.` }
  }

  const dataFile = path.join(os.tmpdir(), `dinoclaw-type-data-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
  const psFile = path.join(os.tmpdir(), `dinoclaw-type-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`)

  const psBody = `param(
  [Parameter(Mandatory = $true)]
  [string] $DataPath
)
$content = Get-Content -Raw -LiteralPath $DataPath -Encoding utf8
Add-Type -AssemblyName System.Windows.Forms
try {
  [System.Windows.Forms.Clipboard]::SetText($content)
  [System.Windows.Forms.SendKeys]::SendWait("^v")
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
Write-Output "OK"
`

  fs.writeFileSync(dataFile, text, 'utf8')
  fs.writeFileSync(psFile, psBody, 'utf8')

  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile, dataFile],
      { timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 },
    )
    const out = String(stdout ?? '')
    if (!out.includes('OK')) {
      return { error: String(stderr ?? '').trim() || out.trim() || 'Paste failed' }
    }
    return { ok: true }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return { error: [e.stderr, e.message].filter(Boolean).join('\n') || 'Paste failed' }
  } finally {
    for (const f of [dataFile, psFile]) {
      try {
        fs.unlinkSync(f)
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Types visible keystrokes into the focused control.
 * This is best for plain ASCII-ish text where the operator wants to watch it type live.
 */
export async function typeKeysAtFocus(text: string, delayMs = 35): Promise<{ ok: true } | { error: string }> {
  if (process.platform !== 'win32') {
    return { error: 'desktop_type_text (keys mode) is only implemented on Windows in this build.' }
  }
  if (text.length > MAX_KEYS_CHARS) {
    return { error: `Text exceeds max length for keys mode (${MAX_KEYS_CHARS} characters). Use paste mode or split it.` }
  }
  const dataFile = path.join(os.tmpdir(), `dinoclaw-keys-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
  const psFile = path.join(os.tmpdir(), `dinoclaw-keys-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`)
  const psBody = `param(
  [Parameter(Mandatory = $true)]
  [string] $DataPath,
  [Parameter(Mandatory = $true)]
  [int] $DelayMs
)
$content = Get-Content -Raw -LiteralPath $DataPath -Encoding utf8
Add-Type -AssemblyName System.Windows.Forms
foreach ($char in $content.ToCharArray()) {
  $key = switch ($char) {
    "\`r" { continue }
    "\`n" { "{ENTER}"; break }
    "\`t" { "{TAB}"; break }
    "+"  { "{+}"; break }
    "^"  { "{^}"; break }
    "%"  { "{%}"; break }
    "~"  { "{~}"; break }
    "("  { "{(}"; break }
    ")"  { "{)}"; break }
    "["  { "{[}"; break }
    "]"  { "{]}"; break }
    "{"  { "{{}"; break }
    "}"  { "{}}"; break }
    default { [string]$char }
  }
  [System.Windows.Forms.SendKeys]::SendWait($key)
  Start-Sleep -Milliseconds $DelayMs
}
Write-Output "OK"
`
  fs.writeFileSync(dataFile, text, 'utf8')
  fs.writeFileSync(psFile, psBody, 'utf8')
  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile, dataFile, String(Math.max(0, Math.min(500, Math.round(delayMs))))],
      { timeout: 60_000, windowsHide: true, maxBuffer: 1024 * 1024 },
    )
    const out = String(stdout ?? '')
    if (!out.includes('OK')) {
      return { error: String(stderr ?? '').trim() || out.trim() || 'Keystroke typing failed' }
    }
    return { ok: true }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return { error: [e.stderr, e.message].filter(Boolean).join('\n') || 'Keystroke typing failed' }
  } finally {
    for (const f of [dataFile, psFile]) {
      try {
        fs.unlinkSync(f)
      } catch {
        // ignore
      }
    }
  }
}

export async function pressKeyAtFocus(
  key: string,
  count = 1,
  delayMs = 35,
): Promise<{ ok: true } | { error: string }> {
  if (process.platform !== 'win32') {
    return { error: 'desktop_press_key is only implemented on Windows in this build.' }
  }
  const token = toSendKeysToken(key)
  if (!token) return { error: `Unsupported key: ${key}` }
  const script = `
param(
  [Parameter(Mandatory = $true)]
  [string] $TokenPath,
  [Parameter(Mandatory = $true)]
  [int] $Count,
  [Parameter(Mandatory = $true)]
  [int] $DelayMs
)
$Token = Get-Content -Raw -LiteralPath $TokenPath -Encoding utf8
Add-Type -AssemblyName System.Windows.Forms
for ($i = 0; $i -lt $Count; $i++) {
  [System.Windows.Forms.SendKeys]::SendWait($Token)
  Start-Sleep -Milliseconds $DelayMs
}
Write-Output "OK"
`.trim()
  const tokenFile = path.join(os.tmpdir(), `dinoclaw-key-token-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
  const psFile = path.join(os.tmpdir(), `dinoclaw-key-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`)
  fs.writeFileSync(tokenFile, token, 'utf8')
  fs.writeFileSync(psFile, script, 'utf8')
  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile, tokenFile, String(Math.max(1, count)), String(Math.max(0, Math.min(500, Math.round(delayMs))))],
      { timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 },
    )
    const out = String(stdout ?? '')
    if (!out.includes('OK')) {
      return { error: String(stderr ?? '').trim() || out.trim() || 'Key press failed' }
    }
    return { ok: true }
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    return { error: [e.stderr, e.message].filter(Boolean).join('\n') || 'Key press failed' }
  } finally {
    for (const f of [tokenFile, psFile]) {
      try {
        fs.unlinkSync(f)
      } catch {
        // ignore
      }
    }
  }
}

export async function pressHotkeyAtFocus(
  modifiers: string[],
  key: string,
): Promise<{ ok: true } | { error: string }> {
  if (process.platform !== 'win32') {
    return { error: 'desktop_hotkey is only implemented on Windows in this build.' }
  }
  const token = toSendKeysToken(key)
  if (!token) return { error: `Unsupported hotkey key: ${key}` }
  const normalizedModifiers = modifiers.map(m => m.trim().toLowerCase())
  if (normalizedModifiers.some(m => ['win', 'meta', 'super', 'cmd', 'command'].includes(m))) {
    return { error: 'Windows/meta key hotkeys are not supported in this build.' }
  }
  const prefix = normalizedModifiers.map(m => {
    if (m === 'ctrl' || m === 'control') return '^'
    if (m === 'alt') return '%'
    if (m === 'shift') return '+'
    return ''
  }).join('')
  if (normalizedModifiers.some(m => !['ctrl', 'control', 'alt', 'shift'].includes(m))) {
    return { error: `Unsupported modifier in hotkey: ${modifiers.join(', ')}` }
  }
  const chord = `${prefix}${token}`
  const script = `
param(
  [Parameter(Mandatory = $true)]
  [string] $ChordPath
)
$Chord = Get-Content -Raw -LiteralPath $ChordPath -Encoding utf8
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait($Chord)
Write-Output "OK"
`.trim()
  const chordFile = path.join(os.tmpdir(), `dinoclaw-hotkey-chord-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
  const psFile = path.join(os.tmpdir(), `dinoclaw-hotkey-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`)
  fs.writeFileSync(chordFile, chord, 'utf8')
  fs.writeFileSync(psFile, script, 'utf8')
  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile, chordFile],
      { timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 },
    )
    const out = String(stdout ?? '')
    if (!out.includes('OK')) {
      return { error: String(stderr ?? '').trim() || out.trim() || 'Hotkey failed' }
    }
    return { ok: true }
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    return { error: [e.stderr, e.message].filter(Boolean).join('\n') || 'Hotkey failed' }
  } finally {
    for (const f of [chordFile, psFile]) {
      try {
        fs.unlinkSync(f)
      } catch {
        // ignore
      }
    }
  }
}

export async function getCursorPosition(): Promise<DesktopCursorPosition | { error: string }> {
  if (process.platform !== 'win32') {
    return { error: 'desktop_cursor_position is only implemented on Windows in this build.' }
  }
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$p = [System.Windows.Forms.Cursor]::Position
Write-Output ("{0},{1}" -f $p.X, $p.Y)
`.trim()
  const r = await runPsFile(script)
  if (!r.ok) return { error: r.stderr || r.stdout || 'PowerShell failed' }
  const line = r.stdout.trim().split(/\r?\n/).pop() ?? ''
  const m = line.match(/^(-?\d+),(-?\d+)$/)
  if (!m) return { error: `Unexpected cursor output: ${line}` }
  return { x: Number(m[1]), y: Number(m[2]) }
}

export async function listDesktopWindows(): Promise<DesktopWindowInfo[] | { error: string }> {
  const windows = await getDesktopWindowsInternal()
  if (!Array.isArray(windows)) return windows
  return windows.map(({ title, processName, pid }) => ({ title, processName, pid }))
}

export async function focusWindow(query: string): Promise<DesktopWindowInfo | { error: string }> {
  if (process.platform !== 'win32') {
    return { error: 'desktop_focus_window is only implemented on Windows in this build.' }
  }
  const normalized = query.trim().toLowerCase()
  if (!normalized) return { error: 'Window query cannot be empty.' }
  const windows = await getDesktopWindowsInternal()
  if (!Array.isArray(windows)) return windows
  const target = findMatchingWindow(windows, normalized)
  if (!target) return { error: 'No matching window found.' }

  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DinoWin32Focus {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$handle = [IntPtr]${target.handle}
[void][DinoWin32Focus]::ShowWindowAsync($handle, 5)
Start-Sleep -Milliseconds 150
[void][DinoWin32Focus]::SetForegroundWindow($handle)
Write-Output "OK"
`.trim()
  const r = await runPsFile(script)
  if (!r.ok || !r.stdout.includes('OK')) {
    return { error: r.stderr || r.stdout || 'Failed to focus window' }
  }
  return { title: target.title, processName: target.processName, pid: target.pid }
}

export async function waitForWindow(
  query: string,
  timeoutMs = 8_000,
  pollMs = 250,
): Promise<DesktopWindowInfo | { error: string }> {
  if (process.platform !== 'win32') {
    return { error: 'desktop_wait_for_window is only implemented on Windows in this build.' }
  }
  const needle = query.trim().toLowerCase()
  if (!needle) return { error: 'Window query cannot be empty.' }
  const deadline = Date.now() + Math.max(250, timeoutMs)
  while (Date.now() < deadline) {
    const windows = await getDesktopWindowsInternal()
    if (!Array.isArray(windows)) return windows
    const match = findMatchingWindow(windows, needle)
    if (match) return { title: match.title, processName: match.processName, pid: match.pid }
    await new Promise(resolve => setTimeout(resolve, Math.max(50, pollMs)))
  }
  return { error: `Timed out waiting for window matching "${query}".` }
}

export async function launchDesktopApp(command: string, args: string[] = []): Promise<{ ok: true } | { error: string }> {
  if (process.platform !== 'win32') {
    return { error: 'desktop_open_app is only implemented on Windows in this build.' }
  }
  const commandFile = path.join(os.tmpdir(), `dinoclaw-open-app-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
  const argsFile = path.join(os.tmpdir(), `dinoclaw-open-app-args-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  const psFile = path.join(os.tmpdir(), `dinoclaw-open-app-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`)
  const psBody = `param(
  [Parameter(Mandatory = $true)]
  [string] $CommandPath,
  [Parameter(Mandatory = $true)]
  [string] $ArgsPath
)
$command = Get-Content -Raw -LiteralPath $CommandPath -Encoding utf8
$args = @(Get-Content -Raw -LiteralPath $ArgsPath -Encoding utf8 | ConvertFrom-Json)
if ($args.Count -gt 0) {
  Start-Process -FilePath $command.Trim() -ArgumentList $args | Out-Null
} else {
  Start-Process -FilePath $command.Trim() | Out-Null
}
Write-Output "OK"
`
  fs.writeFileSync(commandFile, command, 'utf8')
  fs.writeFileSync(argsFile, JSON.stringify(args), 'utf8')
  fs.writeFileSync(psFile, psBody, 'utf8')
  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile, commandFile, argsFile],
      { timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 },
    )
    const out = String(stdout ?? '')
    if (!out.includes('OK')) {
      return { error: String(stderr ?? '').trim() || out.trim() || 'Failed to launch app' }
    }
    return { ok: true }
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    return { error: [e.stderr, e.message].filter(Boolean).join('\n') || 'Failed to launch app' }
  } finally {
    for (const f of [commandFile, argsFile, psFile]) {
      try {
        fs.unlinkSync(f)
      } catch {
        // ignore
      }
    }
  }
}

export async function scrollMouseWheel(
  direction: 'up' | 'down',
  clicks = 3,
): Promise<{ ok: true } | { error: string }> {
  if (process.platform !== 'win32') {
    return { error: 'desktop_scroll is only implemented on Windows in this build.' }
  }
  const amount = Math.max(1, Math.min(50, Math.round(clicks)))
  const delta = direction === 'up' ? 120 * amount : -120 * amount
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DinoMouseWheel {
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);
}
"@
[DinoMouseWheel]::mouse_event(0x0800, 0, 0, ${delta}, [UIntPtr]::Zero)
Write-Output "OK"
`.trim()
  const r = await runPsFile(script)
  if (!r.ok || !r.stdout.includes('OK')) {
    return { error: r.stderr || r.stdout || 'Scroll failed' }
  }
  return { ok: true }
}

export async function captureDesktopScreenshot(targetPath: string): Promise<{ ok: true; path: string } | { error: string }> {
  if (process.platform !== 'win32') {
    return { error: 'desktop_screenshot is only implemented on Windows in this build.' }
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  const script = `
param(
  [Parameter(Mandatory = $true)]
  [string] $OutputPath
)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bitmap.Size)
$bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
Write-Output "OK"
`.trim()
  const psFile = path.join(os.tmpdir(), `dinoclaw-shot-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`)
  fs.writeFileSync(psFile, script, 'utf8')
  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile, targetPath],
      { timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 },
    )
    const out = String(stdout ?? '')
    if (!out.includes('OK')) {
      return { error: String(stderr ?? '').trim() || out.trim() || 'Screenshot failed' }
    }
    return { ok: true, path: targetPath }
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    return { error: [e.stderr, e.message].filter(Boolean).join('\n') || 'Screenshot failed' }
  } finally {
    try {
      fs.unlinkSync(psFile)
    } catch {
      // ignore
    }
  }
}
