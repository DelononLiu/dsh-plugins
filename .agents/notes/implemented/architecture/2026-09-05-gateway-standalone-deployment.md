# Agent Note: 认证网关独立部署——不随 dsh 实例启动

Status: implemented

## Problem

- dsh-gateway（clarknu，社区 vendored）此前以插件 insert 进 web2 console profile（cordis.patch.yml + package.json 依赖），随 dsh 实例（`--profile web2`）一起启动、独占 `127.0.0.1:3443`。
- 网关（登录/会话/登出）是**系统级共享件**，多个 dsh 实例并存时应当只有**一个**：实例内置会各自占端口、职责重复错位——本次已见 3443 与正式 GUI（`~/.dsh` web，3080）冲突致 EADDRINUSE。

## Decision

- **网关不随 dsh 实例启动**（2026-09 用户定）：从实例 profile 组合移除 dsh-gateway——web2 `cordis.patch.yml` 去 insert 块、`package.json` 去依赖；重启验证实例不再加载（日志无 gateway 启动/EADDRINUSE）。
- 网关收敛为**单一独立服务**（实例之外单独部署），就位后各实例的 dsh-user `gatewayCookie` / 网关注入指向它——独立部署为 backlog（architecture.md §9）。
- 已接入的 dsh-user 配置（users / gatewayCookie secretFile）保留，供未来的独立网关使用。

## Alternatives

- 保留随实例启动（原状）：多实例 = 多网关，端口冲突 + 职责重复 → 否。
- 每实例独立端口内嵌网关：仍多实例多网关，违背「网关唯一」且 dsh-user 不知该信谁 → 否。

## Consequences

- web2 实例不再加载 gateway；3443 冲突随之消失（3443 现归正式 GUI 独占）。
- 独立网关就位前，实例仅官方 token 登录（BrowserAuth），dsh-user 多用户登录不可用（backlog）。
- 移除在实例 profile 层面（测试 home 配置，不入库）；仓库发行包模板不涉及。
- 交叉引用：[per-instance-profile-naming](../process/2026-09-05-per-instance-profile-naming.md)（同批测试环境调整）、[alpha5-auth-official-token-vs-user-login](../../proposed/architecture/2026-09-03-alpha5-auth-official-token-vs-user-login.md)（官方会话桥）。
