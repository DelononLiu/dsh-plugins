# Agent Note: 权限模型（角色三档 + shared 授权）

Status: implemented

## Problem

多用户下的权限模型未定：角色、shared 实例授权粒度。

## Decision

- **角色三档（v1）**：`admin`（全权：主机/部署/所有实例管理）/ `member`（自有实例全权 + shared 按授权）/ `guest`（被授权实例只读）。
- **shared 实例授权**：owner 在实例档案记录授权（可访问 / 只读），授权对象 = userId。
- **操作分级**：
  - 查看：member+（或 guest 被授权）
  - 控制（启停/部署/升级指令）：owner / admin
  - 主机管理 / 部署编排：admin
- **落点**：dsh-user 提供 `instanceAccess(instanceId)` 授权查询（基于角色 + shared 授权记录）；console 执行控制指令时校验。
- 参考 dsh-passwords 授权矩阵（工作区→会话粒度）留作 v2 扩展。

## Alternatives

- 细粒度 RBAC（每资源每权限矩阵）——否决：v1 三档角色 + 实例级授权够用。
- 无权限模型——否决：shared 实例与部署操作必须受控。

## Consequences

- 实例档案增加 shared 授权字段；console 指令执行前校验；§9 权限模型项勾除。
