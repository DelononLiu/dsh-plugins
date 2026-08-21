# Agent Note: 发行包版本机制（lock 格式 + 升级回滚）

Status: implemented

## Problem

版本矩阵的落地格式（dsh.lock.json schema）与升级回滚策略未定。

## Decision

**dsh.lock.json 定稿 schema**（参考 Plugin Pack Schema v1）：

```json
{
  "schemaVersion": 1,
  "id": "dsh-distro-web",
  "name": "dsh 团队发行包（web：开发+正式）",
  "version": "0.0.0",
  "kernel": "@deepseek-ai/dsh@0.1.0-rc.8",
  "bundles": { "dsh-user": "0.0.0", "...": "..." },
  "vendored": { "dst-agent-teams": "TBD" }
}
```

**升级回滚策略**（参考 dsh-update-checker）：
1. 升级前**快照**：当前 bundles 版本 + lockfile + patch 层（cordis.patch.yml 全量）。
2. 升级：推新发行包 → **逐实例滚动重启** → 心跳/健康确认（每实例恢复才进下一个）。
3. 失败自动**回滚**到快照；备份保留 N 份（/backups），写路由 loopback + 确认。

## Alternatives

- 只滚动重启无回滚——否决：升级失败团队环境不可用。
- 全量停机升级——否决：小团队也要在线。

## Consequences

- 三个 profile 的 dsh.lock.json 已按定稿 schema 落地（web/web2/web3）。
- scripts/release 按此 schema 负责 bump 与发布；scripts/bootstrap 依赖 agent 组件集（见 agent-minimal-set note）。
