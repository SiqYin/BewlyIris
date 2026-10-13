import browser from 'webextension-polyfill'

import { isContentScriptTargetUrl } from '~/constants/contentScript'
import { BILIBILI_DESKTOP_USER_AGENT, isBilibiliWwwUrl, isPreventMobileRedirectEnabled } from '~/utils/bilibiliDesktopNavigation'

import { setupContentScriptRefreshPrompt } from './contentScriptRefreshPrompt'
import { setupLoginStateWatcher } from './loginStateWatcher'
import { setupApiMsgListeners } from './messageListeners/api'
import { setupTabMsgListeners } from './messageListeners/tabs'
import { setupSettingsCloudSync } from './settingsCloudSync'
import { setupSettingsStorageCoordinator } from './settingsStorageCoordinator'
import { setupTopBarStateBroker } from './topBarStateBroker'
import { syncUposRedirectRule } from './uposRedirectManager'
import { setupWatchLaterStateBroker } from './watchLaterStateBroker'
import { initWbiKeys } from './wbiSign'

// Initialize extension and set up message handlers
browser.runtime.onInstalled.addListener(async () => {
  console.log('Extension installed')
})

const PREVENT_MOBILE_REDIRECT_RULE_ID = 1001
const preventMobileRedirectRule: browser.DeclarativeNetRequest.Rule = {
  id: PREVENT_MOBILE_REDIRECT_RULE_ID,
  priority: 2,
  action: {
    type: 'modifyHeaders',
    requestHeaders: [
      {
        header: 'user-agent',
        operation: 'set',
        value: BILIBILI_DESKTOP_USER_AGENT,
      },
      {
        header: 'sec-ch-ua-mobile',
        operation: 'set',
        value: '?0',
      },
      {
        header: 'sec-ch-ua-platform',
        operation: 'set',
        value: '"Windows"',
      },
    ],
  },
  condition: {
    regexFilter: '^https?://www\\.bilibili\\.com/',
    resourceTypes: ['main_frame'],
  },
}

// eslint-disable-next-line node/prefer-global/process
const isFirefoxBuild = Boolean(process.env.FIREFOX)
let preventMobileRedirectEnabled = false

async function syncPreventMobileRedirectRule(enabled: boolean) {
  if (isFirefoxBuild)
    return

  try {
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [PREVENT_MOBILE_REDIRECT_RULE_ID],
      addRules: enabled ? [preventMobileRedirectRule] : [],
    })
  }
  catch (error) {
    console.error('[BewlyCat] Failed to update the mobile redirect compatibility rule:', error)
  }
}

const preventMobileRedirectReady = browser.storage.local.get('settings').then((result) => {
  preventMobileRedirectEnabled = isPreventMobileRedirectEnabled(result.settings)
  void syncUposRedirectRule(result.settings || {})
  return syncPreventMobileRedirectRule(preventMobileRedirectEnabled)
})

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.settings)
    return

  preventMobileRedirectEnabled = isPreventMobileRedirectEnabled(changes.settings.newValue)
  void syncPreventMobileRedirectRule(preventMobileRedirectEnabled)
  void syncUposRedirectRule(changes.settings.newValue || {})
})

// 扩展启动时初始化 WBI 密钥
initWbiKeys().catch((error) => {
  console.error('[BewlyCat] WBI keys initialization error:', error)
})

// 工具栏图标点击 → 在当前 B 站标签打开页面内设置面板；不在 B 站则新开 B 站首页。
browser.action?.onClicked.addListener(async (tab) => {
  try {
    const url = tab?.url ?? ''
    const isBilibili = /^https?:\/\/(?:[a-z0-9-]+\.)*bilibili\.com/i.test(url)
    if (tab?.id != null && isBilibili)
      await browser.tabs.sendMessage(tab.id, { type: 'BEWLY_OPEN_SETTINGS' })
    else
      await browser.tabs.create({ url: 'https://www.bilibili.com' })
  }
  catch (error) {
    console.error('[BewlyIris] 工具栏点击打开设置失败:', error)
  }
})

