import browser from 'webextension-polyfill'

/// 用户所在地区（决定取流优先走大陆镜像还是海外线路）。移植自 PiliBabel 的 CdnRegion。
export type UposUserRegion = 'auto' | 'mainland' | 'japan' | 'hkMoTw' | 'other'

const DETECT_CACHE_KEY = 'uposRegionDetect'
const DETECT_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 用户可能出差/换网络，7 天后重识别

interface DetectCache {
  region: UposUserRegion
  ts: number
}

/// 由 B 站 `x/web-interface/zone` 的返回值推断地区。
/// 优先用数字 `country_code`（ISO 3166）：86 大陆 / 81 日本 / 852·853·886 港澳台。
/// 拿不到码退回中文地名匹配；「中国」同时用于大陆与港澳台，故港澳台先判。
/// 识别不出来一律 other——最保守（偏好海外），不把海外用户钉在大陆镜像上。
export function regionFromZone(countryCode: number | null, country = '', province = ''): UposUserRegion {
  switch (countryCode) {
    case 86:
      return 'mainland'
    case 81:
      return 'japan'
    case 852:
    case 853:
    case 886:
      return 'hkMoTw'
  }
  const text = `${country}${province}`
  if (/香港|澳門|澳门|台湾|台灣|臺/.test(text))
    return 'hkMoTw'
  if (text.includes('日本'))
    return 'japan'
  if (text.includes('中国') || text.includes('中國'))
    return 'mainland'
  return 'other'
}

/// 非大陆地区：取流应优先海外线路。
export function preferOverseas(region: UposUserRegion): boolean {
  return region !== 'mainland'
}

async function detectOnce(): Promise<UposUserRegion | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 6000)
    const res = await fetch('https://api.bilibili.com/x/web-interface/zone', {
      signal: controller.signal,
      credentials: 'omit',
    })
    clearTimeout(timeout)
    const json = await res.json()
    if (json?.code !== 0)
      return null
    const data = json.data ?? {}
    const raw = data.country_code
    const cc = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)
    return regionFromZone(
      Number.isFinite(cc) ? cc : null,
      String(data.country ?? ''),
      String(data.province ?? ''),
    )
  }
  catch {
    return null
  }
}

/// 需要时识别一次（首次/过期/强制），结果落缓存。失败退回旧值或 other。
export async function ensureDetectedRegion(force = false): Promise<UposUserRegion> {
  const stored = await browser.storage.local.get(DETECT_CACHE_KEY)
  const cached = stored[DETECT_CACHE_KEY] as DetectCache | undefined
  if (!force && cached && Date.now() - cached.ts < DETECT_TTL_MS)
    return cached.region
  const fresh = await detectOnce()
  if (fresh) {
    await browser.storage.local.set({ [DETECT_CACHE_KEY]: { region: fresh, ts: Date.now() } })
    return fresh
  }
  return cached?.region ?? 'other'
}

export async function getDetectedRegion(): Promise<UposUserRegion | null> {
  const stored = await browser.storage.local.get(DETECT_CACHE_KEY)
  return (stored[DETECT_CACHE_KEY] as DetectCache | undefined)?.region ?? null
}

export function clearRegionCache() {
  return browser.storage.local.remove(DETECT_CACHE_KEY)
}

/// 生效地区：手动指定优先，否则用识别结果。
export function effectiveRegion(manual: UposUserRegion | undefined, detected: UposUserRegion): UposUserRegion {
  return manual && manual !== 'auto' ? manual : detected
}
