# 官方 DSH 0.1.2-alpha.5 Typert 生成与远程调用管线调研

> 调研对象（源码）：`/home/long2015/Code/dsh-harness-alpha5`（0.1.2-alpha.5）。
> 目的：把第三方插件工程（dsh-console 等 host 服务 + client 消费）对齐到官方 typert 全套。
> 下文除特别标注外，路径均相对 `/home/long2015/Code/dsh-harness-alpha5`。

---

## 0. 一页结论（先看这里）

- **一次 Remote 业务包 = 三个构建产物**：`lib/typert.host.js`（Host 面 TYPERT manifest：services/events/objects + schemas + **invocations**）、`lib/typert.remote-client.js`（给 client 的 `TYPERT_REMOTE` 描述符 + zod codec）、`lib/typert.remote-client.d.ts`（类型增强，把方法签名字段写进 `TypertRemoteMap/TypertRemoteNamespaceMap/TypertRemoteScopeMap`）。
- **识别开关只有一个**：`package.json` 声明 `"./typert"`（host 面）、`"./remote"`（有 @Remote 时必有）。产物命名与 exports 内容被构建期**强校验**（不对就抛错）。
- **不需要手写 zod**：generator 从 TS 类型自动重构成 zod v4 运行时 schema（strict codec）。边界类型必须是"纯 JSON 数据形状"（见 §2 约束），**产物运行时 `import { z } from 'zod'`**，所以业务包必须把 `zod@^4.4.3` 放进 dependencies。
- **Host 侧自动注册**：`typert-loader`（cordis 插件）监听 Loader 条目，凡装了且 exports `./typert` 的包自动 import + 校验 + `ctx.typert.register(TYPERT)`；网关按 `<namespace>/<method>` 从 `ctx.typert.local` 查描述符派发。
- **Client 侧类型**：任何编译单元里 `import type {} from '<你的包>/remote'` 即可让 `ctx.remote.<namespace>` 出现正确类型；运行时在你的 client 插件里 `await ctx.remote.$mount(remoteContribution)` 即可（命名空间以 Service `remote.<namespace>` 落盘，无需 Proxy）。
- **@RemoteScope 目前只在测试/夹具里真实使用**；产品代码的"作用域化"走**单 lookup 参数 + scope 投影**（如 `commands.execute(agent, …)` → client 传 `agentId`），以及 client 的 agent-scope Context 适配器。别在官方包里找 @RemoteScope 产品例——没有。
- **现有官方 remote 集合被集中在一处**：`@deepseek-ai/dsh-api-remotes`（client 面在 `src/client/index.ts` 一次性 `$mount` 所有官方 namespace）。第三方新 namespace **不要**改它，应该在自己的 client 插件里自 mount（官方例子：`client-ui-agent-team`）。

---

## 1. Typert generator 接入：构建如何扫出并生成

### 1.1 根构建编排（root package.json + tsdown.config.ts）

```jsonc
// package.json（root）
"build:lib:host":   "tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host",
"build:lib:client": "tsc -b tsconfig.client.json && tsdown --env.DSH_BUILD_FACE client",
```

- `tsc -b`（Project References）先把 host / client 两个**独立程序**各自编到各包的 `lib/types/`（声明 + JS）。
- `tsdown` 用 `--env.DSH_BUILD_FACE host|client` 区分面。根 `tsdown.config.ts`：

```ts
// tsdown.config.ts（root）—— host 面
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.DSH_BUILD_FACE) // client pass
  return {
    workspace: ['vendor/*', 'packages/*/*', 'apps/cli'],
    entry: client ? '' : ['lib/types/{index,invariant,startup}.js'],
    outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
```

关键点：
- **host pass** 才挂 `typertPlugin({ mode:'workspace', faces:['host'] })`；client pass 只产出浏览器 bundle（package 自带 config，如 `clientBundle(...)` 预设）。
- `typertPlugin` 两个职责（`packages/typert/generator/src/tsdown-plugin.ts`）：
  1. `transform`：把依赖里的装饰器语法先 `ts.transpileModule` 降级（rolldown 不吃装饰器）。
  2. `writeBundle`：每个输出触发一次；**workspace 模式**下第一次触发即对整个 workspace 跑一遍生成（`emittedWorkspaces` 去重），按包写产物。
