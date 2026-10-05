// ── 旁白条 ──────────────────────────────────────────────
export type NarrationPhase = 'working' | 'done' | 'interrupted'

export type TokenTally = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Narration = {
  phase: NarrationPhase
  text: string // 模型写的一句旁白
  current: string // 正在跑的工具，比如 "Bash · npm test"
  steps: number
  errors: number
  startedAt: number
  endedAt: number | null
  isThinking: boolean // 旁白正在生成
  tokens: TokenTally // 这一轮主模型（含子代理）的 token，按每次模型响应累加
  narratorTokens: number // 旁白自己花掉的 Haiku token
  costUsd: number | null // 这一轮的花费（会话 /cost 的增量，含旁白）
  contextPercent: number | null // 上下文窗口已用比例
  changedAt: TokenTally // 每类 token 最近一次增长的时刻，用来让图标短暂高亮
}

// ── 本轮步骤 ────────────────────────────────────────────
export type StepView = {
  id: string
  tool: string
  label: string // 一行摘要，最多 120 字
  detail: string // 完整命令或参数，最多 2000 字，展开、复制、填入时用
  agent: boolean
  ok: boolean | null // null：还在跑
  startedAt: number
  ms: number | null
  error: string | null
}

export type TurnSteps = { request: string; items: StepView[] }

// ── 改动 ────────────────────────────────────────────────
export type TouchedFile = { path: string; edits: number; lastAt: number } // Claude 本次会话改过的文件（绝对路径）

export type GitFile = { path: string; status: string; added: number | null; removed: number | null } // 相对仓库根

export type GitSnapshot = {
  isRepo: boolean
  root: string | null
  branch: string | null
  files: GitFile[]
  isLoading: boolean
  error: string | null
  updatedAt: number | null
}

// ── 历史 ────────────────────────────────────────────────
// 一轮工作的记录：本会话的放在 $.state，跨会话的放在 $.store
export type TurnRecord = {
  id: string // 这一轮开始的时刻
  sessionId: string
  project: string // 会话目录的最后一段
  startedAt: number
  endedAt: number
  request: string // 最多 300 字
  summary: string // 旁白的收尾总结
  phase: NarrationPhase
  steps: number
  errors: number
  tokens: TokenTally
  narratorTokens: number
  costUsd: number | null
  files: string[] // 这一轮 Claude 改过的文件名
}

export type WorkbenchTab = 'turn' | 'changes' | 'history'

declare module 'claude-code' {
  interface PluginState {
    workbench: {
      line: Narration | null
      tick: number
      steps: TurnSteps
      expanded: string | null
      tab: WorkbenchTab
      touched: TouchedFile[]
      git: GitSnapshot
      history: TurnRecord[]
      expandedTurn: string | null
      confirmCompact: boolean
      legendOpen: boolean
      narrationExpanded: boolean
      pendingSetting: { field: string; value: string } | null // 已点、正在保存（等插件重载）的那一项
    }
  }
}
