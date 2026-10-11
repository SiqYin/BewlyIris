import browser from 'webextension-polyfill'

import { AUTO_UPOS_NODE_ID, UPOS_NODES } from '~/constants/uposNodes'
import type { Settings } from '~/logic/storage'
import { onMessage } from '~/utils/messaging'
import { ensureDetectedRegion, preferOverseas } from '~/utils/uposRegion'

export const UPOS_REDIRECT_RULE_ID = 20001

const AUTO_PICK_CACHE_KEY = 'uposAutoPick'
const AUTO_PICK_TTL_MS = 6 * 60 * 60 * 1000

/// 预检通过、按延迟排序的海外可达镜像列表 + 当前游标（起播失败时向后轮换）。
interface AutoPickCache {
  hosts: string[]
  cursor: number
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

/// 换线前可用性预检：对候选镜像发一次 Range(bytes=0-0) 探测，200/206 才算可用；
/// 同时记录 RTT。避免盲目切到一条已失效/被阻断的主机（PiliBabel v1.4.0 的护栏思路）。
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

async function buildReachableOverseasHosts(): Promise<string[]> {
  const candidates = UPOS_NODES.filter(n => n.region === 'overseas')
  const probed = await Promise.all(candidates.map(async n => ({ host: n.host, r: await probeLine(n.host) })))
  return probed
    .filter(p => p.r.ok)
    .sort((a, b) => (a.r.ms ?? Number.POSITIVE_INFINITY) - (b.r.ms ?? Number.POSITIVE_INFINITY))
    .map(p => p.host)
}

async function readAutoCache(): Promise<AutoPickCache | undefined> {
  const stored = await browser.storage.local.get(AUTO_PICK_CACHE_KEY)
  return stored[AUTO_PICK_CACHE_KEY] as AutoPickCache | undefined
}

async function writeAutoCache(cache: AutoPickCache): Promise<void> {
  await browser.storage.local.set({ [AUTO_PICK_CACHE_KEY]: cache })
}

async function ensureAutoCache(): Promise<AutoPickCache> {
  const cached = await readAutoCache()
  if (cached && Date.now() - cached.ts < AUTO_PICK_TTL_MS)
    return cached
  const fresh: AutoPickCache = { hosts: await buildReachableOverseasHosts(), cursor: 0, ts: Date.now() }
  await writeAutoCache(fresh)
  return fresh
}

/// 自动模式：大陆/未覆盖 -> 不干预（走 B 站原生调度）；海外 -> 返回当前游标指向的可达镜像，
/// 一条都预检不通则返回 null（不切，交由原生兜底）。
async function resolveAutoHost(settings: Partial<Settings>): Promise<string | null> {
  const detected = await ensureDetectedRegion()
  const manual = settings.uposRegion
  const region = manual && manual !== 'auto' ? manual : detected
  if (!preferOverseas(region))
    return null
  const cache = await ensureAutoCache()
  if (!cache.hosts.length)
    return null
  const idx = Math.min(Math.max(cache.cursor, 0), cache.hosts.length - 1)
  return cache.hosts[idx]
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

/// 起播失败回退：切到预检列表里的下一条可达镜像（有界，游标到末尾即停）。返回新主机或 null。
async function switchUposLine(): Promise<string | null> {
  const cache = await readAutoCache()
  if (!cache?.hosts.length)
    return null
  const next = cache.cursor + 1
  if (next >= cache.hosts.length)
    return null
  cache.cursor = next
  await writeAutoCache(cache)
  const host = cache.hosts[next]
  await applyRule(host)
  return host
}

/// 播放恢复成功后把游标复位到最快的一条，避免之后一直停在备用线。
async function resetUposLine(): Promise<void> {
  const cache = await readAutoCache()
  if (!cache?.hosts.length || cache.cursor === 0)
    return
  cache.cursor = 0
  await writeAutoCache(cache)
  await applyRule(cache.hosts[0])
}

export function setupUposFallbackListener() {
  onMessage<Record<string, never>, { host: string | null }>('upos-switch-line', async () => ({ host: await switchUposLine() }))
  onMessage<Record<string, never>, { ok: boolean }>('upos-reset-line', async () => {
    await resetUposLine()
    return { ok: true }
  })
}