- 产物写入逻辑（`emitArtifacts`）：
  - host face → `<pkg>/lib/typert.host.js` + `.d.ts`
  - `artifact.remote !== undefined`（有 @Remote）→ 再写 `lib/typert.remote-client.js` + `.d.ts` + `.d.ts.map`
  - client face（`./client/typert` 才需要）→ `lib/typert.client.js`；官方仓库**当前没有业务包声明它**（仅测试夹具），你要的 client 类型靠 `./remote` 那份 .d.ts。
  - host 面但无 Remote → 主动删掉陈旧的 `typert.remote-client.*`。

### 1.2 一个业务包要声明什么才被处理

识别函数（`tsdown-plugin.ts` `hasTypertExport`）：exports 里有 `./typert` **或** `./client/typert` **或** `./remote` 任一即入选。然后 `workspace.ts` 的 `validateExport` **强校验**精确形状，不符抛 `TypertAnalysisError`：

| 面 | exports 子路径 | 必须等于（types/default 双键） |
| --- | --- | --- |
| host | `./typert` | `{ types: "./lib/typert.host.d.ts", default: "./lib/typert.host.js" }` |
| host（有 @Remote 时） | `./remote` | `{ types: "./lib/typert.remote-client.d.ts", default: "./lib/typert.remote-client.js" }` |
| client | `./client/typert` | `{ types: "./lib/typert.client.d.ts", default: "./lib/typert.client.js" }`（当前官方无人用） |

`package.json.files` 也必须含对应 `.js/.d.ts`（`.d.ts.map` 只留 workspace 不发布）。真实样例：`packages/api/session-controller/package.json`。

```jsonc
"exports": {
  ".":      { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
  "./types":{ "types": "./lib/types/types.d.ts",  "default": "./lib/types/types.js" },
  "./client":{ "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
  "./typert": { "types": "./lib/typert.host.d.ts",          "default": "./lib/typert.host.js" },
  "./remote": { "types": "./lib/typert.remote-client.d.ts", "default": "./lib/typert.remote-client.js" },
  "./src/*": "./src/*", "./package.json": "./package.json"
},
"files": [ "lib/index.js","lib/client.js","lib/types/**/*.js","lib/types/**/*.d.ts",
           "lib/typert.host.js","lib/typert.host.d.ts",
           "lib/typert.remote-client.js","lib/typert.remote-client.d.ts" ],
"dependencies": { "@deepseek-ai/dsh-brand": "workspace:^", ..., "zod": "^4.4.3" }
```

配套点：
- **装饰器降级 + bundling**：一个包的 tsdown 若用自己的 config（如 session-controller 只有 `clientBundle(...)`），node half 在 host pass 由 root workspace config 的 lib entry 出——包自身带 client 需声明 `dsh.client`（external/inject/platform）并出 `lib/client.js`。
- **zod 运行时依赖**：生成的 `typert.host.js / typert.remote-client.js` 只要有 boundary 就会 `import { z } from 'zod'`（`emitter.ts` `renderJs/emitRemote`），故 zod 必须是 runtime dependencies。
- **Peer 依赖协议**：host 侧要能 `@deepseek-ai/dsh-typert-protocol`（装饰器/类型）、`@deepseek-ai/dsh-typert-registry`（ctx.typert 注入处）、`@deepseek-ai/cordis`。

### 1.3 tsconfig 怎么组织

- 根 `tsconfig.host.json` / `tsconfig.client.json`：**solution 式聚合**（各自 `references` 一长串包），根 `tsconfig.json` = `{ files:[], references:[host, client] }`。
- 每包三件套：`tsconfig.json`（files:[] + 两个 reference）、`tsconfig.host.json`、`tsconfig.client.json`。host 与 client **各自独立编译程序**，因为两侧都对 `@deepseek-ai/cordis` 的 `Context` 做 interface merge，合一个程序会撞。
- 包级示例（`packages/api/session-controller/tsconfig.host.json`）：`extends ../../../tsconfig.base.json`、`rootDir: src`、`outDir: lib/types`、`files` 列出 host 侧源码、`references` 只列 host 面依赖（含 `../../typert/protocol`、`../../typert/registry`、上游包的 `tsconfig.host.json`）；client 版 `extends ../../../tsconfig.base.client.json`（jsx/DOM/types），`include: src/client/**` 等，references 走 `../gateway/tsconfig.client.json`。
- 生成器自己的 Workspace 分析用的是 **源码程序**（每个包的 exports `.` 入口 + 各 package tsconfig 组成的 program），不是 lib。workspace root 的判定依据是**向上找 `tsconfig.host.json`**（`tsdown-plugin.ts` `workspaceRoot`）。

