# Agent Note: dsh-tabs 会话 tabs——Alt+P 固定会话注册 conversation.view 条目

Status: implemented

## Problem

dsh-tabs 的 tab 形态/位置反复迭代后，用户最终拍板（2026-08-21）：**浏览器式会话 tabs**——每个会话一个 tab，点击该 tab 选中并显示该会话内容，位置在官方「对话/轨迹」视图 tabs 的**同一行**。用户指出官方 conversation.view 机制可把 tab 加进「对话/轨迹」行（其 open-file 插件即如此，rc0.7），只是需要**动态多个**。

实测后又多次修正（2026-08-21）：①「对话」与会话 tab 同时高亮不好——要求**单一划线**；②**点击左侧会话默认在「对话」视图，只有按 Alt+P 才把当前会话固定到 tab 标签**——tab 行**只显示固定的会话**；③**「对话」tab 需要会话记忆**（VSCode preview 模型：对话与固定 tab 切换显示不同 session）；④**「轨迹」tab 保持官方行为**（不切记忆）；⑤点固定 tab 从轨迹视图回来要恢复对话。

被否决的路径（不重走）：shell.overlay 顶部 tab 条（用户"真他妈丑"）；替换 `conversation.session.header`（single seat 需 priority -10 shadow，丢面包屑/actions 且官方 header 无注入点，用户"没别的方法了吗"）；单个「会话」视图内容条（要点开才展开）；`●` 文本前缀标记（用户否定）；状态机化（划线/记忆/残留三态机，反复出 bug，后按"方案整体设计"收敛为最小状态）。

## Decision

**Alt+P 固定会话 → 动态注册 `conversation.view` 条目**（open-file 同款机制），保持官方行、接受官方机制，逻辑收敛为最小状态（非状态机）：

- **固定制**：点击左侧会话只在「对话」视图（不产生 tab）；Alt+P 固定/取消固定当前会话（toggle），固定列表经 host `settingsNamespace('dsh-tabs-pinned')`（schema `{ pinned: string[] }`）持久化；tab 行只注册**固定且存在**的会话（订阅 sessions.list + settings 双源）。条目 `id: 'session-<id>'`、`order: 100 + index`（官方 tab 之后留足空间）、label 显示「编号. 标题」+ 尾部可见 ` ×`、`inject` 提供 `{ targetId, open, prune }`（字段名避免与框架标准 props 的 sessionId 冲突）。
- **选中划线（单一，官方样式，DOM 层）**：官方 tab 高亮只看 chatStore.view（对话/轨迹），会话 tab 永远不是 active，且 tab button 由官方 header 渲染、无法加 class。方案：label thunk 给会话 tab 打不可见标记（`\u200B` 区分官方 tab + `\u2060` 划线标记），注入 CSS（`button[role="tab"].dsh-tabs-active` 复刻官方 tabActive：蓝字+底部条；`body.dsh-tabs-pinned-active` 抑制官方划线），MutationObserver 扫描 `button[role="tab"]` 机械映射 class。**划线 = 最后激活的 tab（单一）**：一个布尔 `officialView`（官方视图模式）+ 完整事件表 8 条——点官方 tab → 官方划线（轨迹选中不被抑制）；点会话 tab/固定/切到固定会话 → 会话 tab 划线；×/取消固定/切到未固定会话 → 官方划线；`tabMode = !officialView && 当前固定`。
- **「对话」会话记忆**（VSCode preview 模型）：`dialogSession` 记录「对话」tab 看的会话（切换前）；点「对话」→ 记忆存在且非当前则 `open(记忆)`；「轨迹」保持官方（不切记忆）；切到未固定会话/取消固定/×关闭当前 → 记忆跟随；点会话 tab/固定 → 记忆保持。`pendingDialogView` 过渡标记：点「对话」切回记忆后保持对话视图，不被"进入固定会话 → 会话 tab 划线"覆盖。
- **点击会话 tab 切换**：官方 setView(`'session-<目标>'`) 污染**来源**会话的 view（残留导致切回时命中条目自动弹回 → 死循环）——SessionView 挂载时 `pruneStoreScope(来源)` 清掉；`open(目标)` 走官方可靠路径，目标残留（如轨迹）由 `onCurrentChange` 统一清（新当前默认对话，需求：点击左侧会话默认在「对话」）。
- **点自己的 tab（从轨迹视图回来恢复对话）**：拦截官方 setView（否则 view 污染成 `'session-<当前>'` → 内容区占位）+ `pruneStoreScope(当前)` 清轨迹残留 + **程序化触发官方「对话」tab**（`chatBtn.click()` → 官方 `setView('chat')`——chatStore 不可达，官方「对话」tab 是唯一可靠的"切到对话"入口）；`programmaticClick` 标记绕过本插件的 document 委托（否则被当成真实点对话 → 覆盖 officialView + 触发记忆切回 → 划线漂移）。
- **事件委托**（document click capture，先于官方 onClick）：仅 × 热区（`rect.right - 24px`，preventDefault 防误触 setView）、点自己的 tab、模式切换与对话记忆切回；其余交官方。Alt+P（window keydown，排除修饰键）。

## Consequences

- tab 直接出现在官方「对话/轨迹」行（固定会话，排在对话/轨迹之后），点击即切换会话；Alt+P 固定/取消固定，固定列表持久化。
- 单一划线：最后激活的 tab（会话 tab 或官方「对话/轨迹」），永不双划线；「轨迹」保持官方（当前会话轨迹，不切记忆）。
- 清残留三个点、职责明确：SessionView 清来源（防死循环）· onCurrentChange 清新当前（左侧默认对话）· 点自己的 tab 恢复对话（prune + 程序化官方路径）。
- 官方「对话/轨迹」功能与代码完全不动（仅划线视觉让位）。
- 相关：早期骨架 note [2026-08-21-tabs-skeleton.md](2026-08-21-tabs-skeleton.md)（顶栏 tab + Alt+1..9 设计已被本决策取代）。
