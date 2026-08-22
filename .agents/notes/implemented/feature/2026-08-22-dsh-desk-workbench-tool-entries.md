# Agent Note: dsh-desk 组装器——把全家桶工具入口摆到「控制台上面」

Status: implemented

## Problem

用户确认 task-board / ssh / skill-explorer 的入口（侧边栏行按钮）**可见且可点击**，显示在**左侧边栏"工作区"上面**。需求：这三个工具入口应显示在**左侧边栏"控制台"上面**（即 dsh-console 的 ConsoleBadge 上方），而不是当前的工作区上面、也不是底部工具条。

需要先搞清这三个 vendored 插件**真实注册到哪里**（用户明确要求看源码，不要猜），再设计移动机制。

## 调研结论（源码确认，2026-08-22）

### 三个插件同一套渲染机制：不走官方 slots，MutationObserver + 直接 DOM 注入

三个包（`@linxin666/dsh-ssh`、`@linxin666/dsh-client-ui-task-board`、`@linxin666/dsh-client-ui-skill-explorer`）的 `lib/client.js` 里是**同一套 sidebar-entry 注入代码**（各自打包，结构一致）：

1. **`mountSidebarEntry()`**：MutationObserver 监听 `document.body`，等官方侧边栏渲染后，把一行 `<button data-dsh-xxx-entry>`（taskboard/ssh/skill-explorer 各自的 entry 按钮）**直接插入官方侧边栏容器**。
   - `sidebarRoot()` = `[data-pane="sidebar"]` 或 `[class*="sidebarCol"]` 里 `[class*="logoRow"]` 的 `parentElement`（即官方 SidebarRoot 的 `.root` 列容器）。
   - `newSessionButton(root)` = `button[class*="newSession"]`（官方"新建会话"按钮）。
   - `placeEntry`：找 logoRow 行（含新建会话按钮），`root.insertBefore(entry, anchor)`，anchor = 已插入 family 的最后一项的 nextSibling 或 base.nextSibling → **落点 = logoRow 行之后、工作区浏览区（regionArea）之前**。这就是用户看到的"左侧边栏工作区上面"。
   - family 排序：taskboard → ssh → skill-explorer（`familySelectors` 依次匹配）。
2. **自愈机制**：两个 MutationObserver（body 级 waitObserver + root 级 rootObserver），React 重渲染后自动重新插入 entry。entry 是纯 DOM（非 React 树），点击 toggle 各自面板。
3. **面板挂载**：
   - task-board：`mountBoard` → `conversationColumn()`（对话列）appendChild + createRoot → 看板面板（`data-dsh-taskboard-view`）。
   - ssh：`mountPanel` → `conversationColumn()` appendChild + createRoot → 终端面板。
   - skill-explorer：`mountPanel` → `document.body.appendChild` + createRoot → 全屏 overlay。
4. **task-board 额外**：`ctx.slots.inject("web-ui.plugin.item")` → 注册 `TaskBoardSettingsCard`（设置卡片，`settingsScope` bind `task-board` 命名空间，`enabled` 开关控制 UI 挂载）。这是唯一走官方 slots 的地方（设置卡片），与侧边栏 entry 无关。
5. **无 Config**：三个包 host 面 grep 不到 `static Config`——入口位置写死在 client.js，无配置项可改。

### 官方侧边栏结构（SidebarRoot.tsx + SidebarRoot.module.css）

```
.root (flex column)
├── .logoRow        (品牌 + 折叠 toggle, 60px)
├── .newSession     (新建会话按钮, 38px)
├── .regionArea     (flex:1, sidebar.workspaces 插槽 = 工作区/会话浏览)
└── .footArea       (flex:none, column)
    ├── .footerActions  (sidebar.footer.action 插槽 = ConsoleBadge「控制台」所在)
    └── .settingsArea   (sidebar.settings 插槽 = 设置)
```

`sidebarRoot()` 拿到的就是 `.root`；entry 插入位置 = `.newSession` 之后、`.regionArea` 之前 → 视觉上"工作区上面" ✓。

### 目标落点（用户需求）

「控制台」= ConsoleBadge（`sidebar.footer.action`，footArea 的 footerActions 里）。目标：三个 entry 显示在 **footArea 顶部、footerActions 之前**（即 ConsoleBadge 上方），纵向堆叠。

