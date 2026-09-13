# dsh-plan-show：AI 产物的「Show 层」——场景 / 易用性 / 功能面 + 分期（方案草稿）

Status: draft（待并入外部调研；每个决定都要用户拍板后才进入实现）

> **定位升级（2026-09-13 用户补充）**：这不是"计划阶段的一个小面板"，而是**标志性功能**——
> AI 在每个阶段都需要一个"show"：**show 方案 · show 计划 · show 缺陷 · show 验收 · show 完成**。
> 包名 `dsh-plan-show` 保留（历史），能力范围按"产物呈现层（Show layer）"设计。
> 开发方式：MVP 先头脑风暴 → 逐步细化明确，**不一次性做全**。

## 0. 为什么这是标志性功能

AI 协作里**最需要被人判断**的东西，全都是"结构化产物"：方案（批不批）、计划（做哪几步）、
缺陷（是不是真 bug、根因在哪）、验收（凭什么说做完了）、完成（到底改了什么）。而它们现在的
呈现方式是**大段 markdown 文字**或**一行摘要**——用户要滚动阅读、脑内还原结构、自己记进度、
自己核对证据。

反面证据（我们已核实的官方基线）：官方在每个阶段都只给了"最小呈现"，没有统一的产物面。

| 阶段 | 官方现有呈现 | 类型 | 证据 |
| --- | --- | --- | --- |
| 提方案 / 审阅 | `PlanReviewPanel`：**一张卡片 + 整篇 markdown** + 讨论/拒绝/批准 | 计划 | `ui-user-questions/src/client/PlanReviewPanel.tsx` |
| 执行中 | `todo_write` 行 = **一行摘要** `已完成 d/total · 当前项 (+N 并行)` | 进度 | `ui-tool/.../toolviews/{todo-row.tsx,plan-summary.ts}` |
| 目标 | GoalBar（`conversation.input.dock`）+ `useProjection('goal')` | 目标 | `ui-goal/src/client/index.ts` |
| 完成 | `ui-deliverables`：**只列产出的文件**（来自 mutation tools 的 `locations`）+ 内联文件链接 | 产物文件 | `ui-deliverables/README.md` |
| 缺陷 | 无专用面（就是一条消息） | — | — |
| 验收 | 无专用面（就是一句"验证过了"） | — | — |

**缺口**：没有结构化模型、没有跨阶段的统一面、批准/验收/完成的**证据链**不可见、计划 vs 实际
的漂移不可见。做对了，用户从"读文字 + 自己核对"变成"扫一眼 + 做决定"。

## 1. 五类 show（产物 × 阶段）

| # | Show | 阶段 | 要给用户看什么 | 用户要做什么 | 主要数据源 |
| --- | --- | --- | --- | --- | --- |
| 1 | **show plan** | 提议 | 目标 / 步骤 / 影响面 / 风险 / 待定 / 验证方式 | 批准 · 改 · 讨论（子集批准） | plan-review 的 `plan` markdown、todo_write、goal |
| 2 | **show 方案（options）** | 决策 | 2-4 个方向的并列对比：做法 / 代价 / 风险 / 适用场景 | 选一个 · 指定合并 · 追问 | agent 输出的选项块（约定格式或结构化工具） |
| 3 | **show bug** | 排障 | 症状 / 复现步骤 / 证据（日志·栈·命令输出）/ 根因 / 修复面 / 影响范围 | 确认复现 · 认可根因 · 选修复范围 | 会话中的调查输出、命令结果、`diagnosing-bugs` 类流程产物 |
| 4 | **show 验收（verify）** | 验收 | 判据（acceptance criteria）× 证据（命令 / 结果 / 产物）矩阵：**每条判据对应可见证据** | 验收通过 · 打回并指出哪条不达标 | 测试/构建/闸门命令输出、子代理结论、文件 diff |
| 5 | **show 完成（completion）** | 完成 | 改了什么（范围）/ 证据 / 遗留与未做 / 风险与回滚 / 下一步 | 接受 · 重开 · 归档 | 提交记录、deliverables 文件行、todo 终态、note 链接 |

补充（后续）：**show diff/漂移**（计划 vs 实际范围）、**show 复盘**（事故时间线 + 取证）。

## 2. 统一产物模型（一个模型撑五类 show）