### 1.4 Host 侧运行时自动装载

`packages/typert/loader/src/index.ts` 的 cordis 插件（`name:'typert-loader'`, `inject:['typert','loader']`）：
- 以 loader 条目（cordis Loader 的 entry，或显式 `Config.packages`）为准；条目包的 package.json exports 含 `./typert` 就 `import(fileURL)` 其 `TYPERT`，`validateTypertManifest()`（模块/文件边界：package 名必须匹配、face==='host'、schema 必须真 zod v4——`'_zod' in schema`、codec 全 strict）后 `ctx.typert.register(manifest)`。
- 增量：`internal/plugin` 事件打脏 → microtask flush；卸载自动 withdraw。
- 手动通道：`ctx.typert.register(TYPERT)`（`built-lib.e2e.ts` 里 `host.typert.register(TYPERT)` 正是这么用的）。

---

## 2. @Remote 方法完整写法

### 2.1 类型入口与绑定（二选一）

```ts
// 方式 A（产品代码主流）：继承 TypertRemoteService，super(ctx, serviceKey[, {namespace}])
export class SessionController extends TypertRemoteService {
  constructor(ctx: Context, config: Config) {
    super(ctx, 'sessionController', { namespace: 'session' }) // service key ≠ 线上 namespace
  }
  @Remote('list') async list(_req: SessionListRequest, signal: AbortSignal): Promise<SessionListValue> { … }
}
// 方式 B：普通类 + 字段
export class Goals extends Service {
  readonly typertRemote = bindTypertRemote(this, 'goals')  // 或 { namespace: 'x' }
  @Remote async create(request: CreateGoalRequest): Promise<CreateGoalResult> { … }
}
```

生成器约束（`analyzer.ts`）：service key / namespace 必须是字符串字面量、只含 RPC 段字符；options 只允许 `{namespace}`；key 默认即 namespace（`sessionController` 例子显式 `{namespace:'session'}` 让 endpoint 变 `session/list`）。

### 2.2 装饰器形态

| 写法 | 含义 |
| --- | --- |
| `@Remote` | 方法名即 export 名（endpoint `<ns>/<method>`） |
| `@Remote('openWorkspacePath')` | alias：线上叫 `openWorkspacePath`，实现方法名可不同（生成 `implementation` 字段） |
| `@Remote({ mode: 'stream' })` | 流式；方法必须返回 `Iterable<T>`/`AsyncIterable<T>` |
| `@RemoteScope('agent'[, 'exportName'])` | 以 Context 为接收者：endpoint 变成 `<context>:<ns>/<method>`，client 侧挂在 scoped 面 |

### 2.3 方法体硬约束（generator fail 清单，`invocationModel`/`remoteMarker`）

- 必须是 **public 实例方法**、有方法体（非 abstract）、名字是 identifier；**不支持泛型方法**。
- 参数：必须 identifier 绑定；**禁止 rest、默认值、解构、显式 this**。
- **取消参数**：叫 `signal` 且类型为**全局 `AbortSignal`**、**必须是最后一个参数**；codec 不进 wire args（descriptor `cancellation: {parameter:'signal'}`）。host 侧代码照常 `signal.throwIfAborted()` / 透传给底层。
- 返回：`Promise<T>` / `T`（unary）；`AsyncIterable<T>`/`Iterable<T>`（stream 模式，`remoteResultType` 校验 wrapper 后剥掉，client 面生成 `AsyncIterable<T>`）。
- 每个参数/返回值类型必须是可生成 strict codec 的**数据形状**（见 2.4）。类类型参数（如 `Agent`/`Session`）**必须**在 `TypertLookupMap` 有登记（成为 `source:'lookup'` 参数，wire 上变成其 wire id 字段），否则 fail `'non-JSON class parameter X requires a TypertLookupMap entry'`。
- 业务错误一律 `throw new RemoteError('code', message, details)`（code 来自 `RemoteErrorDetailsMap` 合并，`gateway/bad-request|cancelled|internal` 是通用三项，领域码由各包在 `/types` 里 merge，如 `session/not-found`）。

