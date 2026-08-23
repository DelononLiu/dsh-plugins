# Agent Note: 侧边栏插槽问题——全家桶 DOM 注入 vs 官方 slots 的组装边界

Status: proposed

## Problem

讨论了很久的"侧边栏槽位"问题：task-board / ssh / skill-explorer 在侧边栏的入口**到底注册到哪里**、dsh-desk 作为组装器**如何摆位**。调研结论（2026-08-22，见 [dsh-desk-workbench-tool-entries](../../implemented/feature/2026-08-22-dsh-desk-workbench-tool-entries.md)）：

- 这三个全家桶插件**不注册官方 sidebar 插槽**（task-board 唯一 slots 是 `web-ui.plugin.item` 设置卡片），而是各自打包同一套 `mountSidebarEntry`——MutationObserver 等官方侧边栏渲染后，把 `<button data-dsh-xxx-entry>` **直接 DOM 注入**到 sidebar root（logoRow 之后、工作区浏览区之前），位置写死、无 Config。
- dsh-desk 组装器（已实现）用 **re-parent + CSS 覆盖**接管摆位：entry 移到 footArea 顶部（控制台上方），样式对齐官方 `.trigger` 契约。

这解决了三个 DOM 注入型插件，但**暴露一组未决策的开放问题**，本 note 记录边界与待决策项（不重复已实现内容）。

## 开放问题

1. **官方 slots 型插件如何组装**：git-graph（`conversation.input.selector.context` / `conversation.input.dock`）、better-sidebar（`conversation.chat.turnTail` / `settings.section`）走官方 slots，位置由官方宿主决定、**无 entry 元素可搬**。dsh-desk 对它们能做的只有插槽级组合（order / 承接 / 隐藏）——但 vendored 不改注册目标，"承接"即借用既有插槽名（如 web-ui.plugin.item 教训：借错槽=摆错位）。**已落地**（2026-08）：git-graph 显隐开关（`assembler.slots.gitGraph`，CSS 覆盖 `[data-dsh-plugin="git-graph"]` chip+dialog，实时生效）；better-sidebar 为整体工作台框架（自带面板 toggle），不纳入组装——它自己的配置管。
2. **CSS 覆盖的脆弱边界**：覆盖依赖（a）插件类名/属性稳定（`data-dsh-part` 是全家桶约定，但非契约——插件升级可能改）；(b) 官方 css-modules hash 类名子串（`[class*="footArea"]` 等——hash 随构建变，子串比完整 hash 稳但非零风险）；(c) 插件若用 inline style / `!important` 则覆盖失效。**已落地**：失败静默策略（覆盖不生效时回退默认摆位而非硬错误）。
3. **组装配置化**：当前 foot 区间距（2px）硬编码在 CSS，工具入口列表（3 个选择器）硬编码在 `TOOL_ENTRY_SELECTORS`。dsh-desk 定位"可自定义是核心能力"——间距、工具显隐、摆位顺序应进设置页配置项（默认值仍与官方一致）。**已落地**：footSpacing / tools 显隐进设置页（实时响应）。
4. **Rail（折叠）态 entry**：已对齐官方 `.trigger.rail`（36px 圆、仅图标）。**已验收**（2026-08，web2 实测）：折叠/展开切换正常，图标居中、文字隐藏、无溢出。
5. **通用性声明 vs 硬编码**：note 声称"不限这三家，任何 `data-dsh-*-entry` 注入型插件都可被组装"，实现是显式选择器列表——新增插件要改代码。**已落地**：运行时发现（扫描 `[data-dsh-part="sidebar-entry"]` 全部 entry）。

## Alternatives

- **官方 slots 承接**：这三个插件根本不注册 sidebar slots（除 task-board 设置卡片），无槽可承 → 已否决（tool-entries note）。
- **改 vendored 源码（fork）**：违反 vendoring policy → 已否决。
- **CSS order 重排**：需覆盖官方 footArea/regionArea order（改官方 CSS 契约），折叠态更脆弱 → 已否决，DOM re-parent 语义更直接。

## Consequences

- 已实现部分：三个 DOM 注入型插件摆位 + 样式统一（见 implemented note）。
- 开放问题 1-5 已全部落地（②③④⑤ + ① git-graph 显隐开关）——组装器从"三个工具"走向"通用组装平台"（运行时发现 + 配置化 + slots 型显隐）；better-sidebar 明确不纳入组装（框架自带 toggle）。本 note 各问题均已标记落地状态。
- 后续若出现新的 slots 型插件需要组装：沿用 `assembler.slots` 配置 + CSS 覆盖机制（加一项即可），不重复建决策。
