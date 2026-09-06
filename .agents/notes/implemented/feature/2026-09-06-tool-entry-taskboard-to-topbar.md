# Agent Note: 任务看板入口移到会话头快捷导航右侧

Status: implemented

## Problem

任务看板（task-board）入口此前与 SSH/技能中心一起，由 dsh-desk 组装器摆到侧边栏底部
footArea（控制台上方）。需求：把「任务看板」入口移到**顶部会话头 ⚙快捷导航 的右侧**，
侧边栏底部不再显示任务看板入口；SSH/技能中心保持 foot 现状不变。

关键约束：task-board 插件的入口由它自己的 `mountSidebarEntry` 维护，带
MutationObserver 自愈——一旦发现入口 `!root.contains(entry)`（root=官方侧边栏根）
就把它 re-insert 回侧边栏根；同时 dsh-desk 组装器也 observer 整个 body。因此
**不能把插件原始入口 DOM 移出侧边栏根**，否则两个 observer 互相打架（插件拉回、
组装器再搬 → 无限 DOM 抖动）。

## Decision

- **不移动插件原始节点**，改而**隐藏 + 新建转发按钮**：任务看板原始入口保留在侧边栏根内
  `display:none`（自愈不触发），另**新建一个顶部按钮**（非插件节点、可自由管理）插到
  quick-nav root span 之后（其右侧）；点击顶部按钮时对隐藏原始入口 `.click()` 转发
  （原始入口的 click 监听照旧调 `controller.toggleBoard()` 打开看板，行为与原来一致）。
- **顶部锚点走 `data-dsh-quicknav`**：dsh-quick-nav 的 QuickNav root
  `<span data-dsh-quicknav>`（空值属性）是其组件本体稳定锚点；组装器取每个已连接
  quick-nav 的 parentElement 作容器，往容器里、quick-nav span 之后插顶部按钮。
- **幂等/自愈**：顶部按钮自带 `data-dsh-desk-top-taskboard`（非 `data-dsh-part`，
  免 discovery 再处理），重复摆位不重复创建；容器因 React 重建/切换消失时重查补回；
  原始入口被插件卸载时清掉已建按钮；disposer 移除按钮、恢复原始入口显隐。
- **无顶部目标回退 foot**：无已连接 quick-nav（quick-nav 未装 / 无会话头）时，任务看板
  照旧摆到 footArea 顶部（保持旧语义），仅存在可用顶部目标时走顶部摆位。
- **配置排除语义不变**：`assembler.tools.taskboard.visible=false` 时不建顶部按钮、
  原始入口照旧彻底隐藏。

## Alternatives

- **把插件原始节点 re-parent 进会话头**：会与插件自愈 rootObserver 打架（插件把它拉回
  侧边栏根），触发无限 DOM 抖动。否决。
- **CSS 视觉移入顶部容器 / clone 副本**：clone 会让点击走副本而脱离插件 toggle 语义；
  CSS 跨容器搬运既破坏插件按钮契约又不稳定。否决。
- **顶部也放纯文本不带图标**：实现简单、视觉与快捷导航按钮一致即可，文本「任务看板」
  足够，图标非必需（原入口 `.entryIcon` svg 若需可复用，本版取文本方案）。

## Consequences

- 任务看板入口现位于会话头快捷导航右侧；侧边栏底部只剩 SSH/技能中心（foot 控制台上方）。
- 触达改由顶部按钮转发 `.click()`——插件 toggle/面板逻辑零改动、纯 DOM 转发。
- 顶部容器与侧边栏并存：若会话头消失（无快捷导航）自动回退 foot，不丢入口。
- 受影响文件：dsh-quick-nav `QuickNav.tsx`（加 `data-dsh-quicknav` 锚点）；dsh-desk
  `ToolAssembler.ts`（顶部摆位 + 回退）、`LayoutControl.tsx`（设置文案）、
  `tests/assembler.spec.ts`；`docs/architecture.md`（工具入口组装器段落）。

取代先前的全家桶摆位现状（[2026-08-22-dsh-desk-workbench-tool-entries](2026-08-22-dsh-desk-workbench-tool-entries.md)）
——原 note 描述「三工具全摆 foot」为被取代阶段，任务看板摆位现以本 note 为准。
