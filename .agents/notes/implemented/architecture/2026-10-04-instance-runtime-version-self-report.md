# Agent Note: 实例版本 = 运行时自报，池软链仅离线兜底

Status: implemented

## Problem

控制台实例页每行的版本号恒为 `—`（真机实测）。原取值表达式是
`runtimeVersion ?? version ?? '—'`：`runtimeVersion` 由管理端**从磁盘猜**——按
`launch[id]` → 实例规格 → 注册表的 `home + profileDir` 三级定位 profile 目录，
再读 `<profileDir>/node_modules/@deepseek-ai/dsh` 软链是否落在 runtime 池
（`currentRuntimeVersion`）；`version`（通信面自报字段）**从未被填过**。

本机两个实例（3080 `~/.dsh/profiles/web`、3082 `~/.dsh-web2/profiles/web2`）跑的是
**全局安装**的 dsh（`<prefix>/lib/node_modules/@deepseek-ai/dsh`），
`profiles/<p>/node_modules/@deepseek-ai/dsh` **根本不存在**。两个来源同时为空 → 恒 `—`。

根因：**版本是运行时属性，不是磁盘布局属性**。原策略隐含前提"只有引用 runtime 池的
新布局实例才有版本"是错的——全局/自带安装的实例也能报版本，只是磁盘上查不到。

## Decision

1. **自报优先（主路径）**：实例在自己的进程内解析正在跑的官方内核版本，作为通信面
   `InstanceIdentity.version` 上报。解析器 `packages/dsh-console/src/kernel-version.ts`
   三级依序，**都拿不到就留空（不编造）**：
   - `createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')` 读 `version`；
   - 从 `process.argv[1]`（`.../bin/dsh`，或 pnpm `node_modules/.bin/dsh` 软链——先 `realpath` 解析）推 npm 前缀，读 `<prefix>/lib/node_modules/@deepseek-ai/dsh/package.json`（本地安装回落 `<prefix>/node_modules/...`）；
   - 从 `process.execPath`（`.../bin/node`）推 npm 前缀，同上。
   暴露面：通道服务在**任何角色**（含 `role: agent`）经 webServer 挂
   `GET /api/channel/identity` → `{ id, version }`（exact 路由，先于官方 `/api`
   BrowserAuth fence 命中，免凭据）；hub/worker 注册载荷 `WorkerReport.version`
   亦兜底带本进程版本。
2. **管理端读取**：`ConsoleService.probeLaunch()` 探测目标地址的
   `/api/channel/identity`，既判可达（老实例无该端点/非 JSON 仍算可达，不崩），又取回
   `version` 经 `ChannelService.setVersion` 写入 `InstanceIdentity.version`。管理端自己
   （同进程实例）在 `listInstances` 里直接用进程内解析值补 `version`。
3. **池软链作离线兜底**：`runtimeVersion`（读池软链）**保留**，实例离线/探测拿不到时
   UI 回退它。
4. **UI 顺序**：`version ?? runtimeVersion ?? '—'`（自报优先）；tooltip 标注两个来源
   （自报 / 池软链）。取值抽为纯函数 `src/client/version-label.ts`，供 UI 与单测共用。

## Alternatives

- **按 pid 读 `/proc/<pid>/cmdline` 推 dsh 路径**：可选本机兜底，但依赖进程可见性与
  监听端口反查 pid，机制重且跨机无效；主路径自报已覆盖，不做。
- **扩协议新字段/新模型**：`InstanceIdentity.version` 已是通信面既有字段，复用它即向后
  兼容（老实例不带该字段也不崩）；不新造。
- **只在管理端按磁盘猜得更聪明**（如找全局前缀）：仍属"猜"，且跨机不可达；否决。

## Consequences

- 实例在线时版本来自自报，**与磁盘布局解耦**：全局安装、自带安装、池引用都能报出真实版本。
- 新增 `GET /api/channel/identity` 是无鉴权（loopback/内网信任，与既有 `/api/console/instances`
  exact 路由同口径）只读端点，仅暴露实例 id 与内核版本，不泄露更多。
- 实例离线时仍只能给出磁盘池软链版本（或空）——这是兜底，不是权威。
- 真机证据：3082 重启后 `curl http://127.0.0.1:3082/api/channel/identity` →
  `{"id":"web2","version":"0.1.7-rc.2"}`（该实例跑 `~/dsh-017-cli/node_modules/.bin/dsh`，
  实际命中**路径 2**：argv[1] 软链 `realpath` → `.../dsh-017-cli/node_modules/@deepseek-ai/dsh`）；
  新区间 console（3085，含 launch `web2`）的 `curl /api/console/instances` 中
  `web2.version = "0.1.7-rc.2"`、`web5.version = "0.1.7-rc.2"`。
