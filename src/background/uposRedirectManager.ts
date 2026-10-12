import browser from 'webextension-polyfill'

import { AUTO_UPOS_NODE_ID, UPOS_NODES } from '~/constants/uposNodes'
import type { Settings } from '~/logic/storage'

export const UPOS_REDIRECT_RULE_ID = 20001

function cleanHost(raw: string): string {
  return raw.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

function manualHost(settings: Partial<Settings>): string | null {
  if (settings.uposNode === 'custom' && settings.customUposHost?.trim())
    return cleanHost(settings.customUposHost)
  const matched = UPOS_NODES.find(n => n.id === settings.uposNode)
  return matched ? matched.host : null
}

async function applyRule(targetHost: string | null) {
  if (!targetHost) {
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [UPOS_REDIRECT_RULE_ID],
      addRules: [],
    })
    console.log('[BewlyIris UPOS] 未安装改写规则（自动模式由 route B 挑候选，或功能关闭）。')
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
  console.log(`[BewlyIris UPOS] 手动指定线路，视频流重定向至: ${targetHost}`)
}

/// 自动模式：不再用 DNR 强改主机（那会撞上截断视频分片的镜像 → 有声无画），
/// 改由 MAIN 世界在 B 站已签名的候选直链里挑（route B）。
/// 仅「手动指定节点 / 自定义域名」才用 DNR 改写（用户显式选择，自担其责）。
export async function syncUposRedirectRule(settings: Partial<Settings>) {
  try {
    if (!settings.enableUposOptimization || settings.uposNode === AUTO_UPOS_NODE_ID) {
      await applyRule(null)
      return
    }
    await applyRule(manualHost(settings))
  }
  catch (error) {
    console.error('[BewlyIris UPOS] 更新 UPOS 重定向规则失败:', error)
  }
}