不做五套私有模型（呼应"整体性"纪律）。一个 `Artifact`：

```
Artifact {
  id, kind: 'plan'|'options'|'bug'|'verify'|'completion',
  stage: 'propose'|'decide'|'track'|'verify'|'done',
  title, summary,            // 结论先行
  sections: [{ id, title, kind: 'goal'|'steps'|'impact'|'risk'|'verify'|'context'|'other',
               text[], bullets[], items[] }],
  items: [{ id, text, status: 'todo'|'doing'|'done'|'blocked',
            dependsOn[]?, evidence[]?, files[]?, owner? }],
  decisions: [{ id, question, options:[{id,label,detail,cost,risk}], chosen?, rationale? }],
  evidence: [{ id, itemId?, kind:'command'|'test'|'file'|'log'|'link', label, value, result:'pass'|'fail'|'info' }],
  openQuestions: [{ id, text, blocking: boolean }],
  links: [{ kind:'note'|'commit'|'session'|'url', label, href }],
  version, producedAt, approvedAt?, status
}
```

五类 show = 同一渲染核心 + 不同**视图权重**与**动作集**：
- plan → 步骤/风险优先，动作 = 批准/改/讨论
- options → decisions 并排，动作 = 选/合并
- bug → evidence 与时间线优先，动作 = 确认/选范围
- verify → items×evidence 矩阵，动作 = 验收/打回（**打回必须能指向具体条目**）
- completion → 范围与遗留优先（与官方 deliverables 互补：它给文件，我们给"做了什么/没做什么/凭什么"）

## 3. 视图（三个方向，保留供选择）

- **提案卡（sheet）**：分块卡片 + 状态点 + 进度条 —— **决策优先**（默认）。
- **看板（board）**：待办/进行中/完成 三列（含并行、阻塞） —— **执行优先**。
- **流程图（flow/DAG）**：步骤顺序/依赖/并行泳道 + 影响面 —— **关系优先**。
- 备选：**证据矩阵**（verify 专属）、**对比视图**（options / 漂移）。

## 4. 分期（按"不要一把做完"）

| 期 | 范围 | 用户能立刻得到什么 | 依赖 |
| --- | --- | --- | --- |
| **MVP-1** | **show 验收（verify）** 或 **show plan**（二选一，待拍板）+ 提案卡视图 | 一次决定（批/验收）不再靠读长文 | 数据源 B 或 A（见 §5） |
| MVP-2 | 执行中联动（看板 + todo 实时状态） | "做到哪、卡在哪"常驻可见 | 会话 todo 投影 |
| MVP-3 | show 完成（范围/证据/遗留） | 收尾不再靠回忆 | deliverables + 提交/note |
| MVP-4 | show bug（症状/复现/根因/证据） | 排障结论可核 | 调查产物约定 |
| MVP-5 | options 对比 + 漂移视图 | 选型与跑偏可见 | 模型稳定后 |

**推荐 MVP-1 = show 验收（verify）**：证据矩阵是当前**最痛且官方完全空白**的一格（计划至少
有审阅卡，验收什么都没有，用户只能读一句"验证过了"），且它与"完成"天然衔接，一次投入覆盖
验收+完成两个阶段的高频判断。

## 5. 数据源与架构（已取证官方机制，实现前拍板）

**取证结论（kernel 0.1.2-rc.1 源码）**：
- 会话投影（projection）是官方"活状态到达客户端"的标准机制：已注册 key 有 `plan`
  （只给 `{active,pending}`，**不含计划正文**）、`goal`、`turnBoundary`、`tokenUsage`、
  `agentTeam`、`schedule`…；**没有 `todo` 投影**（所以官方 todo 行只能解析工具调用参数）。
- 客户端可读会话面：`@deepseek-ai/dsh-api-session-controller/client`（`ISession`、
  `ProjectionsFace`、`SessionFace`、history records）——插件能订阅会话与投影。
- 计划审阅走 `ctx.uiSession.registerPendingInteraction<PendingQuestion>`，正文在
  `PlanReview.plan`；但 `question` 这个 key 已被官方 `ui-user-questions` 占用
  （重复注册会被拒），**我们不能劫持它**——只能旁路读取。

**推荐架构（照官方模式，不自造通道）**：

