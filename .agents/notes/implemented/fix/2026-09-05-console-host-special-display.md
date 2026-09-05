# Agent Note: 主机页管理端宿主特殊显示（本机 · 管理端 + 徽标）

Status: implemented

## Problem

主机页每行由实例的 host 字段去重渲染，管理端所在机器（web2 自身的 host=host1）
与纯守护主机混在一起显示成 "host1 · 守护 daemon"——管理端这台机器像是台远端
守护机，缺"承载管理端"的可读语义。

## Decision

识别管理端宿主并在主机页特殊显示：
- 判定：instances 中 `self: true`（管理端本端）实例的 host = 管理端宿主 id。
- 渲染：该行主名显示「本机 · 管理端」+ 品牌色「管理端」徽标（dsh-console-badge
  run）；meta 保留 {host} · N 个实例 · 在线/离线。非管理端守护主机维持原名 +
  「守护」后缀。
- 数据面零改动（self 标记已由 listInstances 提供），纯 client UI。

## Consequences

- 主机页首行即"本机 · 管理端"（管理端徽标），host1 等 agent 名下沉到 meta 行。
- 后续接入远端守护（host2…）自动以普通守护行呈现，与管理端行视觉区分。
