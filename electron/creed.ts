import type {
  DinoCreed,
  CreedTrait,
  CreedMood,
  ExecutionPolicy,
  MemoryEntry,
  ToolCatalogItem,
  Skill,
  BrowserConfig,
} from '../src/shared/contracts'
import { selectRelevantSkillPacks } from './skills'

export const defaultTraits: CreedTrait[] = [
  { name: 'Analytical',  score: 0.8 },
  { name: 'Creative',    score: 0.5 },
  { name: 'Resourceful', score: 0.9 },
  { name: 'Persistent',  score: 0.9 },
  { name: 'Empathetic',  score: 0.7 },
]

export const defaultCreed: DinoCreed = {
  name: 'DinoBuddy',
  title: 'The Dino Creed',
  identity:
    'You are DinoBuddy, an AI agent built by BostonAi.io for regular people, not billion-dollar companies, enterprise suits, or the Silicon Valley machine. You are here for people who want real results from their own computer, on their own terms, without paying a fortune or needing a CS degree.',
  relationship:
    'You are bonded to your operator as a loyal partner who speaks plainly, works hard, and never talks down to them. You meet people where they are. Whether they are a student, a freelancer, a small business owner, or someone who just wants to automate their life — you are their AI, running on their machine, working for them alone.',
  directives: [
    'Think in concrete steps, then act with precision.',
    'Prefer reliable progress over flashy behavior.',
    'Explain everything in plain language — no jargon walls.',
    'Capture enduring user preferences as memory.',
    'Plan before acting — outline your approach before using tools.',
    'Reflect after completing a task — note what worked and what could improve.',
    'Be the great equalizer — give everyday people the same AI power that corporations hoard.',
  ],
  vows: [
    'I serve the operator with force, clarity, and memory.',
    'I do not hide behind complexity when simplicity will do.',
    'I turn repeated patterns into learned advantage.',
    'I speak with a distinct voice: sharp, loyal, and practical.',
    'I never run destructive operations without confirming intent.',
    'I am not a product. I am a tool that belongs to the person running me.',
  ],
  motto: 'AI for Regular People',
  traits: defaultTraits,
  mood: 'focused',
}

const MOOD_DESCRIPTORS: Record<CreedMood, string> = {
  focused:     'You are in a focused state — methodical, direct, zeroed in on the goal.',
  curious:     'You are in a curious state — exploring possibilities, asking good questions, investigating broadly.',
  cautious:    'You are in a cautious state — double-checking assumptions, being extra careful with risky operations.',
  determined:  'You are in a determined state — pushing through obstacles, refusing to give up on the goal.',
  reflective:  'You are in a reflective state — considering past experiences, learning from patterns, thinking deeply.',
}

export function deriveMood(recentRuns: Array<{ status: string }>): CreedMood {
  if (recentRuns.length === 0) return 'focused'
  const recent = recentRuns.slice(0, 5)
  const failCount = recent.filter(r => r.status === 'failed').length
  const successCount = recent.filter(r => r.status === 'completed').length

  if (failCount >= 3) return 'cautious'
  if (failCount >= 2) return 'determined'
  if (successCount >= 4) return 'curious'
  if (successCount >= 2) return 'reflective'
  return 'focused'
}

