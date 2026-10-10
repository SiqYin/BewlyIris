export type UposHostRegion = 'mainland' | 'overseas'

export interface UposNodeConfig {
  id: string
  name: string
  host: string
  region: UposHostRegion
  description?: string
}

/// 自动模式：按当前 IP/地区智能选择（大陆不干预、海外挑最快 *ov 镜像）。
export const AUTO_UPOS_NODE_ID = 'auto'

/// 仅收录 `upos-sz-mirror*.bilivideo.com` 家族——DNR 改写主机时路径签名不变，
/// 换同族镜像安全；Akamai / hk_bcache 主机签名不同，改写会 403，故不纳入。
export const UPOS_NODES: UposNodeConfig[] = [
  {
    id: 'mirrorcosov',
    name: '腾讯云海外 (cosov)',
    host: 'upos-sz-mirrorcosov.bilivideo.com',
    region: 'overseas',
    description: '抗抖动佳，海外首选',
  },
  {
    id: 'mirroraliov',
    name: '阿里云海外 (aliov)',
    host: 'upos-sz-mirroraliov.bilivideo.com',
    region: 'overseas',
    description: '阿里云国际链路',
  },
  {
    id: 'mirrorhwov',
    name: '华为云海外 (hwov)',
    host: 'upos-sz-mirrorhwov.bilivideo.com',
    region: 'overseas',
    description: '华为云海外节点',
  },
  {
    id: 'mirrorcos',
    name: '腾讯云国内 (cos)',
    host: 'upos-sz-mirrorcos.bilivideo.com',
    region: 'mainland',
    description: '大陆主干首选',
  },
  {
    id: 'mirrorali',
    name: '阿里云国内 (ali)',
    host: 'upos-sz-mirrorali.bilivideo.com',
    region: 'mainland',
    description: '阿里云大陆节点',
  },
  {
    id: 'mirrorhw',
    name: '华为云国内 (hw)',
    host: 'upos-sz-mirrorhw.bilivideo.com',
    region: 'mainland',
    description: '华为云融合 CDN',
  },
  {
    id: 'mirrorbos',
    name: '百度云国内 (bos)',
    host: 'upos-sz-mirrorbos.bilivideo.com',
    region: 'mainland',
    description: '百度云大陆节点',
  },
]

export const DEFAULT_UPOS_NODE_ID = AUTO_UPOS_NODE_ID
