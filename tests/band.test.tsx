import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'usage-meter',
  component: 'AbovePrompt',
  requestId: 'usage-meter',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: true,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('the band shows task percent, context, limits and cost on every surface', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('tool.call', () => ({ result: {} }))
  on('clock.now', () => ({ value: 0 }))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(String(e.text))
    return { value: undefined }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Read code', status: 'completed', activeForm: 'Reading code' },
      { content: 'Write fix', status: 'in_progress', activeForm: 'Writing fix' },
      { content: 'Run tests', status: 'pending', activeForm: 'Running tests' },
      { content: 'Open PR', status: 'pending', activeForm: 'Opening PR' },
    ],
  })
  await $.session.measure({
    context: { window: 200000, tokens: 84000, percent: 42 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 85 },
      { kind: 'seven_day', percentUsed: 12 },
    ],
    cost: { usd: 1.234 },
    changed: ['context', 'rateLimits', 'cost'],
  })

  expect(toasts).toEqual(['Usage Meter: 5h limit at 85%'])

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /Task 25%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Writing fix/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Context .* 42%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5h limit .* 85%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /~\$1\.23 est\./ })).toBeDefined()
    await ui.unmount()
  }
})

test('with no checklist the band says so', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /no checklist yet/ })).toBeDefined()
  await ui.unmount()
})
