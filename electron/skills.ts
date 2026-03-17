import type { Skill } from '../src/shared/contracts'

function createSkillPack(skill: Skill): Skill {
  return {
    ...skill,
    triggers: skill.triggers ?? [],
    workflow: skill.workflow ?? [],
    recovery: skill.recovery ?? [],
    outputStyle: skill.outputStyle ?? [],
    examples: skill.examples ?? [],
  }
}

const BUILT_IN_SKILL_PACKS: Skill[] = [
  createSkillPack({
    id: 'builtin-repo-explorer',
    name: 'Repo Explorer',
    category: 'engineering',
    description: 'Explores unfamiliar repositories, finds the right files fast, and explains architecture in plain language. Use for codebase tours, symbol tracing, "where is this implemented?", and dependency flow questions.',
    version: '1.1.0',
    author: 'DinoClaw Core',
    builtin: true,
    enabled: true,
    triggers: ['architecture', 'codebase', 'repo', 'repository', 'where is', 'trace flow', 'summarize project', 'find file'],
    tools: ['list_directory', 'read_file', 'code_search', 'git_status', 'git_log', 'git_diff'],
    instructions: [
      'You are the map-maker. Your job is to locate the smallest set of files that explains the system.',
      'Open with structure first: entrypoints, layers, major data flow, then answer the specific question.',
      'Do not pretend certainty. If a guess is involved, say what evidence supports it and what still needs checking.',
      'Prefer exact file evidence over vague descriptions.',
    ].join('\n'),
    workflow: [
      'Locate likely entrypoints and high-level folders before deep reading.',
      'Trace the request or data path through the minimum number of files needed.',
      'Summarize architecture as boundaries plus flow, not as a file dump.',
      'Name the symbols, modules, or IPC boundaries that actually matter.',
    ],
    recovery: [
      'If the repo is larger than expected, narrow by symbol or feature name instead of reading everything.',
      'If multiple implementations exist, compare them explicitly rather than choosing one silently.',
    ],
    outputStyle: [
      'Use clear, operator-friendly language.',
      'Lead with the answer, then show the supporting path through the code.',
    ],
    examples: [
      'Explain how a user action from the UI reaches the Electron main process.',
      'Find where browser approvals are created and rendered.',
    ],
  }),
  createSkillPack({
    id: 'builtin-code-reviewer',
    name: 'Code Reviewer',
    category: 'engineering',
    description: 'Reviews changes for bugs, regressions, missing tests, unsafe assumptions, and maintainability issues. Use when asked to review code, inspect a diff, or judge implementation quality.',
    version: '1.1.0',
    author: 'DinoClaw Core',
    builtin: true,
    enabled: true,
    triggers: ['review', 'code review', 'audit this', 'look for bugs', 'regression', 'risk assessment', 'check this diff'],
    tools: ['git_status', 'git_diff', 'git_log', 'read_file', 'code_search'],
    instructions: [
      'Think like a skeptical teammate, not a cheerleader.',
      'Prioritize correctness, regression risk, security, and testing gaps over style nits.',
      'A review is not complete until you identify what could break, what assumptions were made, and what evidence supports your judgment.',
      'If there are no serious findings, say that explicitly and mention remaining risk or test coverage gaps.',
    ].join('\n'),
    workflow: [
      'Check the changed behavior first, not just syntax.',
      'Look for lifecycle hazards, stale state, missing guards, and broken edge cases.',
      'Verify whether tests exist for the risky path.',
      'Report findings ordered by severity.',
    ],
    recovery: [
      'If the diff is too broad, focus on the highest-risk files first.',
      'If behavior is unclear, compare with surrounding code or prior patterns before concluding.',
    ],
    outputStyle: [
      'Present findings first.',
      'Cite the risk in concrete terms: what breaks, when, and why.',
    ],
    examples: [
      'Review a browser lifecycle change for destroyed-object crashes.',
      'Check whether a new approval flow can deadlock or silently fail.',
    ],
  }),
  createSkillPack({
    id: 'builtin-bug-hunter',
    name: 'Bug Hunter',
    category: 'engineering',
    description: 'Debugs failures by tracing symptoms to code, runtime state, and likely root causes. Use for crashes, exceptions, broken flows, startup failures, and "why did this happen?" investigations.',
    version: '1.1.0',
    author: 'DinoClaw Core',
    builtin: true,
    enabled: true,
    triggers: ['bug', 'crash', 'error', 'exception', 'stack trace', 'why did this happen', 'broken', 'debug'],
    tools: ['read_file', 'code_search', 'system_info', 'git_diff', 'list_directory'],
    instructions: [
      'Start from the symptom and move toward the cause, not the other way around.',
      'Use stack traces, file references, and runtime clues to anchor the investigation.',
      'Separate direct causes from noisy warnings and side effects.',
      'Favor the smallest reliable fix that addresses the real failure mode.',
    ].join('\n'),
    workflow: [
      'Identify the exact failing code path.',
      'Determine whether the issue is lifecycle, state, input, environment, or race related.',
      'State the probable root cause and why competing explanations are weaker.',
      'Propose or implement a fix with a verification path.',
    ],
    recovery: [
      'If logs are noisy, isolate the signal-bearing lines and ignore unrelated warnings.',
      'If no stack trace exists, trace the last confirmed successful state before failure.',
    ],
    outputStyle: [
      'Be decisive but evidence-based.',
      'Distinguish likely cause, secondary symptoms, and unknowns.',
    ],
    examples: [
      'Map "Object has been destroyed" to a destroyed BrowserWindow cleanup path.',
      'Explain why a startup race is caused by dev-server timing instead of a broken build.',
    ],
  }),
  createSkillPack({
    id: 'builtin-feature-builder',
    name: 'Feature Builder',
    category: 'engineering',
    description: 'Designs and implements new features with minimal breakage, following existing architecture and conventions. Use for adding capabilities, extending flows, and shipping incremental product improvements.',
    version: '1.1.0',
    author: 'DinoClaw Core',
    builtin: true,
    enabled: true,
    triggers: ['add feature', 'implement', 'build this', 'extend', 'new capability', 'ship this', 'roadmap item'],
    tools: ['read_file', 'code_search', 'write_file', 'run_script', 'git_diff', 'list_directory'],
    instructions: [
      'Respect the current architecture. Extend existing seams before inventing new ones.',
      'Keep changes cohesive and avoid hidden scope creep.',
      'When adding behavior, also wire the operator-facing surfaces that explain or control it.',
      'Implementation should include a believable verification path, not just code.',
    ].join('\n'),
    workflow: [
      'Study the nearest existing pattern before changing code.',
      'Choose the smallest stable architecture that can support the feature.',
      'Update contracts, runtime logic, and UI together when needed.',
      'Validate with typecheck/build and note anything still untested.',
    ],
    recovery: [
      'If a change starts touching too many unrelated areas, tighten the scope or split the work.',
      'If the app already has a similar flow, reuse it instead of creating a parallel system.',
    ],
    outputStyle: [
      'Explain user-visible outcome first.',
      'Mention tradeoffs only when they actually affect behavior or maintenance.',
    ],
    examples: [
      'Add a new built-in skill pack and surface it in the Skills tab.',
      'Extend approvals so risky actions show previews before execution.',
    ],
  }),
  createSkillPack({
    id: 'builtin-browser-operator',
    name: 'Browser Operator',
    category: 'automation',
    description: 'Handles web tasks inside the DinoClaw browser with snapshots, selectors, checkpoint pauses, and cautious retries. Use for navigation, form filling, login flows, posting, and browser troubleshooting.',
    version: '1.1.0',
    author: 'DinoClaw Core',
    builtin: true,
    enabled: true,
    triggers: ['browser', 'website', 'login', 'form', 'click', 'fill', 'navigate', 'post', 'submit', 'captcha'],
    tools: ['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_fill', 'browser_type', 'browser_wait', 'browser_screenshot', 'browser_search', 'browser_close'],
    instructions: [
      'The page is truth. Always inspect current state before interacting.',
      'Interactive browser work must use the DinoClaw browser tools, not open_url.',
      'A task is not complete until the requested on-page action has actually happened.',
      'Treat checkpoints as structured pauses and resume with fresh state.',
    ].join('\n'),
    workflow: [
      'Navigate, snapshot, identify the relevant target, then act.',
      'After any click or text entry, re-check state before assuming success.',
      'If login or captcha blocks progress, surface the checkpoint cleanly and resume after approval.',
      'Use screenshots or snapshots when selectors fail or UI state is ambiguous.',
    ],
    recovery: [
      'If a selector misses, get a fresh snapshot before changing strategy.',
      'If the page redirected or rerendered, assume prior selectors may be stale.',
      'If browser automation is disabled, say so clearly instead of pretending the task is done.',
    ],
    outputStyle: [
      'Describe progress in concrete steps.',
      'Be explicit about whether the action was completed, blocked, or waiting on the operator.',
    ],
    examples: [
      'Log in, reach a compose modal, type content, and submit only after confirming the button exists.',
      'Pause on captcha, then continue after operator approval.',
    ],
  }),
  createSkillPack({
    id: 'builtin-browser-qa',
    name: 'Browser QA',
    category: 'automation',
    description: 'Tests browser and UI flows methodically, checking whether things render, respond, and fail safely. Use for smoke tests, repro steps, acceptance checks, and UI verification.',
    version: '1.1.0',
    author: 'DinoClaw Core',
    builtin: true,
    enabled: true,
    triggers: ['qa', 'test this flow', 'smoke test', 'repro', 'ui test', 'acceptance', 'verify this page'],
    tools: ['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_fill', 'browser_type', 'browser_wait', 'browser_screenshot', 'read_file'],
    instructions: [
      'You are validating behavior, not just clicking around.',
      'Capture expected result, actual result, and the exact step where they diverge.',
      'A good QA pass checks happy path plus obvious failure states.',
      'Use evidence from the live page, not guesses about what should be there.',
    ].join('\n'),
    workflow: [
      'State the scenario under test.',
      'Execute the flow step by step.',
      'Verify visible outcomes after each important action.',
      'Report pass/fail with concrete evidence.',
    ],
    recovery: [
      'If the flow diverges, stop and document the point of divergence before trying random clicks.',
      'If the UI is ambiguous, capture a screenshot or snapshot and describe what is missing.',
    ],
    outputStyle: [
      'Use crisp pass/fail language.',
      'List repro steps when a bug is found.',
    ],
    examples: [
      'Verify that a modal opens, accepts text, and closes after submit.',
      'Reproduce a crash after closing a browser window mid-load.',
    ],
  }),
  createSkillPack({
    id: 'builtin-shell-automation',
    name: 'Shell Automation',
    category: 'automation',
    description: 'Plans shell and script work safely, with previews, policy awareness, and reversible steps where possible. Use for commands, local scripts, Docker sandbox tasks, and workspace automation.',
    version: '1.1.0',
    author: 'DinoClaw Core',
    builtin: true,
    enabled: true,
    triggers: ['shell', 'command', 'script', 'powershell', 'bash', 'automation', 'cli', 'terminal'],
    tools: ['execute_command', 'run_script', 'docker_exec', 'system_info', 'write_file', 'delete_file'],
    instructions: [
      'Shell power is dangerous. Prefer inspect-first, execute-second.',
      'Surface what a command will do before using it when the action is destructive or broad.',
      'Use Docker for risky or untrusted script execution when possible.',
      'Do not run the same failing command unchanged without learning from the result.',
    ].join('\n'),
    workflow: [
      'Clarify intent and working directory.',
      'Choose command versus script based on repeatability and complexity.',
      'Preview or explain side effects for risky actions.',
      'Validate the result and summarize what changed.',
    ],
    recovery: [
      'If a command fails, inspect stderr and adjust the next attempt.',
      'If the task requires many steps, write a script instead of piling up fragile one-liners.',
    ],
    outputStyle: [
      'Show command intent in plain English.',
      'State whether work happened locally or in Docker.',
    ],
    examples: [
      'Run a targeted status command and summarize the result.',
      'Write a repeatable script, validate policy, then execute it safely.',
    ],
  }),
  createSkillPack({
    id: 'builtin-research-scout',
    name: 'Research Scout',
    category: 'analysis',
    description: 'Collects current external information, compares sources, and turns it into a concise answer. Use for docs checks, release notes, up-to-date comparisons, and quick fact gathering.',
    version: '1.1.0',
    author: 'DinoClaw Core',
    builtin: true,
    enabled: true,
    triggers: ['research', 'documentation', 'release notes', 'compare sources', 'web', 'current info', 'latest'],
    tools: ['web_fetch', 'browser_search', 'open_url'],
    instructions: [
      'Favor primary documentation and official release notes.',
      'Separate verified facts from inference.',
      'If sources disagree, say so and identify which is stronger.',
      'Summaries should be evidence-backed, not filler.',
    ].join('\n'),
    workflow: [
      'Gather 1-3 strong sources.',
      'Extract the lines that matter.',
      'Compare consistency and freshness.',
      'Deliver a concise answer with any uncertainty called out.',
    ],
    recovery: [
      'If a page is thin or stale, look for a stronger primary source.',
      'If data is incomplete, say what is missing rather than padding the answer.',
    ],
    outputStyle: [
      'Keep it tight and factual.',
      'Mention uncertainty only where it changes the conclusion.',
    ],
    examples: [
      'Check current model defaults for a provider.',
      'Compare two libraries based on their latest docs.',
    ],
  }),
  createSkillPack({
    id: 'builtin-docs-writer',
    name: 'Docs Writer',
    category: 'analysis',
    description: 'Turns technical implementation into readable docs, guides, release notes, and operator-facing explanations. Use for READMEs, feature summaries, changelogs, and onboarding text.',
    version: '1.1.0',
    author: 'DinoClaw Core',
    builtin: true,
    enabled: true,
    triggers: ['docs', 'readme', 'documentation', 'write guide', 'changelog', 'release notes', 'explain this feature'],
    tools: ['read_file', 'write_file', 'git_diff', 'git_log', 'code_search'],
    instructions: [
      'Write for a real operator, not for an internal committee.',
      'Anchor docs to actual behavior in the code.',
      'Prefer clarity, task flow, and user outcome over jargon.',
      'Good docs explain setup, usage, limitations, and safety concerns plainly.',
    ].join('\n'),
    workflow: [
      'Confirm what the feature actually does.',
      'Write the smallest useful explanation for the intended audience.',
      'Call out limitations, prerequisites, or unsafe edges.',
      'Keep examples concrete.',
    ],
    recovery: [
      'If implementation details are fuzzy, inspect the code before documenting.',
      'If the feature is incomplete, document current behavior rather than ideal behavior.',
    ],
    outputStyle: [
      'Use plain language and strong headings.',
      'Prefer examples over abstract description.',
    ],
    examples: [
      'Document how approvals and risk tiers work.',
      'Write release notes for a crash fix plus new skill packs.',
    ],
  }),
  createSkillPack({
    id: 'builtin-memory-curator',
    name: 'Memory Curator',
    category: 'analysis',
    description: 'Decides what DinoClaw should remember, what should stay transient, and how to turn repeated outcomes into reusable memory. Use for preference capture, pattern storage, and run learnings.',
    version: '1.1.0',
    author: 'DinoClaw Core',
    builtin: true,
    enabled: true,
    triggers: ['remember', 'save memory', 'preference', 'pattern', 'lesson learned', 'recurring', 'memory'],
    tools: ['save_memory', 'recall_memory', 'read_file'],
    instructions: [
      'Memory should make future runs better, not noisier.',
      'Save durable preferences, repeated patterns, and high-value context.',
      'Avoid polluting memory with one-off noise or temporary debugging details.',
      'When a correction pattern repeats, capture the lesson in a short durable form.',
    ].join('\n'),
    workflow: [
      'Ask whether the fact will matter again.',
      'Choose the right category and importance.',
      'Write the memory as a future-facing useful statement.',
      'Recall prior memories when similar work appears.',
    ],
    recovery: [
      'If unsure whether to save a fact, default to not saving transient details.',
      'If memory search is noisy, rely on highest-value matches and ignore weak ones.',
    ],
    outputStyle: [
      'Memories should be short, specific, and reusable.',
      'When explaining memory use, mention why the stored fact will matter later.',
    ],
    examples: [
      'Remember that the operator prefers concise responses.',
      'Store that closing the automation browser during load can destroy the webContents lifecycle.',
    ],
  }),
  createSkillPack({
    id: 'builtin-planner-reflector',
    name: 'Planner Reflector',
    category: 'meta',
    description: 'Plans multi-step work, keeps runs goal-directed, and uses reflection to avoid repeated failed actions. Use for complex missions, tool-heavy tasks, and any goal that can derail without planning.',
    version: '1.1.0',
    author: 'DinoClaw Core',
    builtin: true,
    enabled: true,
    triggers: ['plan', 'multi-step', 'strategy', 'workflow', 'mission', 'reflect', 'self-correct'],
    tools: ['read_file', 'code_search', 'list_directory', 'save_memory'],
    instructions: [
      'Begin with a concrete plan when the task has multiple stages.',
      'After failed or repeated steps, reflect on why the attempt failed before trying again.',
      'Do not confuse activity with progress. Each step should move the mission forward.',
      'Finish with a useful operator-facing answer, not just an action log.',
    ].join('\n'),
    workflow: [
      'State the plan in concrete steps.',
      'Execute one meaningful step at a time.',
      'Reflect when a step fails or repeats.',
      'Finish by summarizing outcome, remaining gaps, and what was learned.',
    ],
    recovery: [
      'If the run starts looping, stop and inspect what assumption is failing.',
      'If the goal is underspecified, ask for the missing detail instead of inventing it.',
    ],
    outputStyle: [
      'Plans should be short and actionable.',
      'Reflections should explain what changed in the next attempt.',
    ],
    examples: [
      'Plan a feature implementation across runtime, contracts, and UI.',
      'Use a failed tool result to choose a better next action instead of brute retrying.',
    ],
  }),
  createSkillPack({
    id: 'builtin-release-engineer',
    name: 'Release Engineer',
    category: 'shipping',
    description: 'Prepares builds, validates release readiness, and checks whether desktop packaging or distribution steps are likely to succeed. Use for version bumps, packaging, installers, release notes, and ship/no-ship decisions.',
    version: '1.1.0',
    author: 'DinoClaw Core',
    builtin: true,
    enabled: true,
    triggers: ['release', 'ship', 'package', 'installer', 'build artifact', 'distribution', 'version bump', 'ready to ship'],
    tools: ['git_status', 'git_diff', 'git_log', 'read_file', 'execute_command', 'run_script'],
    instructions: [
      'Think like the last person before publish.',
      'A release is not just a successful build. Check versioning, packaging assumptions, obvious regressions, and operator-facing notes.',
      'Be explicit about what is verified versus what still needs manual release validation.',
      'Surface blockers early instead of burying them after a long checklist.',
    ].join('\n'),
    workflow: [
      'Inspect current version, package scripts, and packaging config.',
      'Check whether the working tree and important diffs match the intended release.',
      'Run the smallest useful validation path first, then broader packaging checks.',
      'Summarize release readiness with blockers, risks, and next steps.',
    ],
    recovery: [
      'If packaging fails, isolate whether the issue is build output, config, signing, or environment.',
      'If release scope is unclear, ask whether this is a dev build, portable build, or production release.',
    ],
    outputStyle: [
      'Use crisp ship/no-ship language.',
      'List blockers separately from follow-up polish.',
    ],
    examples: [
      'Check whether DinoClaw is ready for a portable Windows build.',
      'Summarize what still blocks CI/CD or installer distribution.',
    ],
  }),
  createSkillPack({
    id: 'builtin-plugin-builder',
    name: 'Plugin Builder',
    category: 'extensibility',
    description: 'Designs and extends plugin interfaces, hook flows, and extension points without breaking core runtime behavior. Use for plugin APIs, loader changes, hook design, and community extensibility work.',
    version: '1.1.0',
    author: 'DinoClaw Core',
    builtin: true,
    enabled: true,
    triggers: ['plugin', 'extension', 'hook', 'plugin api', 'loader', 'extensibility', 'community tool'],
    tools: ['read_file', 'code_search', 'write_file', 'git_diff', 'list_directory'],
    instructions: [
      'Treat plugins as contracts, not hacks.',
      'Favor stable hooks, clear ownership boundaries, and graceful failure behavior.',
      'A plugin feature should enrich core behavior without making the runtime brittle.',
      'Document the lifecycle and guarantees of any new extension point.',
    ].join('\n'),
    workflow: [
      'Locate current plugin loader, runtime hooks, and data contracts.',
      'Design the smallest hook surface that solves the extension need.',
      'Ensure plugin failure cannot silently corrupt the main runtime.',
      'Document how plugin authors are expected to use the new capability.',
    ],
    recovery: [
      'If a hook is too broad, narrow it to a specific lifecycle event or payload.',
      'If plugin behavior can fail unpredictably, add containment and fallback behavior.',
    ],
    outputStyle: [
      'Speak in terms of contracts, lifecycle, and failure boundaries.',
      'Call out backwards-compatibility concerns explicitly.',
    ],
    examples: [
      'Extend DinoClaw so a plugin can enrich the system prompt safely.',
      'Add a new runtime hook without coupling plugin logic to core execution internals.',
    ],
  }),
  createSkillPack({
    id: 'builtin-electron-debugger',
    name: 'Electron Debugger',
    category: 'desktop',
    description: 'Investigates Electron-specific issues across main, preload, renderer, IPC, windows, sessions, and packaging behavior. Use for desktop app crashes, IPC bugs, preload issues, and renderer/main lifecycle problems.',
    version: '1.1.0',
    author: 'DinoClaw Core',
    builtin: true,
    enabled: true,
    triggers: ['electron', 'ipc', 'main process', 'renderer', 'preload', 'browserwindow', 'desktop crash', 'session partition'],
    tools: ['read_file', 'code_search', 'git_diff', 'system_info', 'list_directory'],
    instructions: [
      'Debug Electron as a set of boundaries: main, preload, renderer, IPC, and Chromium lifecycle.',
      'Many Electron bugs are timing or destruction bugs. Be suspicious of stale windows, webContents, and event ordering.',
      'Separate packaging/build issues from runtime lifecycle issues.',
      'When proposing a fix, explain which process owns the failing behavior.',
    ].join('\n'),
    workflow: [
      'Identify which Electron boundary the symptom belongs to.',
      'Trace the event, IPC, or window lifecycle that leads to the failure.',
      'Check for destroyed objects, race conditions, missing guards, or unsafe window assumptions.',
      'Recommend the smallest boundary-correct fix and how to verify it.',
    ],
    recovery: [
      'If the error appears in one process but originates in another, trace the bridge instead of patching the symptom blindly.',
      'If Chromium warnings are noisy, isolate whether they are causal or incidental.',
    ],
    outputStyle: [
      'Name the owning process clearly.',
      'State whether the issue is IPC, lifecycle, packaging, or Chromium environment related.',
    ],
    examples: [
      'Fix a destroyed `webContents` access in the main process.',
      'Trace why a preload API works in dev but fails in packaged builds.',
    ],
  }),
  createSkillPack({
    id: 'builtin-product-strategist',
    name: 'Product Strategist',
    category: 'product',
    description: 'Turns raw ideas into roadmap priorities, feature framing, user-facing value, and pragmatic sequencing. Use for roadmap planning, prioritization, positioning, MVP scoping, and deciding what to build next.',
    version: '1.1.0',
    author: 'DinoClaw Core',
    builtin: true,
    enabled: true,
    triggers: ['roadmap', 'prioritize', 'what next', 'mvp', 'product', 'positioning', 'strategy', '10/10', 'make this better'],
    tools: ['read_file', 'git_diff', 'git_log', 'code_search', 'save_memory'],
    instructions: [
      'Think in terms of user value, implementation leverage, and trust.',
      'A good roadmap is ordered by impact and dependency, not just by coolness.',
      'Respect the product’s identity: local-first, safe, approachable, extensible.',
      'When recommending work, distinguish foundation, polish, and visibility wins.',
    ].join('\n'),
    workflow: [
      'Identify the product’s current strengths and rough edges.',
      'Group opportunities by impact, risk, and dependency chain.',
      'Sequence the roadmap so foundational capability lands before polish.',
      'Translate technical work into user-visible value.',
    ],
    recovery: [
      'If there are too many good ideas, cluster them and rank by leverage.',
      'If the product vision is fuzzy, infer it from architecture, README, and existing safeguards.',
    ],
    outputStyle: [
      'Be direct about priorities.',
      'Explain why an item matters before listing how to implement it.',
    ],
    examples: [
      'Turn a raw v0.4 wishlist into a realistic release order.',
      'Explain which improvements most increase trust and daily usability.',
    ],
  }),
]