### 2.4 "需要 z schema 吗？" —— 不需要手写，但要守形状

`emitter.ts` 的 `SchemaEmitter` 会把每个边界类型**自动重构成 zod v4 表达式**（`z.object/z.union/z.intersection/z.array/z.tuple/z.record/z.date/z.literal/z.optional/z.readonly…`、泛型声明包 `z.lazy`），产物里既有 TYPERT manifest 的 strict codec（`{mode:'strict', typeSymbol, schema:<z对象>}`）也真实 import zod。所以对你（作者）的约束只是类型必须 **JSON 化 + zod 可投影**：primitive/literal/tuple/array/object（数据属性）/Record/Date/union/intersection/可泛型 object 声明；**不允许 enum（无 Zod 投影）、函数/构造函数/mapped/conditional/模板串类型/索引访问等**。`analyzer.ts` 用 `assertRemoteJsonType` + `resolvedRemoteCodecType` 强校验。`./types.ts` 里那些 `SessionListRequest` 纯 interface 即是全部所需。

### 2.5 真实产品样例速览

- session：`packages/api/session-controller/src/index.ts`（unary/stream/alias/AbortSignal/RemoteError 全有，见 2.1 片段）。
- agent 参数 lookup：`packages/interaction/commands/src/index.ts`：

```ts
@Remote
async execute(agent: Agent, line: string, images: readonly EncodedImageAttachment[],
              signal: AbortSignal): Promise<CommandExecution | undefined> { … }
@Remote
list(agent: Agent): readonly CommandDescriptor[] { … }
```
- stream：`packages/api/workspace-controller/src/index.ts` 的 `@Remote({mode:'stream'})`、`packages/api/session-controller/src/index.ts` 的 `follow/control`。
- scoped（唯一真实源码都在测试/夹具）：`packages/typert/generator/tests/fixtures/remote-model/packages/remote/src/index.ts`（`@RemoteScope('agent')`）、`packages/api/gateway/tests/gateway.host.spec.ts`。

---

## 3. 生成的 remote-client 工件与 client 类型

### 3.1 文件与形状

每个包产物（repo 当前未预构建，以下从 generator 源码与单测断言还原；断言见 `packages/typert/generator/tests/remote-model.spec.ts`）：

- `lib/typert.remote-client.js`：`export const TYPERT_REMOTE = { package, descriptors:[InvocationDescriptor…] }; export default TYPERT_REMOTE`，类型即 `TypertRemoteContribution`（protocol `types.ts`）。descriptors 含：`id`（`<pkg>#<ns>/<method>`）、`service`、`namespace`、`method`、`implementation?`、`mode:'stream'?`、`invocation:{kind:'direct'} | {kind:'context', context, wire, codec}`、`scope?{context, wire}`、`parameters[{name, wire, source:'json'|'lookup', lookup?, codec(strict,zod), acceptsUndefined?}]`、`cancellation?{parameter:'signal'}`、`result:{mode:'strict',…}`、`sourceLocation`。
- `lib/typert.remote-client.d.ts`：**核心是 module augmentation**：

```ts
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { …你包的 ./types 等 } from '<你的包>/types'   // 类型从公共 exports 子路径引入

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$73657373696f6e {   // 每 namespace 一个 hex 接口（"session"）
    list(request: SessionListRequest, signal?: AbortSignal): Promise<RemoteResult<SessionListValue>>
    follow(request: SessionFollowRequest, signal?: AbortSignal): AsyncIterable<SessionFollowFrame>
    …
  }
  interface TypertRemoteMap { 'session/list': (…same…) => Promise<RemoteResult<…>>; … }
  interface TypertRemoteNamespaceMap { 'session': TypertRemoteNamespace$73657373696f6e }
  interface TypertRemoteScopeMap { 'agent:…/…': (…) => … }   // 有 context/scope 时
}
export declare const TYPERT_REMOTE: TypertRemoteContribution
export default TYPERT_REMOTE
```

