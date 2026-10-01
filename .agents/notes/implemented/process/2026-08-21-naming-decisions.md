# Agent Note: 插件命名决策

Status: implemented

## Problem

插件家族需要稳定的名字；命名前必须实查 npm/GitHub 占用，避免与社区撞名、撞语义。

## Decision

**最终命名（2026-08 全部实查拍板）**：

| 插件 | 层 | 名 | 命名要点 |
| --- | --- | --- | --- |
| 身份 | 系统 | **dsh-user** | npm/GitHub 无占用 |
| 通信 | 系统 | **dsh-channel** | 保留原名（dsh- 为自研家族标记，社区 ZinkLu/dsh-channel 是 IM 消息渠道，语义不同，不影响） |
| 管理 | 管理组件 | **dsh-console** | 原 dsh-hub（npm 被 @marecgents/dsh-hub 占、GitHub "hub"=插件市场语义垄断） |
| 导航 | UI（档案读端） | **dsh-nav** | 无占用（社区 dsh-navbar 不同名） |
| 标签页 | UI | **dsh-tabs** | 原 dsh-session-tabs（短、与 nav 风格统一） |
| UI 平台 | UI | **dsh-desk** | 个人化语义，呼应"实例皆 personal + 自定义化核心"；dsh-ui（2021 空壳占）、toolkits（集合词混淆）、web-ui2（将就续作名）、fleet（社区 dsh-fleet 系列）、distributed（学术）均否决 |
| vendored | UI | **dst-agent-teams** | vendor 自 NanmiCoder/dsh-agent-teams（MIT），dst- 前缀标记第三方 |
| 呈现 | UI | **dsh-show-me** | 原 dsh-plan-show（名字只说了 plan 一个 kind）；npm/GitHub 无占用，理由与逐项否决见 [2026-10-01 note](2026-10-01-dsh-show-me-naming.md) |

**命名规则**：`dsh-*` = 自研家族（发布 npm）；`dst-*` = vendored 第三方；**例外**：`vendored/dsh-web-ui` 保留社区原名（UI 全家桶来源，改名无意义）。新增名字前查 npm + GitHub 占用。

## Alternatives

- dsh-web-ui2 / dsh-ui / dsh-toolkits / dsh-fleet-ui / dsh-distributed-ui / dsh-ui-kit——逐一实查后否决（占用或语义问题，理由见上表）。

## Consequences

- 文档（architecture.md §8）与 AGENTS.md 记录完整否决理由，防止后人重提。
- 命名冻结后，目录/包名/文档同步更新，禁止再改（除非占用情况变化）。
