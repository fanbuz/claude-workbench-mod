export type Beat = {
  id: string
  tool: string
  label: string
  start: number
  end: number | null
  isError: boolean
}

// 一次画面快照：心跳列表和拍下它的时刻（SVG 内的滚动动画从这一刻开始）
export type Snapshot = { beats: Beat[]; t: number }

declare module 'claude-code' {
  interface PluginState {
    'tool-ecg': { snap: Snapshot }
  }
}
