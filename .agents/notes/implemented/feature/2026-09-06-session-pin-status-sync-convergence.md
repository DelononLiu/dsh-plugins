# Agent Note: MutationObserver 驱动的 DOM 同步必须幂等收敛

Status: implemented

## Problem

置顶区状态点（`PinnedStrip.syncRows`）上线后，**发一条消息整页卡死**：会话
`running` → 置顶行渲染状态点 → 渲染主线程被饿死，页面永久冻结。根因不是数据
契约，而是 DOM 同步机制的**收敛性**缺陷：

- `startPinnedStrip` 在 `document.body` 挂全站 `MutationObserver`（`childList:
  true, subtree: true`），body 任何变更都重跑 `sync`；
- 旧 `syncRows` 对状态槽**无条件** `replaceChildren()` + `appendChild(新建点)`——
  状态没变也必然产生 childList 变更；
- 浏览器里 MutationObserver 回调按微任务派发：自己写的 DOM 又触发 observer →
  再 sync → 再写 → **微任务永不排空**，渲染主线程饿死。空闲行无点、无写入时
  不触发，所以症状是「发消息（出状态点）才卡」，且一旦卡住不自行恢复。

单测全绿但抓不到：happy-dom 的 MutationObserver 派发语义与真实浏览器不同，
且既有用例只做「一次性 sync 后断言结果 DOM」，从不验证「状态不变再 sync 是否
零变更」。

## Decision

**observer 驱动的 DOM 同步必须幂等收敛（写 DOM 前先比对，状态/内容未变则零写），
且 observer 不因自己的写入回环。**

- **状态槽幂等更新**：`syncStatusSlot` 比对期望点（done/warning 圆点 / ongoing
  矩阵 / 空闲空槽）与槽内现状，一致则不动 DOM，不一致才重建一次。
- **observer 忽略本区内部写入**：回调只响应置顶区之外（`target` 不在
  `[data-dsh-pinned-strip]` 内）的变更——本区内容完全自持、无他人改动，忽略
  自身写入不影响 React 重排后的自愈重插。
- 同为高频率同步热点的 `title`/可见文本写入也加等值守卫，避免属性/文本抖动。
- **回归测试**：`tests/pinned-strip.spec.ts` 加「状态点已渲染后，状态不变再次
  同步零 DOM 变更」用例（`MutationObserver.takeRecords()` 同步断言零 childList
  记录）——修复前必红、修复后全绿。

## Alternatives

- **仅断开/重连 observer 包住每次 sync（mutation batching）**：可行但脆弱——
  一旦未来某处写入漏包或异步插入，回环复发；收敛 + 过滤自身写入是结构性根治。
- **缩小 observer 范围（只观察侧边栏子树）**：仍会因会话页流式渲染等外部变更
  高频触发，收敛性缺陷依旧；收敛是必要条件，不因观察范围而免除。

## Consequences

- 置顶区 sync 现为纯收敛路径：任何外部变更（流式渲染/React 重排/会话更新）触发
  sync 都是 O(行数) 的比对，状态不变零 DOM 写。
- 同类风险存在于其它「全站 MutationObserver + 写 DOM」的同步代码（如
  `index.ts` 的划线 `applyActive`）——后续任何此类代码须遵守本约束：
  先比对后写入、observer 忽略自身子树写入、配收敛回归用例。
- 不改变任何数据/视觉契约，纯实现收敛性修复；功能 note 见
  [session-pin-sidebar-strip](./2026-09-06-session-pin-sidebar-strip.md)。
