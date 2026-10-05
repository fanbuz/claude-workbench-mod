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

test('zh: band, turn steps and changes render on terminal and desktop', { options: { language: 'zh' } }, async ($, on) => {
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

test('zh: an expanded step can be copied or put in the prompt, a failed one retried', { options: { language: 'zh' } }, async ($, on) => {
  const submitted: string[] = []
  const filled: string[] = []
  const copied: string[] = []
  on('tool.call', (_$, e) =>
    (e as { command?: string }).command === 'npm test'
      ? ({ result: { stdout: '', stderr: 'boom', interrupted: false }, isError: true, text: 'Error: 3 tests failed' } as never)
      : ({ result: { stdout: 'ok', stderr: '', interrupted: false } } as never),
  )
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text } as never
  })
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    return { isFilled: true } as never
  })
  on('ui.copy', (_$, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 10 }, rateLimits: [] } }) as never)
  on('session.cwd', () => ({ value: '/repo' }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: '正在跑测试' } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)

  await $.prompt.submit({ text: '跑一下测试' })
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'test' } as never)

  const pane = await $.ui.mount({ plugin: 'workbench', surface: 'desktop', ...(PANE as never) })
  await pane.press({ key: 'tab-turn' })
  await pane.press({ key: (await pane.find({ type: 'Button', text: /npm test/ }))!.key! })
  expect(await pane.find({ type: 'Text', text: /3 tests failed/ })).toBeDefined()

  const copyKey = (await pane.find({ type: 'Button', text: /^复制$/ }))!.key!
  await pane.press({ key: copyKey })
  expect(copied).toEqual(['npm test'])

  await pane.press({ key: (await pane.find({ type: 'Button', text: /填入输入框/ }))!.key! })
  expect(filled).toEqual(['npm test'])

  await pane.press({ key: (await pane.find({ type: 'Button', text: /排查并重试/ }))!.key! })
  expect(submitted.some(t => t.includes('npm test') && t.includes('3 tests failed'))).toBe(true)
  await pane.unmount()
})

test('zh: off mode makes no model calls and shows the current step', { options: { narratorMode: 'off', language: 'zh' } }, async ($, on) => {
  let modelCalls = 0
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 10 }, rateLimits: [] } }) as never)
  on('model.complete', () => {
    modelCalls += 1
    return { value: { isAnswered: true, text: '不该出现' } } as never
  })

  await $.prompt.submit({ text: '看看目录' })
  await $.tool.call({ tool: 'Bash', command: 'ls -la', description: 'list' } as never)

  const band = await $.ui.mount({ plugin: 'workbench', surface: 'desktop', ...(BAND as never) })
  expect(await band.find({ type: 'Text', text: /正在运行 Bash · ls -la/ })).toBeDefined()
  await band.unmount()
  expect(modelCalls).toBe(0)
})

test('zh: each turn lands in the history, which can copy today\'s log', { options: { language: 'zh' } }, async ($, on) => {
  const copied: string[] = []
  const stored: Record<string, unknown> = {}
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 62 }, rateLimits: [], cost: { usd: 0.2 } } }) as never)
  on('session.cwd', () => ({ value: '/work/demo-app' }) as never)
  on('session.id', () => ({ value: 's1' }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  on('store.get', (_$, e) => ({ value: stored[e.key] }) as never)
  on('store.set', (_$, e) => {
    stored[e.key] = e.value
    return { value: undefined } as never
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '改好了登录页的表单校验' } }) as never)
  on('ui.copy', (_$, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('turn.complete', () => ({ text: '' }) as never)

  await $.prompt.submit({ text: '修一下登录页的表单校验' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/demo-app/src/login.tsx', old_string: 'a', new_string: 'b' } as never)
  await $.turn.complete({ turnId: 't1', answer: '已修复表单校验', durationMs: 1000, isAborted: false } as never)
  await new Promise(r => setTimeout(r, 20)) // 等收尾写入历史

  expect(Array.isArray(stored['history'])).toBe(true)
  const pane = await $.ui.mount({ plugin: 'workbench', surface: 'desktop', ...(PANE as never) })
  await pane.press({ key: 'tab-history' })
  expect(await pane.find({ type: 'Button', text: /改好了登录页的表单校验/ })).toBeDefined()
  expect(await pane.find({ type: 'Button', text: /压缩上下文/ })).toBeDefined() // 上下文 62% ≥ 50%
  await pane.press({ key: 'copy-day' })
  expect(copied[0]).toContain('[demo-app] 改好了登录页的表单校验')
  await pane.unmount()
})

// 以下两个测试验证语言：默认 auto 跟随设置和系统语言

const quiet = (on: Parameters<Parameters<typeof test>[1]>[1]) => {
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 30 }, rateLimits: [], cost: { usd: 0.05 } } }) as never)
  on('session.cwd', () => ({ value: '/repo' }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: 'Reading the project layout' } }) as never)
}

