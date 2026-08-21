# Agent Note: 共享契约包与 console 界面拆分

Status: implemented

## Problem

两个联动未定项：①实例档案共享契约的载体（nav 是档案读端，不能直接依赖 console 运行时——否则 UI 层绑定管理组件实现）；②总览 UI 归属（console 自带 client 会混淆"管理组件"与"UI 层"边界）。

## Decision

**U1 契约载体 → `dsh-contracts`（types-only 共享包）**：
- 身份/实例/主机档案的 schema 与 Typert 契约声明放 dsh-contracts，**无运行时逻辑**，位于内核之上、所有层之下（任何层 → contracts，contracts 零依赖）。
- console（L3）实现档案服务（@Remote，host 面）；nav / dsh-console-ui 消费生成契约（client 面 `ctx.remote`）——**只依赖类型，不依赖 console 运行时**。整体性的落地机制。

**U4 总览 UI 归属 → console 纯服务端 + `dsh-console-ui`（UI 层）**：
- dsh-console 去掉 client 导出与 dsh.client 字段（纯服务端）。
- 总览/管理界面独立为 UI 层插件 dsh-console-ui（依赖 dsh-contracts，经 ctx.remote 消费 console 服务），符合"UI 可替换、不进核心契约"。

## Alternatives

- 契约放 dsh-channel——否决：档案含归属/类型/生命周期等业务概念，放通信层会让 L2 依赖 L3 语义（违反分层）。
- 契约放 dsh-console、nav 直接依赖——否决：UI 层绑定管理组件实现，多消费者时代理变多。
- console 自带 client——否决：混淆管理组件与 UI 层边界（原骨架形态，已改）。

## Consequences

- packages/ 增加 dsh-contracts（types-only）+ dsh-console-ui（UI）；console 变纯服务端。
- nav 依赖改为 contracts 类型 + ctx.remote（原直接依赖 console 的骨架已调整）。
- profiles bundles 同步（web 全量、web3 核心组合均含 contracts）。
