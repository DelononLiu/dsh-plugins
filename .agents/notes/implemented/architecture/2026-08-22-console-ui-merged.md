# Agent Note: dsh-console-ui 并入 dsh-console（UI 与实现同包）

Status: implemented

## Problem

dsh-console（纯服务端管理组件）与 dsh-console-ui（纯 UI，client 半区）拆为两个包：多一个包、profile 多一项 insert、版本需分别管理；控制台界面是管理组件的核心可见形态，拆包的"UI 可替换"收益未兑现（无替代 UI 接入）。

## Decision

**dsh-console-ui 功能并入 dsh-console**，一个包同时含 host 面（ConsoleService）与 client 面（ConsoleBadge，sidebar 底部入口）：

- `dsh-console` 声明 `dsh.client`（inject dsh-client-runtime + dsh-client-ui-sidebar，platform web），exports 加 `"./client"`，build 产出 client bundle（build-client.mjs）；
- `src/client/`（ConsoleBadge.tsx + 入口）从 dsh-console-ui 移入；删除 dsh-console-ui 包；
- profile（web2/web3 与 profiles/web 模板）移除 dsh-console-ui insert/bundle。

**UI 可替换性保留**：client 面仍独立于 host 逻辑（`src/client/` + `exports["./client"]`），未来替换界面只需换 client 入口。

## Alternatives

- **保持拆包**（沿用"UI 可替换"纪律）：包多、配置多、版本分治，且可替换收益未兑现 → 否决。

## Consequences

- `dsh-console` = 管理组件（服务 + 界面），一个包一个版本；
- 安装/配置面：profile 只 insert dsh-console，client 面随其加载；
- 测试环境（web2/web3）patch 同步移除 dsh-console-ui，node_modules 链接清理；
- 后续界面调整直接改 dsh-console/src/client/。

交叉链接：[console-ui-control-panel](../../implemented/architecture/2026-08-22-console-ui-control-panel.md) · [ui-official-alignment](../../implemented/process/2026-08-22-ui-official-alignment.md)
