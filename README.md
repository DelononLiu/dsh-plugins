# dsh-plugins · dsh 团队发行包

DSH（DeepSeek Harness）是内核，本仓库产出**面向团队的发行包**：内核 + 自研核心插件（系统 → 管理组件 → UI）+ 社区聚合插件 + 版本锁。

## 分层与插件

| 层 | 插件 | 职责 |
| --- | --- | --- |
| 业务 app | dst-agent-teams（vendored）· 全家桶功能应用 | 多 Agent 协作编排 / 任务看板 / SSH / Git 图谱等重业务逻辑应用 |
| UI | dsh-desk · dsh-quick-nav · dsh-tabs · dsh-console-ui · 全家桶 UI 能力（侧边栏） | UI 平台（四区布局/插件组合，无皮肤；工具入口组装器）/ 实例导航 / 会话标签页 / 总览界面 / 界面增强 |
| 管理组件 | dsh-console（+社区 dsh-update-checker/dsh-prometheus） | 主机/实例档案、生命周期、部署编排、inbox/投递、总览 |
| 系统 | dsh-channel · dsh-user · 认证网关（社区）· 远程访问（社区）· LLM 记忆（社区 dsh-memento） | 通信 · 身份模型 · 登录认证 · 对外暴露 · 跨会话记忆 |
| 内核 | deepseek-harness（rc 锁定） | 官方内核 + 内置插件 |

## 仓库结构

```
packages/   自研家族（发布 npm，dsh-* 前缀）
vendored/   社区插件（git submodule，dst-* 前缀标记第三方）
profiles/   发行包 profile 模板（git clone 即用）：web=开发+正式 / web2=单插件测试 / web3=多插件测试，各含 dsh.lock.json 版本锁
scripts/    bootstrap（SSH 引导装最小 agent）+ release（版本矩阵 bump）
docs/       架构文档
```

详见 [docs/architecture.md](docs/architecture.md)。
