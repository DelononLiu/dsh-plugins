# dsh-plugins · dsh 团队发行包

DSH（DeepSeek Harness）是内核，本仓库产出**面向团队的发行包**：内核 + 自研核心插件（系统 → 管理组件 → UI）+ 社区聚合插件 + 版本锁。

## 分层与插件

| 层 | 插件 | 职责 |
| --- | --- | --- |
| 业务 app（当前无，预留） | — | 面向用户业务价值的应用（协作/分析/工作流…） |
| UI | dsh-my-ui · dsh-nav · dsh-tabs · dst-agent-teams | UI 平台（布局/组合/皮肤）/ 实例导航 / 会话标签页 / 多 Agent 编排 |
| 管理组件 | dsh-console | 主机/实例档案、生命周期、部署编排、inbox/投递（v1 承载）、总览 |
| 系统 | dsh-channel · dsh-user | 通信（发现/心跳/事件总线/鉴权/远程调用/控制指令）· 身份（网关注入/静态配置） |
| 内核 | deepseek-harness（rc 锁定） | 官方内核 + 内置插件 |

## 仓库结构

```
packages/   自研家族（发布 npm，dsh-* 前缀）
vendored/   社区插件（git submodule，dst-* 前缀标记第三方）
profiles/   发行包 profile 模板（分发形态：git clone 即用）+ dsh.lock.json 版本锁
scripts/    bootstrap（SSH 引导装最小 agent）+ release（版本矩阵 bump）
docs/       架构文档
```

详见 [docs/architecture.md](docs/architecture.md)。
