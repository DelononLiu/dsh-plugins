# Agent Note: deploy 新实例闭环——复用发行包 + 新 DSH_HOME 实例化

Status: proposed

## Problem

控制台「部署主机」（半自动 bootstrapHost）已让 daemon 上线。下一步：**daemon 上部署/新建工作实例**（web6/web7...），管理端声明 → daemon 自动拉起 → 控制台出现可跳转。

现状：daemon 只管理静态 config.instances 清单内实例（deploy 走 default 占位、清单外拒绝）；无新实例落地机制。

## Decision（成熟技术借鉴：Docker 镜像/容器 + 发行包即模板）

**核心洞察**：发行包不是每实例一份——web3/web4 是**同一发行包（共享 node_modules）+ 不同 DSH_HOME + 不同 patch（端口/身份/令牌）**。新实例不需要 clone 模板或推送发行包，daemon 复用本地已装发行包，只需：

```
Docker 模型:   镜像(共享)  + run(可写层+env) = container
我们的模型:  发行包/内核   + DSH_HOME+patch  = 实例
```

### 1. deploy = console 声明期望状态（决策面）

`deployInstance` 入参扩为完整请求（LaunchSpec + 实例化值）：
`{ instanceId, host, version, profile, port, dshHome, addr, env, token }`

console 组装好 daemon 落地所需一切（dshHome 路径/端口/身份/令牌），经 channel sendControl `type: 'deploy'` 下发（只投 daemon，已有路由）。

### 2. daemon 动态实例 + patch 实例化（执行面）

daemon 收 deploy（新增 case）：
1. **运行时清单** `runtimeInstances: Map<id, LaunchSpec>`（初始 = config.instances），deploy 动态加（不改静态 config；重启后 console 重新下发，v1 不持久化）。
2. **建 dshHome**：`mkdir ~/.dsh-<id>/profiles/web`，复制 profile 骨架（web 实例的 package.json/cordis.yml/patch 模板——几 KB 配置）。
3. **patch 实例化**：写该实例的 patch（port/DSH_RELAY_AGENT/令牌/DSH_CONSOLE_ADDR）——console 在请求里给实例化值，daemon 写入。
4. **node_modules 复用**：新实例引用 daemon 本地已装发行包的 node_modules（pnpm link / 同 tree 引用）——零下载（测试环境 web2/3/4 正是此模式）。
5. **拉起**：复用 `daemonStart`（`DSH_HOME=~/.dsh-<id> dsh --profile web`）→ 注册 → 控制台出现。

### 3. 与半自动 bootstrapHost 分层

- bootstrapHost：部署**主机 daemon**（agent 最小集，SSH 引导）。
- deployInstance：在**已上线 daemon** 上建工作实例（复用本地发行包）——两级一致。

### 4. 版本

deploy 带 version（实例发行包版本引用）；升级（后续）复用此落地通道推新版本 → 重启。

## Alternatives

- **console 推送 profile 目录给 daemon**（原方案 A）：daemon 需依赖 console 在线、且 profile 会随版本漂移 → 砍掉，改复用本地发行包。
- **daemon 每实例独立 pnpm install**（有网）：浪费（同版本可共享），且 headless 未必有网 → 复用本地 node_modules。
- **静态清单扩容**（改 cordis.patch.yml）：不符合"管理端便捷部署" → 不选。

## Consequences

- 「部署主机 → 建实例 → 跳转干活」闭环打通（配合 bootstrapHost + 跳转）。
- daemon 从"静态守护"升为"可接收部署的动态执行面"（runtimeInstances + patch 实例化）。
- node_modules 复用是核心——与 Docker 共享镜像层同思路，测试环境已验证此模式。
- 开放项：runtimeInstances 重启后恢复策略（v1 由 console 重发）、deploy 失败回滚、patch 模板维护。

## 下一步实现拆解（确认后）

1. console.deployInstance 增强（完整请求 + token 生成）
2. daemon runtimeInstances + deploy case（动态加 + 建 dshHome + patch 实例化 + 复用 node_modules + daemonStart）
3. 测试（daemon 收 deploy 动态实例 / console 组装请求）
4. 实测（web2 对 host1 daemon deploy web6 → 出现可跳转）

相关：[daemon-host-supervisor](../../implemented/architecture/2026-08-22-daemon-host-supervisor.md) · [multi-dsh-collaboration](2026-09-03-multi-dsh-collaboration.md)