- 命名空间定名规则：wire endpoint = **`<namespace>/<method>`**（namespace 默认 service key，可 `{namespace}` 覆盖；`remoteSignature` 拼接）；scope key = **`<context>:<namespace>/<method>`**；client 面方法签名把 host 的 lookup/Context 身份参数**换成 wire 字段**（`agent`→`agentId: SessionId`），取消参数统一变成可选的 `signal?: AbortSignal`，unary 返回值包一层 `Promise<RemoteResult<T>>`，stream 返回 `AsyncIterable<T>`。

### 3.2 消费侧拿类型的标准姿势

在 client 编译单元里做**类型副作用导入**即可全局 merge 类型面：

```ts
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'   // 让 TypertRemoteMap/…Map 展开
export type SessionRemote = ClientRemote['session']                    // 或直接索引
// transport.ts 真实做法（packages/api/session-controller/src/client/transport.ts）
```

`ClientRemote`（`packages/api/gateway/src/client/index.ts`）`extends TypertRemoteNamespaceMap`，所以每个 `/remote` 的 .d.ts merge 后，`ctx.remote.<namespace>` 的类型自然出现。官方把全部 namespace 的 value+type import 收口在 `packages/api/remotes/src/client/index.ts`（`import sessionRemote from '…/remote'; export type {} from '…/remote'`），供业务 UI 只 import 一个包。

---

## 4. ctx.remote 消费面（client）

### 4.1 运行时装配

- `ctx.remote` = `ClientRemoteService`（cordis Service `remote`，`packages/api/gateway/src/client/index.ts`），依赖 `typert`（registry 的 client 面，`packages/typert/registry/src/client/index.ts` 提供 `ctx.typert`）和 `connection`（RPC carrier）。
- 追加一个 namespace = 对它的 Service `$mount` 一份 `TypertRemoteContribution`：
  - 官方集中式：`dsh-api-remotes` client `apply()` 里 `for (…贡献) await ctx.remote.$mount(contribution)`（`src/client/index.ts` L143-162），并 `inject:['remote']`。
  - 第三方自持（推荐，官方现例 `packages/experimental/client-ui-agent-team/src/client/mount.ts`）：

```ts
import agentTeamsRemote from '@deepseek-ai/dsh-experimental-agent-team/remote' // value
import type {} from '@deepseek-ai/dsh-experimental-agent-team/remote'          // types
export const inject = ['sessions', 'remote', 'slots', 'locale']
export async function apply(ctx: ClientContext) {
  const disposeRemote = await ctx.remote.$mount(agentTeamsRemote)
  … // ctx.remote.agentTeams.view(sessionId) 全类型化
  return async () => { await disposeRemote() }
}
```
- `$mount` 内部：`ctx.typert.remotes.register(contribution)` → 按 namespace 分组 → 每个 namespace 起一个插件 Service（`remote.<namespace>`，方法以 defineProperty 装上），direct/scoped 变体同时落；命名冲突/重复注册会被拒。调用时 `prepareInvocation` 用 codec（`schema.parse`）校验每个入参，`signal` 合并 mount token 与调用者 signal，走 `connection.rpc.call('/api', endpoint, {args}, signal)`。

### 4.2 事件面（$on / $dispatch）

- `ctx.remote.$on<Event>(event, listener)`（协议 `TypertClientRemote.$on`）；key 合法性由 `TypertRemoteEvent` 推导：`TypertRemoteEventSelection` 的 merge（`packages/api/remotes/src/types.ts`：`interface TypertRemoteEventSelection extends Record<ApiRemoteForwardedEvent, true>{}`；事件词表在 `remote-events.ts` 的 `API_REMOTE_FORWARDED_EVENTS`：`emit` 或 `waterfall` 模式），事件语义取自 Owner 包的 Cordis `Events` 声明（`TypertForwardableEvent` 推导，session 事件面在 `packages/api/session-controller/src/remote-events.ts`）。
- Host 侧转发：`packages/api/remotes/src/index.ts` 构造 `TypertRemoteEventSource`（buffer + AsyncGenerator），注册给网关 `registerRemoteEvents(source, hostFacts)`（`packages/api/gateway/src/index.ts`）；scoped（waterfall）事件经 `ctx.typert.contexts.identifyHost(subject)` 判定 agent 身份后下发，client 回执走 `resolve/outcome`。客户端 `$on` 的 listener 里 scoped 事件会把 `agent` 载荷投影成 client Context（协议 `TypertClientEventListener`）。
- 消费样例：`packages/api/session-controller/src/client/index.ts` L92-102 一连串 `ctx.remote.$on('api-session/added', …)` 驱动 session 列表。

