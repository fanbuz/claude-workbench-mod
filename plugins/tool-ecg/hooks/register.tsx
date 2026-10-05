import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Beat, Snapshot } from '../types'

const PANE = 'tool-ecg'
const snap = atom({ plugin: 'tool-ecg', key: 'snap' } as const, { beats: [], t: 0 } as Snapshot)

const WINDOW_MS = 60_000
const COMPLEX_W = 28
const FLUSH_MS = 800 // 画面最多每 0.8 秒更新一次：每次更新都会重载 SVG

// /ecg 打开的详情面板的画布
type Layout = {
  w: number
  h: number
  mid: number
  left: number
  head: number // "现在"所在的横坐标，右侧留出画完一个波形的空间
  scale: number // 波形高度缩放
  isCompact: boolean
}
const fullLayout = (w: number): Layout => ({ w, h: 220, mid: 128, left: 10, head: w - 40, scale: 1, isCompact: false })

// 沙盒画框不会按内容撑开，宽度要显式给出：按栏宽估算像素，超出的部分由界面收窄
function pixelWidth(columns: number): number {
  return Math.max(320, Math.min(1600, Math.round(columns * 8)))
}

const COLORS = {
  read: '#4FC3F7',
  bash: '#FFB74D',
  edit: '#81C784',
  web: '#BA68C8',
  agent: '#F06292',
  mcp: '#4DD0E1',
  other: '#E0E0E0',
  error: '#FF5252',
}

function colorOf(tool: string): string {
  if (/^(Read|Grep|Glob|LS)$/.test(tool)) return COLORS.read
  if (/^(Bash|BashOutput|KillShell)$/.test(tool)) return COLORS.bash
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)) return COLORS.edit
  if (/^Web/.test(tool)) return COLORS.web
  if (/^(Agent|Task)$/.test(tool)) return COLORS.agent
  if (tool.startsWith('mcp__')) return COLORS.mcp
  return COLORS.other
}

function shortTool(tool: string): string {
  if (tool.startsWith('mcp__')) return tool.split('__').pop() ?? tool
  return tool
}

function labelOf(args: Record<string, unknown>): string {
  const pick = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : '')
  const path = pick('file_path') || pick('notebook_path') || pick('path')
  const raw =
    pick('command') ||
    (path ? path.split('/').pop() ?? path : '') ||
    pick('pattern') ||
    pick('url') ||
    pick('query') ||
    pick('description') ||
    pick('prompt')
  const line = raw.replace(/\s+/g, ' ').trim()
  return line.length > 60 ? `${line.slice(0, 59)}…` : line
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
}

