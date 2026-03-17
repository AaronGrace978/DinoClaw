import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BrowserWindow, session } from 'electron'
import type { BrowserSessionInfo, ToolArtifact, ToolResult } from '../src/shared/contracts'

export interface BrowserConfig {
  enabled: boolean
  allowedDomains: string[]
  requireApprovalForWrites: boolean
}

export const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
  enabled: false,
  allowedDomains: [],
  requireApprovalForWrites: true,
}

const BROWSER_PARTITION = process.env.NODE_ENV === 'development'
  ? 'dinoclaw-browser-dev'
  : 'persist:dinoclaw-browser'
const NAVIGATION_TIMEOUT_MS = 30_000
const MAX_ACTIONABLES = 60

let automationWindow: BrowserWindow | null = null
let activeConfig: BrowserConfig = { ...DEFAULT_BROWSER_CONFIG }

export async function browserNavigate(url: string, config: BrowserConfig): Promise<ToolResult> {
  try {
    assertDomainAllowed(url, config)
    const win = await ensureAutomationWindow(config)
    const previousUrl = win.webContents.getURL()
    await win.loadURL(url)
    await waitForPageSettle(win, previousUrl)
    return snapshotWithArtifact(win, 'Browser navigation complete')
  } catch (error) {
    return browserError('Browser navigation failed', error, 'browser_navigation_failed')
  }
}

export async function browserSnapshot(config: BrowserConfig): Promise<ToolResult> {
  try {
    const win = getAutomationWindow()
    assertCurrentDomainAllowed(win, config)
    return snapshotWithArtifact(win, 'Browser snapshot captured')
  } catch (error) {
    return browserError('Browser snapshot failed', error, 'browser_snapshot_failed')
  }
}

export async function browserClick(target: string, config: BrowserConfig): Promise<ToolResult> {
  try {
    const win = getAutomationWindow()
    assertCurrentDomainAllowed(win, config)
    const beforeUrl = win.webContents.getURL()
    const action = await actionWithRetries(win, target, 'click')
    if (!action.ok) {
      return {
        ok: false,
        summary: `Browser click failed: ${action.detail}`,
        retryable: true,
        errorCode: 'browser_element_not_found',
        evidence: { target, action: 'click' },
      }
    }
    await waitForPageSettle(win, beforeUrl)
    return snapshotWithArtifact(win, `Clicked target: ${target}`, {
      action: 'click',
      target,
      detail: action.detail,
    })
  } catch (error) {
    return browserError('Browser click failed', error, 'browser_click_failed')
  }
}

export async function browserFill(target: string, value: string, config: BrowserConfig): Promise<ToolResult> {
  return setElementValue(target, value, config, false)
}

export async function browserType(target: string, value: string, config: BrowserConfig): Promise<ToolResult> {
  return setElementValue(target, value, config, true)
}

export async function browserWait(ms: number, config: BrowserConfig): Promise<ToolResult> {
  try {
    const waitMs = Math.max(0, Math.min(ms, 10_000))
    const win = getAutomationWindow()
    assertCurrentDomainAllowed(win, config)
    await delay(waitMs)
    return snapshotWithArtifact(win, `Waited ${waitMs}ms`)
  } catch (error) {
    return browserError('Browser wait failed', error, 'browser_wait_failed')
  }
}

export async function browserScreenshot(config: BrowserConfig, label = 'manual'): Promise<ToolResult> {
  try {
    const win = getAutomationWindow()
    assertCurrentDomainAllowed(win, config)
    const artifact = await saveScreenshot(win, label)
    return {
      ok: true,
      summary: 'Browser screenshot captured',
      output: artifact.path,
      artifacts: [artifact],
      evidence: { ...getBrowserSessionInfo() },
    }
  } catch (error) {
    return browserError('Browser screenshot failed', error, 'browser_screenshot_failed')
  }
}

export async function browserClose(): Promise<ToolResult> {
  if (!automationWindow || automationWindow.isDestroyed()) {
    automationWindow = null
    return { ok: true, summary: 'Browser session already closed.' }
  }
  automationWindow.close()
  automationWindow = null
  return { ok: true, summary: 'Browser session closed.' }
}

