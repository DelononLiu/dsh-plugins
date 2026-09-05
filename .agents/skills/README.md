# Skills（vendored 自官方 harness 并适配，外加社区/工具 skill）

本目录大部分 skills **vendored 自官方仓库** [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（`.agents/skills/`，MIT License，© 2026 DeepSeek），并在本仓库语境下适配（去掉官方脚本/文档引用，替换为本仓库规则）。

例外：`browser-skill` 不出自官方 harness——SKILL.md 主体字节抽取自 [Tencent BrowserSkill](https://github.com/Tencent/BrowserSkill) 的 `bsk` CLI 二进制内嵌资源（MIT，© Tencent BrowserSkill contributors），由本仓库降级为 agent skill 形态（通过 `bash` 调 `bsk` 而非 dsh 插件注册）。详见该 skill 的"版权与来源"段。

| Skill | 来源 | 适配情况 |
| --- | --- | --- |
| dsh-trim-cot-leakage | 官方 harness | 直接用（删失效引用）——修剪思维链泄漏散文 |
| dsh-prose-standard | 官方 harness | 适配（去官方文档引用 → 本仓库 AGENTS/architecture） |
| dsh-code-review | 官方 harness | 重写为本仓库规则（分层/note/提交/整体性） |
| dsh-pre-push-checks | 官方 harness | 重写为本仓库自检清单（typecheck/规则/同步/残留/diff） |
| dsh-kernel-upgrade | 本仓库原创 | 内核/依赖基线升级流程（隔离 web5 验证 + 适配 + 铺开，含 `verify-kernel-upgrade.sh` 强制验证） |
| record-browser-gif | 官方 harness | 工具直接拷（含 encode_gif.py；依赖 harness 环境浏览器能力） |
| browser-skill | 社区（Tencent BrowserSkill） | 字节抽取 bsk 内嵌 SKILL.md → agent skill 形态（`bash` 调 `bsk` CLI；不依赖 dsh 插件）；要求 `bsk` 在 PATH 上 + bsk daemon 在跑 + 浏览器扩展已连 |

官方 skills 保留官方版权声明（MIT © 2026 DeepSeek）；`browser-skill` 保留 Tencent BrowserSkill 版权声明（MIT）。两者本仓库的适配改动均归本仓库 MIT（见根 LICENSE）。上游更新时按 vendoring policy 同步。

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
- [ ] dsh-pre-push-checks：typecheck/diff 卫生/残留术语/依赖方向 → 内联命令或脚本
- [ ] dsh-code-review：变更范围命令可内联；结论判断留模型
- [ ] dsh-prose-standard / dsh-trim-cot-leakage：探测命令已有 → 保持 probe + 语义判读
