# Agent Note: typert 接入第一期——channel @Remote + quick-nav ctx.remote（rc.2 源码确认）

Status: implemented

## Problem

typert 接入（传输分层已定：`typert → dsh-channel`）。第一期 = 最小闭环：dsh-channel 暴露 `@Remote` 服务、quick-nav client 改 `ctx.remote` 消费（替换手写 `/api/quick-nav/instances`），验证构建管线 + 类型契约 + 运行时链路。**第一期已落地（2026-08-23）**。

## 实现方案（rc.2 源码逐段确认，2026-08）

### 内核事实（已实测）

- 运行内核 **0.1.1-rc.2**（`dsh --version`），typert 运行时内置：`dsh-typert-protocol` / `dsh-typert-registry` / `dsh-typert-loader` / `dsh-client-connection` / `dsh-api-remotes`（web2 已跑 registry bundle）。
- **generator 不随内核**——构建期工具，npm `@deepseek-ai/dsh-typert-generator@0.0.1-rc.1`（依赖 TS6），或官方仓库 rc.2 源码构建（版本完全一致）。

### 官方链路（rc.2 代码确认）

```
1. host 服务方法加 @Remote('name') —— packages/typert/protocol: Remote 装饰器
2. 构建时 generator.generate(packages, ['host']) → WorkspaceEmitResult{js,dts,remote{js,dts}}
3. 写文件（tsdown-plugin emitArtifacts）：lib/typert.host.{js,d.ts} + lib/typert.remote-client.{js,d.ts}
4. package.json exports "./typert"（host）+ "./remote"（client 投影）
5. host 运行时 typert-loader 发现 ./typert → import → ctx.typert.register()（自动）
6. 传输：api-gateway 经 ctx.connection.rpc.intercept('/api') 挂载（HTTP/WS，官方已实现）
7. client：import channelRemote from '@deepseek-ai/dsh-channel/remote' → ctx.remote.$mount(channelRemote)（inject ['remote']）
8. 消费：ctx.remote.list() / .get(id)（类型合并自 ./remote 的 d.ts）
```

### 我们的构建脚本接入（build-client.mjs 扩展）

- host 构建后（tsc 出 lib），**新增 typert 生成步骤**：写 `scripts/build-typert.mjs`：
  ```js
  import { WorkspaceTypertGenerator } from '@deepseek-ai/dsh-typert-generator'
  const gen = new WorkspaceTypertGenerator(workspaceRoot)
  const artifacts = gen.generate(['dsh-channel'], ['host'])
  // 写 lib/typert.host.js + lib/typert.remote-client.js（照抄 emitArtifacts 逻辑）
  ```
- **tsconfig.host.json**（generator 需要）：聚合 host 源码——我们只需 dsh-channel 一个包，创建最小 `tsconfig.host.json`（include 各包 src）+ `tsconfig.client.json`（client 源码）。
- **TS6**：generator 需要 `typescript@^6` —— 独立 `scripts/typert/package.json`（隔离 TS6，不污染包构建的 TS5）。

### dsh-channel 改动

- `ChannelService.list()` / `get()` 加 `@Remote`（rc.2 protocol 装饰器）：
  ```ts
  import { Remote } from '@deepseek-ai/dsh-typert-protocol'
  // ...
  @Remote
  list(): InstanceIdentity[] { ... }
  @Remote
  get(instanceId: string): InstanceIdentity | undefined { ... }
  ```
- package.json：`peerDependencies` 加 `@deepseek-ai/dsh-typert-protocol`；`exports` 加 `"./typert"` + `"./remote"`（指向 lib/typert.host.js / typert.remote-client.js）。

### quick-nav client 改动

- 删手写 `fetch('/api/quick-nav/instances')`；改：
  ```ts
  import channelRemote from '@deepseek-ai/dsh-channel/remote'
  import type {} from '@deepseek-ai/dsh-channel/remote'  // 类型合并
  ctx.inject(['remote'], async (ctx) => {
    const dispose = await ctx.remote.$mount(channelRemote)
    const instances = await ctx.remote.list()  // 类型契约
  })
  ```
- inject 加 `'remote'`。

### client remote 消费纪律（fiber 注入，2026-08 实测）

- `ctx.remote.<ns>` 不是普通对象属性，是 **cordis 服务**（`remoteServiceKey(ns)` = `'remote.<ns>'`）——dotted
  访问解析为服务全名，**调用 fiber 的 store 链必须可见该服务**，否则抛
  `cannot get property "remote.<ns>" without inject`。
