# Agent Note: 实例模型（全部 personal）

Status: implemented

## Problem

"团队实例 vs 个人实例"的二分模型会带来权限与归属的复杂性。用户明确：**没有 team 实例**。

## Decision

- **所有实例都是 personal**（归属某个用户，系统层身份）；不存在"团队共享实例"这一类型。
- 可创建**特殊 personal 实例**，`type` 为可扩展枚举：
  - `normal`：个人调试/测试，仅本人可见可管
  - `shared`：owner 授权后其他用户可访问（团队协作的载体，替代 team 实例）
  - `host`：承载 console 服务 / 常驻 agent 的实例
  - 后续可扩展：`ci`、`sandbox` 等
- **主机 = 部署单元，实例 = 运行单元**；一台主机可跑**多个实例**（不限定）；一个实例 = 主机上一个 profile 进程（本地或远程）。
- 实例档案字段：id / name / owner / type / host / addr / status / health / 版本。

## Alternatives

- team/personal 二分——否决：归属模型复杂化，且与"全部 personal"的用户决策冲突。
- 一主机一实例——否决（用户明确"不限定"）。

## Consequences

- 权限模型围绕"归属者 + type"展开：角色三档 + shared 授权（可访问/只读）见 [permission-model](2026-08-21-permission-model.md)；shared 跨实例访问 = SSH 公钥式见 [shared-access-publickey](2026-08-21-shared-access-publickey.md)。
- 实例服务协作：channel 提供实例服务、console 提供管理服务、nav/console-ui 消费（type-only + ctx.remote）见 [contracts-and-console-ui](2026-08-21-contracts-and-console-ui.md)。

相关：[部署链路](2026-08-21-deployment-chain.md) · [命名决策](2026-08-21-naming-decisions.md)
