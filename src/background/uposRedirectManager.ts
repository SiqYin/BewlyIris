import browser from 'webextension-polyfill'

import { UPOS_NODES } from '~/constants/uposNodes'
import type { Settings } from '~/logic/storage'

export const UPOS_REDIRECT_RULE_ID = 20001

export function resolveUposHost(settings: Partial<Settings>): string | null {
  if (!settings.enableUposOptimization)
    return null

  if (settings.uposNode === 'custom' && settings.customUposHost?.trim()) {
    return settings.customUposHost.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  }

  const matched = UPOS_NODES.find(n => n.id === settings.uposNode)
  return matched ? matched.host : UPOS_NODES[0].host
}

export async function syncUposRedirectRule(settings: Partial<Settings>) {
  const targetHost = resolveUposHost(settings)

  try {
    if (!targetHost) {
      // 禁用重定向规则
      await browser.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [UPOS_REDIRECT_RULE_ID],
        addRules: [],
      })
      console.log('[BewlyCat UPOS] Optimization disabled, rule removed.')
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
    console.log(`[BewlyCat UPOS] Optimization rule active, redirecting to: ${targetHost}`)
  }
  catch (error) {
    console.error('[BewlyCat UPOS] Failed to update UPOS dynamic redirect rule:', error)
  }
}
