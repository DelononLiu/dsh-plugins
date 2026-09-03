# Agent Note: 多 dsh——方向修正（2026-09-04 复核）

Status: proposed（2026-09-04 方向修正后）

## 2026-09-04 复核结论（取代早期 v1/v2/v3 愿景）

用户质疑"多 dsh 是否伪需求"+ 明确真实需求后，方向修正：

1. **跨主机自主协同干活（早期 v3）= 搁置**：官方 dsh 严格单机单实例
   （无多实例/多主机/守护派生概念，rc.1 tag 源码全量核对）；社区无项目
   做协同决策（最接近的 dsh-helm 仅 MCP 路由转发）；依赖全是新发明 →
   现阶段伪需求/过早，降级。
2. **一台服务器为多用户开隔离实例 = 真实需求（转正）**：组内需要团队
   多人共用服务器、每人隔离 DSH 实例。社区已有成熟参考
   （AnkoCD/dsh-server-deployment ⭐25：登录门户 + 每用户独立 OS 账号 +
   独立 DSH_HOME/端口 + 独立 API Key + 交付抽屉 + OS 级隔离 runuser
   降权；x102201/deepseek-harness-helper：单机多开 launcher）。
3. **路径 = 自研为主**（用户确认）：在官方底料（Cordis 插件 + profile
   组合 + Typert 协议类型层）上自建"多实例管理层"——官方完全空白，
   无可删除/借力的概念，AGENTS.md 分层（user 身份 → channel 通信 →
   console 管理 → daemon host）正是这个空白上的正确落点。

## 我们已有地基（多用户隔离实例雏形）

- web2/3/4 = 独立 DSH_HOME + 独立端口（测试矩阵已验证多实例并存）。
- dsh-user = 实例内多用户身份（admin/member，官方无此概念——差异化）。
- gateway（clarknu）+ dsh-user cookie 验签 = 登录层（官方 BrowserAuth
  fence 需官方会话桥，见 2026-09-03-alpha5-auth note）。
- console = 实例档案/生命周期/launch 编排（管理多实例的地基）。

## 与社区参考的差距（自研要做）

| 维度 | AnkoCD 参考 | 我们现状 | 差距 |
| --- | --- | --- | --- |
| 每用户独立实例 | OS 账号隔离 + userctl 自动建户/拉实例 | 多实例已隔离但手动配 | userctl 式自动建户 |
| 每用户独立 API Key | 各自 .credentials.yaml | 共享 key | 需做 |
| 登录门户路由 | 网关反代到各实例端口 | dsh-user+gateway | 多站点路由 |
| 实例内多用户 | 不做（一用户一实例） | **有**（dsh-user） | 保留（差异化） |

## 遗留

- 是否逐项落地（建户/实例/Key/门户路由）按功能拆 worktree 推进；
  先补 community-reference.md 的社区方案调研（AnkoCD 等）与本文档对照。

## 早期内容（2026-09-03 原愿景，已部分取代）

原 v1（部署/升级/跳转）+ v2（远程工作区）+ v3（自主协同）愿景与 A/C/B
决策记录如下，v1 的"便捷跳转"（quick-nav 实现）与"统一升级"仍有效且
是"管理多实例"的组成部分；v3 自主协同按本修正搁置。
