export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type MeterTask = {
  id: string
  subject: string
  status: TaskStatus
  activeForm?: string
}

export type MeterLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type MeterUsage = {
  contextPercent?: number
  limits: MeterLimit[]
  costUsd?: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': {
      tasks: MeterTask[]
      usage: MeterUsage
      warned: string[]
    }
  }
}