### 4.3 agentCtx（session-scoped Context）与 scoped 调用

- `packages/api/session-controller/src/client/scope.ts`：`createScope(ctx, sessionId)` 铸一个带 agent tag 的 `AgentContext`（`remote: ClientRemote & TypertRemoteScopeApi<'agent'>`），tag 比较是 SessionId 值。
- Client 侧身份适配：`ctx.typert.contexts.registerClient('agent', { identity: c => sessions.scopeOf(c), resolve: id => sessions.resolveAgentScope(id) })`（client/index.ts L111）。invoke 时若该方法带 scoped 投影，先 `getClient('agent').identity(callerCtx)` 取到身份就**自动注入** wire 字段；取不到则回落 direct 变体（显式传 `agentId`）。
- host 侧默认适配由 `core/agent` 注册（`identity: c => c.agent?.id, resolve: id => agents.get(id)?.ctx`），session-controller 会再 `configureHost('agent', …)` 接管（见 §5）。

---

## 5. lookup / scope 注册与 host 侧身份解析

### 5.1 类型声明（编译期，generator 读取）

在 `@deepseek-ai/dsh-typert-protocol` 上做 interface merge（`packages/core/agent/src/types.ts`、`packages/core/session/src/index.ts`）：

```ts
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertLookupMap  { agent: TypertLookup<Agent, SessionId>; session: TypertLookup<Session, SessionId> }
  interface TypertContextMap { agent: TypertContext<SessionId> }   // session 目前无独立 Context key
}
```
generator 扫描 program 里这些 merge（`typeMetaMapMembers('TypertLookupMap'|'TypertContextMap')`）后：宿主类型参数 `agent: Agent` → `source:'lookup', lookup:'agent', wire:'agentId'`；`@RemoteScope('agent')` 需要 `TypertContextMap.agent` 存在。

### 5.2 运行时注册（host）

默认 provider 由 owner 服务注册（`packages/core/agent/src/index.ts` L262-274、`packages/core/session/src/index.ts` L862-870）：

```ts
typeCtx.typert.lookups.register('agent', {
  parameter: 'agent', wire: 'agentId',
  hostTypeSymbol: '@deepseek-ai/dsh-agent#Agent',
  wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
  resolve: sessionId => this.get(sessionId),
})
typeCtx.typert.contexts.registerHost('agent', {
  wire: 'agentId', wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
  identity: candidate => candidate.agent?.id,
  resolve: sessionId => this.get(sessionId)?.ctx,
})
```

组装级"按需解析"用 `configure` 系列覆盖默认 resolver（`packages/api/session-controller/src/agent.ts` L148-162）——wire id（sessionId）→ 本地 Agent/Session/ctx：

```ts
ctx.typert.lookups.configure('agent',   async (sessionId: SessionId) => (await this.resolveAgent(sessionId)).agent)
ctx.typert.lookups.configure('session', async (sessionId: SessionId) => (await this.resolveAgent(sessionId)).agent.session)
ctx.typert.contexts.configureHost('agent', async (sessionId: SessionId) => (await this.resolveAgent(sessionId)).agent.ctx)
```

配置语义（`packages/typert/registry/src/service.ts` + protocol）：`configure` 是"当前 fiber 有效、restore-on-dispose"，可与 provider 注册先后无关，但**同一 key 同时只能一个 configure**（重复即抛）。Client 侧对称 API：`contexts.registerClient('agent', {identity, resolve})`（resolve 只同步）。

### 5.3 Host 网关派发（wire → 本地对象）