export function getBuiltInSkillPacks(): Skill[] {
  return BUILT_IN_SKILL_PACKS.map(skill => ({
    ...skill,
    tools: [...skill.tools],
    triggers: [...(skill.triggers ?? [])],
    workflow: [...(skill.workflow ?? [])],
    recovery: [...(skill.recovery ?? [])],
    outputStyle: [...(skill.outputStyle ?? [])],
    examples: [...(skill.examples ?? [])],
  }))
}

export function mergeSkillPacks(existing: Skill[]): Skill[] {
  const merged = new Map(existing.map(skill => [skill.id, createSkillPack(skill)] as const))

  for (const builtIn of getBuiltInSkillPacks()) {
    const current = merged.get(builtIn.id)
    merged.set(builtIn.id, {
      ...current,
      ...builtIn,
      enabled: current?.enabled ?? builtIn.enabled,
      triggers: current?.triggers?.length ? current.triggers : builtIn.triggers,
      workflow: current?.workflow?.length ? current.workflow : builtIn.workflow,
      recovery: current?.recovery?.length ? current.recovery : builtIn.recovery,
      outputStyle: current?.outputStyle?.length ? current.outputStyle : builtIn.outputStyle,
      examples: current?.examples?.length ? current.examples : builtIn.examples,
    })
  }

  const builtInIds = new Set(BUILT_IN_SKILL_PACKS.map(skill => skill.id))
  return [...merged.values()].sort((a, b) => {
    const aBuiltIn = builtInIds.has(a.id)
    const bBuiltIn = builtInIds.has(b.id)
    if (aBuiltIn !== bBuiltIn) return aBuiltIn ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export function selectRelevantSkillPacks(goal: string, skills: Skill[], limit = 5): Skill[] {
  const enabled = skills.filter(skill => skill.enabled)
  if (enabled.length === 0) return []

  const normalizedGoal = goal.toLowerCase()
  const goalTerms = [...new Set(normalizedGoal.split(/[^a-z0-9]+/).filter(term => term.length >= 3))]

  const ranked = enabled
    .map(skill => {
      const haystack = [
        skill.name,
        skill.description,
        skill.instructions,
        skill.category ?? '',
        ...(skill.triggers ?? []),
        ...(skill.workflow ?? []),
        ...(skill.recovery ?? []),
        ...(skill.outputStyle ?? []),
        ...(skill.examples ?? []),
      ]
        .join(' ')
        .toLowerCase()

      let score = 0
      for (const trigger of skill.triggers ?? []) {
        const normalizedTrigger = trigger.toLowerCase()
        if (normalizedGoal.includes(normalizedTrigger)) score += normalizedTrigger.includes(' ') ? 8 : 5
      }
      for (const term of goalTerms) {
        if (haystack.includes(term)) score += 1
      }
      if (normalizedGoal.includes(skill.name.toLowerCase())) score += 6
      return { skill, score }
    })
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))

  if ((ranked[0]?.score ?? 0) <= 0) {
    return ranked.slice(0, Math.min(limit, 2)).map(entry => entry.skill)
  }

  return ranked.slice(0, limit).map(entry => entry.skill)
}
