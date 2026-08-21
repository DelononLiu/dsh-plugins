# Agent Note: 认证/远程选型与 vendored 双模式

Status: implemented

## Problem

系统层两个接入件（认证网关、远程访问）需要从社区方案中选定；vendored 落地机制需要明确（多包全家桶 vs 轻量单包的处理差异）。

## Decision

**认证网关 → dsh-gateway（clarknu）** 为主选：
- v1.6.0 成熟（npm 发布、多站点、配置热生效、fail-closed、一键全体会话失效、每 IP 限速）；
- "多站点"对多实例场景直接有用；与 dsh-user 身份接口对接，认证可替换；
- dsh-webui-auth 的安全手法（四层 fail-closed、回环转交特权方法、IP 假名化审计、时序抹平）作为 v1 补强参考；vendored 实测二选一。

**远程访问 → dsh-remote-web-ui（全家桶内）** 为主选：
- 局域网扫码配对 + 配对令牌门控，v1 够用；**零额外 vendored**（随 dsh-web-ui 全家桶自然获得）；
- dsh-relay（Wire-Trunk 云中继）作跨网扩展参考（v2，需自托管 relay 节点，家端零入站端口）。

**vendored 双模式**：
- **轻量单包**（dst-agent-teams）：submodule 进 vendored/，profile 本地安装——完全锁定 + dst- 标记；
- **重量全家桶**（dsh-web-ui 17 包）：submodule 锁源码快照（审查/补丁参考），安装走 npm 发布版（@linxin666 scope），dsh.lock.json 锁版本，改造走 profile 层 cordis.patch.yml。

## Alternatives

- 认证自研（dsh-gate 命名已查可用）——否决：认证细节（fail-closed/限速/吊销）成熟度社区远超自研，接入件可替换。
- 远程访问 v1 不纳入——否决（用户 2026-08 确认纳入系统层）。
- 全家桶全量本地构建安装——否决：17 包 monorepo 全量 submodule+构建过重；npm 发布版 + lock 锁定已够。

## Consequences

- §9 三项已勾除（认证选型/远程选型/vendored 机制）；§5 矩阵标注选定。
- vendored/ 目录待落地：dst-agent-teams submodule + dsh-web-ui submodule（未定项 U7 进入实施阶段）。
- 远程访问主通道=局域网（小团队场景）；跨网公网访问 v2 再做。
