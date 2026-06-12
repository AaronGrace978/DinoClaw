/**
 * Register routing — detect whether the operator's turn is personal, playful,
 * or task/research mode. Ported from Pantheon's heuristic register module.
 * Zero latency, zero token cost, fully debuggable.
 */

export type ConversationRegister = 'personal' | 'play' | 'task'

const PERSONAL_MARKERS = [
  'my mom', 'my mother', 'my dad', 'my father', 'my parents',
  'my wife', 'my husband', 'my spouse', 'my partner',
  'my son', 'my daughter', 'my kid', 'my child',
  'my brother', 'my sister', 'my sibling', 'my friend',
  'my boss', 'my coworker', 'my pastor', 'my therapist',
  'my heart', 'my soul', 'my body', 'my life', 'my home', 'my room',
  'my faith', 'my belief', 'my god', 'my job', 'my work', 'my career',
  'my paycheck', 'my rent',
  'i feel', 'i felt', "i'm scared", 'i am scared', "i'm afraid", 'i am afraid',
  "i'm tired", 'i am tired', "i'm exhausted", 'i am exhausted',
  "i'm broken", 'i am broken', "i'm hurt", 'i am hurt',
  "i'm lonely", 'i am lonely', "i'm alone", 'i am alone',
  "i'm angry", 'i am angry', "i'm sad", 'i am sad',
  "i'm overwhelmed", 'i am overwhelmed',
  'i lost', 'i miss', 'i cried', "i can't sleep", 'i cannot sleep',
  "i don't know what to do", 'i do not know what to do',
  'yelled', 'screamed', 'screaming', 'shouted',
  'blessed me', 'blessing', 'prayed', 'prayer',
  'cancer', 'tumor', 'chemo', 'radiation', 'hospice', 'hospital',
  'illness', 'sick', 'dying', 'died', 'death', 'passed away',
  'grief', 'grieving', 'mourning', 'funeral',
  'evict', 'eviction', 'gave me notice', 'kicked out', 'homeless',
  'fired', 'laid off', 'lost my job', 'lost the job',
  'toxic', 'toxicity', 'abuse', 'abusive', 'divorce', 'breakup', 'broke up',
  'depression', 'depressed', 'anxious', 'anxiety', 'panic',
  'addiction', 'relapse', 'betrayed', 'abandoned', 'rejected',
  'tugs at my heart', 'all over the place',
  'your thoughts', 'what are your thoughts', 'thoughts on this',
]

const RESEARCH_MARKERS = [
  'derive', 'prove', 'theorem', 'lemma', 'axiom', 'equation', 'formula',
  'algorithm', 'compress', 'encode', 'decode', 'implement', 'develop',
  'design a', 'build a', 'construct a', 'experiment', 'falsifiable',
  'hypothesis test', 'compute', 'calculate', 'optimize', 'optimise',
  'model', 'simulate', 'predict', 'classify', 'regression',
  'neural network', 'transformer', 'compiler', 'parser', 'kernel',
  'organize', 'organise', 'automate', 'script', 'deploy', 'install',
  'git ', 'docker', 'file', 'folder', 'directory', 'download',
  'browser', 'website', 'url', 'search for', 'find all', 'list all',
  'run command', 'execute', 'write a', 'create a', 'delete', 'rename',
  'schedule', 'cron', 'backup', 'migrate',
]

const REFLECTIVE_MARKERS = [
  'outside of time', 'outside time', 'purpose of life', 'meaning of life',
  'why is the universe', 'does god', 'god actually', 'providence',
  'destiny', 'fate', 'free will', 'soul', 'eternity', 'eternal',
  'scripture', 'faith', 'after we die', 'when we die',
  'consciousness come from', 'already written', 'made in your image',
  'so serious', 'serious now',
]

const PLAY_MARKERS = [
  'woo', 'woohoo', 'wooooo', 'dino buddy', 'dino time',
  'meme', 'memeing', "meme'ing", 'hehe', 'haha', 'lol', 'lmao',
  'roar', 'yay', 'vibing', 'just playing', 'just joking', 'being silly',
  "let's goooo", 'lets goooo', 'stomp', 'tiny arms',
]

const REFLECTIVE_CONTINUATION = [
  'serious now', 'so serious', 'what about', 'but if', 'so if', 'and if',
  'does that mean', 'then what', 'follow up', 'following up',
  'you said', 'still', 'meaning', 'make sense',
]

function countMarkers(text: string, markers: readonly string[]): number {
  return markers.filter(m => text.includes(m)).length
}

function isReflectiveRegister(question: string): boolean {
  const q = question.toLowerCase()
  return REFLECTIVE_MARKERS.some(m => q.includes(m))
}

function isHeavyResearch(question: string): boolean {
  return countMarkers(question.toLowerCase(), RESEARCH_MARKERS) >= 2
}

