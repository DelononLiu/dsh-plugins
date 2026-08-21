# Agent Note: dsh-my-ui 布局自定义机制（v1 从简）

Status: implemented

## Problem

dsh-my-ui 是四区布局平台，自定义维度=布局+插件组合——自定义机制未定。

## Decision

**v1 从简**（2026-08 定）：
- **插件组合**：cordis.patch.yml（DSH 原生机制）——装/启停插件。
- **布局调整**（四区显隐/顺序/宽度）：dsh-my-ui 的 Config 字段（cordis.yml 可配）+ 设置页开关（参考 dsh-topbar-manager 的开关治理模式）。
- **布局配置按实例存**（每实例一套）——符合"实例 personal"、实现简单。
- "每用户布局"（用户登录跨实例看到自己的布局）**留 v2**（需用户级配置存储）。

## Alternatives

- 按用户存布局（"my"= 每用户跨实例一致）——延后：需用户级配置存储 + 多实例聚合，v1 不做。

## Consequences

- dsh-my-ui 实现范围 = Config 字段 + 设置页开关 + 实例级持久化（经 console/本地配置）。
- 议题 3/5 定稿。
