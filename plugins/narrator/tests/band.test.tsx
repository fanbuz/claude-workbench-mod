import { expect, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11, totalRows: 0 } },
} as const

const USAGE = { input_tokens: 4, output_tokens: 2300, cache_read_input_tokens: 688000, cache_creation_input_tokens: 2300, model: 'claude-opus-5-5' }

test('旁白横幅在终端和桌面都能画出来，token 行带图标', async ($, on) => {
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 52000, percent: 26 }, rateLimits: [], cost: { usd: 0.1 } } }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: '正在看项目结构', usage: USAGE } }) as never)
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: '我先看看目录。', ref: 1 } as never
    yield { kind: 'stop', stopReason: 'end_turn', usage: USAGE, ref: 2 } as never
    return { turnId: 't1', index: 0, answer: '我先看看目录。', toolUses: [], stopReason: 'end_turn', usage: USAGE } as never
  })

  let opened = ''
  on('ui.open', (_$, e) => {
    opened = e.id
    return { value: { isPlaced: true } } as never
  })

  await $.prompt.submit({ text: '看看项目结构' })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as never)) {
    // 读完流
  }
  await $.tool.call({ tool: 'Bash', command: 'ls -la', description: 'list' } as never)

  const term = await $.ui.mount({ plugin: 'narrator', surface: 'terminal', ...(BAND as never) })
  expect(await term.find({ type: 'Text', text: /─{10,}/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /688k/ })).toBeDefined()
  await term.unmount()

  const desk = await $.ui.mount({ plugin: 'narrator', surface: 'desktop', ...(BAND as never) })
  expect(await desk.find({ type: 'Svg' })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: /688k/ })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: /26%/ })).toBeDefined()
  await desk.press({ key: 'steps' }) // 点步数：打开步骤面板
  expect(opened).toBe('narrator-steps')
  await desk.unmount()

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({
      plugin: 'narrator',
      surface,
      component: 'Pane',
      requestId: 'narrator-steps',
      props: { title: '步骤', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30, totalRows: 0 } },
    } as never)
    expect(await pane.find({ type: 'Text', text: /1 步/ })).toBeDefined()
    // 展开状态在会话里共享：终端里点开，桌面上看到的是已展开，再点一下收起
    const isOpenBefore = (await pane.find({ type: 'Text', text: /^ls -la$/ })) !== undefined
    expect(isOpenBefore).toBe(surface === 'desktop')
    await pane.press({ key: (await pane.find({ type: 'Button', text: /ls -la/ }))!.key! })
    const isOpenAfter = (await pane.find({ type: 'Text', text: /^ls -la$/ })) !== undefined
    expect(isOpenAfter).toBe(surface === 'terminal')
    await pane.unmount()
  }
})