test('en: English UI by default when nothing points to Chinese', async ($, on) => {
  quiet(on)
  await $.prompt.submit({ text: 'look around' })
  await $.tool.call({ tool: 'Bash', command: 'ls -la', description: 'list' } as never)

  const band = await $.ui.mount({ plugin: 'workbench', surface: 'desktop', ...(BAND as never) })
  expect(await band.find({ type: 'Button', text: /Step 1 ›/ })).toBeDefined()
  await band.unmount()

  const pane = await $.ui.mount({ plugin: 'workbench', surface: 'terminal', ...(PANE as never) })
  expect(await pane.find({ type: 'Button', text: /This turn/ })).toBeDefined()
  expect(await pane.find({ type: 'Button', text: /History/ })).toBeDefined()
  await pane.press({ key: 'tab-turn' })
  expect(await pane.find({ type: 'Text', text: /1 steps/ })).toBeDefined()
  await pane.unmount()
})

test('auto: follows a Chinese language setting', async ($, on) => {
  quiet(on)
  on('settings.read', () => ({ value: { language: '简体中文' } }) as never)
  on('session.start', () => ({ cwd: '/repo' }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo' } as never)
  await $.prompt.submit({ text: '看看目录' })

  const pane = await $.ui.mount({ plugin: 'workbench', surface: 'desktop', ...(PANE as never) })
  expect(await pane.find({ type: 'Button', text: /本轮/ })).toBeDefined()
  await pane.unmount()
})

test('settings: the gear opens the settings pane, a pick goes through $.config.set', { options: { narratorMode: 'lite' } }, async ($, on) => {
  quiet(on)
  const opened: string[] = []
  const sets: { key: string; value: unknown }[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  on('config.list', () =>
    ({
      value: ['language', 'bandMode', 'narratorMode', 'narratorIntervalSeconds', 'narratorMaterialChars'].map(f => ({
        key: `workbench@inline.${f}`,
        label: f,
        kind: 'choice',
        value: '',
        provider: { kind: 'plugin', name: 'workbench' },
        isLocked: false,
      })),
    }) as never,
  )
  on('config.set', (_$, e) => {
    sets.push({ key: e.key, value: e.value })
    return { value: e.value } as never
  })

  const pane = await $.ui.mount({ plugin: 'workbench', surface: 'desktop', ...(PANE as never) })
  await pane.press({ key: 'open-settings' })
  expect(opened).toContain('workbench-settings')
  await pane.unmount()

  for (const surface of ['desktop', 'terminal', 'mobile'] as const) {
    const settings = await $.ui.mount({
      plugin: 'workbench',
      surface,
      component: 'Pane',
      requestId: 'workbench-settings',
      props: { title: 'Workbench settings', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40, totalRows: 0 } },
    } as never)
    expect(await settings.find({ type: 'Button', text: /Auto · English/ })).toBeDefined()
    const lite = await settings.find({ key: 'set-narratorMode-lite' })
    expect(lite?.props.variant).toBe('primary') // 当前值高亮
    await settings.unmount()
  }

  const settings = await $.ui.mount({
    plugin: 'workbench',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'workbench-settings',
    props: { title: 'Workbench settings', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40, totalRows: 0 } },
  } as never)
  await settings.press({ key: 'set-language-zh' })
  await settings.press({ key: 'set-narratorIntervalSeconds-15' })
  expect(sets).toEqual([
    { key: 'workbench@inline.language', value: 'zh' },
    { key: 'workbench@inline.narratorIntervalSeconds', value: 15 },
  ])
  await settings.unmount()
})
