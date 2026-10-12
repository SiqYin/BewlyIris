import browser from 'webextension-polyfill'

import { AUTO_UPOS_NODE_ID, UPOS_NODES } from '~/constants/uposNodes'
import type { Settings } from '~/logic/storage'
import { onMessage } from '~/utils/messaging'
import { ensureDetectedRegion, preferOverseas } from '~/utils/uposRegion'

export const UPOS_REDIRECT_RULE_ID = 20001

const AUTO_PICK_CACHE_KEY = 'uposAutoPick'
const BAD_HOSTS_KEY = 'uposBadHosts'
const AUTO_PICK_TTL_MS = 6 * 60 * 60 * 1000

interface AutoPickCache {
  hosts: string[]
  ts: number
}

/// 海外镜像的推荐顺序（腾讯云 cosov 首选）。
const OVERSEAS_ORDER = UPOS_NODES.filter(n => n.region === 'overseas').map(n => n.host)

function cleanHost(raw: string): string {
  return raw.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

function manualHost(settings: Partial<Settings>): string | null {
  if (settings.uposNode === 'custom' && settings.customUposHost?.trim())
    return cleanHost(settings.customUposHost)
  const matched = UPOS_NODES.find(n => n.id === settings.uposNode)
  return matched ? matched.host : null
}

/// 换线前可用性预检：Range(bytes=0-0) 探测，200/206 记为可达并测 RTT。
async function probeLine(host: string): Promise<{ ok: boolean, ms: number | null }> {
  const start = performance.now()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(`https://${host}/crossdomain.xml?_t=${Date.now()}`, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
      signal: controller.signal,
    })
    clearTimeout(timeout)
    const ok = res.status === 200 || res.status === 206
    return { ok, ms: ok ? Math.round(performance.now() - start) : null }
  }
  catch {
    return { ok: false, ms: null }
  }
}

async function getBadHosts(): Promise<string[]> {
  const stored = await browser.storage.local.get(BAD_HOSTS_KEY)
  const v = stored[BAD_HOSTS_KEY]
  return Array.isArray(v) ? v as string[] : []
}

async function addBadHost(host: string): Promise<void> {
  const bad = await getBadHosts()
  if (!bad.includes(host)) {
    bad.push(host)
    await browser.storage.local.set({ [BAD_HOSTS_KEY]: bad })
  }
}

async function clearBadHosts(): Promise<void> {
  await browser.storage.local.remove(BAD_HOSTS_KEY)
}

/// 计算有序候选：剔除黑名单主机后做 Range 预检，只保留真正可达(200/206)的镜像并按 RTT 排序。
/// 一条都探不通就返回空 -> 上层不改写、走 B 站原生调度。（v2.3.0 曾把探测改成「优先」，
/// 会在探测误判时强行改写到会截断视频分片的镜像，导致「有声无画 + 更卡」，故回退为「门禁」。）
/// 全被拉黑则清空重来（多为临时抽风）。
async function computeHosts(): Promise<string[]> {
  const bad = await getBadHosts()
  let candidates = OVERSEAS_ORDER.filter(h => !bad.includes(h))
  if (!candidates.length) {
    await clearBadHosts()
    candidates = [...OVERSEAS_ORDER]
  }
  const probed = await Promise.all(candidates.map(async host => ({ host, r: await probeLine(host) })))
  return probed
    .filter(p => p.r.ok)
    .sort((a, b) => (a.r.ms ?? Number.POSITIVE_INFINITY) - (b.r.ms ?? Number.POSITIVE_INFINITY))
    .map(p => p.host)
}

async function ensureHosts(force = false): Promise<string[]> {
  if (!force) {
    const stored = await browser.storage.local.get(AUTO_PICK_CACHE_KEY)
    const c = stored[AUTO_PICK_CACHE_KEY] as AutoPickCache | undefined
    if (c && Array.isArray(c.hosts) && Date.now() - c.ts < AUTO_PICK_TTL_MS)
      return c.hosts
  }
  const hosts = await computeHosts()
  await browser.storage.local.set({ [AUTO_PICK_CACHE_KEY]: { hosts, ts: Date.now() } })
  return hosts
}

/// 自动模式：大陆/未覆盖 -> 不干预（走 B 站原生调度）；海外 -> 返回当前最优可达镜像。
async function resolveAutoHost(settings: Partial<Settings>): Promise<string | null> {
  const detected = await ensureDetectedRegion()
  const manual = settings.uposRegion
  const region = manual && manual !== 'auto' ? manual : detected
  if (!preferOverseas(region))
    return null
  const hosts = await ensureHosts()
  return hosts[0] ?? null
}

async function applyRule(targetHost: string | null) {
  if (!targetHost) {
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [UPOS_REDIRECT_RULE_ID],
      addRules: [],
    })
    console.log('[BewlyIris UPOS] 未启用覆盖，走 B 站原生调度。')
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
  console.log(`[BewlyIris UPOS] 视频流重定向至: ${targetHost}`)
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
    console.error('[BewlyIris UPOS] 更新 UPOS 重定向规则失败:', error)
  }
}

/// 起播失败回退：把当前主机拉黑（主机级，避免同机多候选反复黑屏），切到下一条未拉黑的可达镜像。
async function switchUposLine(): Promise<string | null> {
  const hosts = await ensureHosts()
  const current = hosts[0]
  if (current)
    await addBadHost(current)
  const next = await computeHosts()
  await browser.storage.local.set({ [AUTO_PICK_CACHE_KEY]: { hosts: next, ts: Date.now() } })
  const host = next[0] ?? null
  await applyRule(host)
  return host
}

/// 复位：清空黑名单并重算，回到全局最优一条。
async function resetUposLine(): Promise<void> {
  await clearBadHosts()
  const hosts = await ensureHosts(true)
  await applyRule(hosts[0] ?? null)
}

export function setupUposFallbackListener() {
  onMessage<Record<string, never>, { host: string | null }>('upos-switch-line', async () => ({ host: await switchUposLine() }))
  onMessage<Record<string, never>, { ok: boolean }>('upos-reset-line', async () => {
    await resetUposLine()
    return { ok: true }
  })
}