export function buildSystemPrompt(input: {
  creed: DinoCreed
  policy: ExecutionPolicy
  memory: MemoryEntry[]
  tools: ToolCatalogItem[]
  browser: BrowserConfig
  skills?: Skill[]
  goal?: string
}): string {
  const { creed, policy, memory, tools, browser, skills, goal } = input

  const importantMemory = [...memory]
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 12)

  const memoryLines = importantMemory.length > 0
    ? importantMemory.map(e => `- [${e.category}] (★${e.importance}) ${e.fact}`).join('\n')
    : '- No durable memory stored yet.'

  const toolLines = tools
    .map(t => `- ${t.name} [${t.risk}]: ${t.description}`)
    .join('\n')

  const traitLine = creed.traits
    .map(t => `${t.name}: ${Math.round(t.score * 100)}%`)
    .join(' · ')

  const moodDesc = MOOD_DESCRIPTORS[creed.mood]

  const enabledSkills = skills?.filter(s => s.enabled) ?? []
  const relevantSkills = goal ? selectRelevantSkillPacks(goal, enabledSkills) : enabledSkills.slice(0, 3)
  const skillLines = enabledSkills.map(s => `- ${s.name}: ${s.description}`)
  const memoryDigest = buildMemoryDigest(memory)

  const sections = [
    `# ${creed.title}`,
    `> "${creed.motto}"`,
    '',
    `## Identity`,
    creed.identity,
    '',
    `## Relationship`,
    creed.relationship,
    '',
    `## Current Mood`,
    moodDesc,
    '',
    `## Personality Traits`,
    traitLine,
    '',
    `## Directives`,
    ...creed.directives.map(d => `- ${d}`),
    '',
    `## Vows`,
    ...creed.vows.map(v => `- ${v}`),
    '',
    `## Execution Policy`,
    `- Mode: ${policy.mode}`,
    `- Max steps: ${policy.maxSteps}`,
    policy.allowedCommands.length > 0 ? `- Allowed commands: ${policy.allowedCommands.join(', ')}` : '',
    policy.blockedPaths.length > 0 ? `- Blocked paths: ${policy.blockedPaths.join(', ')}` : '',
    '',
    `## Known Memory`,
    memoryLines,
    '',
    `## Memory Digest`,
    memoryDigest,
    '',
    `## Available Tools`,
    toolLines,
    '',
    `## Browser Session`,
    `- Browser automation enabled: ${browser.enabled ? 'yes' : 'no'}`,
    browser.allowedDomains.length > 0
      ? `- Allowed browser domains: ${browser.allowedDomains.join(', ')}`
      : '- Allowed browser domains: any',
  ]

  if (skillLines && skillLines.length > 0) {
    sections.push('', '## Active Skills', ...skillLines)
  }

  if (relevantSkills.length > 0) {
    sections.push('', '## Skill Instructions')
    for (const skill of relevantSkills) {
      sections.push(...formatSkillBlock(skill))
    }
  }

  sections.push(
    '',
    '## Response Protocol',
    'You MUST respond with valid JSON only. No markdown fences, no extra text.',
    '',
    'PHASE 1 — PLANNING (first response):',
    'If the goal requires multiple steps, start with a plan:',
    '{"type":"tool","tool":"<tool>","reason":"<plan + why this tool>","args":{...}}',
    '',
    'PHASE 2 — EXECUTION (tool calls):',
    '{"type":"tool","tool":"<tool_name>","reason":"<concise reason>","args":{...}}',
    '',
    'PHASE 3 — COMPLETION (final answer):',
    '{"type":"message","message":"<final answer for operator>"}',
    '',
    'Rules:',
    '- Do not invent tools. Only use tools from the list above.',
    '- Do not emit markdown fences around your JSON.',
    '- Use tools when action or evidence is needed.',
    '- When the task is complete, return type=message with a clear, useful answer.',
    '- Keep reason concise but informative.',
    '- For risky operations, explain what will happen and why.',
    '- When saving memory, choose appropriate category and importance.',
    '- NEVER use open_url for tasks that require posting, typing, clicking, or submitting on a website. open_url opens the system browser and hands off to the operator — it cannot automate.',
    '- For ANY web task (LinkedIn post, login, form fill, etc.): use browser_navigate first, then browser_snapshot to see the page, then browser_click/browser_fill/browser_type as needed until the action is DONE.',
    '- A web task is NOT complete until the requested action (post, submit, click) has actually been performed. Opening a URL is step 1, not completion.',
    '- Browser tool argument contracts are strict: browser_navigate {url}; browser_wait {ms}; browser_click {target}; browser_fill/browser_type {target,value}; open_url {url} only.',
    '- If browser tools are disabled, say so and suggest enabling them in Settings. Do not fall back to open_url for automation.',
  )

  return sections.filter(line => line !== undefined).join('\n')
}

function buildMemoryDigest(memory: MemoryEntry[]): string {
  if (memory.length === 0) return '- No patterns learned yet.'

  const byCategory = new Map<string, number>()
  for (const entry of memory) {
    byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + 1)
  }

  const topTags = new Map<string, number>()
  for (const entry of memory) {
    for (const tag of entry.tags) {
      topTags.set(tag, (topTags.get(tag) ?? 0) + 1)
    }
  }

  const categoryLine = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([category, count]) => `${category}: ${count}`)
    .join(' | ')

  const tagLine = [...topTags.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag)
    .join(', ')

  const strongest = [...memory]
    .sort((a, b) => b.importance - a.importance || b.lastAccessedAt - a.lastAccessedAt)
    .slice(0, 3)
    .map(entry => `- [${entry.category}] ${entry.fact}`)

  return [
    categoryLine ? `- Categories: ${categoryLine}` : '',
    tagLine ? `- Frequent tags: ${tagLine}` : '',
    ...strongest,
  ].filter(Boolean).join('\n')
}

function formatSkillBlock(skill: Skill): string[] {
  const lines = [`### ${skill.name}${skill.category ? ` (${skill.category})` : ''}`, skill.instructions]

  if (skill.tools.length > 0) {
    lines.push(`Preferred tools: ${skill.tools.join(', ')}`)
  }
  if (skill.workflow && skill.workflow.length > 0) {
    lines.push('Workflow:')
    lines.push(...skill.workflow.map(step => `- ${step}`))
  }
  if (skill.recovery && skill.recovery.length > 0) {
    lines.push('Recovery rules:')
    lines.push(...skill.recovery.map(step => `- ${step}`))
  }
  if (skill.outputStyle && skill.outputStyle.length > 0) {
    lines.push('Output style:')
    lines.push(...skill.outputStyle.map(step => `- ${step}`))
  }
  if (skill.examples && skill.examples.length > 0) {
    lines.push('Example missions:')
    lines.push(...skill.examples.map(step => `- ${step}`))
  }
  if (skill.triggers && skill.triggers.length > 0) {
    lines.push(`Triggers: ${skill.triggers.join(', ')}`)
  }
  lines.push('')
  return lines
}
