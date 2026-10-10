<script lang="ts" setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import browser from 'webextension-polyfill'

import Button from '~/components/Button.vue'
import Radio from '~/components/Radio.vue'
import Select from '~/components/Select.vue'
import { AUTO_UPOS_NODE_ID, UPOS_NODES } from '~/constants/uposNodes'
import { settings } from '~/logic'

import SettingsItem from '../../components/SettingsItem.vue'
import SettingsItemGroup from '../../components/SettingsItemGroup.vue'
import SettingsItemSubgroup from '../../components/SettingsItemSubgroup.vue'

const { t } = useI18n()

interface PingResult {
  [host: string]: {
    latency: number | null
    testing: boolean
    error: boolean
  }
}

const pingResults = ref<PingResult>({})
const isTestingAll = ref(false)

const nodeOptions = computed(() => {
  const options = [
    { label: t('settings.upos_node_auto') || '自动（按当前网络/地区智能选择）', value: AUTO_UPOS_NODE_ID },
    ...UPOS_NODES.map(node => ({
      label: `${node.name} (${node.region === 'overseas' ? '海外' : '大陆'})`,
      value: node.id,
    })),
  ]
  options.push({
    label: '自定义 CDN 域名',
    value: 'custom',
  })
  return options
})

const regionOptions = [
  { label: '自动识别', value: 'auto' },
  { label: '中国大陆', value: 'mainland' },
  { label: '日本', value: 'japan' },
  { label: '港澳台', value: 'hkMoTw' },
  { label: '其他地区', value: 'other' },
]

const regionLabelMap: Record<string, string> = {
  auto: '自动识别',
  mainland: '中国大陆',
  japan: '日本',
  hkMoTw: '港澳台',
  other: '其他地区',
}

const detectedRegion = ref('')
const pickedHost = ref('')
const statusLoading = ref(false)

async function loadStatus() {
  const st = await browser.storage.local.get(['uposRegionDetect', 'uposAutoPick'])
  detectedRegion.value = (st.uposRegionDetect as { region?: string } | undefined)?.region ?? ''
  pickedHost.value = (st.uposAutoPick as { host?: string } | undefined)?.host ?? ''
}

const detectedLabel = computed(() => regionLabelMap[detectedRegion.value] ?? '未检测')
const pickedName = computed(() => {
  const node = UPOS_NODES.find(n => n.host === pickedHost.value)
  return node?.name ?? (pickedHost.value || '—')
})
const effectiveDesc = computed(() => {
  const eff = settings.value.uposRegion && settings.value.uposRegion !== 'auto'
    ? settings.value.uposRegion
    : detectedRegion.value
  if (eff === 'mainland')
    return '走 B 站原生调度（大陆最快）'
  if (!eff)
    return '检测中…'
  return `海外优选 → ${pickedName.value}`
})

async function redetect() {
  statusLoading.value = true
  await browser.storage.local.remove(['uposRegionDetect', 'uposAutoPick'])
  detectedRegion.value = ''
  pickedHost.value = ''
  // 清缓存后切换开关，触发后台重新识别并应用（走一次 storage.onChanged）
  settings.value.enableUposOptimization = false
  await nextTick()
  settings.value.enableUposOptimization = true
  setTimeout(async () => {
    await loadStatus()
    statusLoading.value = false
  }, 2200)
}

onMounted(() => {
  if (settings.value.uposNode === AUTO_UPOS_NODE_ID)
    loadStatus()
})
watch(() => settings.value.uposNode, (v) => {
  if (v === AUTO_UPOS_NODE_ID)
    loadStatus()
})

async function pingHost(host: string): Promise<number | null> {
  const startTime = performance.now()
  try {
    // 采用携带时间戳的快速探测请求
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)
    // 探测 bilivideo 的心跳/静态小图或根节点
    await fetch(`https://${host}/crossdomain.xml?_t=${Date.now()}`, {
      method: 'HEAD',
      mode: 'no-cors',
      signal: controller.signal,
    })
    clearTimeout(timeout)
    return Math.round(performance.now() - startTime)
  }
  catch {
    try {
      // 次级备用探测
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3500)
      await fetch(`https://${host}/favicon.ico?_t=${Date.now()}`, {
        method: 'HEAD',
        mode: 'no-cors',
        signal: controller.signal,
      })
      clearTimeout(timeout)
      return Math.round(performance.now() - startTime)
    }
    catch {
      return null
    }
  }
}