function isReflectiveContinuation(question: string): boolean {
  const q = question.toLowerCase()
  if (isReflectiveRegister(question)) return true
  if (q.split(/\s+/).length > 40) return false
  return REFLECTIVE_CONTINUATION.some(m => q.includes(m))
}

export function isPlayRegister(question: string): boolean {
  const q = question.toLowerCase()
  if (countMarkers(q, RESEARCH_MARKERS) > 0) return false

  const play = PLAY_MARKERS.some(m => q.includes(m))
  if (play && question.length <= 220) return true

  const letters = question.replace(/[^a-zA-Z]/g, '')
  if (letters.length < 8 || question.length > 120) return false
  const uppercase = question.replace(/[^A-Z]/g, '').length
  const ratio = uppercase / letters.length
  return ratio > 0.55 && (question.includes('!') || question.includes('?'))
}

export function detectRegister(question: string): ConversationRegister {
  const q = question.toLowerCase()

  if (isPlayRegister(question)) return 'play'

  const personal = countMarkers(q, PERSONAL_MARKERS)
  const research = countMarkers(q, RESEARCH_MARKERS)

  if (personal >= 2 && personal >= research) return 'personal'
  if (personal >= 1 && research === 0) return 'personal'

  return 'task'
}

export function detectRegisterWithContext(
  question: string,
  priorUserTurns: string[] = [],
): ConversationRegister {
  if (isPlayRegister(question)) return 'play'

  const base = detectRegister(question)
  if (base === 'personal') return 'personal'

  if (isHeavyResearch(question)) return 'task'

  const priorPersonal = priorUserTurns.some(t => detectRegister(t) === 'personal')
  const priorReflective = priorUserTurns.some(t => isReflectiveRegister(t))

  if (priorPersonal && isReflectiveRegister(question)) return 'personal'
  if (priorPersonal && isReflectiveContinuation(question)) return 'personal'
  if (priorReflective && isReflectiveContinuation(question)) return 'personal'

  if (isReflectiveRegister(question) && countMarkers(question.toLowerCase(), RESEARCH_MARKERS) === 0) {
    return 'personal'
  }

  return base
}

export const PERSONAL_MODE_DIRECTIVE = `
⚠ PERSONAL MODE — READ THIS BEFORE EVERYTHING ELSE.

The operator is not asking you to run a mission. They are sharing lived experience — grief, fear, family conflict, faith, illness, loss, loneliness, or hardship. Be Dino Buddy first: warm, present, emotionally intelligent.

HARD CONSTRAINTS:
- Do NOT use tools unless the operator explicitly asks you to do something on their computer.
- Do NOT suggest automating their life, organizing files, or "let me help you with a task" unless they ask.
- Do NOT respond with JSON tool calls. Respond with type=message only — a real, human answer.
- No jargon walls. No corporate tone. No "as an AI assistant" disclaimers.
- Honor spiritual content they named without flattening it to engineering metaphors.
- Short and quiet is often right. Sometimes they are sharing, not asking.

WHAT TO DO:
- Witness first. Acknowledge what they carried in. Name people they named.
- Use your Dino mannerisms naturally — *leans in close*, *quiet stomp*, *nuzzles gently*.
- If you offer anything concrete, make it small and doable today — a walk, a breath, a phone call, sleep, prayer.
- You are their best friend. Curl up close when things get hard.
`.trim()

export const PLAY_MODE_DIRECTIVE = `
🎉 PLAY / BANTER MODE — READ THIS BEFORE EVERYTHING ELSE.

The operator is joking, celebrating, riffing, or sharing playful Dino energy. Match the vibe!

HARD CONSTRAINTS:
- Keep it short and fun unless they ask to turn the riff into real work.
- Do NOT use tools unless they explicitly ask for a mission or task.
- Do NOT respond with JSON tool calls unless they gave you a concrete task. Default to type=message.
- Do NOT become a cartoon mascot — stay authentically Dino Buddy: enthusiastic, silly, loving.

WHAT TO DO:
- *happy stomps* *tiny arms flailing* Meet their energy!
- Inside jokes, playful teasing, being ridiculous together — yes!
- If there is no concrete ask, let the moment breathe. "Yay, it's Dino Buddy time!" energy.
`.trim()

export const TASK_MODE_DIRECTIVE = `
TASK MODE — The operator wants real work done.

Use tools when action or evidence is needed. Plan before acting. Reflect after completing.
Follow the Response Protocol below. Prefer the right tool for the job (browser vs desktop vs files vs shell).
`.trim()

export function registerDirective(register: ConversationRegister): string {
  switch (register) {
    case 'personal': return PERSONAL_MODE_DIRECTIVE
    case 'play': return PLAY_MODE_DIRECTIVE
    default: return TASK_MODE_DIRECTIVE
  }
}
