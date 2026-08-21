# Agent Note: 系统层 LLM 记忆（采用社区 dsh-memento）

Status: implemented

## Problem

系统层缺少 LLM 记忆能力（官方 harness 无 memory）。社区 60+ 实现（awesome-dsh-plugin Memory 分类）填补空白但无公认标准。

## Decision

**采用社区 dsh-memento（PerryLink）作为系统层 LLM 记忆组件**（vendored，npm v0.4.3，活跃）：
- 形态：`ctx.memory` typed seam + 零依赖本地 SQLite provider + memory 工具 + 冻结快照注入 + 审批门控/审计——正是"系统层服务提供者"形态。
- **纯本地**（用户确认：先纯本地，不做云端 TDAI/mem0 类）。
- 归层：系统层（与认证网关/远程访问同为社区 vendored 系统组件）。
- 名字：保留原名 vendored/dsh-memento（npm 无冲突，同 dsh-web-ui 先例）。
- 参考：dsh-memory-gate 的 CBDC 门控手法（检索≠注入）作补强。

## Alternatives

- 自研 dsh-memory——否决：社区 60+ 已验证形态（SQLite/Markdown + 工具 + 门控注入），LLM 记忆非护城河（身份模型 + 实例编排才是）；单实例场景社区已够。
- 云端记忆（TDAI/mem0）——否决（用户：先纯本地）。
- 其他候选（@max-null/dsh-memory、dsh-memory-gate、dsh-noema）——备选；memento 的 ctx.memory seam 形态最匹配系统层定位。

## Consequences

- 系统层组件 = dsh-user + dsh-channel（自研）+ 认证网关 + 远程访问 + **LLM 记忆（dsh-memento）**（社区）。
- 文档同步：architecture.md §1 分层图 / §5 社区采用表、AGENTS.md 系统层行。
- vendored/ 落地清单增加 dsh-memento（submodule）。