async function testSingleNode(host: string) {
  pingResults.value[host] = { latency: null, testing: true, error: false }
  const latency = await pingHost(host)
  if (latency !== null) {
    pingResults.value[host] = { latency, testing: false, error: false }
  }
  else {
    pingResults.value[host] = { latency: null, testing: false, error: true }
  }
}

async function testAllNodes() {
  if (isTestingAll.value)
    return
  isTestingAll.value = true

  let bestHost = ''
  let minLatency = Infinity

  const tasks = UPOS_NODES.map(async (node) => {
    pingResults.value[node.host] = { latency: null, testing: true, error: false }
    const latency = await pingHost(node.host)
    if (latency !== null) {
      pingResults.value[node.host] = { latency, testing: false, error: false }
      if (latency < minLatency) {
        minLatency = latency
        bestHost = node.id
      }
    }
    else {
      pingResults.value[node.host] = { latency: null, testing: false, error: true }
    }
  })

  await Promise.all(tasks)
  isTestingAll.value = false

  // 如果测出了最佳节点且当前处于默认配置，智能推荐选中
  if (bestHost && !settings.value.enableUposOptimization) {
    settings.value.uposNode = bestHost
  }
}
</script>

<template>
  <SettingsItemGroup
    :title="t('settings.upos_optimization_title') || '视频 CDN 与海外线路优选 (PiliBabel 加速)'"
    :desc="t('settings.upos_optimization_desc') || '针对海外用户（如日本、港澳台等）由于骨干网或 PCDN 调度导致的视频一卡一卡问题，强制重写至高速海外/国内优质 CDN 镜像。'"
  >
    <SettingsItem
      :title="t('settings.enable_upos_optimization') || '启用 CDN 线路优选加速'"
      :desc="t('settings.enable_upos_optimization_desc') || '开启后将通过浏览器内核（declarativeNetRequest）自动拦截并重定向视频分段至指定的加速节点。'"
      right-width="auto"
    >
      <Radio v-model="settings.enableUposOptimization" />
    </SettingsItem>

    <template v-if="settings.enableUposOptimization">
      <SettingsItem
        :title="t('settings.upos_node_select') || '选择加速节点'"
        :desc="t('settings.upos_node_select_desc') || '海外直连推荐选用「腾讯云海外节点 (mirrorcosov)」或「阿里云海外节点 (mirroraliov)」'"
        right-width="auto"
      >
        <Select
          v-model="settings.uposNode"
          :options="nodeOptions"
        />
      </SettingsItem>

      <SettingsItem
        v-if="settings.uposNode === AUTO_UPOS_NODE_ID"
        :title="t('settings.upos_region') || '使用地区'"
        :desc="t('settings.upos_region_desc') || '默认自动识别当前 IP 所在地区，也可手动指定。大陆走 B 站原生调度，海外自动挑选最快加速镜像。'"
        right-width="auto"
      >
        <Select
          v-model="settings.uposRegion"
          :options="regionOptions"
        />
      </SettingsItem>

      <SettingsItem
        v-if="settings.uposNode === AUTO_UPOS_NODE_ID"
        :title="t('settings.upos_detect_status') || '当前网络检测'"
        :desc="`识别地区：${detectedLabel} · 生效策略：${effectiveDesc}`"
        right-width="auto"
      >
        <Button
          type="secondary"
          size="small"
          :loading="statusLoading"
          @click="redetect"
        >
          {{ statusLoading ? '检测中…' : '重新检测' }}
        </Button>
      </SettingsItem>

      <SettingsItem
        v-if="settings.uposNode === 'custom'"
        :title="t('settings.custom_upos_host') || '自定义 UPOS 节点 Host'"
        :desc="t('settings.custom_upos_host_desc') || '输入自定义 CDN 域名，例如: upos-sz-mirrorcosov.bilivideo.com'"
        right-width="auto"
      >
        <input
          v-model="settings.customUposHost"
          type="text"
          placeholder="upos-sz-mirrorcosov.bilivideo.com"
          class="custom-host-input"
        >
      </SettingsItem>

      <!-- 节点测速面板 -->
      <SettingsItemSubgroup :title="t('settings.upos_node_speed_test') || '节点网络测速 (大阪/海外实测)'">
        <div class="speed-test-header">
          <Button
            type="primary"
            size="small"
            :loading="isTestingAll"
            @click="testAllNodes"
          >
            {{ isTestingAll ? '正在并发测速...' : '一键测速全部节点' }}
          </Button>
          <span class="speed-test-tip">通过 HEAD 探测计算实际网络往返延迟 (RTT)</span>
        </div>

        <div class="node-list">
          <div
            v-for="node in UPOS_NODES"
            :key="node.id"
            class="node-card"
            :class="{ active: settings.uposNode === node.id }"
            @click="settings.uposNode = node.id"
          >
            <div class="node-main">
              <div class="node-name">
                {{ node.name }}
                <span
                  class="node-badge"
                  :class="node.region"
                >
                  {{ node.region === 'overseas' ? '海外优化' : '大陆直连' }}
                </span>
              </div>
              <div class="node-host">
                {{ node.host }}
              </div>
            </div>

            <div class="node-status">
              <span v-if="pingResults[node.host]?.testing" class="status-testing">测速中...</span>
              <span
                v-else-if="pingResults[node.host]?.latency !== null && pingResults[node.host]?.latency !== undefined"
                class="status-latency"
                :class="{
                  fast: (pingResults[node.host]?.latency || 0) < 100,
                  medium: (pingResults[node.host]?.latency || 0) >= 100 && (pingResults[node.host]?.latency || 0) < 250,
                  slow: (pingResults[node.host]?.latency || 0) >= 250,
                }"
              >
                {{ pingResults[node.host]?.latency }} ms
              </span>
              <span v-else-if="pingResults[node.host]?.error" class="status-error">超时 / 阻断</span>
              <button
                type="button"
                class="test-btn"
                @click.stop="testSingleNode(node.host)"
              >
                测速
              </button>
            </div>
          </div>
        </div>
      </SettingsItemSubgroup>
    </template>
  </SettingsItemGroup>
