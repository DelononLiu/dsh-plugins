# Agent Note: 身份模型机制

Status: implemented

## Problem

dsh-user 的用户模型接口与归属机制未定（认证已拆出走 dsh-gateway，dsh-user 只剩身份模型职责）。

## Decision

- **服务**：`ctx.user.current()` → `User { id, name, roles }`；`ctx.user.instanceAccess(instanceId)` 授权查询。
- **身份来源可插拔**（认证不在本插件）：
  - 网关注入：dsh-gateway 认证后注入身份头（`X-DSH-User-Id` / `X-DSH-User-Roles`），dsh-user 解析；
  - 静态配置：cordis.patch.yml 配置用户列表（id/name/roles）。
- **角色三档（v1）**：admin（全权）/ member（自有实例全权 + shared 按授权）/ guest（被授权实例只读）。
- **归属**：实例档案 owner = userId；shared 实例授权记录在档案。

## Alternatives

- 身份+认证合一（原双模式）——否决（已拆分）：认证是可替换接入件（社区网关），身份模型是核心。
- 细粒度 RBAC（每资源每权限）——否决：v1 三档角色够用，授权矩阵参考 dsh-passwords 留待 v2。

## Consequences

- dsh-user 职责收敛为"身份模型 + 授权查询"；认证由 dsh-gateway 承担。
- §9 身份模型项勾除。
- **实现落地（2026-08-21）**：UserService 类插件（static Config + default export，cordis 自动注册 ctx.user）；Config schema = users（静态列表）+ gatewayHeaders（网关注入头名）+ sharedAuth（shared 授权映射）；13 项单测通过（身份解析/授权/归属）；密钥对与 shared 公钥访问留待 shared 访问实现。
