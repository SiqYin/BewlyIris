import { settings } from '~/logic'
import { sendMessage } from '~/utils/messaging'

/// 起播失败自动回退备用线路（PiliBabel v1.4.0 的可移植子集）。
/// 监听网页播放器 <video> 的 error 事件：向后台请求切到下一条预检通过的可达镜像，
/// 换好后调用一次 load()/play() 让播放器用新主机重试。有界：每个视频源最多切 2 次，
/// 且后台镜像列表耗尽后返回 null 即停手，避免无限重载循环。
const MAX_SWITCH_PER_SRC = 2
const SWITCH_COOLDOWN_MS = 4000

let installed = false

export function initUposPlaybackGuard() {
  if (installed || !location.hostname.endsWith('bilibili.com') || location.hostname === 'live.bilibili.com')
    return
  installed = true

  let currentSrc = ''
  let attempts = 0
  let lastSwitchAt = 0
  let busy = false

  document.addEventListener('error', async (event) => {
    const video = event.target
    if (!(video instanceof HTMLVideoElement))
      return
    if (!settings.value.enableUposOptimization || settings.value.uposNode !== 'auto')
      return
    if (busy)
      return

    const src = video.currentSrc || video.src || ''
    if (src !== currentSrc) {
      currentSrc = src
      attempts = 0
    }
    if (attempts >= MAX_SWITCH_PER_SRC)
      return
    const now = Date.now()
    if (now - lastSwitchAt < SWITCH_COOLDOWN_MS)
      return

    attempts++
    lastSwitchAt = now
    busy = true
    try {
      const res = await sendMessage<Record<string, never>, { host: string | null }>('upos-switch-line')
      if (res?.host) {
        video.load()
        void video.play().catch(() => {})
      }
    }
    finally {
      busy = false
    }
  }, true)
}