</template>

<style lang="scss" scoped>
.custom-host-input {
  width: 280px;
  padding: 6px 12px;
  font-size: 13px;
  border-radius: 6px;
  border: 1px solid var(--bew-border-color, rgba(255, 255, 255, 0.2));
  background: var(--bew-fill-1, rgba(255, 255, 255, 0.05));
  color: var(--bew-text-1, #fff);
  outline: none;

  &:focus {
    border-color: var(--bew-theme-color, #00aeec);
  }
}

.speed-test-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;

  .speed-test-tip {
    font-size: 12px;
    color: var(--bew-text-2, rgba(255, 255, 255, 0.6));
  }
}

.node-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.node-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid var(--bew-border-color, rgba(255, 255, 255, 0.1));
  background: var(--bew-fill-1, rgba(255, 255, 255, 0.03));
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: var(--bew-fill-2, rgba(255, 255, 255, 0.08));
  }

  &.active {
    border-color: var(--bew-theme-color, #00aeec);
    background: var(--bew-theme-color-10, rgba(0, 174, 236, 0.1));
  }

  .node-main {
    .node-name {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 500;
      color: var(--bew-text-1, #fff);
    }

    .node-host {
      font-size: 12px;
      color: var(--bew-text-3, rgba(255, 255, 255, 0.4));
      margin-top: 2px;
    }
  }

  .node-badge {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 4px;

    &.overseas {
      background: rgba(34, 197, 94, 0.15);
      color: #22c55e;
      border: 1px solid rgba(34, 197, 94, 0.3);
    }

    &.mainland {
      background: rgba(148, 163, 184, 0.15);
      color: #94a3b8;
      border: 1px solid rgba(148, 163, 184, 0.3);
    }
  }

  .node-status {
    display: flex;
    align-items: center;
    gap: 10px;

    .status-testing {
      font-size: 12px;
      color: var(--bew-theme-color, #00aeec);
    }

    .status-latency {
      font-size: 13px;
      font-weight: 600;

      &.fast {
        color: #22c55e;
      }
      &.medium {
        color: #eab308;
      }
      &.slow {
        color: #ef4444;
      }
    }

    .status-error {
      font-size: 12px;
      color: #ef4444;
    }

    .test-btn {
      padding: 3px 8px;
      font-size: 12px;
      border-radius: 4px;
      border: 1px solid var(--bew-border-color, rgba(255, 255, 255, 0.2));
      background: transparent;
      color: var(--bew-text-2, rgba(255, 255, 255, 0.8));
      cursor: pointer;

      &:hover {
        background: var(--bew-fill-2, rgba(255, 255, 255, 0.1));
        color: var(--bew-text-1, #fff);
      }
    }
  }
}
</style>
