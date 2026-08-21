# Agent Note: dsh-tabs 骨架（可加载版）

Status: implemented

## Problem

会话标签页（顶栏 tab + Alt+1..9 跨工作区切换）的 client 半区实现依赖官方 client 框架集成（共性工作块）。

## Decision

**v1 骨架（2026-08-21）**：host 面空 apply（占位）；client 面最小注册骨架（inject ['slots']）。dsh-tabs **无内部依赖**（独立插件，可与 nav 并行开发）。标签渲染 + 快捷键绑定（键位经 settings 持久化，参考 dsh-hotkeys）列入 client 集成步。

## Consequences

- dsh-tabs 可加载（host + client + 依赖），typecheck/build 通过；标签/快捷键列入 client 集成步。
