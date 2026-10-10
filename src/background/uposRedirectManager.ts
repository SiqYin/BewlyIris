import browser from 'webextension-polyfill'

import { AUTO_UPOS_NODE_ID, UPOS_NODES } from '~/constants/uposNodes'
import type { Settings } from '~/logic/storage'
import { ensureDetectedRegion, preferOverseas } from '~/utils/uposRegion'

export const UPOS_REDIRECT_RULE_ID = 20001

const AUTO_PICK_CACHE_KEY = 'uposAutoPick'
const AUTO_PICK_TTL_MS = 6 * 60 * 60 * 1000

interface AutoPickCache {
  host: string
  ts: number
}

function cleanHost(raw: string): string {
  return raw.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

function manualHost(settings: Partial<Settings>): string | null {
  if (settings.uposNode === 'custom' && settings.customUposHost?.trim())
    return cleanHost(settings.customUposHost)
  const matched = UPOS_NODES.find(n => n.id === settings.uposNode)
  return matched ? matched.host : null
}

async function probeLatency(host: string): Promise<number | null> {
  const start = performance.now()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)
    await fetch(`https://${host}/crossdomain.xml?_t=${Date.now()}`, {
      method: 'HEAD',
      mode: 'no-cors',
      signal: controller.signal,
    })
    clearTimeout(timeout)
    return Math.round(performance.now() - start)
  }
  catch {
    return null
  }
}

/// 自动模式：大陆不干预（返回 null，走 B 站按 IP 就近的原生调度）；
/// 海外挑最快的 `*ov` 镜像（HEAD 测 RTT，结果缓存 6 小时）。
async function resolveAutoHost(settings: Partial<Settings>): Promise<string | null> {
  const detected = await ensureDetectedRegion()
  const manual = settings.uposRegion
  const region = manual && manual !== 'auto' ? manual : detected
  if (!preferOverseas(region))
    return null

  const stored = await browser.storage.local.get(AUTO_PICK_CACHE_KEY)
  const cached = stored[AUTO_PICK_CACHE_KEY] as AutoPickCache | undefined
  if (cached && Date.now() - cached.ts < AUTO_PICK_TTL_MS)
    return cached.host

  const candidates = UPOS_NODES.filter(n => n.region === 'overseas')
  const probed = await Promise.all(candidates.map(async n => ({ host: n.host, ms: await probeLatency(n.host) })))
  const reachable = probed.filter(p => p.ms !== null).sort((a, b) => (a.ms as number) - (b.ms as number))
  const host = reachable[0]?.host ?? candidates[0].host
  await browser.storage.local.set({ [AUTO_PICK_CACHE_KEY]: { host, ts: Date.now() } })
  return host
}

async function applyRule(targetHost: string | null) {
  if (!targetHost) {
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [UPOS_REDIRECT_RULE_ID],
      addRules: [],
    })
    console.log('[IrisCat UPOS] 未启用覆盖，走 B 站原生调度。')
    return
  }

  const uposRule: browser.DeclarativeNetRequest.Rule = {
    id: UPOS_REDIRECT_RULE_ID,
    priority: 10,
    action: {
      type: 'redirect',
      redirect: {
        regexSubstitution: `https://${targetHost}/\\1`,
      },
    },
    condition: {
      regexFilter: '^https?://upos-[^/]+\\.bilivideo\\.(?:com|cn)/(.*)',
      resourceTypes: ['xmlhttprequest', 'media'],
    },
  }

  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [UPOS_REDIRECT_RULE_ID],
    addRules: [uposRule],
  })
  console.log(`[IrisCat UPOS] 视频流重定向至: ${targetHost}`)
}

export async function syncUposRedirectRule(settings: Partial<Settings>) {
  try {
    if (!settings.enableUposOptimization) {
      await applyRule(null)
      return
    }
    const host = settings.uposNode === AUTO_UPOS_NODE_ID
      ? await resolveAutoHost(settings)
      : manualHost(settings)
    await applyRule(host)
  }
  catch (error) {
    console.error('[IrisCat UPOS] 更新 UPOS 重定向规则失败:', error)
  }
}
