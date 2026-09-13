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
| grilling | mattpocock/skills（productivity） | 直接拷——就计划/设计对用户连环追问（strict 拷问协议） |
| grill-me | mattpocock/skills（productivity） | 直接拷——`/grilling` 的一行入口（`disable-model-invocation`，需用户显式触发） |
| grill-with-docs | mattpocock/skills（engineering） | 直接拷——带文档上下文的 grilling 变体 |
| to-spec | mattpocock/skills | 直接拷——把当前对话综合成 spec 并发布；**依赖 issue tracker 配置**（见下"未装依赖"） |
| implement | mattpocock/skills（engineering） | 直接拷——按 spec/issue 落地实现 |
| tdd | mattpocock/skills（engineering） | 直接拷——红绿重构 + tests.md/mocking.md 参考 |
| code-review | mattpocock/skills（engineering） | 直接拷——通用双轴审查（Standards + Spec 并行 subagent）；**与本仓库 `dsh-code-review` 并存**（后者是仓库特定规则，二者互补） |
| domain-modeling | mattpocock/skills（engineering） | 直接拷——领域术语/ADR 建模（含 ADR-FORMAT.md/CONTEXT-FORMAT.md） |
| codebase-design | mattpocock/skills（engineering） | 直接拷——深模块设计词汇（含 DEEPENING.md/DESIGN-IT-TWICE.md） |
| diagnosing-bugs | mattpocock/skills（engineering） | 直接拷——硬 bug/性能回归诊断循环（含 scripts/） |

### 未装依赖（引用但不影响本批工作）

- `to-spec` / `code-review` 提示 `run /setup-matt-pocock-skills if docs/agents/issue-tracker.md is missing`——需 issue tracker 配置（本仓库用 Agent Notes + docs/architecture 体系，未配置；用到时按提示补 `setup-matt-pocock-skills`）。
- `diagnosing-bugs` 结尾 hand off 到 `/improve-codebase-architecture`（未装——该建议仅在诊断结论涉及架构改造时出现，可届时再补装）。

官方/mattpocock skills 保留各自版权声明（MIT © 2026 DeepSeek / © 2026 Matt Pocock）；`browser-skill` 保留 Tencent BrowserSkill 版权（MIT）。本仓库的适配改动均归本仓库 MIT（见根 LICENSE）。上游更新时按 vendoring policy 同步。

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
- [ ] mattpocock skills（未适配批次）：用到时按本原则补内联命令