```
模型/会话 ──(① 工具提交 或 ② 旁路解析)──▶ host 侧 Artifact 存储
                                              │  注册投影 key（如 planShow）
                                              ▼
                         client: useProjection('planShow') ──▶ 面板三视图 + 动作
```

| 层 | 做什么 | 依据 |
| --- | --- | --- |
| host | 拥有 `Artifact` 存储；注册自有投影 key；动作 remotes（批准/验收/打回） | `ui-goal` 的 projection-mode surface 写法 |
| 输入① | 注册面向模型的工具（如 `show_artifact`）：agent 主动提交结构化产物（字段最全） | `plan-mode` 的 `ctx.tools.register(defineTool(...))` |
| 输入② | 旁路解析：从会话历史里读 `exit_plan_mode`/`todo_write` 参数与命令输出，拼出 Artifact（自动、零配合） | todo 行正是解析工具参数（`todo-row.tsx`） |
| client | 面板 + 三视图 + 动作；窄屏/导出降级 | 官方 `PlanReviewPanel` / `useProjection` 用法 |

| 方案 | 怎么来 | 优点 | 代价 |
| --- | --- | --- | --- |
| A 手贴/适配器 | 用户把产物文本贴进面板解析（原型 0 已实现） | 零耦合、立刻可用 | 手动、易过期 |
| B 会话旁路提取 | 读会话历史（工具参数 + 输出）拼模型 | **自动**、零 agent 配合 | 启发式解析；依赖会话面 API 稳定性 |
| C 结构化提交 | 工具 + 投影，agent 直接交结构化产物 | 结构最可靠、字段最全 | 需 agent 遵守；多一个契约面 |

倾向：**B 用来自动兜底，C 用来保证质量，A 用来演示与救急**；三者产出同一个 `Artifact` 模型
（§2），渲染与动作层完全共用——这正是"不要一把做完"能成立的前提。

## 6. 设计原则（旗舰级取舍）

1. **证据先行**：验收/完成视图里，每条判据旁边就是它的证据；没有证据的条目标"未验证"。
2. **结论先行**：首屏回答"要你决定什么"；细节折叠。
3. **一屏可判**：默认视图必须能在一屏内完成"批/不批""验收/打回"。
4. **尊重原文**：验收判据、风险描述等精确措辞保留原文，不用图形替代。
5. **单一真相**：进度只来自 todo/goal/工具事实，不自己维护第二份状态。
6. **不抢焦点**：可常驻但不自动弹出、不遮挡输入区。
7. **零配置**：打开即呈现当前会话的产物；无产物时给明确引导，绝不空白。
8. **动作可回溯**：批准/验收/打回都带时间与来源（谁在什么时候基于哪版做的决定）。
9. **渐进披露**：窄屏/摘要优先；同一模型可降级为纯文本导出。
10. **复用官方契约**：批准/拒绝/讨论沿用官方 label 语义（`approve`/`decline`/keep planning），
    只做"结构化增强"，不替换官方 `PlanReviewPanel` 的职责。

## 7. 原型 0（已存在，仅作形状证据）

分支 `feat/plan-show` 已有 `packages/dsh-plan-show`：host 空实现 + 侧栏入口 + 面板 +
markdown→模型解析器（带单测）+ 三视图切换（提案卡/看板/流程）。它是"方向 1+2+3 的粗混版"，
**方案定稿后按 §4 分期重写或裁剪**（用户已明确：先方案，再写码）。

## 9. 自主决策记录（2026-09-13，用户全权授权"你自己完成、不中途征求意见"）

原"待拍板"四项由实现者拍板并留理由；用户回来后可直接推翻（每项都标了推翻成本）。

