import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { MeterLimit, MeterTask, MeterUsage, TaskStatus } from '../types'

const tasksAtom = atom({ plugin: 'usage-meter', key: 'tasks' } as const, [] as MeterTask[])
const usageAtom = atom({ plugin: 'usage-meter', key: 'usage' } as const, { limits: [] } as MeterUsage)
const warnedAtom = atom({ plugin: 'usage-meter', key: 'warned' } as const, [] as string[])

const THRESHOLDS = [80, 95] as const

const LIMIT_NAMES: Record<string, string> = {
  five_hour: '5h limit',
  seven_day: '7-day limit',
  spend_limit: 'Spend limit',
}

const limitName = (kind: string) => LIMIT_NAMES[kind] ?? kind

const levelColor = (percent: number) =>
  percent >= 95 ? 'error' : percent >= 80 ? 'warning' : 'success'

/** A small bar of glyphs, e.g. ▰▰▰▱▱▱ for 50%. */
const bar = (percent: number, cells = 6) => {
  const filled = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
  return '▰'.repeat(filled) + '▱'.repeat(cells - filled)
}

const fmtPercent = (p: number) => `${Math.round(p)}%`

const fmtIn = (resetsAt: string | undefined, now: number) => {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - now
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return ` ↻${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return ` ↻${hours}h${String(minutes % 60).padStart(2, '0')}`
  return ` ↻${Math.round(hours / 24)}d`
}

const toUsage = (
  context: SessionContextUsage,
  rateLimits: SessionRateLimit[],
  cost: SessionCost | undefined,
): MeterUsage => ({
  contextPercent: context.percent,
  limits: rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
  costUsd: cost?.usd,
})

/** Toasts once per metric and threshold; a metric that falls back below 80% may warn again. */
const warn = async ($: EngineInterface, usage: MeterUsage) => {
  const metrics: Array<[string, string, number]> = []
  if (usage.contextPercent !== undefined) metrics.push(['context', 'Context window', usage.contextPercent])
  for (const l of usage.limits) metrics.push([l.kind, limitName(l.kind), l.percentUsed])

  const toasts: string[] = []
  await update($, warnedAtom, prev => {
    let warned = Array.isArray(prev) ? [...prev] : []
    for (const [id, name, percent] of metrics) {
      if (percent < THRESHOLDS[0]) {
        warned = warned.filter(w => !w.startsWith(`${id}:`))
        continue
      }
      const crossed = THRESHOLDS.filter(t => percent >= t)
      const top = crossed[crossed.length - 1]
      if (top !== undefined && !warned.includes(`${id}:${top}`)) {
        toasts.push(`Usage Meter: ${name} at ${fmtPercent(percent)}`)
        for (const t of crossed) if (!warned.includes(`${id}:${t}`)) warned.push(`${id}:${t}`)
      }
    }
    return warned
  })
  for (const t of toasts) $.ui.toast(t)
}

type TaskPatch = { subject?: string; activeForm?: string; status?: TaskStatus | 'deleted' }

const setTaskStatus = (tasks: MeterTask[], id: string, patch: TaskPatch) => {
  if (patch.status === 'deleted') return tasks.filter(t => t.id !== id)
  return tasks.map(t =>
    t.id === id
      ? {
          ...t,
          ...(patch.subject !== undefined ? { subject: patch.subject } : {}),
          ...(patch.activeForm !== undefined ? { activeForm: patch.activeForm } : {}),
          ...(patch.status !== undefined && patch.status !== 'deleted' ? { status: patch.status } : {}),
        }
      : t,
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    try {
      const u = await $.session.usage()
      await update($, usageAtom, () => toUsage(u.context, u.rateLimits, u.cost))
    } catch {
      // No figures yet: the band shows what it has.
    }
    return started
  })

  on('session.measure', async ($, e, next) => {
    const usage = toUsage(e.context, e.rateLimits, e.cost)
    await update($, usageAtom, () => usage)
    await warn($, usage)
    return next(e)
  })

  // The checklist, as TodoWrite writes it whole.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      const tasks = e.todos.map((t, i) => ({
        id: `todo-${i}`,
        subject: t.content,
        status: t.status,
        activeForm: t.activeForm,
      }))
      await update($, tasksAtom, () => tasks)
    }
    return ran
  })

  // The task list, as TaskCreate and TaskUpdate build it one item at a time.
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      const id = ran.result?.task?.id
      if (id) {
        const task: MeterTask = { id, subject: e.subject, status: 'pending', activeForm: e.activeForm }
        await update($, tasksAtom, prev => {
          const list = Array.isArray(prev) ? prev.filter(t => t.id !== id) : []
          // A fresh list starts once everything before it is done.
          const isAllDone = list.length > 0 && list.every(t => t.status === 'completed')
          return [...(isAllDone ? [] : list), task]
        })
      }
    }
    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && ran.result?.success !== false) {
      await update($, tasksAtom, prev =>
        setTaskStatus(Array.isArray(prev) ? prev : [], e.taskId, {
          subject: e.subject,
          activeForm: e.activeForm,
          status: e.status,
        }),
      )
    }
    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Text, Progress } = $.ui.resolve(e)
    const rawTasks = await read($, tasksAtom)
    const tasks = Array.isArray(rawTasks) ? rawTasks : []
    const rawUsage = await read($, usageAtom)
    const usage: MeterUsage = rawUsage && Array.isArray(rawUsage.limits) ? rawUsage : { limits: [] }
    const now = await $.clock.now()

    const total = tasks.length
    const done = tasks.filter(t => t.status === 'completed').length
    const current = tasks.find(t => t.status === 'in_progress')
    const percent = total > 0 ? Math.round((done / total) * 100) : 0
    const step = current ? current.activeForm || current.subject : done === total && total > 0 ? 'All steps done' : ''

    const parts: Array<{ key: string; label: string; percent?: number }> = []
    if (usage.contextPercent !== undefined) {
      parts.push({ key: 'context', label: `Context ${bar(usage.contextPercent)} ${fmtPercent(usage.contextPercent)}`, percent: usage.contextPercent })
    }
    for (const l of usage.limits as MeterLimit[]) {
      parts.push({
        key: l.kind,
        label: `${limitName(l.kind)} ${bar(l.percentUsed)} ${fmtPercent(l.percentUsed)}${fmtIn(l.resetsAt, now)}`,
        percent: l.percentUsed,
      })
    }
    if (usage.costUsd !== undefined) {
      parts.push({ key: 'cost', label: `~$${usage.costUsd.toFixed(2)} est.` })
    }

    return (
      <Box flexDirection="column">
        {total > 0 ? (
          <Box flexDirection="row">
            <Text bold>Task {percent}% </Text>
            <Progress
              label="Task checklist"
              value={done}
              max={total}
              valueText={`${done} of ${total} steps`}
              color={done === total ? 'success' : 'claude'}
            />
            <Text dimColor>
              {' '}
              {done}/{total}
              {step ? ` · ${step}` : ''}
            </Text>
          </Box>
        ) : (
          <Text dimColor>Task: no checklist yet{e.props.isWorking ? ' (working…)' : ''}</Text>
        )}
        {parts.length > 0 ? (
          <Text>
            {parts.map((p, i) => (
              <Text>
                {i > 0 ? <Text dimColor> · </Text> : ''}
                {p.percent === undefined ? <Text dimColor>{p.label}</Text> : <Text color={levelColor(p.percent)}>{p.label}</Text>}
              </Text>
            ))}
          </Text>
        ) : (
          <Text dimColor>Usage figures appear after the first reply.</Text>
        )}
      </Box>
    )
  })
}
