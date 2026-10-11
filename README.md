# BewlyIris

<p align="center">
  <img width="200" alt="BewlyIris" src="./assets/icon-512.png"><br/>
</p>

<p align="center">让 Bilibili 更好用的浏览器扩展 · 内置 PiliBabel 海外 CDN 线路优选</p>

BewlyIris 是一个 Bilibili 网页增强扩展：重构并美化首页、动态、搜索、收藏、历史等页面，增强播放器体验，并集成了 **PiliBabel** 的海外 CDN 节点优选（UPOS + 动态延迟测速），改善海外访问时的加载与播放体验。

## 功能特性

### 页面与浏览

- 首页 / 动态 / 搜索 / 收藏 / 历史 / 稍后再看等页面的界面重构与美化
- 顶栏与 Dock 自定义，支持后台打开、前进后退
- 视频卡片、播放器组件的自定义快捷键
- BewlyIris 宽屏模式与侧栏自适应
- 局部音量均衡（目标响度、强度可调）
- 听视频模式（隐藏画面，仅保留声音）
- 合集随机播放、倍速记忆、暗色基准色自定义

### 海外加速（PiliBabel）

- 视频 CDN 与海外线路优选：UPOS 节点选择器 + 动态延迟测速
- 播放与下载链路复用同一套线路优选逻辑

> 完整功能与差异说明见 [`docs/`](./docs)。

## 安装

BewlyIris 目前仅通过 GitHub Releases 分发，未上架任何浏览器商店。

1. 到 [Releases](https://github.com/SiqYin/BewlyIris/releases) 下载最新的 `extension.zip`。
2. 解压得到包含 `manifest.json` 的目录。
3. 打开 `chrome://extensions`（或 `edge://extensions`），在右上角开启「开发者模式」。
4. 点击「加载已解压的扩展程序」，选择上一步解压出的目录。

> 若同时安装并启用了 BewlyCat，请先停用其中一个，避免功能叠加冲突。

## 构建

构建与开发说明见 [CONTRIBUTING](./docs/CONTRIBUTING-cmn_CN.md)。

## 品牌资源

- 图标 · 高清 PNG（2048×2048）：[`brand/bewlyiris-icon.png`](./brand/bewlyiris-icon.png)
- 图标 · 矢量 SVG（1024×1024）：[`brand/bewlyiris-icon.svg`](./brand/bewlyiris-icon.svg)
- 鸢尾花纹章 · 纯白矢量 SVG：[`brand/fleur-de-lis-white.svg`](./brand/fleur-de-lis-white.svg)

## 鸣谢

BewlyIris 是 [BewlyCat](https://github.com/keleus/BewlyCat) 的 fork，在其基础上合并了 PiliBabel 的海外 CDN 线路优选，并完成了品牌与功能方向的独立化。BewlyIris 的诞生离不开以下上游项目与作者：

- [BewlyCat](https://github.com/keleus/BewlyCat) 及其作者 **Keleus** —— BewlyIris 的代码基础与主要功能来源，本项目在其之上继续发展。
- [BewlyBewly](https://github.com/BewlyBewly/BewlyBewly) —— BewlyCat 的上游基础。
- [PiliBabel](https://github.com/SiqYin/PiliBabel) —— 海外 CDN 线路优选机制的来源。
- [vitesse-webext](https://github.com/antfu/vitesse-webext) —— 项目使用的扩展模板。
- [Bilibili-Evolved](https://github.com/the1812/Bilibili-Evolved)、[bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)、[bilibili-app-recommend](https://github.com/magicdawn/bilibili-app-recommend) —— 部分功能与接口的实现参考。

## 许可

BewlyIris 继承 BewlyCat 的自定义许可（在 MIT 协议基础上附加限制），完整条款见 [LICENSE](./LICENSE)。请勿将本项目或其衍生代码用于该许可所禁止的用途（例如任何形式的客户端封装）。

## 贡献者

[![Contributors](https://contrib.rocks/image?repo=SiqYin/BewlyIris)](https://github.com/SiqYin/BewlyIris/graphs/contributors)
