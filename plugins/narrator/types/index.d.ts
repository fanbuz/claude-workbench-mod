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

// 步骤面板里的一行：一次工具调用
export type StepView = {
  id: string
  tool: string
  label: string
  agent: boolean
  ok: boolean | null // null：还在跑
  startedAt: number
  ms: number | null
  error: string | null
}

export type TurnSteps = { request: string; items: StepView[] }

declare module 'claude-code' {
  interface PluginState {
    narrator: { line: Narration | null; tick: number; steps: TurnSteps; expanded: string | null }
  }
}
