# Agent Note: skills 引入（vendored 自官方 harness）

Status: implemented

## Problem

仓库需要评审/写作/推送自检等 agent 能力。官方 deepseek-harness 的 .agents/skills 有 11 个，其中 5 个可移植。

## Decision

**引入 5 个 skill**（vendored 自 deepseek-harness/.agents/skills，MIT © 2026 DeepSeek，保留版权）并适配本仓库：
- dsh-trim-cot-leakage（直接用）：修剪思维链泄漏散文。
- dsh-prose-standard（适配）：写作标准（去官方文档引用 → 本仓库 AGENTS/architecture）。
- dsh-code-review（重写）：评审方法论 → 本仓库规则（分层/note/提交/整体性五条 blocking）。
- dsh-pre-push-checks（重写）：提交/合入前自检清单（typecheck/规则/同步/残留/diff/依赖方向）。
- record-browser-gif（工具）：浏览器录屏 GIF（含 encode_gif.py；依赖 harness 环境浏览器能力）。

排除：绑定官方机制的 skill（pre-push 原版/translate-docs/doc-site-sync/merging-stacked-prs/doc-standards）。

## Alternatives

- 自研 skills——否决：官方方法论成熟（评审/写作/泄漏修剪），适配成本低。
- 全量引入 11 个——否决：5 个绑定官方脚本/站点/双语机制，不可移植。

## Consequences

- .agents/skills/ 5 个 skill + README（license 出处）；AGENTS.md 布局记录。
- 适配原则：去官方脚本/文档引用、换本仓库规则、保留官方版权（MIT © 2026 DeepSeek）。