function seconds(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

// 耗时越长，R 波越高（对数刻度，避免长命令把图顶穿）
function amplitude(ms: number): number {
  return Math.min(88, 16 + 26 * Math.log10(1 + ms / 150))
}

// 一次心跳：P 波、QRS 波群、T 波；出错时 R 波向下翻
function complexPath(x: number, h: number, isError: boolean, L: Layout): string {
  const r = isError ? Math.min(h, L.h - L.mid - 4) : -Math.min(h, L.mid - 4)
  const k = Math.max(L.scale, 0.5) // 小波保持可见
  const pts: [number, number][] = [
    [0, 0], [3, -5 * k], [6, 0], [9, 0], [11, 6 * k], [14, r], [17, -r * 0.22], [19, 0], [22, 0], [25, -7 * k], [28, 0],
  ]
  return pts.map(([dx, dy], i) => `${i === 0 ? 'M' : 'L'}${(x + dx).toFixed(1)},${(L.mid + dy).toFixed(1)}`).join(' ')
}

// 波形按快照时刻 t 摆好，再由 SVG 自己的 SMIL 动画匀速向左平移，
// 所以画面滚动不需要重绘，只有心跳变化时才换一次 SVG
function drawSvg({ beats: list, t }: Snapshot, L: Layout): string {
  const { w: W, h: H, mid: MID, head: HEAD, left } = L
  const travel = HEAD - left
  const xOf = (at: number) => HEAD - ((t - at) / WINDOW_MS) * travel

  // 从最新往回排，挤在一起的心跳往左推开，最新的一个停在真实位置
  const placed: { beat: Beat; x: number }[] = []
  let limit = Infinity
  for (const beat of [...list].sort((a, b) => b.start - a.start)) {
    const x = Math.min(xOf(beat.start), limit - COMPLEX_W - 4)
    if (x < left - COMPLEX_W) break
    placed.push({ beat, x })
    limit = x
  }

  const recent = list.filter(b => t - b.start <= WINDOW_MS)
  const bpm = recent.length
  const errors = recent.filter(b => b.isError).length

  const parts: string[] = []
  for (const { beat, x } of placed) {
    const tip = esc(
      `${beat.tool}${beat.label ? ` · ${beat.label}` : ''}\n` +
        (beat.end === null ? '运行中…' : `${seconds(beat.end - beat.start)}${beat.isError ? ' · 出错' : ''}`),
    )
    if (beat.end === null) {
      // 仍在运行：基线上一个呼吸的光点
      parts.push(
        `<g><title>${tip}</title><circle cx="${(x + 14).toFixed(1)}" cy="${MID}" r="4" fill="${colorOf(beat.tool)}" filter="url(#glow)">` +
          `<animate attributeName="r" values="3;6;3" dur="1s" repeatCount="indefinite"/></circle></g>`,
      )
      continue
    }
    const h = amplitude(beat.end - beat.start) * L.scale
    const color = beat.isError ? COLORS.error : colorOf(beat.tool)
    const labelY = beat.isError ? MID + h + 14 : MID - h - 6
    parts.push(
      `<g class="beat"><title>${tip}</title>` +
        `<rect x="${(x - 2).toFixed(1)}" y="0" width="${COMPLEX_W + 4}" height="${H}" fill="transparent"/>` +
        `<path d="${complexPath(x, h, beat.isError, L)}" stroke="${color}" stroke-width="2" fill="none" stroke-linejoin="round" filter="url(#glow)"/>` +
        (L.isCompact
          ? ''
          : `<text x="${(x + 14).toFixed(1)}" y="${labelY.toFixed(1)}" fill="${color}" font-size="9" text-anchor="middle">${esc(shortTool(beat.tool).slice(0, 8))}</text>`) +
        `</g>`,
    )
  }

  const bpmColor = errors > 0 ? COLORS.error : '#69F0AE'
  const header = L.isCompact
    ? `<text x="14" y="${MID - 3}" fill="#69F0AE" font-size="12" font-weight="bold" letter-spacing="2">ECG</text>
<text x="14" y="${MID + 12}" fill="#2e7d32" font-size="9">${errors ? `${errors} 出错` : '60s'}</text>
<text x="${W - 14}" y="${MID + 8}" fill="${bpmColor}" font-size="22" font-weight="bold" text-anchor="end">${bpm}<tspan font-size="10" dx="4">BPM</tspan></text>`
    : `<text x="14" y="22" fill="#69F0AE" font-size="12" font-weight="bold" letter-spacing="2">TOOL ECG</text>
<text x="14" y="38" fill="#2e7d32" font-size="10">${bpm === 0 ? '等待心跳…' : `近 60 秒 ${bpm} 次调用${errors ? ` · ${errors} 次出错` : ''}`}</text>
<text x="${W - 14}" y="30" fill="${bpmColor}" font-size="22" font-weight="bold" text-anchor="end">${bpm}<tspan font-size="10" dx="4">BPM</tspan></text>
<text x="${W - 14}" y="${H - 10}" fill="#2e7d32" font-size="9" text-anchor="end">60s ◀ now</text>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace, Menlo, monospace" style="display:block;background:#050b08">
<defs>
  <pattern id="g1" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#0f3d24" stroke-width="0.5"/></pattern>
  <pattern id="g5" width="50" height="50" patternUnits="userSpaceOnUse"><rect width="50" height="50" fill="url(#g1)"/><path d="M50 0H0V50" fill="none" stroke="#14532d" stroke-width="1"/></pattern>
  <filter id="glow" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="${left - 20}" x2="${left + 60}" y1="0" y2="0"><stop offset="0" stop-color="#050b08" stop-opacity="1"/><stop offset="1" stop-color="#050b08" stop-opacity="0"/></linearGradient>
  <clipPath id="clip"><rect x="0" y="0" width="${HEAD + COMPLEX_W + 6}" height="${H}"/></clipPath>
  <style>.beat:hover path{stroke-width:3.5}.beat:hover text{font-size:11px;font-weight:bold}</style>
</defs>
<rect width="${W}" height="${H}" fill="#050b08"/>
<rect width="${W}" height="${H}" fill="url(#g5)"/>
<line x1="0" y1="${MID}" x2="${HEAD}" y2="${MID}" stroke="#43a047" stroke-width="1.5" filter="url(#glow)"/>
<g clip-path="url(#clip)"><g>
${parts.join('\n')}
<animateTransform attributeName="transform" type="translate" from="0 0" to="${-travel} 0" dur="${WINDOW_MS / 1000}s" fill="freeze"/>
</g></g>
<rect x="0" y="0" width="${left + 60}" height="${H}" fill="url(#fade)"/>
<circle cx="${HEAD}" cy="${MID}" r="3.5" fill="#69F0AE" filter="url(#glow)"><animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite"/></circle>
${header}
</svg>`
}

function altOf({ beats: list, t }: Snapshot): string {
  return `工具调用心电图：近 60 秒 ${list.filter(b => t - b.start <= WINDOW_MS).length} 次调用`
}

const LEGEND: [string, string][] = [
  ['读取', COLORS.read],
  ['命令', COLORS.bash],
  ['编辑', COLORS.edit],
  ['网络', COLORS.web],
  ['子代理', COLORS.agent],
  ['MCP', COLORS.mcp],
  ['出错', COLORS.error],
]

function statsOf(list: Beat[]) {
  const done = list.filter(b => b.end !== null)
  const total = done.length
  const errors = done.filter(b => b.isError).length
  const avg = total ? Math.round(done.reduce((sum, b) => sum + (b.end! - b.start), 0) / total) : 0
  const running = list.filter(b => b.end === null)
  return { done, total, errors, avg, running }
}

export const register: Register = on => {
  // 心跳先记在这里，由定时器合并写进 $.state：一阵密集的调用只换一次画面
  let local: Beat[] = []
  let isDirty = false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'ecg', description: '打开工具调用心电图详情面板' })
    local = (await read($, snap)).beats

    $.clock.every(FLUSH_MS, async () => {
      if (!isDirty) return
      isDirty = false
      const t = await $.clock.now()
      await update($, snap, () => ({ beats: local, t }))
    })

    return next(e)
  })

  on('command.run', { command: 'ecg' }, async $ => {
    await $.ui.open({ id: PANE, title: '心电图' })
    return { text: '心电图详情面板已打开。' }
  })

  on('tool.call', async ($, e, next) => {
    const start = await $.clock.now()
    const beat: Beat = {
      id: e.tool_use_id ?? `${e.tool}-${start}`,
      tool: e.tool,
      label: labelOf(e as unknown as Record<string, unknown>),
      start,
      end: null,
      isError: false,
    }
    local = [...local, beat].slice(-150)
    isDirty = true

    let ran: Awaited<ReturnType<typeof next>> | undefined
    try {
      ran = await next(e)
      return ran
    } finally {
      const end = await $.clock.now()
      const isError = ran === undefined || ran.deny !== undefined || ran.isError === true
      local = local.map(b => (b.id === beat.id ? { ...b, end, isError } : b))
      isDirty = true
    }
  })

  // /ecg 打开的详情面板：大图 + 统计 + 最近调用
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = await read($, snap)
    const { done, total, errors, avg } = statsOf(s.beats)
    const last = done.slice(-6).reverse()

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text bold color="#69F0AE">TOOL ECG</Text>
          <Text dimColor>本次会话 {total} 次调用 · 平均 {seconds(avg)} · 出错 {errors} 次</Text>
        </Box>
      )
    }

    const { Box, Text, Svg, Button } = $.ui.resolve(e)
    const L = fullLayout(pixelWidth(e.props.bodyColumns))

    return (
      <Box flexDirection="column" gap={1}>
        <Svg source={drawSvg(s, L)} alt={altOf(s)} width={L.w} height={L.h} isInteractive />
        <Box flexDirection="row" gap={2}>
          {LEGEND.map(([label, color]) => (
            <Text color={color}>● {label}</Text>
          ))}
        </Box>
        <Text dimColor>
          本次会话 {total} 次调用 · 平均 {seconds(avg)} · 出错 {errors} 次
        </Text>
        <Box flexDirection="column">
          {last.map(b => (
            <Text wrap="truncate-end">
              <Text color={b.isError ? COLORS.error : colorOf(b.tool)}>{b.isError ? '✕' : '✓'} {shortTool(b.tool)}</Text>
              <Text dimColor> {seconds(b.end! - b.start)} </Text>
              <Text>{b.label}</Text>
            </Text>
          ))}
        </Box>
        {s.beats.length > 0 && (
          <Box flexDirection="row">
            <Button
              key="clear"
              label="清空"
              onPress={() => {
                local = []
                isDirty = true
              }}
            />
          </Box>
        )}
      </Box>
    )
  })
}