| # | 决定 | 理由 | 推翻成本 |
| --- | --- | --- | --- |
| D1 | **MVP 范围 = Show 层骨架 + 三类产物（plan / verify / completion）共用同一模型与面板** | 一次证明核心论点"一个模型撑多个 show"；verify 填官方空白，plan/completion 让生命周期闭环；三类在同一流水线上边际成本低（差别只在字段权重与默认视图） | 中：去掉某类 = 删 kind + 视图分支 |
| D2 | **数据源以 C（工具 + host 存储）为主**，A（markdown 粘贴导入）兜底，**B（会话旁路解析）留二期** | 只有 C 能稳定拿到"验收证据/完成范围"这类结构化信息；B 的计划正文在官方 pending interaction 里，`question` key 被官方占用不可劫持，旁路解析成本高收益低 | 低：加 B 只是新增一个 Artifact 生产者 |
| D3 | **入口常驻侧栏底部**（与"控制台"同级），面板内无产物时给引导 | 零配置可见性、位置可预期；比"有产物才出现"更容易被发现 | 低：改 slot 注册条件 |
| D4 | **只做增强，不替换官方 `PlanReviewPanel` / deliverables**；批准动作仍发生在官方卡片上 | 不重造审阅协议、不制造双批准入口；我们的价值是"批准后计划常驻 + 验收证据矩阵 + 完成范围" | 低：后续若要接管审阅，走官方 slot 贡献 |

## 10. MVP 验收判据（本轮实现即按此自证）

1. **工具可用**：agent 调 `show_artifact`（最小 `kind+title+markdown`）→ 返回回执，产物进入存储；
   结构化字段（items/evidence/decisions/openQuestions）可覆盖 markdown 派生；非法 JSON 报错点名到字段。
2. **数据到达 UI**：只读端点 `/api/plan-show/artifacts` 返回产物；面板轮询（5s）后自动出现，
   无需刷新；端点不可用时面板显示"端点不可用"而不是空白。
3. **呈现**：五种视图（提案卡/看板/流程/验收矩阵/原文）渲染同一模型；验收矩阵对**无证据条目**
   显式标"未验证"（硬规则）。
4. **兜底**：只有 markdown 时也能"粘贴导入"并得到结构化呈现；原文视图永远可达。
5. **机械闸门**：`pnpm --filter dsh-plan-show typecheck` 通过；`pnpm --filter dsh-plan-show test`
   全绿（模型/host 两层单测）；`build` 产出 `lib/client.js`。
6. **真实实例自验**：在 dev 实例（web2, 3082）link 安装并重启，浏览器实测：入口出现 → 面板打开 →
   agent 提交产物后自动出现 → 切换五种视图 → 验收矩阵状态正确。

## 11. 外部调研结论（2026-09-13，一手来源；并入后修正了 §3/§4）