export async function browserSearch(query: string, config: BrowserConfig): Promise<ToolResult> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const allowedDomains = config.allowedDomains.includes('*')
    ? config.allowedDomains
    : [...new Set([...config.allowedDomains, 'html.duckduckgo.com'])]
  return browserNavigate(searchUrl, { ...config, allowedDomains })
}

export function getBrowserSessionInfo(): BrowserSessionInfo {
  if (!automationWindow || automationWindow.isDestroyed()) {
    return { open: false, url: '', title: '', domain: '' }
  }
  const url = automationWindow.webContents.getURL()
  const title = automationWindow.getTitle() || automationWindow.webContents.getTitle()
  return {
    open: true,
    url,
    title,
    domain: extractDomain(url),
  }
}

export async function clearBrowserSession(): Promise<ToolResult> {
  try {
    const partition = session.fromPartition(BROWSER_PARTITION)
    await partition.clearCache()
    await partition.clearStorageData()
    if (automationWindow && !automationWindow.isDestroyed()) {
      await automationWindow.loadURL('about:blank')
    }
    return { ok: true, summary: 'Browser session data cleared.' }
  } catch (error) {
    return browserError('Failed to clear browser session', error, 'browser_session_clear_failed')
  }
}

async function setElementValue(target: string, value: string, config: BrowserConfig, append: boolean): Promise<ToolResult> {
  try {
    const win = getAutomationWindow()
    assertCurrentDomainAllowed(win, config)
    const action = await actionWithRetries(win, target, append ? 'type' : 'fill', value)
    if (!action.ok) {
      return {
        ok: false,
        summary: `Browser ${append ? 'type' : 'fill'} failed: ${action.detail}`,
        retryable: true,
        errorCode: 'browser_element_not_found',
        evidence: { target, action: append ? 'type' : 'fill' },
      }
    }
    await waitForPageSettle(win, win.webContents.getURL())
    return snapshotWithArtifact(win, `${append ? 'Typed in' : 'Filled'} target: ${target}`, {
      action: append ? 'type' : 'fill',
      target,
      valueLength: value.length,
      detail: action.detail,
    })
  } catch (error) {
    return browserError(`Browser ${append ? 'type' : 'fill'} failed`, error, `browser_${append ? 'type' : 'fill'}_failed`)
  }
}

async function ensureAutomationWindow(config: BrowserConfig): Promise<BrowserWindow> {
  activeConfig = config
  if (automationWindow && !automationWindow.isDestroyed()) {
    automationWindow.show()
    return automationWindow
  }

  automationWindow = new BrowserWindow({
    width: 1360,
    height: 920,
    autoHideMenuBar: true,
    title: 'DinoClaw Browser',
    show: true,
    webPreferences: {
      partition: BROWSER_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  automationWindow.on('closed', () => {
    automationWindow = null
  })

  automationWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      assertDomainAllowed(url, activeConfig)
      void automationWindow?.loadURL(url)
    } catch {
      // blocked by allowlist; stay on current page
    }
    return { action: 'deny' }
  })

  return automationWindow
}

function getAutomationWindow(): BrowserWindow {
  if (!automationWindow || automationWindow.isDestroyed()) {
    throw new Error('Browser session is not open. Start with browser_navigate.')
  }
  return automationWindow
}

async function waitForPageSettle(win: BrowserWindow, previousUrl: string): Promise<void> {
  if (win.webContents.isLoading()) {
    await waitForLoad(win)
  }

  let stableChecks = 0
  let lastUrl = win.webContents.getURL()

  for (let i = 0; i < 25; i++) {
    await delay(150)
    const nowUrl = win.webContents.getURL()
    const loading = win.webContents.isLoading()
    if (!loading && nowUrl === lastUrl) {
      stableChecks += 1
      if (stableChecks >= 3) break
    } else {
      stableChecks = 0
      lastUrl = nowUrl
    }
  }

  if (previousUrl && win.webContents.getURL() !== previousUrl && win.webContents.isLoading()) {
    await waitForLoad(win)
  }
}

