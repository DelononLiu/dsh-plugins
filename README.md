# dsh-plugins · dsh 团队发行包

DSH（DeepSeek Harness）是内核，本仓库产出**面向团队的发行包**：内核 + 自研核心插件（系统 → 管理组件 → UI）+ 社区聚合插件 + 版本锁。

## 分层与插件

| 层 | 插件 | 职责 |
| --- | --- | --- |
| 业务 app | dst-agent-teams（vendored）· 全家桶功能应用 | 多 Agent 协作编排 / 任务看板 / SSH / Git 图谱等重业务逻辑应用 |
| UI | dsh-desk · dsh-quick-nav · dsh-focus-session · dsh-focus-tabs · 全家桶 UI 能力（侧边栏） | UI 平台（布局/插件组合，无皮肤；工具入口组装器）/ 实例导航 / 会话关注区（置顶+活跃+胶囊标签）/ 会话标签行 / 界面增强（console UI 并入 dsh-console） |
| 管理组件 | dsh-console（+社区 dsh-update-checker/dsh-prometheus） | 主机/实例档案、生命周期、部署编排、inbox/投递、总览 |
| 系统 | dsh-channel · dsh-user · 认证网关（社区）· LLM 记忆（社区 dsh-memento） | 通信 · 身份模型（侧边栏用户徽标/登出）· 登录认证 · 跨会话记忆 |
| 内核 | deepseek-harness（rc 锁定） | 官方内核 + 内置插件 |

## 仓库结构

```
packages/   自研家族（发布 npm，dsh-* 前缀）
vendored/   社区插件清单（npm 安装 + lock 锁版本；dst-* 标记第三方）
profiles/   发行包 profile 模板（git clone 即用）：web=开发+正式 / web2=单插件测试 / web3=多插件测试，各含 dsh.lock.json 版本锁
presets/    团队自定义 agent preset 源（orchestrator 等，见下方「Agent preset」）
scripts/    bootstrap（SSH 引导装最小 agent）+ release（版本矩阵 bump）
docs/       架构文档
```

## Agent preset

Agent preset 定义 agent 会话的工具/提示词组合，属于内核概念（官方
`dsh-agent-presets`）。本仓库 `presets/<id>/` 版本化管理团队自定义 preset；
**安装 = 把目录铺到目标环境的 `$DSH_HOME/.agent-presets/<id>/`**（user root，
被自动扫描，无需任何配置），删除目录即卸载。现含：

| preset | 中文名 | 说明 |
| --- | --- | --- |
| presets/orchestrator/ | 调度模式 | 主模型作为编排者：分析需求、拆解任务、派发子代理执行并验收，循环迭代直至完成（基于官方 standard 派生，见 `.agents/notes/implemented/feature/`） |

详见 [docs/architecture.md](docs/architecture.md)。