`packages/api/gateway/src/index.ts`：`claimsEndpoint` 用 `ctx.typert.local.get(endpoint) ?? hasSeen(endpoint)`（否则 SRC 兜底反射）。`prepareInvocation`：取 descriptor → `resolveReceiverContext`（context receiver 经 `contexts.getHost(ctx).resolve(wire)` 解析到本地 Context）→ `receiver = context.get(descriptor.service)` → 逐个参数 `resolveParameter`（strict codec `schema.parse`；lookup 参数再 `lookups.get(key).resolve(id)`）→ 末尾注入 `signal` → `Reflect.apply(method, receiver, args)`。`ctx.typert.local` 由 typert-loader（或手动 `ctx.typert.register(TYPERT)`）填充，schema 注册还能 `ctx.typert.get/resolve/list/toJSONSchema`（registry host 增强面，`packages/typert/registry/src/index.ts`）。

---

## 6. 第三方包（dsh-console）接入 typert 的最小步骤清单

前提理解：dsh-console = **host 服务包**（跑在 Harness host 进程、暴露方法）+ **自己的 client 插件**（浏览器消费）。官方 alpha5 的 client 组装不是"一包双面自动通"——host 面产物是 `./typert`+`./remote`，client 拿到的是 `./remote` 的描述符 + 类型；运行时两侧各挂各的。

### A. package.json（服务包）

1. `exports` 加两段（**逐字节匹配**官方校验形状）：
   ```jsonc
   "./typert": { "types": "./lib/typert.host.d.ts",          "default": "./lib/typert.host.js" },
   "./remote": { "types": "./lib/typert.remote-client.d.ts", "default": "./lib/typert.remote-client.js" }
   ```
   再补一个类型出口，如 `"./types": { "types": "./lib/types/types.d.ts", "default": "./lib/types/types.js" }`（远程边界类型必须走公共 exports 子路径，生成的 .d.ts 会 `import type … from '<pkg>/types'`）。
2. `files` 含 `lib/typert.host.{js,d.ts}`、`lib/typert.remote-client.{js,d.ts}`（以及 `lib/types/**`）。
3. `dependencies`（不是 dev）加 `"zod": "^4.4.3"`；`peerDependencies` 加 `@deepseek-ai/dsh-typert-protocol`、`@deepseek-ai/dsh-typert-registry`、`@deepseek-ai/cordis`。
4. 若包还要出浏览器 client 半区：按官方 client 约定声明 `dsh.client`（inject/external/platform）并产出 `lib/client.js`。

### B. 源码（host 服务）

5. 建 `class ConsoleService extends TypertRemoteService`，构造里 `super(ctx, 'console', { namespace: 'consoleApi' })`（或直接用 key 当 namespace；避免与官方 `session/commands/…` 撞）。方法挂 `@Remote` / `@Remote('alias')` / `@Remote({mode:'stream'})`。
6. 参数/返回类型定义在 `src/types.ts` 并 `export type * from './types.ts'`；类型保持纯 JSON 数据（无 class/enum/function）。需要收 Agent/Session 时，参数类型用 `Agent`/`Session`（依赖已登记 lookup），wire 上 client 会传 `agentId/sessionId`。
7. 取消：尾参 `signal: AbortSignal`；业务失败 `throw new RemoteError('code', msg, details)`（要自创领域码先在 `types.ts` merge `RemoteErrorDetailsMap`）。
8. 若无现成 provider 兜你的 host 对象，在服务里 `ctx.typert.lookups.register/configure` +（若要 scoped/事件身份）`contexts.registerHost`——声明侧类型靠 `declare module '@deepseek-ai/dsh-typert-protocol'` 的 `TypertLookupMap/TypertContextMap` merge（并把该文件纳入 host 面 program）。

### C. 构建接入（产出 lib/typert.*）

9. 包纳入 workspace + 根 `tsconfig.host.json` 的 references（`tsc -b` 先出 `lib/types`）。
10. tsdown 接生成器（官方是根 workspace config 的 `typertPlugin({mode:'workspace',faces:['host']})`，前提 workspace root 有 `tsconfig.host.json` 哨兵；等价二选一）：
    - 把插件挂到自己的 tsdown config：`plugins:[typertPlugin({mode:'package',faces:['host']})]`，entry 指 `lib/types/index.js`；或
    - 写个小脚本用公开 API `new WorkspaceTypertGenerator(root).generate([pkgName], ['host'])`（`@deepseek-ai/dsh-typert-generator` 的 `.` 出口导出 `WorkspaceTypertGenerator/FaceModelEmitter` 等），把 `WorkspaceEmitResult` 的 `js/dts/remote.*` 落成 `lib/typert.*`。
    构建顺序必须 host 面（含 `./types` 声明）先于 remote-client 消费方编译。