async function waitForLoad(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed() || win.webContents.isDestroyed() || !win.webContents.isLoading()) return
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      settle(() => reject(new Error('Timed out waiting for page load')))
    }, NAVIGATION_TIMEOUT_MS)

    const cleanup = () => {
      clearTimeout(timeout)
      win.removeListener('closed', onClosed)
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.removeListener('did-finish-load', onFinish)
        win.webContents.removeListener('did-fail-load', onFail)
      }
    }

    const settle = (cb: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      cb()
    }

    const onFinish = () => {
      settle(resolve)
    }

    const onFail = (_event: unknown, _errorCode: number, errorDescription: string) => {
      settle(() => reject(new Error(errorDescription || 'Page failed to load')))
    }

    const onClosed = () => {
      settle(() => reject(new Error('Browser window closed during page load')))
    }

    if (win.isDestroyed() || win.webContents.isDestroyed()) {
      settle(resolve)
      return
    }

    win.once('closed', onClosed)
    win.webContents.once('did-finish-load', onFinish)
    win.webContents.once('did-fail-load', onFail)
  })
}

async function snapshotWithArtifact(
  win: BrowserWindow,
  summary: string,
  extraEvidence: Record<string, unknown> = {},
): Promise<ToolResult> {
  const snapshot = await captureSnapshot(win)
  const artifact = await saveScreenshot(win, 'snapshot')
  const checkpointType = snapshot.flags.captchaRequired
    ? 'captcha_required'
    : snapshot.flags.loginRequired
      ? 'login_required'
      : undefined

  return {
    ok: true,
    summary,
    output: formatSnapshot(snapshot),
    evidence: {
      ...extraEvidence,
      checkpointType,
      loginRequired: snapshot.flags.loginRequired,
      captchaRequired: snapshot.flags.captchaRequired,
      url: snapshot.url,
      title: snapshot.title,
      actionables: snapshot.actionables.slice(0, 12),
      viewport: snapshot.viewport,
      scrollState: { x: snapshot.viewport.scrollX, y: snapshot.viewport.scrollY },
    },
    artifacts: [artifact],
  }
}

async function captureSnapshot(win: BrowserWindow): Promise<BrowserSnapshot> {
  return runDomAction<BrowserSnapshot>(win, `
    (() => {
      const cleanText = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const cssEscape = (value) => {
        if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
        return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
      };
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const selectorFor = (el) => {
        if (!(el instanceof Element)) return '';
        if (el.id) return 'css:#' + cssEscape(el.id);
        const testId = el.getAttribute('data-testid');
        if (testId) return 'css:[data-testid="' + testId.replace(/"/g, '\\\\\\"') + '"]';
        const name = el.getAttribute('name');
        if (name) return 'css:' + el.tagName.toLowerCase() + '[name="' + name.replace(/"/g, '\\\\\\"') + '"]';
        const ph = el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-placeholder');
        if (ph) return 'placeholder:' + ph.slice(0, 60).replace(/"/g, '\\\\\\"');
        const aria = el.getAttribute('aria-label');
        if (aria) return 'role:' + (el.getAttribute('role') || el.tagName.toLowerCase()) + '|' + aria.replace(/\\|/g, '');
        const text = cleanText(el.textContent).slice(0, 80);
        if (text) return 'text:' + text;
        return 'css:' + el.tagName.toLowerCase();
      };

      const candidates = Array.from(document.querySelectorAll('button, a, input, textarea, select, [role], [contenteditable="true"]'))
        .filter(isVisible)
        .slice(0, ${String(MAX_ACTIONABLES)});

      const actionables = candidates.map((el) => {
        const role = el.getAttribute('role') || el.tagName.toLowerCase();
        const text = cleanText(el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '');
        return {
          role,
          text: text.slice(0, 120),
          selector: selectorFor(el),
        };
      });

      const pageText = cleanText(document.body?.innerText || '').slice(0, 6000);
      const lowerText = pageText.toLowerCase();
      const lowerUrl = location.href.toLowerCase();
      const loginRequired = /signin|sign-in|log in|login|auth|challenge/.test(lowerUrl) ||
        /sign in|log in|password|verification code|two-factor|2fa/.test(lowerText);
      const captchaRequired = /captcha|i'm not a robot|verify you are human|recaptcha|hcaptcha/.test(lowerText);

      return {
        title: document.title || 'Untitled page',
        url: location.href,
        text: pageText,
        actionables,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        },
        flags: {
          loginRequired,
          captchaRequired,
        },
      };
    })()
  `)
}

