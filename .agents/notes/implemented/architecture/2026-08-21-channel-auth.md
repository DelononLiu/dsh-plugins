# Agent Note: 通道鉴权（agent↔console 实例令牌）

Status: implemented

## Problem

远程 agent 与 console 之间的通道认证未定（token/证书）；且浏览器端 WS/EventSource 无法带 Authorization 头。

## Decision

- **agent↔console 认证 = 实例令牌**：bootstrap（SSH 引导装 agent）时生成注入 agent（32 hex 随机）；agent 的注册/心跳/指令请求携带令牌；console 校验 + 操作级鉴权（角色/授权，见权限模型）。
- **实例令牌与用户会话分离**（机↔机 vs 人↔机，参考 dsh-relay 干线令牌/配对码双凭证）。
- **浏览器端（远程访问）走 dsh-gateway 会话（cookie 路径）**——WS/EventSource 无法带 Authorization 头，用 HttpOnly Cookie + SameSite=Strict（dsh-remote-link 解法）。
- 局域网内不强制双向 TLS（v1）；跨网（v2，dsh-relay）加密由传输层承担。

## Alternatives

- 证书/双向 TLS——否决：bootstrap 分发证书复杂，局域网 v1 令牌够用。
- 用户会话复用——否决：agent 是无头程序，无用户会话；且机身份≠人身份。

## Consequences

- scripts/bootstrap 需生成并注入实例令牌；dsh-channel 校验令牌；§9 通道鉴权项勾除。
