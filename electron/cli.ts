#!/usr/bin/env node

import path from 'node:path'
import os from 'node:os'
import { createStorage } from './storage'
import { buildSystemPrompt, deriveMood } from './creed'
import { callModel } from './provider'
import { executeTool, getToolRisk, toolCatalog } from './tools'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type {
  GoalRequest,
  MemoryCategory,
  MemoryEntry,
  RunRecord,
  ToolName,
} from '../src/shared/contracts'

const ALL_TOOL_NAMES = toolCatalog.map(t => t.name) as [string, ...string[]]

const decisionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('tool'),
    tool: z.enum(ALL_TOOL_NAMES),
    reason: z.string().min(1),
    args: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal('message'),
    message: z.string().min(1),
  }),
])

type Decision = z.infer<typeof decisionSchema>

const dataDir = path.join(os.homedir(), '.dinoclaw')
const storage = createStorage(dataDir)

function log(prefix: string, msg: string): void {
  const color = {
    '  PLAN': '\x1b[36m',
    '  TOOL': '\x1b[33m',
    'RESULT': '\x1b[32m',
    ' ERROR': '\x1b[31m',
    '  DONE': '\x1b[35m',
    '  INFO': '\x1b[90m',
  }[prefix] ?? '\x1b[0m'
  console.log(`${color}[${prefix}]\x1b[0m ${msg}`)
}

async function runCli(): Promise<void> {
  const args = process.argv.slice(2)
  const mFlag = args.indexOf('-m')
  const messageFlag = args.indexOf('--message')
  const interactiveFlag = args.includes('--interactive') || args.includes('-i')
  const statusFlag = args.includes('status')
  const helpFlag = args.includes('--help') || args.includes('-h')

  if (helpFlag || args.length === 0) {
    console.log(`
\x1b[32mDinoClaw CLI\x1b[0m — Headless AI Agent

Usage:
  dinoclaw agent -m "your goal"     Run a single goal
  dinoclaw agent -i                 Interactive mode
  dinoclaw status                   Show runtime status

Options:
  -m, --message <goal>    Goal to execute
  -i, --interactive       Interactive REPL mode
  --help, -h              Show this help
`)
    return
  }

  if (statusFlag) {
    const state = storage.load()
    const runs = state.runs
    const completed = runs.filter(r => r.status === 'completed')
    console.log(`
\x1b[32mDinoClaw Status\x1b[0m
  Runs:        ${runs.length}
  Success:     ${runs.length > 0 ? Math.round((completed.length / runs.length) * 100) : 0}%
  Memory:      ${state.memory.length} entries
  Mood:        ${state.creed.mood}
  Provider:    ${state.model.provider}
  Model:       ${state.model.model}
  Policy:      ${state.policy.mode}
  Data dir:    ${dataDir}
`)
    return
  }

  let goalText = ''
  if (mFlag >= 0 && args[mFlag + 1]) goalText = args[mFlag + 1]
  if (messageFlag >= 0 && args[messageFlag + 1]) goalText = args[messageFlag + 1]

  if (interactiveFlag) {
    await interactiveMode()
    return
  }

  if (!goalText) {
    console.error('No goal provided. Use -m "your goal" or -i for interactive mode.')
    process.exit(1)
  }

  await executeGoal({ goal: goalText })
}

async function interactiveMode(): Promise<void> {
  const readline = await import('node:readline')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  console.log('\x1b[32mDinoClaw Interactive Mode\x1b[0m — Type a goal or "exit" to quit.\n')

  const prompt = (): void => {
    rl.question('\x1b[36mdinoclaw>\x1b[0m ', async (input) => {
      const trimmed = input.trim()
      if (trimmed === 'exit' || trimmed === 'quit') {
        rl.close()
        return
      }
      if (trimmed === 'status') {
        const state = storage.load()
        log('  INFO', `Runs: ${state.runs.length} | Memory: ${state.memory.length} | Mood: ${state.creed.mood}`)
        prompt()
        return
      }
      if (trimmed) {
        await executeGoal({ goal: trimmed })
      }
      prompt()
    })
  }

  prompt()
}

async function executeGoal(request: GoalRequest): Promise<void> {
  const state = storage.load()
  const goal = request.goal.trim()

  log('  INFO', `Goal: ${goal}`)
  log('  INFO', `Provider: ${state.model.provider} / ${state.model.model}`)

  const run: RunRecord = {
    id: randomUUID(),
    goal,
    status: 'running',
    startedAt: Date.now(),
    steps: [],
    toolsUsed: [],
  }

  state.runs.push(run)

  try {
    const systemPrompt = buildSystemPrompt({
      creed: state.creed,
      policy: state.policy,
      memory: state.memory,
      tools: toolCatalog,
      skills: state.skills,
    })

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: goal },
    ]

    for (let stepIndex = 0; stepIndex < state.policy.maxSteps; stepIndex++) {
      const rawDecision = await callModel(state.model, messages)
      const decision = parseDecision(rawDecision)

      if (decision.type === 'message') {
        log('  DONE', decision.message)
        run.finalMessage = decision.message
        run.status = 'completed'
        run.finishedAt = Date.now()
        state.creed.mood = deriveMood(state.runs.slice(-5))
        storage.save(state)
        return
      }

      const toolName = decision.tool as ToolName
      log('  PLAN', decision.reason)
      log('  TOOL', `${toolName}(${JSON.stringify(decision.args)})`)

      const risk = getToolRisk(toolName)
      if (state.policy.mode === 'lockdown' || (state.policy.mode === 'review-risky' && risk === 'risky')) {
        log('  INFO', `Tool ${toolName} requires approval (risk: ${risk}). Auto-approving in CLI mode.`)
      }

      const result = await executeTool(toolName, decision.args, {
        workspaceRoot: process.cwd(),
        memory: state.memory,
        saveMemory: (fact: string, category?: MemoryCategory, importance?: number, tags?: string[]) => {
          const entry: MemoryEntry = {
            id: randomUUID(),
            fact,
            category: category ?? 'fact',
            importance: Math.min(5, Math.max(1, importance ?? 3)),
            tags: tags ?? [],
            createdAt: Date.now(),
            accessCount: 0,
            lastAccessedAt: Date.now(),
          }
          state.memory.push(entry)
          return entry
        },
      })

      if (!run.toolsUsed.includes(toolName)) run.toolsUsed.push(toolName)
      log('RESULT', result.slice(0, 500))

      messages.push(
        { role: 'assistant', content: JSON.stringify(decision) },
        { role: 'user', content: `TOOL RESULT (${toolName}):\n${result}` },
      )

      storage.save(state)
    }

    log(' ERROR', `Max steps reached (${state.policy.maxSteps})`)
    run.status = 'failed'
    run.error = 'Max steps reached'
    run.finishedAt = Date.now()
    storage.save(state)
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    log(' ERROR', msg)
    run.status = 'failed'
    run.error = msg
    run.finishedAt = Date.now()
    storage.save(state)
  }
}

function parseDecision(raw: string): Decision {
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error(`No JSON found in response: ${cleaned.slice(0, 200)}`)
  return decisionSchema.parse(JSON.parse(jsonMatch[0]))
}

void runCli()