// 工具栏图标按页面激活状态切换：内容脚本只在支持的页面注入，注入即上报 → 彩色；
// 导航/离开 → 灰色。不依赖 tab.url（扩展未申请 tabs 权限，onUpdated 里 url 可能不可见）。
const ACTIVE_ACTION_ICON = {
  16: 'assets/icon-512.png',
  48: 'assets/icon-512.png',
  128: 'assets/icon-512.png',
}
const INACTIVE_ACTION_ICON = {
  16: 'assets/icon-512-gray.png',
  48: 'assets/icon-512-gray.png',
  128: 'assets/icon-512-gray.png',
}

async function setActionIcon(tabId: number, active: boolean) {
  try {
    await browser.action?.setIcon({ tabId, path: active ? ACTIVE_ACTION_ICON : INACTIVE_ACTION_ICON })
  }
  catch { /* 标签页可能已关闭 */ }
}

browser.runtime.onMessage.addListener((message: unknown, sender: browser.Runtime.MessageSender) => {
  if (typeof message === 'object' && message !== null && (message as { type?: string }).type === 'BEWLY_ICON_ACTIVE') {
    const tabId = sender?.tab?.id
    if (tabId != null)
      void setActionIcon(tabId, true)
  }
  return false
})

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading')
    void setActionIcon(tabId, false)
  else if (changeInfo.url !== undefined)
    void setActionIcon(tabId, isContentScriptTargetUrl(tab.url))
})

function isExtensionUri(url: string) {
  return new URL(url).origin === new URL(browser.runtime.getURL('')).origin
}

// Firefox specific header handling
if (isFirefoxBuild) {
  browser.webRequest.onBeforeSendHeaders.addListener(
    async (details: any) => {
      const requestHeaders: browser.WebRequest.HttpHeaders = []
      await preventMobileRedirectReady
      if (preventMobileRedirectEnabled && details.type === 'main_frame' && isBilibiliWwwUrl(details.url)) {
        let hasUserAgent = false
        for (const header of details.requestHeaders || []) {
          const headerName = header.name.toLowerCase()
          if (headerName === 'user-agent') {
            requestHeaders.push({ name: header.name, value: BILIBILI_DESKTOP_USER_AGENT })
            hasUserAgent = true
          }
          else if (headerName === 'sec-ch-ua-mobile') {
            requestHeaders.push({ name: header.name, value: '?0' })
          }
          else if (headerName === 'sec-ch-ua-platform') {
            requestHeaders.push({ name: header.name, value: '"Windows"' })
          }
          else {
            requestHeaders.push(header)
          }
        }

        if (!hasUserAgent)
          requestHeaders.push({ name: 'User-Agent', value: BILIBILI_DESKTOP_USER_AGENT })

        return { ...details, requestHeaders }
      }

      if (details.documentUrl && (isExtensionUri(details.documentUrl) || isContentScriptTargetUrl(details.documentUrl))) {
        const url = new URL(details.documentUrl)
        const extensionUri = isExtensionUri(details.documentUrl)
        details.requestHeaders = details.requestHeaders || []
        const multiAccountCookieHeader = details.requestHeaders.find(
          (header: browser.WebRequest.HttpHeaders[number]) => header.name.toLowerCase() === 'firefox-multi-account-cookie',
        )

        for (const header of details.requestHeaders) {
          const headerName = header.name.toLowerCase()
          if (headerName === 'firefox-multi-account-cookie')
            continue
          if (multiAccountCookieHeader && headerName === 'cookie')
            continue
          if (headerName === 'origin' || headerName === 'referer')
            requestHeaders.push({ name: header.name, value: extensionUri ? 'https://www.bilibili.com' : url.origin })
          else
            requestHeaders.push(header)
        }

        if (multiAccountCookieHeader)
          requestHeaders.push({ name: 'cookie', value: multiAccountCookieHeader.value ?? '' })

        return { ...details, requestHeaders }
      }
    },
    { urls: ['<all_urls>'] },
    ['blocking', 'requestHeaders'],
  )
}

// Setup all message listeners
setupSettingsStorageCoordinator()
setupSettingsCloudSync()
setupApiMsgListeners()
setupTabMsgListeners()
setupTopBarStateBroker()
setupWatchLaterStateBroker()
setupContentScriptRefreshPrompt()
setupLoginStateWatcher()