async function actionWithRetries(
  win: BrowserWindow,
  target: string,
  mode: 'click' | 'fill' | 'type',
  value = '',
): Promise<DomActionResult> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await runDomAction<DomActionResult>(win, buildDomActionScript(target, mode, value))
    if (result.ok) return result
    if (attempt < 3) await delay(250 * attempt)
  }
  return { ok: false, detail: `Unable to resolve target "${target}" after retries` }
}

function buildDomActionScript(target: string, mode: 'click' | 'fill' | 'type', value: string): string {
  return `
    (() => {
      const rawTarget = ${JSON.stringify(target)};
      const mode = ${JSON.stringify(mode)};
      const value = ${JSON.stringify(value)};
      const clean = (v) => (v || '').replace(/\\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const byText = (text) => {
        const needle = clean(text).toLowerCase();
        if (!needle) return null;
        const elements = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"], [contenteditable="true"], textarea'));
        for (const el of elements) {
          if (!isVisible(el)) continue;
          const hay = clean(el.textContent || el.getAttribute('aria-label') || el.getAttribute('value') || '');
          if (hay.toLowerCase().includes(needle)) return el;
        }
        return null;
      };
      const byLabel = (labelText) => {
        const needle = clean(labelText).toLowerCase();
        const labels = Array.from(document.querySelectorAll('label'));
        for (const label of labels) {
          const text = clean(label.textContent);
          if (!text.toLowerCase().includes(needle)) continue;
          if (label.htmlFor) {
            const input = document.getElementById(label.htmlFor);
            if (input) return input;
          }
          const nested = label.querySelector('input, textarea, [contenteditable="true"]');
          if (nested) return nested;
        }
        return null;
      };
      const byPlaceholder = (placeholderText) => {
        const needle = clean(placeholderText).toLowerCase();
        const candidates = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"][data-placeholder], [contenteditable="true"]'));
        for (const el of candidates) {
          if (!isVisible(el)) continue;
          const ph = (el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-placeholder') || '').toLowerCase();
          if (ph.includes(needle) || needle.includes(ph)) return el;
        }
        return null;
      };
      const byRole = (roleExpr) => {
        const [roleRaw, nameRaw] = roleExpr.split('|');
        const role = clean(roleRaw).toLowerCase();
        const name = clean(nameRaw || '').toLowerCase();
        const implicit = role === 'button' ? 'button, [role="button"], input[type="submit"], input[type="button"]' : '[role="' + role + '"]';
        const nodes = Array.from(document.querySelectorAll(implicit));
        for (const node of nodes) {
          if (!isVisible(node)) continue;
          if (!name) return node;
          const text = clean(node.textContent || node.getAttribute('aria-label') || node.getAttribute('value') || '').toLowerCase();
          if (text.includes(name)) return node;
        }
        return null;
      };
      const resolveTarget = () => {
        if (!rawTarget) return null;
        if (rawTarget.startsWith('css:')) return document.querySelector(rawTarget.slice(4));
        if (rawTarget.startsWith('text:')) return byText(rawTarget.slice(5));
        if (rawTarget.startsWith('label:')) return byLabel(rawTarget.slice(6));
        if (rawTarget.startsWith('role:')) return byRole(rawTarget.slice(5));
        if (rawTarget.startsWith('placeholder:')) return byPlaceholder(rawTarget.slice(12));
        try {
          const byCss = document.querySelector(rawTarget);
          if (byCss) return byCss;
        } catch {}
        const byPh = byPlaceholder(rawTarget);
        if (byPh) return byPh;
        return byText(rawTarget);
      };

      const el = resolveTarget();
      if (!el || !isVisible(el)) return { ok: false, detail: 'Target not found or not visible' };
      if (!(el instanceof HTMLElement)) return { ok: false, detail: 'Target is not an HTMLElement' };

      el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
      el.focus();

      if (mode === 'click') {
        el.click();
        return { ok: true, detail: 'Click dispatched' };
      }

      const append = mode === 'type';
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.value = append ? (el.value + value) : value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, detail: append ? 'Text appended' : 'Value replaced' };
      }

      if (el.isContentEditable) {
        const current = el.innerText || '';
        el.innerText = append ? current + value : value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, detail: append ? 'Content appended' : 'Content replaced' };
      }

      return { ok: false, detail: 'Target does not support text input' };
    })()
  `
}

