# Skills（vendored 自官方 harness 并适配，外加社区/工具 skill）

本目录大部分 skills **vendored 自官方仓库** [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（`.agents/skills/`，MIT License，© 2026 DeepSeek），并在本仓库语境下适配（去掉官方脚本/文档引用，替换为本仓库规则）。

第二来源：**engineering/productivity 开发流程 skills vendored 自** [mattpocock/skills](https://github.com/mattpocock/skills)（MIT License，© 2026 Matt Pocock）——直接拷贝未适配（见下表"适配情况"列的注意事项）。

例外：`browser-skill` 不出自官方 harness——SKILL.md 主体字节抽取自 [Tencent BrowserSkill](https://github.com/Tencent/BrowserSkill) 的 `bsk` CLI 二进制内嵌资源（MIT，© Tencent BrowserSkill contributors），由本仓库降级为 agent skill 形态（通过 `bash` 调 `bsk` 而非 dsh 插件注册）。详见该 skill 的"版权与来源"段。

| Skill | 来源 | 适配情况 |
| --- | --- | --- |
| dsh-trim-cot-leakage | 官方 harness | 直接用（删失效引用）——修剪思维链泄漏散文 |
| dsh-prose-standard | 官方 harness | 适配（去官方文档引用 → 本仓库 AGENTS/architecture） |
| dsh-code-review | 官方 harness | 重写为本仓库规则（分层/note/提交/整体性） |
| dsh-pre-push-checks | 官方 harness | 重写为本仓库自检清单（typecheck/规则/同步/残留/diff） |
| dsh-kernel-upgrade | 本仓库原创 | 内核/依赖基线升级流程（隔离 web5 验证 + 适配 + 铺开，含 `verify-kernel-upgrade.sh` 强制验证） |
| dsh-subagent-model-test | 本仓库原创 | subagent 模型能力验证（确定性工具链冒烟 + 派发稳定性 + ACL 会话机制；备胎模型验收用） |
| record-browser-gif | 官方 harness | 工具直接拷（含 encode_gif.py；依赖 harness 环境浏览器能力） |
| browser-skill | 社区（Tencent BrowserSkill） | 字节抽取 bsk 内嵌 SKILL.md → agent skill 形态（`bash` 调 `bsk` CLI；不依赖 dsh 插件）；要求 `bsk` 在 PATH 上 + bsk daemon 在跑 + 浏览器扩展已连 |
| grilling | mattpocock/skills（productivity） | 拷问协议保留原样 + **追加本项目 13 条高危种子**（内核基线/双实例/实例隔离/3080/数据面权威源/状态写入者冲突/内存态/增量闸门/回滚/文档同步/UI 抄官方/概念模型/验证闸门，各带查证命令） |
| grill-me | mattpocock/skills（productivity） | 直接拷——`/grilling` 的一行入口（`disable-model-invocation`，需用户显式触发） |
| grill-with-docs | mattpocock/skills（engineering） | 直接拷——带文档上下文的 grilling 变体 |
| to-spec | mattpocock/skills | 直接拷——把当前对话综合成 spec 并发布；**依赖 issue tracker 配置**（见下"未装依赖"） |
| implement | mattpocock/skills（engineering） | 直接拷——按 spec/issue 落地实现 |
| tdd | mattpocock/skills（engineering） | 直接拷——红绿重构 + tests.md/mocking.md 参考 |
| code-review | mattpocock/skills（engineering） | 直接拷——通用双轴审查（Standards + Spec 并行 subagent）；**与本仓库 `dsh-code-review` 并存**（后者是仓库特定规则，二者互补） |
| domain-modeling | mattpocock/skills（engineering） | 直接拷——领域术语/ADR 建模（含 ADR-FORMAT.md/CONTEXT-FORMAT.md） |
| codebase-design | mattpocock/skills（engineering） | 直接拷——深模块设计词汇（含 DEEPENING.md/DESIGN-IT-TWICE.md） |
| diagnosing-bugs | mattpocock/skills（engineering） | 六阶段循环保留 + **前插 Phase 0 污染检查闸门**（非破坏性快照 + 本人改动清单 + 并发写者 → 分流）；CONTEXT.md/ADR 引用改指本仓库 AGENTS/architecture/notes |
| dsh-incident-forensics | 本仓库原创 | 反向链的受污染分支（A–F 取证/隔离/证伪/验证/恢复/复核 + 七条铁律）；`diagnosing-bugs` Phase 0 判污染时的出口 |
| dsh-component-hardening | 本仓库原创 | 加固链——既有组件"毛病很多"时的可复用流程（目标可判定化 → 只读取证 → 成因归类 → 分批排序 → 先红后绿 → 收口回灌；六步各带闸门 + 三条不变式 + 反模式清单） |

### 未装依赖（引用但不影响本批工作）

- `to-spec` / `code-review` 提示 `run /setup-matt-pocock-skills if docs/agents/issue-tracker.md is missing`——需 issue tracker 配置（本仓库用 Agent Notes + docs/architecture 体系，未配置；用到时按提示补 `setup-matt-pocock-skills`）。
- `diagnosing-bugs` 的架构类结论落 Agent Note（`.agents/notes/proposed/architecture/`），复发类结论回灌 `grilling` 高危种子清单；装上 `improve-codebase-architecture`（当前未装）后可由它接管前者。

官方/mattpocock skills 保留各自版权声明（MIT © 2026 DeepSeek / © 2026 Matt Pocock）；`browser-skill` 保留 Tencent BrowserSkill 版权（MIT）。本仓库的适配改动均归本仓库 MIT（见根 LICENSE）。上游更新时按 vendoring policy 同步。

## 正反两链与加固链（2026-09 立）

方法论来源与准入理由见 [Agent Note：AICoding 方法论吸纳](../notes/implemented/process/2026-09-13-aicoding-methodology.md)。**约束分三类，别混**：
机械闸门（命令有输出即失败）· 结构化约束（格式/清单，可 lint 但需人判）· 纯判断（架构与语义，不装成闸门）。

| 链 | 阶段 | 载体 | 类型 |
| --- | --- | --- | --- |
| 正向 | 拷问 | `grilling`（高危种子清单，含查证命令） | 结构化约束 |
| 正向 | 规格 | `to-spec`（需 issue tracker 配置） | 纯判断 |
| 正向 | 实施 | `implement` / `tdd` / `dsh-code-review` | 混合 |
| 正向 | **验证** | `dsh-pre-push-checks`（+ 内核升级 `verify-kernel-upgrade.sh`） | **机械闸门** |
| 正向 | 发布 | AGENTS.md 提交规则 / 推送 | 机械闸门 |
| 反向 | 污染判定 | `diagnosing-bugs` Phase 0 | **机械闸门** |
| 反向 | 干净现场 | `diagnosing-bugs` Phase 1–6（构造反馈环） | 混合 |
| 反向 | 受污染现场 | `dsh-incident-forensics` A–F + 七条铁律 | 结构化约束 |
| 加固 | 目标可判定化 → 收口 | `dsh-component-hardening` 六步（取证 / 归因 / 分批 / 先红后绿 / 回灌） | 混合（第 2、5 步为机械闸门） |
| 三链共享 | 高危面记忆 | `grilling` 种子清单 ← 事故结论与加固结论回灌 | 结构化约束 |

## 检查脚本化原则（2026-09 立，所有检查型 skills 适用）

**凡能确定性检查的步骤，把确切可执行的命令/命令片段写进 SKILL.md 提示词**——
模型按命令执行，判读结果；不写"确认 X / 检查 Y"这类让模型自由发挥的模糊指令。
经验来源：dsh-kernel-upgrade 曾靠模型自觉逐项验证，漏检 dsh-tools 双实例
（Symbol 键服务跨实例不共享）→ agent 工具调用崩；纯对话冒烟也发现不了工具链问题。

形态（按复杂度递增，够用就好）：

1. **一行命令**——如 `pnpm typecheck`、`git diff --check`、`grep -rn '<pattern>' packages/*/src`。直接内联在检查项里。
2. **命令片段/小脚本**——多步但确定（如"对每个环境查依赖+端口"），可内联 `for ... done`，或抽成仓库 `scripts/<name>.sh` 再由 SKILL.md 引用（如 dsh-kernel-upgrade 的 `verify-kernel-upgrade.sh`）。
3. **判读规则写清**——命令后的"怎样算过"也要在提示词里（如 401 = fence 正常、TS18003 = 预期占位）。

**边界**：只对**确定性**检查脚本化；**需语义判断**的（散文是否算泄漏、review 权衡、提交单元粒度）保留为模型判断，必要时先用脚本缩小范围（如 dsh-trim-cot-leakage：recall-batteries 是 probe 不是定义）。别把语义判断伪装成可脚本化，也别把可脚本化的留给自觉。

落地清单（按需逐 skill 执行）：
- [x] dsh-kernel-upgrade：`verify-kernel-upgrade.sh`（静态 + 运行健康），SKILL.md 引用
- [x] dsh-pre-push-checks：typecheck/diff 卫生/残留术语/双实例 → SKILL.md 内联确切命令
- [x] dsh-code-review：变更事实命令段（范围/note/依赖/卫生）内联；结论判断留模型
- [x] dsh-prose-standard / dsh-trim-cot-leakage：探测命令内联 → 保持 probe + 语义判读
- [x] grilling：13 条高危种子**每条**带查证命令 + 统一判读规则（"命令没能执行 ≠ clean"）
- [x] diagnosing-bugs：Phase 0 闸门内联快照 / 现场坐标 / **活体写者两采样探针** / 陈旧产物
- [x] dsh-incident-forensics：A1–A4 与 B 内联命令块（快照 / 现场坐标 / 陈旧与时间戳 / 副本隔离），C–F 为行内确切命令
- [x] dsh-pre-push-checks：增「自改清单 + 产物同步 + UI 语义变量核对（`--dsw-alias-state-*` 与官方基线主题做差集）」命令段
- [x] 全部 skills：`bash scripts/verify-skills.sh` 机械校验 frontmatter / 命令块语法 / **尖括号占位符位置（重定向风险）** / 相对链接（含占位符的块另给"需先替换"警告）
- [ ] mattpocock skills 其余未适配批次：用到时按本原则补内联命令

## 功能测试（2026-09 立，语法检查之外的第二层）

`verify-skills.sh` 只能证明"提示词没写坏"；**提示词写得对不等于 skill 能得出正确结论**。第二层是拿真故障
考 skill：

- **场景与对照结论**：[`scripts/tests/fixtures/skills-fn/GROUND-TRUTH.md`](../../scripts/tests/fixtures/skills-fn/GROUND-TRUTH.md)
  —— 重建：`bash scripts/tests/fixtures/skills-fn/build-scenes.sh`。含受污染的反向排错现场（模块重复副本 →
  Symbol 身份不匹配 + 陈旧产物假绿 + 有人"顺手修"把 TypeError 抹成静默 undefined）、干净入口现场、受污染入口现场。
- **确定性部分**（可 CI）：`bash scripts/tests/skills-functional.test.sh` —— 断言现场真的坏、篡改真的抹掉了
  症状、HEAD 真的能恢复证据，并**从 SKILL.md 抽出真命令块实跑**（陈旧判据能红能绿、活体写者探针能红能绿、
  快照非破坏性）。
- **结论层**（要模型）：把 skill 交给一个子 agent 照走一遍，结论对照 GROUND-TRUTH。这一层才查得出语法闸门
  看不见的缺陷——命令缺失、`git diff` 被当成"我的改动"、判据恒真或恒假、种子里根本没有命令。发现问题的
  记录与方法论准入理由见 [Agent Note：AICoding 方法论吸纳](../notes/implemented/process/2026-09-13-aicoding-methodology.md)。
