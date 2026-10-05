import { expect, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11, totalRows: 0 } },
} as const

const PANE = {
  component: 'Pane',
  requestId: 'workbench',
  props: { title: '工作台', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40, totalRows: 0 } },
} as const

const USAGE = { input_tokens: 4, output_tokens: 2300, cache_read_input_tokens: 688000, cache_creation_input_tokens: 2300, model: 'claude-opus-5-5' }

// 假的 git：一个仓库、两处改动，其中 src/app.ts 是这一轮 Claude 用 Edit 改的
const GIT: Record<string, string> = {
  'rev-parse --show-toplevel': '/repo\n',
  'rev-parse --abbrev-ref HEAD': 'main\n',
  'status --porcelain=v1': ' M src/app.ts\n?? notes.md\n',
  'diff --numstat HEAD': '12\t3\tsrc/app.ts\n',
}

test('旁白条、本轮步骤和改动页在终端和桌面都能画出来', async ($, on) => {
  const opened: string[] = []
  const submitted: string[] = []
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }) as never)
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text } as never
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 52000, percent: 26 }, rateLimits: [], cost: { usd: 0.1 } } }) as never)
  on('session.cwd', () => ({ value: '/repo' }) as never)
  on('process.run', (_$, e) => {
    const out = GIT[(e.argv as string[]).slice(1).join(' ')]
    return { value: { exitCode: out === undefined ? 1 : 0, stdout: out ?? '', stderr: '' } } as never
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '正在看项目结构', usage: USAGE } }) as never)
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: '我先看看目录。', ref: 1 } as never
    yield { kind: 'stop', stopReason: 'end_turn', usage: USAGE, ref: 2 } as never
    return { turnId: 't1', index: 0, answer: '我先看看目录。', toolUses: [], stopReason: 'end_turn', usage: USAGE } as never
  })

  await $.prompt.submit({ text: '看看项目结构' })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as never)) {
    // 读完流
  }
  await $.tool.call({ tool: 'Bash', command: 'ls -la', description: 'list' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b' } as never)

  // 旁白条：终端画符号，桌面画 SVG 图标；点步数打开工作台
  const term = await $.ui.mount({ plugin: 'workbench', surface: 'terminal', ...(BAND as never) })
  expect(await term.find({ type: 'Text', text: /688k/ })).toBeDefined()
  await term.unmount()

  const desk = await $.ui.mount({ plugin: 'workbench', surface: 'desktop', ...(BAND as never) })
  expect(await desk.find({ type: 'Svg' })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: /26%/ })).toBeDefined()
  await desk.press({ key: 'steps' })
  expect(opened).toContain('workbench')
  await desk.unmount()

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: 'workbench', surface, ...(PANE as never) })

    // 本轮：两步，点开 Bash 那一步看到完整命令（展开状态跨表面共享，桌面上点一下是收起）
    await pane.press({ key: 'tab-turn' })
    expect(await pane.find({ type: 'Text', text: /2 步/ })).toBeDefined()
    const isOpenBefore = (await pane.find({ type: 'Text', text: /^ls -la$/ })) !== undefined
    expect(isOpenBefore).toBe(surface === 'desktop')
    await pane.press({ key: (await pane.find({ type: 'Button', text: /ls -la/ }))!.key! })
    const isOpenAfter = (await pane.find({ type: 'Text', text: /^ls -la$/ })) !== undefined
    expect(isOpenAfter).toBe(surface === 'terminal')

    // 改动：分支、Claude 改的文件和行数、其他改动
    await pane.press({ key: 'tab-changes' })
    await pane.press({ key: 'git-refresh' })
    expect(await pane.find({ type: 'Text', text: /main/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Claude 本次会话改的 · 1/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Claude ×1/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /\+12/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /其他改动 · 1/ })).toBeDefined()
    await pane.unmount()
  }

  // 改动页的快捷指令会以一条新消息发给 Claude
  const pane = await $.ui.mount({ plugin: 'workbench', surface: 'desktop', ...(PANE as never) })
  await pane.press({ key: 'commit-msg' })
  expect(submitted.some(t => t.includes('提交信息'))).toBe(true)
  await pane.unmount()
})