**产品对照（要点）**：Claude Code 计划落 `~/.claude/plans/*.md` + 三选一批准（含权限后果）+ `Ctrl+G` 外部编辑器改计划；Cursor 计划=磁盘普通文件（可编辑、可 Save to workspace）；Codex 有**已发布 schema** `PlanItemArg{step,status}`（"至多一个 in_progress"）；OpenHands 固定 5 段 `PLAN.md`（OBJECTIVE/CONTEXT/APPROACH/STEPS/**TESTING AND VALIDATION**）+ `TaskItem{title,notes,status}`；Roo/Kilo 支持批准前编辑清单（Kilo 明确拒绝用户直接编辑）；**ACP 规范**是唯一公开类型化 plan schema（`PlanEntry{content,priority,status}`，全量快照语义，**无 id、无依赖、无审批原语**）。
一手来源：`code.claude.com/docs/en/permission-modes`、`cursor.com/help/ai-features/plan-mode.md` + `cursor.com/changelog/2-2`、`openai/codex` 的 `plan_tool.rs`（jsDelivr 镜像）、`OpenHands` 的 `plan-file.ts` / `task_tracker/definition.py`、`roocodeinc.github.io/.../update-todo-list`、`agentclientprotocol` 的 `agent-plan.mdx`。

**四处必须修正我们的判断**：

| # | 调研结论 | 对我们方案的影响 |
| --- | --- | --- |
| R1 | 官方**已有** `todos` 投影 + `TodoPanel`（slot `conversation.input.dock`）+ `planSummary()`（明确要求并行 in_progress 不能只显示第一个） | 原 §5"没有 todo 投影"**错了**；数据源 B（自动）成本远低于估计——二期直接读 `todos` 投影即可，无需旁路解析 |
| R2 | **没有任何产品有"带 id/依赖/验收判据"的 plan schema**（ACP/Codex/OpenHands/DSH 都没有 id 与依赖） | 我们的 `Artifact.items[{id,dependsOn?,criteria}]` **是真空白**，值得作为差异化；但也意味着"依赖/流程图"没有现成数据支撑 |
| R3 | **流程图应否决为主视图**：无数据模型（图会退化成"按列表顺序连虚线"的假信息）；Mermaid 默认引擎 Dagre 官方文档标注 **"Unmaintained. Development stopped in 2018."** 且严格分层会强扭非层级数据；可访问性需额外手写 | §3 的"流程图（关系优先）"降级为**次要视图**，不做主入口；MVP 不做图 |
| R4 | 失败教训（全部可查 issue）：计划面板**窄居中列**被投诉（claude-code #57749，👍20）；批准太轻率（Devin 默认 30s 自动放行；claude-code #18599 默认项"清空上下文"被吐槽）；计划与执行不一致（#38255，👍38）；**批准后上下文不可回溯**是全调研最高赞（#27242，👍86）；OpenHands 卡片硬截 300 字符 | §4 增补：宽屏必须用满宽度（不做窄居中列）；批准必须写"批准后会发生什么"；**计划必须常驻可回溯**（正是我们的定位）；**绝不截断正文**，解析失败降级为原文 |

**调研对三个方向的排序建议**（与我们的 D1 部分冲突，据实记录）：
- **A 计划卡**（把 `exit_plan_mode` 的 markdown 当场结构化）：零新 schema、官方接缝已留好（`plan-review` intent + `firstHeading`），最该先做。
- **C 对账视图**（计划步骤 ↔ 实际执行/文件改动）：命中证据最强的两类抱怨（#27242、#38255），**没有任何产品做过**——差异化机会。
- **B 计划面板（看板+图）**：看板部分与官方 `TodoDock` 高度重叠；图缺数据支撑 → 建议砍掉图、看板只做官方没做的部分（依赖/阻塞/漂移）。

## 12. 调研后的决策修正（实现者拍板，覆盖 §9 的 D1）

| # | 决定 | 理由 |
| --- | --- | --- |
| D1′ | MVP **保持"统一模型 + 三类产物"**（已实现并自验），但**视图排序改为**：验收矩阵 / 提案卡 / 看板 是主线，**流程图降为次要且不做依赖连线**（现实现只是顺序节点，不算假依赖，可留） | R2+R3：没有依赖数据就没有真图；先交付有数据支撑的呈现 |
| D5 | **二期做"对账视图"**（items.files ↔ 实际改动文件集合差集），并接官方 `todos` 投影做进度联动 | R1 让成本变低；C 方向是调研认定的差异化空白 |
| D7 | **删除侧栏入口与面板**：主路径收敛为「消息内就地渲染」（围栏 → 图片）；侧栏入口、面板与五视图组件一并删除 | 用户实测反馈：面板要多点一次、看不到消息上下文，而在消息里直接出图才是卖点。工具 `show_artifact` 与只读端点保留（agent 显式提交 + 未来界面消费） |
| D6 | 面板宽度用满（`min(980px, vw-48)` 已如此），**批准/验收文案必须写明后果**，正文**永不截断**（原文视图永远可达，已实现） | R4 的四条硬约束 |

## 13. 本轮自验证据（MVP 判据 1-6）

- `pnpm --filter dsh-plan-show typecheck` ✓；`test` **19 通过**（模型 + host 两层）；`build` 产出 `lib/client.js` ✓。
- 实例自验（dev 实例 web2, 3082，面板期）：入口「Show」出现于侧栏底部 ✓；面板与粘贴导入 ✓；
  只读端点 `GET /api/plan-show/artifacts` → `{"artifacts":[]}` ✓（host 插件已加载）；
  「粘贴导入…」→ 产物入列（方案 · 3/5 · 证据 0）✓；五视图切换 ✓；
  **验收矩阵**：`已验证 0 / 5 条（无证据的条目标记为未验证）`，每条标"未验证 / 没有证据" ✓（硬规则生效）。
- 过程中被抓到并修掉的两个真问题（都是实例自验的产物，单测抓不到）：
  ① 相对导入缺 `.js` 后缀 → Node ESM `ERR_UNSUPPORTED_DIR_IMPORT`（仓库约定：值导入用 `.js`）；
  ② host 插件未声明 `export const inject = ['tools']` → cordis 启动即报 `cannot get property "tools" without inject`。