- **$mount 的 fiber 归属**：namespace 服务注册在 `$mount` 执行时的 fiber 的 store。若 `$mount` 在
  **异步回调**里执行（如 `fetch(...).then()` 内），服务落在异步 fiber——后续点击/渲染 fiber 访问
  必报 without inject（quick-nav 的 $mount 在 apply 同步 fiber，裸访问碰巧工作，是 fiber 巧合）。
- **正道**：消费方用 `ctx.inject(['remote.<ns>'], (injected) => { ns = injected.remote.<ns> })` 显式
  从 store 解析服务（不依赖 fiber 巧合）；`$mount` 仍需 await（异步挂载完成前 ns 不存在）。
- 实例：dsh-console ConsoleBadge 的 host 方法（listInstances/controlInstance/brokerStatus）均经
  `ctx.inject` 抓取 namespace 引用后调用。

### 验证

- 构建：generator 产出 channel typert 产物（host + remote-client）。
- web2：quick-nav 实例列表经 `ctx.remote.list()` 拉取（替换 /api/quick-nav/instances），类型契约编译期生效。
- 单元测试：generator 产物存在 + quick-nav 消费路径 mock。

### 保留

- console 的 /api/console/* 与跨实例 sendControl 不动（第二期：console @Remote + @RemoteScope）。
- broker 仍为 channel 可选 transport（跨实例物理投递）。

## Alternatives

- **官方仓库 rc.2 构建 generator**：与内核版本完全一致，但需先构建官方 harness 的 typert 四包（依赖 TS6 workspace）→ npm rc.1 优先试，不兼容再退。
- **自建 channel transport（路线 B）**：重复官方 Connection 轮子 → 否决（用户确认路线 A）。

## Consequences

- 构建管线升级（build-typert.mjs + tsconfig.host/client.json + 隔离 TS6）。
- dsh-channel 成为第一个 @Remote 服务；quick-nav 第一个 ctx.remote 消费者。
- 验证"类型即契约"全链路后，第二期 console @Remote + @RemoteScope 跨实例照此扩展。

## Implementation（第一期，2026-08-23 落地）

- **构建管线**：`scripts/build-typert.mjs`（host tsc 后调 WorkspaceTypertGenerator）；`tsconfig.host.json` references 含 vendored typert-protocol（generator 的 loadRegistrations 只收 packages/ 内）。
- **vendored typert-protocol**：官方 rc.2 源码（771 行 MIT）——generator 的 `isTypeMetaSymbol` 要求 @Remote 装饰器符号声明在 packages/ 内源码（npm .d.ts 不满足）；运行时用内核自带版，不 fork。
- **dsh-channel**：`list()/get()` @Remote（TypertRemoteService 基类）；InstanceIdentity 移 `./types` 子路径（generator 边界类型规则）；exports `./typert`/`./remote`/`./types`。
- **quick-nav client**：inject `remote` + `$mount(channelRemote)` → `ctx.remote.channel.list()`；本地 declare module cordis `remote: TypertClientRemote`（官方 api-remotes 只聚合官方 7 包，不含自研 channel）。
- **踩坑**：① protocol 版本必须全仓统一 rc.2（pnpm peer 组合残留 rc.8 导致 declare module 合并分离——`remote.channel` 类型缺失）；② build-typert 的 workspaceRoot 须从脚本位置推导（build cwd=包目录）；③ 生成物依赖 zod（channel 加依赖）；④ TS6 移除 @types 默认包含（tsconfig.base 补 types:["node"]）。
- **验证**：`channel/list|get` RPC 端点经 gateway 暴露（loader 自动注册 ./typert），web2 curl 实测 `ok:true`；全仓 115 测试 + build 全绿。

## Implementation（第二期，2026-08-23 落地）

- **console @Remote**：`listInstances()` / `controlInstance()` 加 @Remote（TypertRemoteService）；边界类型移 `./types` 子路径；`Record<string,unknown>` payload 改 `{version?: string}`（generator 无法投影 unconstrained unknown）。
- **broker 下沉 channel**（用户分层纠正）：brokerStatus 从 console 移到 channel（channel 持有 relay + signRequest）；console 删除 broker 路由/方法/BrokerStatusView——broker 是 channel 传输后端，上层经 `ctx.remote.channel.brokerStatus()` 消费。
- **构建分离**：console `tsconfig.host.json`（generator 只分析 host 面，exclude client——避免 client import dsh-console/remote 死循环）；tsconfig.json 全量 typecheck；build 顺序 build-typert 前置。
- **踩坑**：① composite+exclude 组合致 tsc 静默不输出（host/build tsconfig 分离）；② 跨包类型 import（console types import dsh-channel）致 generator flags 崩溃（内联身份字段解决）。
- **验证**：console/listInstances|controlInstance + channel/brokerStatus RPC 经 gateway 暴露（web2 curl 实测 ok:true）；全仓 115 测试 + build 全绿。
