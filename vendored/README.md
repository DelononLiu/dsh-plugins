# vendored/ —— 社区插件（npm 安装 + lock 锁版本）

> 2026-08 更新：**统一 npm 安装方式**——所有 vendored 走 `dependencies` + `dsh.lock.json` 锁版本（与全家桶一致）。submodule 不再用于轻量单包（npm 有发布版即用 npm）；submodule 仅保留给**无 npm 发布版或需深度改造审查**的例外（当前无）。
>
> 2026-09-26 收敛：**vendored UI 应用与认证网关全部下架**——UI 一律官方原生 + 自研关注层；协作编排改用官方 agent-team。

| 插件 | 来源 | 模式 | 状态 |
| --- | --- | --- | --- |
| dsh-memento | [PerryLink/dsh-memento](https://github.com/PerryLink/dsh-memento) | 尚未安装（npm 最新 v0.5.18，peer 已声明 0.1.7-rc.2 兼容） | 📋 选定未接入（v1 无消费方） |
| ~~dsh-web-ui 全家桶（@linxin666 4 包）~~ | [zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) | — | ❌ 2026-09-26 移除（task-board / git-graph / ssh / skill-explorer 全部下架，UI 用官方原生） |
| ~~dst-agent-teams / @nanmicoder/dsh-agent-teams~~ | [NanmiCoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) | — | ❌ 2026-09-26 移除（改用官方 agent-team） |
| ~~dsh-gateway（clarknu）~~ | [clarknu/dsh-gateway](https://github.com/clarknu/dsh-gateway) | — | ❌ 2026-09-26 从实例下架（独立部署 + 官方会话桥仍为 backlog，见 `docs/architecture.md` §9） |
| ~~dsh-better-sidebar（omdsh-dev）~~ | [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | — | ❌ 2026-09-26 移除（侧边栏改用官方原生） |
| ~~dsh-update-checker~~ | — | — | ❌ 已删除（升级/备份/回滚并入 dsh-console，见 `docs/architecture.md` §5 注） |
| ~~dsh-prometheus~~ | [xxiaoxiong/dsh-prometheus](https://github.com/xxiaoxiong/dsh-prometheus) | — | ❌ 2026-09-26 评估后不引入（npm 0.1.0 的 peer 精确钉 0.1.0-rc.6，未跟内核 → 0.1.7 闸门会拒装；将来要指标面时重评） |

- 安装方式见 AGENTS.md「Vendoring policy」：统一 npm + lock 锁版本 + patch 层改造。
- License：dsh-memento MIT（已下架项的历史 license 见 `docs/community-reference.md`）。
- 下架决策与后果见 [trim-vendored-ui-and-gateway](../.agents/notes/implemented/architecture/2026-09-26-trim-vendored-ui-and-gateway.md)。
