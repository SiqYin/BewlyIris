import fs from 'fs-extra'
import type { Manifest } from 'webextension-polyfill'

import type PkgType from '../package.json'
import { isDev, isFirefox, isSafari, port, r } from '../scripts/utils'
import { CONTENT_SCRIPT_EXCLUDE_MATCHES, CONTENT_SCRIPT_MATCHES } from './constants/contentScript'

export async function getManifest() {
  const pkg = await fs.readJSON(r('package.json')) as typeof PkgType

  // update this file to update this manifest.json
  // can also be conditional based on your need
  const manifest: Manifest.WebExtensionManifest = {
    manifest_version: 3,
    name: `${pkg.displayName || pkg.name}${isDev ? ' Dev' : ''}`,
    version: pkg.version,
    description: pkg.description,
    homepage_url: pkg.homepage,
    // 工具栏图标：不设 default_popup，点击触发 background 的 action.onClicked →
    // 打开页面内设置面板（BewlyIris 的设置是注入在 B 站页面里的完整面板）。
    // 默认用灰色图标；后台按标签页动态 setIcon：支持的 B 站页面显示彩色，其余灰色。
    action: {
      default_title: 'BewlyIris — 点击打开设置',
      default_icon: {
        16: 'assets/icon-512-gray.png',
        48: 'assets/icon-512-gray.png',
        128: 'assets/icon-512-gray.png',
      },
    },

    // Setting `persistent` to true in Manifest V3 results in an error in Firefox
    // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background
    background: (isFirefox || isSafari)
      ? { scripts: ['./dist/background/index.js'], persistent: isFirefox ? undefined : false }
      : { service_worker: './dist/background/index.js', type: 'module' },

    icons: {
      16: 'assets/icon-512.png',
      48: 'assets/icon-512.png',
      128: 'assets/icon-512.png',
    },
    permissions: [
      'storage',
      'declarativeNetRequest',
      'cookies',
      ...(!isSafari ? ['scripting'] : []),
      ...isFirefox
        ? ['webRequest', 'webRequestBlocking']
        : [],
    ],
    host_permissions: [
      '*://*.bilibili.com/*',
      '*://*.hdslb.com/*',
      '*://*.bilivideo.com/*',
      '*://*.bilivideo.cn/*',
      '*://*.akamaized.net/*',
    ],
    // IframePage and IframeDrawer embed supported Bilibili pages and rely on the
    // content scripts for styling, layout synchronization, and interactions.
    // Blank frames are not supported pages, so match_about_blank is intentionally omitted.
    content_scripts: [
      {
        matches: [...CONTENT_SCRIPT_MATCHES],
        exclude_matches: [...CONTENT_SCRIPT_EXCLUDE_MATCHES],
        js: ['./dist/contentScripts/pageLoading.js', './dist/contentScripts/index.global.js'],
        css: ['./dist/contentScripts/style.css'],
        run_at: 'document_start',
        all_frames: true,
      },
      {
        matches: [...CONTENT_SCRIPT_MATCHES],
        exclude_matches: [...CONTENT_SCRIPT_EXCLUDE_MATCHES],
        js: ['./dist/contentScripts/inject.global.js'],
        run_at: 'document_start',
        all_frames: true,
        world: 'MAIN',
      },
    ],
    web_accessible_resources: [
      {
        resources: [
          'assets/*',
          'dist/contentScripts/listenVideoControl.js',
        ],
        matches: [...CONTENT_SCRIPT_MATCHES],
      },
    ],
    content_security_policy: isFirefox
      ? {
          extension_pages: 'script-src \'self\'; object-src \'self\'',
        }
      : {
          extension_pages: isDev
          // this is required on dev for Vite script to load
            ? `script-src 'self' http://localhost:${port}; object-src 'self' http://localhost:${port}`
            : 'script-src \'self\'; object-src \'self\'',
        },
    ...isFirefox
      ? {}
      : {
          declarative_net_request: {
            rule_resources: [
              {
                id: 'ruleset_1',
                enabled: true,
                path: 'assets/rules.json',
              },
            ],
          },
        },
  }

  if (isDev)
    manifest.permissions?.push('webNavigation')

  if (isFirefox) {
    manifest.browser_specific_settings = {
      gecko: {
        id: 'addon@celeus.cn',
      },
    }
  }

  return manifest
}