11. 校验：exports 形状不符时 generator 会抛 `TypertAnalysisError`（带期望 JSON）——跑通即证明产物合规。

### D. Host 运行时

12. Host 进程要已装配：`@deepseek-ai/dsh-typert-registry`（提供 `ctx.typert`）、cordis Loader、`typert-loader` 插件（`inject:['typert','loader']`，需要 `ctx.baseUrl` 指向能解析你包的配置树）。包作为 loader entry（或 `Config.packages` 点名）装上后自动 import `./typert` 注册。
13. RPC/流载体：官方管线是 `dsh-api-gateway`(host) + `dsh-client-connection`(host/webServer) 提供 `/api` RPC 与 WebSocket mux；不想自研就复用它们（§4/§5 已述端点与 identity 解析）。

### E. Client 侧类型 + 运行时

14. 在 client 插件源码里：
    ```ts
    import consoleRemote from '<你的包>/remote'      // 值
    import type {} from '<你的包>/remote'            // 类型增强（一次即全局可见）
    // 可选：import type {} from '@deepseek-ai/dsh-api-remotes/client' 若要与官方 namespace 同面
    export const inject = ['remote', …]
    export async function apply(ctx) {
      const dispose = await ctx.remote.$mount(consoleRemote)
      ctx.on('dispose', dispose)
      return dispose
    }
    ```
15. 用 `ctx.remote.consoleApi.method(request, signal)`（类型来自步骤 14 的 import；或 `ClientRemote['consoleApi']` 局部别名），按 `RemoteResult<T>` 判 `ok`/`error`（`isRemoteFailure`/`RemoteError` 来自 `@deepseek-ai/dsh-typert-protocol`）。
16. 若要让 scoped 调用自动生效：client 侧注册 `ctx.typert.contexts.registerClient('<contextKey>', {identity, resolve})`（agent 场景即官方 `createScope`/`registerClient('agent')` 模式，参照 `packages/api/session-controller/src/client/`）。
17. 事件推送（可选）：host 把事件挂进你的 Host 面 `Events` + 由转发装配（官方做法 = 在 `api/remotes` 类组装包加 allowlist + `TypertRemoteEventSelection` merge + `registerRemoteEvents`），client 用 `ctx.remote.$on('…', …)`。

### F. 验证链路

- 类型面：client 文件里 `ctx.remote.consoleApi.list` hover 应有 `(…args) => Promise<RemoteResult<…>>`；参数名与 wire 字段与 `InvocationDescriptor` 一致。
- 运行时最小冒烟：参照 `packages/api/remotes/tests/built-lib.e2e.ts`——起 cordis Context → `TypertRegistry` → 你的 Service → `host.typert.register(TYPERT)`（或 typert-loader 自动）→ 网关后直接 `invoke`/`stream`。
- Generator 单测断言样例：`packages/typert/generator/tests/remote-model.spec.ts`、fixture `packages/typert/generator/tests/fixtures/remote-model/`。

---

## 附：本调研注意到、但别踩的坑

- 官方目前 **没有业务包声明 `./client/typert`**（client face 只有机制）；"client 的类型"来自 **host 面生成的 `./remote` 的 .d.ts**，别等 `typert.client.js`。
- `@RemoteScope` 产品代码为零，别照抄测试当惯例；产品级"按 agent/session 寻址"是 lookup 参数 + scope 投影 + client actx 适配器这套（§4.3/§5）。
- 客户端 unary 返回值一律是 `RemoteResult<T>` 信封，**不是裸 T**；stream 才是裸 `AsyncIterable<T>`。
- 生成的 .d.ts 里对 owner 类型的 import 走的是你包 exports 的公共子路径——所以 wire 类型必须放公共出口，不能是内部模块。
- 本仓库 `packages/typert-protocol` 是官方 rc.2 vendored 版；如需完整对齐 alpha5 管线，建议把 `protocol/registry/loader/generator` 四件套按 alpha5 版本整体对齐（协议类型面、exports 形状、zod v4 校验语义均与 rc.2 可能有差），并让 generator 能读到业务包源码。
