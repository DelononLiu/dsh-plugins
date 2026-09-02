# Skills（vendored 自官方 harness 并适配）

本目录 5 个 skill **vendored 自官方仓库** [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（`.agents/skills/`，MIT License，© 2026 DeepSeek），并在本仓库语境下适配（去掉官方脚本/文档引用，替换为本仓库规则）。

| Skill | 适配情况 |
| --- | --- |
| dsh-trim-cot-leakage | 直接用（删失效引用）——修剪思维链泄漏散文 |
| dsh-prose-standard | 适配（去官方文档引用 → 本仓库 AGENTS/architecture） |
| dsh-code-review | 重写为本仓库规则（分层/note/提交/整体性） |
| dsh-pre-push-checks | 重写为本仓库自检清单（typecheck/规则/同步/残留/diff） |
| dsh-kernel-upgrade | 本仓库原创——内核/依赖基线升级流程（隔离 web5 验证 + 适配 + 铺开，2026-08 rc.2→alpha.5 实测沉淀） |
| record-browser-gif | 工具直接拷（含 encode_gif.py；依赖 harness 环境浏览器能力） |

保留官方版权声明（MIT © 2026 DeepSeek）；本仓库适配改动亦为 MIT（见根 LICENSE）。上游更新时按 vendoring policy 同步。