async function saveScreenshot(win: BrowserWindow, label: string): Promise<ToolArtifact> {
  const image = await win.webContents.capturePage()
  const artifactDir = path.join(os.homedir(), '.dinoclaw', 'browser-artifacts')
  fs.mkdirSync(artifactDir, { recursive: true })
  const fileName = `browser-${Date.now()}-${sanitizeName(label)}.png`
  const fullPath = path.join(artifactDir, fileName)
  fs.writeFileSync(fullPath, image.toPNG())
  return { path: fullPath, description: `Browser screenshot (${label})` }
}

async function runDomAction<T>(win: BrowserWindow, script: string): Promise<T> {
  const result = await win.webContents.executeJavaScript(script, true)
  return result as T
}

function assertDomainAllowed(url: string, config: BrowserConfig): void {
  if (!config.enabled) {
    throw new Error('Browser tools are disabled. Enable them in Infra > Browser Tools.')
  }
  const domain = extractDomain(url)
  if (!isDomainAllowed(domain, config.allowedDomains)) {
    throw new Error(`Domain "${domain}" not in allowed domains list.`)
  }
}

function assertCurrentDomainAllowed(win: BrowserWindow, config: BrowserConfig): void {
  assertDomainAllowed(win.webContents.getURL(), config)
}

function isDomainAllowed(domain: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true
  if (allowedDomains.some(d => d.trim() === '*')) return true
  const normalized = domain.toLowerCase()
  return allowedDomains
    .map(d => d.trim().toLowerCase())
    .filter(Boolean)
    .some(allowed => normalized === allowed || normalized.endsWith(`.${allowed}`))
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

function formatSnapshot(snapshot: BrowserSnapshot): string {
  const actions = snapshot.actionables
    .slice(0, 20)
    .map((entry, index) => `${index + 1}. [${entry.role}] ${entry.text || '(no label)'} -> ${entry.selector}`)
  const lines = [
    `Title: ${snapshot.title}`,
    `URL: ${snapshot.url}`,
    `Viewport: ${snapshot.viewport.width}x${snapshot.viewport.height} (scroll ${snapshot.viewport.scrollX}, ${snapshot.viewport.scrollY})`,
    '',
    ...(snapshot.flags.loginRequired ? ['Checkpoint hint: login appears required.'] : []),
    ...(snapshot.flags.captchaRequired ? ['Checkpoint hint: captcha/human verification detected.'] : []),
    'Visible actions:',
    ...(actions.length > 0 ? actions : ['(no actionable elements found)']),
    '',
    'Page text:',
    snapshot.text || '(no visible text)',
  ]
  return lines.join('\n')
}

function browserError(summary: string, error: unknown, code: string): ToolResult {
  return {
    ok: false,
    summary: `${summary}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    retryable: true,
    errorCode: code,
  }
}

function sanitizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'artifact'
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

interface BrowserSnapshot {
  title: string
  url: string
  text: string
  actionables: Array<{
    role: string
    text: string
    selector: string
  }>
  viewport: {
    width: number
    height: number
    scrollX: number
    scrollY: number
  }
  flags: {
    loginRequired: boolean
    captchaRequired: boolean
  }
}

interface DomActionResult {
  ok: boolean
  detail: string
}
