# Agent Note: dsh-desk 布局消费方 + 组装器开放边界（v1 实现设计）

Status: implemented

## Problem

§9 两个开放项开始实现：
1. **dsh-desk 四区布局消费方**：LayoutControl 已读写 `my-ui-layout` 配置但**无消费方应用显隐**。
2. **组装器开放边界**：① slots 型插件组装语义 ② CSS 覆盖回退 ③ 组装配置化（间距/工具显隐）④ rail 验收 ⑤ 通用性声明 vs 显式选择器列表。

## 调研结论（2026-08，源码确认）

- 官方 sidebar = `slots.register('sidebar', SidebarRoot)`（single 占位，注册即替换官方整列）；官方 `ctx.layout` 仅 `toggleSidebar()/openDetails()/closeDetails()`（翻转，无 getter）；AppFrame 在折叠时给容器加 `data-sidebar-collapsed` 属性（可读当前状态）。
- 官方**无 topbar 区域**：quick-nav 实际注册在 `conversation.session.header.actions`（会话头部），tabs 注册在 `conversation.view`（会话视图）。
- dsh-tabs / dsh-quick-nav 均已 inject `settingsScope`——**settings 本身就是跨插件共享配置**（同 namespace 各自 bind 即可读同一份）。

## Decision

### 1. 布局消费方（方案 B：跨插件契约 = 共享 settings 配置）

**核心机制：各插件读同一 `my-ui-layout` 配置决定是否注册**，不需要 dsh-desk 提供服务（settingsScope 天然共享）。

- **sidebar 显隐**（dsh-desk client）：订阅 `my-ui-layout`，`sidebar.visible=false` 且当前未折叠（读 `data-sidebar-collapsed`）→ `ctx.layout.toggleSidebar()` 折叠一次；`visible=true` 且已折叠 → 展开。用 DOM 属性对齐翻转语义，避免状态错乱。
- **tabs 显隐**（dsh-tabs client）：bind `my-ui-layout`，`tabs.visible=false` → **不注册** `conversation.view`（插件级跳过）。
- **topbar/actions 显隐**（dsh-quick-nav / dsh-desk client）：`topbar.visible=false` → quick-nav 不注册 `conversation.session.header.actions`；`actions` 随 sidebar 折叠（foot 区在侧边栏内）。
- **生效边界（v1）**：sidebar 显隐**实时生效**（LayoutConsumer 订阅 settings）；tabs/topbar 显隐为**启动时快照**（`slots.inject` 回调不重跑，配置变更需刷新页面——v1 接受，动态重注册留后续）。
- 设置页 LayoutControl 已是入口（读写同一配置），无需改 UI。

### 2. 组装器开放边界（v1 范围）

- **③ 配置化**：设置页扩展——foot 区间距（默认 2px）、工具显隐（taskboard/ssh/skill 三开关）。复用 LayoutControl 的 settings host，扩展配置 schema（`my-ui-layout` 加 `tools`/`footSpacing` 字段）。
- **⑤ 通用性**：组装器改为**运行时发现** `[data-dsh-part="sidebar-entry"]` 全部 entry（替代显式 3 选择器），配置可排除（`tools.<id>.visible=false` 不摆位）；顺序保持 DOM 出现序。
- **② CSS 回退**：覆盖不生效时**静默回退默认摆位**（re-parent 失败 = 保持插件原位置），不抛错——现有实现已如此，补注释与测试断言。
- **① slots 型组装语义**：git-graph/better-sidebar 是 slots 型——v1 **只做显隐开关**（配置控制注册，机制同 tabs），**不做 DOM 摆位**（位置由官方插槽语义决定，v2 评估）。
- **④ rail 验收**：无浏览器，保持 DOM 级验证（已实现）；视觉验收待有浏览器环境。

## Alternatives

- 方案 A（仅 sidebar 折叠 + 其余标注预留）：用户明确要 tabs/topbar 也生效 → 不选，走方案 B。
- dsh-desk 注册 'sidebar' 替换官方：需重写整个 SidebarRoot（品牌/折叠动画/浏览区），违反"抄官方" → 不选，用 toggleSidebar + data 属性对齐。
- 专用布局服务（ctx.myUi.layout）：settings 已共享，服务冗余 → 不选。

## Consequences

- 改动范围：dsh-desk（client：消费方 + 组装器配置化 + 通用性）、dsh-tabs / dsh-quick-nav（读配置决定注册）、dsh-desk 设置 schema 扩展。
- 跨插件契约 = `my-ui-layout` 配置 schema（文档同步 §5/§9）。
- worktree 分支 feat/dsh-desk-layout（依赖链：dsh-tabs/quick-nav 无下层依赖，可并行；dsh-desk 聚合）。
- 测试：dsh-desk 布局消费方（mock settings + DOM 属性）、组装器通用性/配置化、tabs/quick-nav 注册跳过。

## Implementation（2026-08-23 落地）

- `dsh-desk/src/index.ts`：Config 扩展 `assembler`（footSpacing 默认 2 + tools dict 显隐），`MyUiService.assembler()` 查询。
- `dsh-desk/src/client/LayoutConsumer.ts`：`startLayoutConsumer`——订阅 `my-ui-layout`，`sidebar.visible=false` 且未折叠（读 `data-sidebar-collapsed`）→ `ctx.layout.toggleSidebar()`；true 且已折叠 → 展开；`applied` 记录防重复翻转。
- `dsh-desk/src/client/ToolAssembler.ts`：**通用性**——运行时发现全部 `[data-dsh-part="sidebar-entry"]`（不限三家）；**配置化**——`footSpacing` 参数化注入 CSS、`tools.<id>.visible=false` 跳过摆位；CSS 回退静默（失败保持插件原位置，不抛错）。
- `dsh-desk/src/client/LayoutControl.tsx`：新增工具显隐 + foot 间距配置区；面板样式对齐官方设计语言（bg-layer-2/shadow-lv2/圆角 8/border-l2，修掉原 #1e1e1e 硬编码）。
- `dsh-tabs` / `dsh-quick-nav` client：bind `my-ui-layout`，`tabs.visible`/`topbar.visible=false` → 跳过 slots 注册（quick-nav 加 settingsScope inject + peerDeps）。
- 测试：dsh-desk 20（含 layout-consumer 5、assembler 通用性/排除/间距 3）、quick-nav client-layout 3；全 workspace 93 测试全绿，typecheck 6 包通过。
- 提交：worktree feat/dsh-desk-layout。
