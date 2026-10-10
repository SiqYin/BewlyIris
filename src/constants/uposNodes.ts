export interface UposNodeConfig {
  id: string
  name: string
  host: string
  region: 'overseas' | 'mainland'
  description?: string
}

export const UPOS_NODES: UposNodeConfig[] = [
  {
    id: 'mirrorcosov',
    name: '腾讯云海外节点 (海外优化/推荐)',
    host: 'upos-sz-mirrorcosov.bilivideo.com',
    region: 'overseas',
    description: '针对日本、东南亚等海外 IP 优化，抗抖动表现佳',
  },
  {
    id: 'mirroraliov',
    name: '阿里云海外节点 (海外优化)',
    host: 'upos-sz-mirroraliov.bilivideo.com',
    region: 'overseas',
    description: '阿里云国际链路优化节点',
  },
  {
    id: 'mirrorhw',
    name: '华为云节点',
    host: 'upos-sz-mirrorhw.bilivideo.com',
    region: 'mainland',
    description: '华为云全国骨干节点，部分海外线路直连速度较快',
  },
  {
    id: 'mirrorcos',
    name: '腾讯云国内节点',
    host: 'upos-sz-mirrorcos.bilivideo.com',
    region: 'mainland',
    description: '腾讯云大陆节点，国内主干网络首选',
  },
  {
    id: 'mirrorali',
    name: '阿里云国内节点',
    host: 'upos-sz-mirrorali.bilivideo.com',
    region: 'mainland',
    description: '阿里云大陆节点',
  },
  {
    id: 'mirrorbos',
    name: '百度云节点',
    host: 'upos-sz-mirrorbos.bilivideo.com',
    region: 'mainland',
    description: '百度云大陆节点',
  },
]

export const DEFAULT_UPOS_NODE_ID = 'mirrorcosov'