## Decision

**dsh-desk 组装器接管摆位**（符合 dsh-desk 定位：用什么插件、摆在哪）：

1. dsh-desk client 增加一个**组装器模块**（MutationObserver 驱动）：
   - 等三个 entry（`[data-dsh-taskboard-entry]` / `[data-dsh-ssh-entry]` / `[data-dsh-skill-explorer-entry]`）出现；
   - 等官方 footArea（sidebar root 内最后一个 flex-column 区 / `[class*="footArea"]`）出现；
   - 把 entry **re-parent 到 footArea 顶部（footerActions 之前）**，保持 taskboard → ssh → skill 顺序。
2. **自愈兼容**（关键，源码已验证）：
   - entry 仍在 sidebar root（`.root`）内部 → `root.contains(entry)` 为 true → rootObserver 不重插 ✓；
   - entry 仍在 document.body 内 → waitObserver 的 `tryPlace` 直接 return ✓；
   - 所以**移到 root 内部其他位置不会触发插件的自愈拉回**。
3. **行为不变**：re-parent 不丢事件监听（listener 绑在元素上），点击 toggle 面板照旧；CSS 不动（entry 自带 `.entry` 样式：`width:100%; min-height:36px; border-radius:8px; display:flex; align-items:center; gap:10px; padding:0 10px; font-size:13px; color:var(--dsw-alias-label-secondary)`）。
4. **不动 vendored**：不 fork、不改 client.js、不加 Config；dsh-desk 只做运行时摆位。
5. 折叠态（rail）：折叠时官方 footArea `align-items:center`、footerActions `width:auto`——entry 在 rail 下宽度/对齐可能溢出，需处理（rail 下隐藏或缩成图标行，v1 可先隐藏三个 entry 的文案或整体，视测试环境验证）。

## Alternatives

- **CSS 视觉重排**（flex order）：entry 是 root 直接子元素，可用 order 排到 footArea 之前——但需覆盖官方 footArea/regionArea 的 order（改官方 CSS 契约），折叠态 rail 下更脆弱；DOM re-parent 语义更直接、只动 entry 自身。不选。
- **改 vendored 源码（fork）**：违反 vendoring policy。不选。
- **官方 slots 承接**：这三个插件根本不注册 sidebar slots（除 task-board 的设置卡片），无槽可承。不选。

## Consequences

- dsh-desk = 工作台组装器的第一个真实摆位能力（运行时 DOM 摆位，不限这三家，后续任何 `data-dsh-*-entry` 注入型插件都可被组装）。
- 三个工具入口从"工作区上面"移到"控制台上面"（footArea 顶部、ConsoleBadge 上方）。
- 自愈兼容已源码验证；测试环境（web2 3082 管理端）可实测。
- 后续：折叠态 rail 处理、组装配置（设置页开关：哪些 entry 摆位/隐藏）。

## Implementation（2026-08-23 落地）

- `packages/dsh-desk/src/client/ToolAssembler.ts`：`startToolAssembler()` —— MutationObserver 观察 body，等官方 sidebar root + footArea 出现后，把三个 entry（`[data-dsh-taskboard-entry]` / `[data-dsh-ssh-entry]` / `[data-dsh-skill-explorer-entry]`）re-parent 到 footArea 顶部（footerActions 锚点之前），保持 taskboard → ssh → skill 顺序。选择器与 vendored `sidebarRoot()` 一致（`[data-pane="sidebar"]` / `[class*="sidebarCol"]` → logoRow parentElement）。
- `src/client/index.ts`：apply 中启动组装器，disposer 进 `ctx.effect`。
- 测试：`tests/assembler.spec.ts`（happy-dom 环境，4 用例：摆位顺序 / 晚注入等待 / 侧栏未渲染容错 / disposer 断开），`vitest.config.ts` 新增；共 7 测试全绿。
- 验证：web2（3082）`/plugins/dsh-desk/client.js` 200 且含组装器；全家桶 bundle（task-board / ssh / skill-explorer / git-graph / better-sidebar）全部 200。
- 提交：worktree feat/dsh-desk-workbench。
