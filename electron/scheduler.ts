import { randomUUID } from 'node:crypto'
import type { DinoRuntime } from './runtime'

export interface CronJob {
  id: string
  name: string
  schedule: string
  goal: string
  enabled: boolean
  lastRun?: number
  nextRun?: number
}

interface ParsedSchedule {
  type: 'interval' | 'daily'
  intervalMs?: number
  hour?: number
  minute?: number
}

export class Scheduler {
  private runtime: DinoRuntime
  private readonly onJobsChanged?: (jobs: CronJob[]) => void
  private jobs: CronJob[] = []
  private timers = new Map<string, ReturnType<typeof setInterval>>()
  private running = false

  constructor(runtime: DinoRuntime, onJobsChanged?: (jobs: CronJob[]) => void) {
    this.runtime = runtime
    this.onJobsChanged = onJobsChanged
  }

  start(): void {
    this.running = true
    this.stopAllTimers()
    for (const job of this.jobs) {
      if (job.enabled) this.scheduleJob(job)
    }
    this.notifyChanged()
  }

  stop(): void {
    this.running = false
    this.stopAllTimers()
    this.notifyChanged()
  }

  addJob(name: string, schedule: string, goal: string): CronJob {
    const job: CronJob = {
      id: randomUUID(),
      name,
      schedule,
      goal,
      enabled: true,
    }
    this.jobs.push(job)
    if (this.running) this.scheduleJob(job)
    this.notifyChanged()
    return job
  }

  removeJob(id: string): void {
    const timer = this.timers.get(id)
    if (timer) {
      clearInterval(timer)
      this.timers.delete(id)
    }
    this.jobs = this.jobs.filter(j => j.id !== id)
    this.notifyChanged()
  }

  pauseJob(id: string): void {
    const job = this.jobs.find(j => j.id === id)
    if (!job) return
    job.enabled = false
    const timer = this.timers.get(id)
    if (timer) {
      clearInterval(timer)
      this.timers.delete(id)
    }
    this.notifyChanged()
  }

  resumeJob(id: string): void {
    const job = this.jobs.find(j => j.id === id)
    if (!job) return
    job.enabled = true
    if (this.running) this.scheduleJob(job)
    this.notifyChanged()
  }

  getJobs(): CronJob[] {
    return [...this.jobs]
  }

  isRunning(): boolean {
    return this.running
  }

  loadJobs(jobs: CronJob[]): void {
    this.stopAllTimers()
    this.jobs = jobs.map(job => ({ ...job }))
    if (this.running) {
      for (const job of this.jobs) {
        if (job.enabled) this.scheduleJob(job)
      }
    }
    this.notifyChanged()
  }

  private scheduleJob(job: CronJob): void {
    const existing = this.timers.get(job.id)
    if (existing) {
      clearInterval(existing)
      this.timers.delete(job.id)
    }

    const parsed = this.parseSchedule(job.schedule)
    if (!parsed) {
      this.notifyChanged()
      return
    }

    if (parsed.type === 'interval' && parsed.intervalMs) {
      const timer = setInterval(() => {
        void this.executeJob(job)
      }, parsed.intervalMs)
      this.timers.set(job.id, timer)
      job.nextRun = Date.now() + parsed.intervalMs
    } else if (parsed.type === 'daily') {
      const checkInterval = setInterval(() => {
        const now = new Date()
        if (now.getHours() === parsed.hour && now.getMinutes() === parsed.minute) {
          if (!job.lastRun || Date.now() - job.lastRun > 60_000) {
            void this.executeJob(job)
          }
        }
      }, 30_000)
      this.timers.set(job.id, checkInterval)
    }
    this.notifyChanged()
  }

  private async executeJob(job: CronJob): Promise<void> {
    job.lastRun = Date.now()
    this.notifyChanged()
    try {
      await this.runtime.runGoal({ goal: job.goal, context: `Scheduled task: ${job.name}` })
    } catch {
      // Scheduled job failures are logged via runtime
    }
  }

  private stopAllTimers(): void {
    for (const [id, timer] of this.timers) {
      clearInterval(timer)
      this.timers.delete(id)
    }
  }

  private notifyChanged(): void {
    this.onJobsChanged?.(this.getJobs())
  }

  private parseSchedule(schedule: string): ParsedSchedule | null {
    const everyMatch = schedule.match(/^every\s+(\d+)\s*(m|min|minutes?|h|hours?|s|seconds?)$/i)
    if (everyMatch) {
      const value = parseInt(everyMatch[1])
      const unit = everyMatch[2].toLowerCase()
      let ms = value * 1000
      if (unit.startsWith('m')) ms = value * 60_000
      if (unit.startsWith('h')) ms = value * 3_600_000
      return { type: 'interval', intervalMs: Math.max(ms, 10_000) }
    }

    const dailyMatch = schedule.match(/^daily\s+at\s+(\d{1,2}):(\d{2})$/i)
    if (dailyMatch) {
      return {
        type: 'daily',
        hour: parseInt(dailyMatch[1]),
        minute: parseInt(dailyMatch[2]),
      }
    }

    const intervalMatch = schedule.match(/^(\d+)(ms|s|m|h)$/)
    if (intervalMatch) {
      const val = parseInt(intervalMatch[1])
      const unit = intervalMatch[2]
      const multiplier = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit] ?? 1000
      return { type: 'interval', intervalMs: Math.max(val * multiplier, 10_000) }
    }

    return null
  }
}
