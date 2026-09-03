# Agent Note: 多用户隔离实例 v1 方案——provision 化 + 直达链接（前置：官方会话桥评估）

Status: proposed（2026-09-04，承接 multi-dsh-collaboration 方向修正：多用户隔离实例 = 真实需求）

## 目标回顾

组内团队共用一台服务器、每人独立隔离 DSH 实例（AnkoCD/dsh-server-deployment 对照，
见 community-reference.md §「多 dsh 管理与多用户」）。差距：userctl 式自动建户 /
每用户独立 API Key / 登录门户多站点路由；保留 dsh-user 实例内多用户（差异化）。

## 前置障碍评估：官方 BrowserAuth 会话桥

结论（沿用 [alpha5-auth 实测](2026-09-03-alpha5-auth-official-token-vs-user-login.md)）：

- 官方 fence = 每进程一次性 launch token → HMAC cookie（possession 模型，无用户/角色），
  30 天有效；clarknu gateway 反代到 upstream 无官方 cookie → 401，**上游不修这个**。
- **三种桥接选项**：
  1. 自研 login-bridge（替换 clarknu）：登录后持官方 cookie 进 UI + HTTPS 头喂 dsh-user。
     重活（多站点 cookie 续期/转发语义），列为中期。
  2. clarknu 升级：只修 Host/Origin，**不解决** 401 → 不做。
  3. **直达链接捷径（v1 采用）**：多用户场景里每个用户访问的是**他自己的实例**
     （独立 DSH_HOME/端口），官方 cookie 本就按实例独立签发——不需要用户在"管理端"
     登录。管理端仍由 admin 官方 token 保护；用户拿到**一次性实例直达链接**
     `http://host:<port>/?token=<launch>` 即换取自己实例的 cookie。会话桥问题
     从"门户登录"降级为"**实例 launch token 的受控派发**"。

## v1 功能切分（基于现有地基，全部可复用）

1. **provisionUserInstance（console @Remote）**：管理端为成员开个人实例
   - 入参：user 展示名/归属；自动分配：DSH_HOME=~/.dsh-<user>、端口（递增分配表）、
     profile=web、实例令牌（= 该实例的 channel token，**兼作个人 API Key**——每实例
     独立，解决"共享 key"差距）。
   - 复用现有 `deployInstance` 链路（daemon 落地：模板复制 + patch 实例化 + 拉起）。
   - 用户→实例映射存档（console 档案），web2 界面入口放「实例」页（区分 personal）。
2. **实例直达链接派发（console @Remote getInstanceAccessLink）**：daemon 拉起实例时
   stdout 已落盘 `~/.dsh-daemon/logs/<id>.log`（含 `?token=`）；解析最新 launch token
   生成直达链接，管理端展示/复制给成员。重启后 token 轮换 → 链接失效，属 possession
   模型预期（管理端重新取）。
   - （中期）daemonStart 可加 `--no-open` + 独立捕获 token，避免多余开浏览器。
3. **登录门户多站点路由 → 降级为「实例目录页」**：管理端控制台已有跳转能力；
   加"成员"分组的可分享直达链接列表即可，无需 HTTPS 门户反代。
4. **dsh-user 保留**：实例内成员/角色隔离照旧；一用户一实例的 OS 级 runuser 隔离
   （AnkoCD 手法）在自托管 dev/组内场景 v1 不做（同账号 + 独立 DSH_HOME 已隔离数据）。

## 与 AnkoCD 差距表更新

| AnkoCD | v1 对应 | 状态 |
| --- | --- | --- |
| userctl 自动建户/实例 | provisionUserInstance（复用 deployInstance） | 待实现 |
| 每用户独立 API Key | 实例 token = 个人 key | 待实现（随 provision） |
| 登录门户路由 | 直达链接目录页（admin 侧展示/分享） | 待实现 |
| OS 级 runuser 降权 | v1 不做（同账号隔离数据；OS 隔离后续评估） | 记录 |

## 开放项 / 后续

- login-bridge（选项 1）中期再议：需要"用户在管理端登录后自动跳自己实例"时启用。
- token 派发审计 / 一次性失效（链接可复制期 = token 有效期 30 天 cookie，重启轮换）。
- 实例配额/端口分配表并发安全（对照 dsh-remote-tunnel 端口双校验）。

相关：[alpha5-auth](2026-09-03-alpha5-auth-official-token-vs-user-login.md) ·
[multi-dsh-collaboration](2026-09-03-multi-dsh-collaboration.md) ·
[deploy-instance-closed-loop](2026-09-04-deploy-instance-closed-loop.md) ·
community-reference.md §73-97
