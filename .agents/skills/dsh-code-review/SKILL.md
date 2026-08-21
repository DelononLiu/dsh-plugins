---
name: dsh-code-review
description: Use when reviewing a pull request or branch in this repository (dsh-plugins) — orients the reviewer to this codebase's standards (AGENTS.md conventions, layered architecture, Agent Notes, commit rules) and the review-specific checks that code alone can't show
---

# Reviewing a Change in dsh-plugins

**This skill is guidance, not a complete checklist.** Review the change against the repository's standing rules first, then the diff and enough surrounding code to understand the design. Prioritize correctness, lifecycle, security, and broken required behavior over style; a short review with one substantiated blocker is better than a list of nits.

## Sources of truth

- [AGENTS.md](../../AGENTS.md)：仓库分层/依赖纪律、插件包形态、提交规则、worktree 流程。
- [docs/architecture.md](../../docs/architecture.md)：架构 spec（分层、插件矩阵、机制）。
- [.agents/notes/](../../notes/README.md)：设计决策记录——与 Agent Note 分歧是设计讨论，不是自动否决。
- 变更的 Agent Note（非平凡变更必须同提交附 note）与实现一致。

## Blocking requirements

1. **文档同步**：行为/配置/默认值/接口变更必须同步更新对应文档（architecture.md / README / AGENTS.md / 相关 note）——同提交。
2. **Agent Note**：非平凡变更必须新增/更新 note（见 notes/README.md）；implemented note 用现在时陈述已落地事实。
3. **分层与依赖纪律**：依赖严格向下（业务app→UI→管理组件→系统→内核），无反向/跨层依赖；UI 层内部聚合例外。
4. **提交规则**：一个提交 = 一个逻辑单元；前缀合规（feat:/fix:/docs:/chore:/refactor:/test:）；main 原子可回滚。
5. **整体性**：无逐插件私有模型——共享概念（身份/实例/主机）引用 channel/console 的唯一定义（type-only import）。

## Manual checks

- **意图与接口**：核对变更与 note/文档声明一致（含错误、取消、所有权、释放）。
- **生命周期与并发**：异步 setup、回调、进程、teardown——检查发布前竞态、await 中取消、独立错误上报、回调隔离、complete detach 清理。
- **范围与必要性**：每个抽象/状态机/选项/防御拷贝对应到当前消费方；挑战无关功能与投机式通用（speculative generality）。
- **配置与公共选择**：默认值/公共操作集/格式有当前消费方证据或先例；缺失时要求显式选择或延后。
- **测试强度**：断言针对预期回归生效（验证外部状态/日志/事件，而非复述实现）；覆盖是必要非充分。
- **清理**：新注册项/事件监听有对应释放（disposal）。
- **实现期占位**：当前仓库为占位骨架（无 src）——评审"实现"类变更时要求：真实 src 已按包形态约定编写、typecheck 通过。

## Reporting findings

State the defect, location, impact, and evidence. Separate blockers from suggestions; omit issues already enforced by a green gate. When receiving review, verify each claim and fix or rebut it on technical grounds without performative agreement.
