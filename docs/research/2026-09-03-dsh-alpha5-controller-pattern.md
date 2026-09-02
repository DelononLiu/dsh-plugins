# 官方 DSH 0.1.2-alpha.5 Controller 分层模式（源码调研）

> 目的：为把第三方插件工程对齐到官方架构做调研。本文档以**官方源码**（下文 `SOURCE = /home/long2015/Code/dsh-harness-alpha5`）为唯一依据，读者应能照本文的样板新建自己的 controller 包。
>
> 两个完整参照物（同构、一轻一重）：
> - `packages/api/workspace-controller`（轻：纯命令 + 一条状态流，无事件回流）
> - `packages/api/session-controller`（重：命令 + 冷读 + 事件回流 + 两条 Remote 流 + 完整 client 对象层）

---

## 0. 核心心智模型（一句话版）

> **一个业务域 = 一个 npm 包，双面发布：**
> Host 面（`src/*.ts`，跑在 agent 宿主进程）写一个 `extends TypertRemoteService` 的 Cordis Service——`@Remote` 装饰器在类上打点，构建期 typert generator 据此自动生成 `./typert`(host 清单) 与 `./remote`(client 端描述符/类型) 两个产物；
> Client 面（`src/client/**`，跑在浏览器，**React-free**）由同一个包以 `./client` 子路径导出 `apply(ctx)`：消费 `ctx.remote.<namespace>`（gateway 提供的生成 Remote），维护一组**普通对象 + `getSnapshot()/subscribe()` 可观察模型**，并对外以 Cordis 服务窄接口注入（`ctx.sessions` / `ctx.workspaces`）。
> 权威状态永远在 Host；Client 只是"列表/事件窗口/瞬时态"的镜像与乐观缓存；Host→Client 的推送**优先走 Remote 流（重连安全），事件回流（forwardable events）只用于列表级摘要通知**。

分层（官方 web 组合，`packages/bundle/web-app/cordis.patch.yml` 可见装配）：

```
UI 层(client 包)      ui-*        —— dsh.client 行，dsh.client.inject 声明依赖
对象层(client 包)      *-controller 的 ./client   —— ctx.sessions / ctx.workspaces / 各对象模型
传输层(双面/浏览器)    gateway/connection        —— ctx.remote.$stream/$on/远程命名空间
Host BFF             api-remotes                —— 转发事件 allowlist（应用级，唯一一份）
控制器(Host)          *-controller 默认导出      —— 权威命令/持久化/流（ctx.plugin 行）
核心域(Host)          core/* (session/workspace) —— 权威实体/注册表（ctx.sessions / ctx.workspaceRegistry）
```

---

## 1. api/*-controller 成对模式

### 1.1 职责划分（从源码注释与实现归纳）

| | Host 面（`src/index.ts` + 子控制器） | Client 面（`src/client/**`） |
|---|---|---|
| 权威状态 | 是。写实体注册表/会话日志（`ctx.sessions`(core)、`ctx.workspaceRegistry` 等） | 否。镜像/投影：`list` 行、事件窗口、瞬时队列/运行位/错误 |
| 持久化 | 是。`dsh-session-persistence`、`dsh-storage-domain` 等 | 仅 localStorage 持久一个选择格（`dsh.sessions.current`） |
| 流 | `@Remote({mode:'stream'})` async generator：先 yield baseline 再 yield 增量；每代独立 | gateway `RemoteSnapshotStream`/`RemoteJournalStream` 负责重连、代际、快照判定 |
| 事件 | `ctx.emit('api-session/*')` 等域事件；会话日志事件本身不入事件流，走 follow 流 | `ctx.remote.$on(...)` 只收 allowlist 事件；日志增量走 `follow` Remote 流 |
| 注入面 | 注册 `ctx.sessionController`/`ctx.workspaceController`（`declare module Context` + `super(ctx, key, {namespace})`） | 注册窄服务接口 `ctx.sessions`(ISessions)/`ctx.workspaces`(IWorkspaces)（`declare module Context` + `ctx.reflect.provide`/Cordis Service） |

### 1.2 Host 服务的 ctx 暴露方式

- Host 核心域服务是现成的：`packages/core/session/src/index.ts:36-38` `interface Context { sessions: SessionStore }`；`packages/workspace/workspace/src/index.ts:68-69` `interface Context { workspaceRegistry: WorkspaceRegistry }`。
- **controller 自己是服务**：`session-controller/src/index.ts:60-65`
  ```ts
  declare module '@deepseek-ai/cordis' {
    interface Context {
      /** Host Session business API and Remote namespace owner. */
      sessionController: SessionController
    }
  }
  ```
  `SessionController extends TypertRemoteService`（`:84`），构造器 `super(ctx, 'sessionController', { namespace: 'session' })`（`:116`）——即 Cordis Service 注册为 `ctx.sessionController`，同时 wire namespace 是 `session`。**任何其它 Host 插件 inject `'sessionController'` 即可编程调用**（`index.ts:182 resolveAgent()`、`:192 inspect()` 就是给 Host 内其它域用的非 Remote 方法）。

### 1.3 Controller 是"薄门面"，逻辑在子控制器

`session-controller/src/index.ts:102-135`：构造器把职责拆给 5 个子控制器并各自持有：

```ts
this.agents       = new ApiSessionAgentController(ctx)      // create/resume/模型选择权威（agent.ts）
this.commands     = new SessionCommandController(ctx, this.agents, process.cwd()) // 命令业务（commands.ts）
this.controlState = new SessionControlController(ctx)       // 全局控制流（control.ts）
this.history      = new SessionHistoryController(ctx, promotion) // 历史/日志流（history.ts）
this.listState    = new ApiSessionList(ctx, maxBytes)       // 冷读列表/搜索（list.ts）
ctx.plugin(SessionFileReferences); ctx.plugin(SessionSkillCatalog) // 两个附属 Remote owner 子包
```

`@Remote` 方法体通常一行委托（如 `index.ts:368-371` `page(...) { return this.history.page(request, signal) }`）。**Remote 装饰器只能打在 controller 类 public 实例方法上**（typert-protocol 校验，见 2.1）。

### 1.4 Client 服务暴露（窄接口）

Client 不暴露具体类，只暴露**窄接口**（加宽接口 = 显式加宽业务面）：
- `session-controller/src/client/index.ts:69-74`：
  ```ts
  declare module '@deepseek-ai/cordis' {
    interface Context {
      /** Client Session object layer and Agent scope owner. */
      sessions: import('./contract/sessions.ts').ISessions
    }
  }
  ```
  接口定义 `client/contract/sessions.ts:21-123` `ISessions`（`list` 可观察快照 + create/open/fork/search/scope/binding…）。文档注释明言："Widening this interface is the explicit act of widening what features may do"。
- 实现与绑定：`ClientSessions`（`sessions/service.ts:182`）`implements ISessions`，构造器末 `rootCtx.reflect.provide('sessions', this, undefined)`（`:263`）；feature 插件经 `ctx.sessions`/`this.ctx.get('sessions')` 消费（例 `ui-conversation/src/client/service.ts:340-347` `requireSessions()` 用 `ctx.get('sessions')`）。
- workspace 侧更简：`client/service.ts:32-77` `IWorkspaces`；`class WorkspaceController extends Service implements IWorkspaces`，`super(ctx, 'workspaces')`（`:88`）；`client/index.ts:30-35` merge `Context { workspaces: IWorkspaces }`。
- 会话局部作用域：对每个 session 会 mint 一个 agent-scope ctx（`ctx.sessions.scope(id)` → 子 Context），每会话的 feature 服务挂在 scope ctx 上——见 §3.3。

---

## 2. Host 面样板：@Remote、Remote 流、事件转发

### 2.1 装饰器机制（`packages/typert/protocol/src/index.ts`）

- `Remote` 有两种形态（`:176-203`）：
  ```ts
  @Remote                                  // 方法名即端点
  @Remote('openWorkspacePath')             // 显式端点名（方法名可不同）
  @Remote({ mode: 'stream' })              // AsyncIterable 方法：逐项校验/逐项投递
  ```
  均为 **standard method decorator**：通过 `context.addInitializer` 把 marker 写进类 prototype 上的版本化描述符（`REMOTE_METHOD_DESCRIPTOR`，`:249-314`），**编译期零代码生成**；运行期 `remoteMethods(service)`（`:243`）反射读取。
- 约束（`:273-275`）：public 实例方法、string 名；static/private 抛 TypeError；重复标记冲突抛错。
- 绑定基类（`:155-169`）：
  ```ts
  export abstract class TypertRemoteService<T = never> extends Service<T> {
    readonly typertRemote: TypertGatewayBinding<this>   // {service, serviceKey, namespace}
    protected constructor(ctx, serviceKey, options?: { namespace?: string }) {
      super(ctx, serviceKey); this.typertRemote = bindTypertRemote(this, this.name, options)
    }
  }
  ```
- 其它类型级协议（`packages/typert/protocol/src/types.ts`）：`RemoteResult<T>` 判别联合（`:74-76`）、`RemoteErrorDetailsMap` 代码合并（`:47-54`）、`TypertRemoteEventSelection`（`:134`）、`TypertForwardableEvent(Entry)`（`:120-131`）。

### 2.2 Host 包完整骨架（以 session-controller/src/index.ts 为模板）

```ts
export class SessionController extends TypertRemoteService {
  static inject = ['agentDefaultModel','agents','attachments','llm','sessions',
                   'sessionProjections','sessionQuery','typert','workspaceRegistry'] // :85-95
  static Config: z<Config> = z.object({ coldBlankProbeMaxBytes: ..., nativeOpen: z.boolean() })
  constructor(ctx: Context, config: Config, internals: SessionControllerInternals = {}) {
    super(ctx, 'sessionController', { namespace: 'session' })   // :116
    // ...构建子控制器；ctx.on(...)→ctx.emit 域事件；ctx.effect 收尾
  }

  @Remote('create')                        // 命名端点 → this.commands.create(request)
  create(request: SessionCreateRequest): Promise<SessionCreateValue>
  @Remote('prompt')
  prompt(request, signal: AbortSignal): Promise<SessionPromptValue> { signal.throwIfAborted(); ... }
  @Remote({ mode: 'stream' })              // 流方法：参数照常 + signal 由载体注入
  follow(request: SessionFollowRequest, signal): AsyncIterable<SessionFollowFrame>
  @Remote({ mode: 'stream' })
  control(signal): AsyncIterable<SessionControlFrame>
}
export default SessionController            // Loader 直接当插件用
```

要点：
- **request/result/value DTO 全部是 browser-safe 纯 JSON 类型**，放 `types.ts`（见 workspace-controller/src/types.ts：全是 `interface`，无函数/无运行时值；连 `RemoteErrorDetailsMap` 的类型合并也在此文件，`:29-50`）。
- 参数顺序：业务参数在前，**可选 `signal: AbortSignal` 收尾**表示"调用方可取消"（typert loader 校验 `cancellation.parameter === 'signal'`）。流方法体不 await 网络，它是 AsyncIterable。
- 业务失败抛 `RemoteError(code, message, details)`，code 必须在某处 merge 进 `RemoteErrorDetailsMap`（session-controller 自己及被依赖域包、workspace-controller/types.ts:30-49 是极好的例子）。
- 域内给其它 Host 插件的方法**不打 @Remote**（`resolveAgent`/`inspect`），公开出去才打。

### 2.3 Host 端 Remote 流：三份可抄的生成器

**模式 A：全局状态流（`control.ts:20-172`，SessionControlController）**——每个 stream generation 独立 `ControlQueue`，构造时订阅域事件 `broadcast` 到所有活跃队列：

```ts
class ControlQueue {           // 拉驱动：Deque + waiter 唤醒
  push(frame) { this.buffer.pushBack(frame); this.wake?.() }
  async *iterate(signal) { while(!done && !aborted){ frame=popFront(); if(frame) yield frame
                            else await new Promise(res=>this.wake=res) } }  // :154-171
}
async *control(signal): AsyncIterable<SessionControlFrame> {   // 控制器上 :54-65
  signal.throwIfAborted()
  const queue = new ControlQueue(); this.streams.add(queue)
  try { yield { type:'baseline', value: this.baseline() }      // 先全量
        yield* queue.iterate(signal) }                          // 再增量
  finally { this.streams.delete(queue); queue.end() }
}
```

**模式 B：per-address 日志/事件流（`history.ts:105-189`，SessionHistoryController.follow）**——yield 一帧 `snapshot`（cursor+records+hasMore+projections）后挂 `ctx.on('session/event')` 收增量、按 `expectedSeq` 断缝（丢序即 `RemoteError('gateway/internal', …skipped seq)`，`:176-182`）：

```ts
async *follow(request, signal): AsyncIterable<SessionFollowFrame> {
  ...
  using source = await this.sourceFor(address, signal, true)   // 持久化冷读
  yield { type:'snapshot', header, cursor, records: pageRecords(...), hasMore, projections }  // :150-159
  const disposeEvent = this.ctx.on('session/event', (session,event)=>{
    if (session.id !== target) return; buffered.pushBack(event); notify() }, { global:true })
  let nextOffset = SessionLogOffset(cursor+1)
  while (!follower.closed && !signal.aborted) {
    const item = buffered.popFront(); if(!item){ await new Promise(...); continue }
    if (item.seq !== expectedSeq) throw new RemoteError(...)   // 无空洞保证
    nextOffset++; yield entryFor(item)
  }
  // finally 里 dispose 事件监听/移除 closeFollowers
}
```

**模式 C：注册表增量流（`workspace-controller/src/feed.ts:47-185`，WorkspaceFeed）**——订阅 `ctx.on('domain/changed')`（storage-domain），把 put/delete/order/archived 差异换算成 upsert/remove/order/archived 帧推给所有 `WorkspaceFollower`（同 ControlQueue 拉驱动，`read()` :160-169）。

三个模式的共同纪律（值得照抄）：
1. 快照帧永远有确定判别字段（`type: 'baseline'`/`'snapshot'`）——client 用它在重连后重置；
2. 每代独立队列，finally 清理；
3. 事件订阅用 `{global:true}` 或按 address 过滤；
4. 只推 JSON 值（不能序列化的字段先投影成 DTO，如 `workspaceView()` feed.ts:23-32）。

### 2.4 Host 事件回流（forwardable events）——一条链的四处声明

host 域事件要出现在 client 的 `ctx.remote.$on` 上需要四处协作（**类型双层校验 + 应用级 allowlist**）：

1. **域包声明 Events 签名**（session-controller/src/types.ts:515-551）：
   ```ts
   declare module '@deepseek-ai/cordis' {
     interface Events {
       /** @mode emit @param summary - initial list row ... */
       'api-session/added'(summary: SessionSummary): void
       'api-session/status'(sessionId: SessionId, running: boolean): void
       ...
     }
   }
   ```
   注意 `types.ts` 同时被 host/client 两个 tsconfig 编译（§5.3），所以两端看到同一签名。`@mode emit | waterfall` 注释与 typert 推断耦合（见 types.ts:110-122 的 `TypertForwardingMode`）。
2. **域包类型级选择**（session-controller/src/remote-events.ts，整文件）：
   ```ts
   type SessionControllerRemoteEvent =
     | 'api-session/activity' | 'api-session/added' | 'api-session/error'
     | 'api-session/removed'  | 'api-session/status'
   declare module '@deepseek-ai/dsh-typert-protocol' {
     interface TypertRemoteEventSelection extends Record<SessionControllerRemoteEvent, true> {}
   }
   export {}
   ```
   编译进两端（host 端 tsconfig files 与 client include 都列它）。
3. **应用级 allowlist**（`packages/api/remotes/src/remote-events.ts:16-35`，官方 BFF 应用 `api-remotes`）——**"forward 哪些事件"只有一个家**，两边共享同一声明：
   ```ts
   export const API_REMOTE_FORWARDED_EVENTS = [
     { event: 'agent-preset/selected', mode: 'emit' },
     { event: 'approval/request', mode: 'waterfall' },
     { event: 'api-session/added', mode: 'emit' }, ...
   ] as const satisfies readonly TypertForwardableEventEntry[]
   ```
   Host 注册（`api/remotes/src/index.ts:37-42`）：`ctx.effect(() => ctx.typertGateway.registerRemoteEvents(remoteEventSource(ctx), { home: homedir() }), ...)`。`remoteEventSource`（:45-78）对每个 allowlist 事件 `ctx.on(event, (...args)=>{ queue.push({event,args: assertJsonArgs(...)}) })`——**参数必须是无损 JSON**（`assertJsonArgs` :158-165），waterfall 事件则经 `forwardWaterfall` 桥接 `next()`。
4. **client 消费**（§3.1）：`ctx.remote.$on('api-session/added', …)`。

> ⚠️ 对第三方插件的关键含义：**allowlist 属于应用装配（api-remotes 的角色），不属于 controller 包**。包只能做 (1)(2)，能否被 push 取决于所在应用的 allowlist 是否收录其事件。因此官方 push 策略 = **需要推送的完整状态一律走 Remote 流**（重连安全、自包含），**事件回流只承载列表级摘要**。

---

## 3. Client 面样板：React-free 镜像

### 3.1 入口 apply()（session-controller/src/client/index.ts:89-115，全量可抄）

```ts
export const inject = ['typert','remote','remote.commands','remote.session','remote.subagents'] // :77-83
export function apply(ctx: Context): void {
  const remotes = ctx.remote as unknown as SessionRemotes
  const sessions = new ClientSessions(ctx, remotes)          // 1. 根服务（含 list store + scope 树）
  ctx.remote.$on('api-session/added',  s => sessions.handleSessionAdded(s))      // 2. 事件回流接线
  ctx.remote.$on('api-session/removed', id => sessions.handleSessionRemoved(id))
  ctx.remote.$on('api-session/status', (id, running) => sessions.handleSessionStatus(id, running))
  ctx.remote.$on('api-session/activity', (id, updatedAt) => sessions.handleSessionActivity(id, updatedAt))
  ctx.remote.$on('api-session/error', (id, message) => sessions.handleSessionError(id, message))
  const control = createSessionControlStream(remotes, {      // 3. 全局控制流（队列/任务/投影）
    accept: frame => sessions.handleControlFrame(frame),
    failed: error => console.error('[session-controller] control stream failed:', error),
  })
  control.start()                                             // 4. 启动（重连由载体管理）
  ctx.on('connection/reset', () => sessions.handleConnected()) // 5. 连接恢复 → 全量重拉
  if (ctx.remote.$host.home !== undefined) sessions.handleConnected()
  ctx.typert.contexts.registerClient('agent', {               // 6. agent 作用域 ↔ session id 双向投影
    identity: c => sessions.scopeOf(c),
    resolve:  id => sessions.resolveAgentScope(id),
  })
  ctx.effect(() => async () => { await control.dispose() }, 'session-controller.client.control') // 7. 清理
}
```

### 3.2 传输适配（client/transport.ts）——gateway 泛型流类的域参数化

`createSessionControlStream`（transport.ts:113-132）把 Remote 流升级成"快照流"：

```ts
const stream = remote.$stream<SessionControlFrame>({
  name: 'session control stream',
  open: signal => remote.session.control(signal),          // 域：打开一"代"
  ended: accepted => accepted ? new RemoteStreamCarrierError('...ended without terminal')
                              : new Error('...ended before opening snapshot'),
})
return new RemoteSnapshotStream(stream, {                  // gateway/client/snapshot-stream.ts
  name: 'session control stream',
  isSnapshot: (frame): frame is SessionControlBaselineFrame => frame.type === 'baseline',
  replace: options.accept, update: options.accept, failed: options.failed,
})
```

日志窗口则 `class SessionEventStream extends RemoteJournalStream<SessionJournalPage, SessionHistoryRecord, number, ClientSessionPageRequest>`（transport.ts:135-213），override 三件事：
- `follow()`（:169-191）：把 `remote.session.follow()` 的 `snapshot` 帧改造成 `{type:'opened', cursor, page:{records,hasMore,projections}}`，逐条 `entry` 帧原样 yield；
- `readPage()`（:194-205）：`remote.session.page({address, throughSeq, ...request})`，`result.ok` 折叠成值；
- `repairRequest()`：重连时对请求做最小化修复（:208-212）。
泛型参数 = gateway 提供的 `RemoteJournalStream`/`RemoteSnapshotStream`（`@deepseek-ai/dsh-api-gateway/client`，见 client/journal-stream.ts、snapshot-stream.ts、remote-stream.ts）。**controller client 包不做任何 socket 层工作。**

### 3.3 对象层三件套（session 侧，最完整的样板）

依赖方向严格单向：`ClientSessions(service.ts)` → `SessionManager(manager.ts)` → `Session(session.ts)`；React 只见接口/快照，不见具体类。

**(a) ClientSessions——根服务、scope 树、list 投影**
`service.ts:182-263`：`ClientSessions implements ISessions`，私有字段：
- `selection: SnapshotStore<SessionSelection>`——localStorage 持久化（`createSnapshotStore({}, {persist:{name:'dsh.sessions.current'}})` :225-227）——是 `list.current` 的持久半边；
- `list: SnapshotStore<SessionListState>`（:234-237）——**manager 快照的投影**（manager 是 wire 真相）；`manager.subscribe(()=>this.projectList())`（:240-242）；
- `scopes: Map<SessionId, ScopeRecord>` + `watched`(stage) + `deferredRemovals`——"打开 ⟺ 上 stage（=current）"的生命周期机（见文件头注释 :1-16）；
- `followCurrent()`（:520-537）：list.current 变化 → `record.session.open()` + `refreshSubagents`；
- `materializeScope()`（:553-568）：`createScope(rootCtx, id)`（client/scope.ts，client 侧 agent ctx 镜像）→ `session.bindScope(ctx)` → `binding = {sessionId, session(只给 SessionFace), eventSource, ctx}`；
- `projectList()`（:577-647）：manager `getListSnapshot()` → 行标题派生（`displayTitleOf`）→ 面包屑地址投影 → 校验/写回持久 selection → `list.set(...)` → `pruneScopes()`；
- 命令方法薄委托给 manager：`open`→`manager.select`，`create`→`manager.create`（成功后同步 `projectList()`，保证"promise resolve 时列表里已有、binding 可寻址" :406-411），`binding(id)`/`scope(id)`/`sessionOf(ctx)` 查询面。

**(b) SessionManager——实例簇 + list 状态 + 帧派发入口**（manager.ts）
- `Map<SessionId, Session>` 惰性实例（`get()` :288-317，新建时用队列基线/运行位/blank 位回填）；
- list 态：`summaries` + `listState('idle'|'loading'|'error')` + `listPhase('pending'|'ready')` + `listMutations` 缓冲（拉取在途时的变更先缓存，返回后重放 :453-530）；
- RPC 面：`refreshList()`→`remote.session.list({})`（单飞，:456）、`search()`→`remote.session.search`（:531）、`create()`→`remote.session.create`（成功后 `recordMutation` 即时入列表，:553）、`fork()`→`remote.session.fork`（:596）；
- 帧入口：`handleControlFrame`（control 流）、`handleSessionAdded/Removed/Status/Activity/Error`（事件回流）、`handleConnected()`（重拉）；
- 微任务批量通知：私有 `Notifier`（`notifier.ts:8`，`markDirty/notifyNow/ensureFresh/subscribe` + 惰性重建快照缓存），`subscribe(listener)`/`getListSnapshot()`（:643-661）即 React uSES 挂点。
- **列表数据不进 zustand**（manager.ts:1-3 头注释："List data never enters zustand; React connects via subscribe/getListSnapshot"）；zustand 只出现在 `ClientSessions.list`/`selection` 两个 SnapshotStore 投影层（dsh-client-store 是 zustand vanilla 的薄壳）。

**(c) Session——单个会话对象**（session.ts）
- 构造（:157-169）：`projections`（ProjectionValueStore，会话投影格）、`queueMirror`（队列镜像）、`eventSource = new MutableSessionEventSource()`（`contract/events.ts:95-158`：持久不可变窗口节点 + `replace/prepend/append` 同步发布 + 惰性物化）、`notifier` + `snapshotCache`；
- 命令方法（全走 remote 并折叠成 `RemoteResult`）：`prompt`（:225-280，subagent 地址则改走 `remote.subagents.prompt`）、`readAttachment`、`updateQueue`、`cancel`、`rename`（成功后本地投影 `title` 格，:337-343）、`command`（:352，走 `remote.commands.execute`）；
- 打开窗口：`open()`→`doOpen(generation)`（:586-613）创建 `SessionEventStream` 并 `events.open({maxMessages})`；失败→`openState='error'`；代际守卫 `generation !== this.openGeneration` 丢弃过期发布；
- 增量落地 `acceptEventChange`（:616-631）：replace/prepend→窗口整体换/前插；append→`appendLive`（:652-663）再 `eventSource.append` + `queueMirror.acceptDurable(event)`；
- 本地回显（乐观提交）：`beginSubmission`（:198-215，同步进下一帧 snapshot）→ prompt 带上 `requestId` → 当 durable `user/message`(source.rpcId) 出现在日志/队列时 `scheduleObservedRetirement` 一帧后移除回显（:666-720）——UI 的"先画后实"；
- 可观察面：`subscribe`/`getSnapshot`（:459-470，snapshot 缓存；头注释 "Subscription API (useSyncExternalStore direct wiring)" :452）；
- `handleRunning/handleBlank/handleRemoved/handleAgentError` 等 `@internal` 入口只被 manager/ClientSessions 调用（:472-564 区段注释 "Manager-only entry points"）。

**snapshot 数据流纪律**（client 全仓库统一，见 dsh-client-store/src/index.ts:1-10）：
`notifySubscribers` 同步分发、`rafBatch` 可选合帧；每个可观察 = 不变快照 + 缓存（dirty 时重建）+ `subscribe/getSnapshot`；**selector hook 由 ui-renderer 合成**（store 不 import React）。controller client 包零 React 依赖。

### 3.4 对照：workspace-controller client（最小模板）

- `client/index.ts:44-57` apply：`new ClientWorkspaceModel(ctx.remote.workspace)` + `new WorkspaceController(ctx, model)`（注册 `ctx.workspaces`）+ `createWorkspaceStateStream`（:75-94，`isSnapshot: frame.type==='baseline'`，增量按 `frame.type` switch 到 sink：upsert/remove/order/archived）。
- `client/model.ts:54-…` `ClientWorkspaceModel implements WorkspaceFollowSink`：纯数组字段 + `listeners` + `snapshotCache/snapshotDirty` + 微任务 `flush()`（:315-334）；`getSnapshot/subscribe` 就是 `IWorkspaces['list']` 需要的 `WorkspaceSource`（service.ts:21-30）。命令方法与 unary Remote 一一对应并直接折叠结果（model.ts:85-96 `create → this.remote.create(input)`）。
- 它没有 `contract/` 子目录——因为只有一个可观察面（`list`），窄接口 `IWorkspaces` 与实现同文件；`ISessions` 拆 `contract/` 是因为面太多（list/search/scope/binding/subagents…）。

---

## 4. 一条完整请求的调用链（含文件/行）

SOURCE 路径行号均按 alpha5 实测。两条链都从 React 组件出发。

### 4.1 打开会话（点击侧栏 → 拉日志窗口 → 渲染）

| 步 | 位置 | 动作 |
|---|---|---|
| 1 | UI：`packages/client/ui-layout/src/client/AppFrame.tsx:100-104` | `useSessions((s)=>{...})` 读 `s.current`（selector hook 由注入的 ui-renderer 合成，模型面是 `subscribe/getSnapshot`） |
| 2 | UI 动作调 `ctx.sessions.open(id)`（如 ui-workflow-run `src/client/index.ts:33` `openSession:(id)=>{ctx.sessions.open(id)}`） | 选择态写 |
| 3 | `session-controller/src/client/sessions/service.ts:270-272` | `open(id)→manager.select(id)` |
| 4 | `manager.ts:168-185` | `select()` 校验存在、写 `selected`、`notifier.notifyNow()` |
| 5 | `service.ts:249-251` `list.subscribe(this.followCurrent)` | 投影后 stage 跟随 |
| 6 | `service.ts:520-537` `followCurrent()` | `record.session.open()` |
| 7 | `session.ts:359-368` `open()` → `doOpen(generation)` :586-613 | 建 `SessionEventStream`，`events.open({maxMessages})` |
| 8 | `transport.ts:169-191`（SessionEventStream.follow） | `remote.session.follow({address,...}, signal)` 订阅 Remote 流 |
| 9 | Host `session-controller/src/index.ts:379-382` | `@Remote({mode:'stream'}) follow → this.history.follow(request, signal)` |
| 10 | Host `history.ts:105-189` | 持久化冷读 → yield `snapshot`(cursor/records/projections)；之后 `session/event` 增量逐条 yield |
| 11 | transport 层 | `snapshot`帧→`opened` change→`replace`（window 整窗替换+projections seed） |
| 12 | `session.ts:616-642` `acceptEventChange`/`installWindow` | `baseSeq/hasMore` 更新、`projections.seed`、`eventSource.replace(entries,hasMore)`、`notifier.markDirty` |
| 13 | `contract/events.ts:123-126,151-157` | `replace()` 发布新窗口快照 `revision+1`，`notifySubscribers` 同步唤醒订阅者 |
| 14 | 订阅端 | Conversation 装配器/React 重渲染（下一帧 paint 新窗口） |

### 4.2 发送 prompt（输入回车 → Host agent 接单 → 增量回染）

| 步 | 位置 | 动作 |
|---|---|---|
| 1 | UI `ui-conversation/src/client/skeleton/InputBar.tsx:266-279,325` | Enter→`keyboard.submit(mode)`（primary 按钮同源 `inputActions.submit()` :325） |
| 2 | `ui-conversation/src/client/input/hub.ts:175-184` `sink()` | `conversation().sendSession(session, text, imageIds, mode, signal)` |
| 3 | `ui-conversation/src/client/service.ts:199-248` `sendSession()` | 快照判 subagent；先 `session.beginSubmission(...)` 注册回显（:221-234），`nextPaint` 后 `session.prompt(content, mode, signal, submission.requestId)`（:244） |
| 4 | `session-controller/src/client/sessions/session.ts:198-215` `beginSubmission` | 同步写入 `pendingSubmissions`，`notifier.markDirty()`——**点击同帧**回显可见 |
| 5 | `session.ts:225-280` `prompt()` | `remote.session.prompt({requestId, sessionId, mode, content, clientTimeZone}, signal)` |
| 6 | 传输 | gateway client 把 unary 调用发到 Host（Connection RPC） |
| 7 | Host `session-controller/src/index.ts:326-330` | `@Remote('prompt') → this.commands.prompt(request)` |
| 8 | Host `commands.ts:288-330` | `resolveAgent(sessionId)`（必要时恢复 Agent）→ `agent.steer(message)`/`agent.followup(message)` 把 user/message 投进 agent inbox（source.rpcId = 第 5 步 requestId） |
| 9 | Host agent 运行 | 产出 `user/message` 等会话日志事件 → core session 触发 `ctx.emit('session/event', session, event)` |
| 10 | Host `history.ts:123-127`（follow 的监听） | 命中 target → pushBack 增量 → yield `entryFor(item)` |
| 11 | 传输/gateway journal 流 | append 帧 → `SessionEventStream` publish `{type:'append', entry}` |
| 12 | `session.ts:652-663` `appendLive` | `queueMirror.acceptDurable(event)`；`eventSource.append(entry)`；`observeSubmissionEvent`（:666-675 读 `source.kind==='user' && rpcId`）→ `scheduleObservedRetirement` 一帧后移除本地回显 |
| 13 | 同时 Host `control.ts:98-107` | `agent/inbox/spliced` → broadcast `{type:'queue',sessionId,items}` 到控制流；client `manager.handleControlFrame`(:662) → `session.handleControlFrame`(session.ts:488-492) → `queueMirror.replace` |
| 14 | Host `index.ts:149-161` | `session/event` 另触 `ctx.emit('api-session/activity', sessionId, time)`（列表排序更新）；`agent/status`→`api-session/status`；均经 api-remotes allowlist 推给 client `ctx.remote.$on` |
| 15 | `client/index.ts:92-102` + `service.ts:378-388` | `handleSessionActivity/Status` → manager 更新 summaries → projectList → `list.set` → useSessions 订阅者重渲染 |
| 16 | 用户消息在日志出现 | snapshot：`pendingSubmissions` 清掉该条（observed）；Conversation 装配把 durable 节点渲染出来 |

小结：**写路径是 unary RPC（7/8），读路径与后续增量全部是流/事件**（10-15），client 只是把两路合流成一份不变快照。

---

## 5. package.json / 构建形态（一个 controller 包完整模板）

### 5.1 exports 与 dsh（以 workspace-controller/package.json 为最小权威模板，session-controller 多了 `./remote-events`）

```jsonc
{
  "name": "@deepseek-ai/dsh-api-workspace-controller",   // 命名域：api/<domain>-controller
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".":            { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },      // Host 插件面
    "./types":      { "types": "./lib/types/types.d.ts", "default": "./lib/types/types.js" }, // 跨面共享 DTO+Events（browser-safe）
    "./client":     { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }, // Client apply 入口
    "./typert":     { "types": "./lib/typert.host.d.ts", "default": "./lib/typert.host.js" },  // ★构建期生成
    "./remote":     { "types": "./lib/typert.remote-client.d.ts", "default": "./lib/typert.remote-client.js" }, // ★构建期生成
    "./src/*":      "./src/*",
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {                                            // 声明这是一个 browser 端插件
      "external": ["@deepseek-ai/dsh-api-gateway/client"], // 运行时由模块表提供、不打进 bundle
      "inject": ["@deepseek-ai/dsh-api-gateway", "@deepseek-ai/dsh-client-connection"], // 激活顺序依赖
      "platform": "web"
    }
  },
  "files": [ "lib/index.js", "lib/client.js", "lib/types/**/*.js", "lib/types/**/*.d.ts",
             "lib/typert.host.js", "lib/typert.host.d.ts",
             "lib/typert.remote-client.js", "lib/typert.remote-client.d.ts" ]
}
```

session-controller 版差异（同样可照抄，含事件时）：
- 多一个导出 `"./remote-events": { types: "./lib/types/remote-events.d.ts", default: "./lib/types/remote-events.js" }`（事件选择类型模块，两端编译）；
- `dsh.client.external: ["@deepseek-ai/dsh-api-gateway/client"]`；`dsh.client.inject: ["@deepseek-ai/dsh-api-gateway"]`（session 不需要 connection，事件由 gateway 转发）；
- peerDependencies 很长，分三类（见其 package.json:76-113）：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-typert-protocol`(+registry)、以及**每个被注入/被 type-only 引用的官方域包**；其中 `dsh-jobs`/`dsh-session-persistence`/`dsh-session-projection-cache` 是 `peerDependenciesMeta.optional`。devDependencies 额外放测试用域包（storage/…）。

### 5.2 host/client 双 tsconfig（Project References + 面分离）

- `tsconfig.host.json`：`files` 显式列出 Host 面源码（index/types/子控制器…），`outDir: lib/types`，references 指向 core 域/typert-protocol 等 host 面包（session-controller 版见其文件 :8-48）。
- `tsconfig.client.json`：`include: ["src/client/**/*.ts", "src/types.ts", "src/remote-events.ts"]`——**types.ts 与 remote-events.ts 被两端编译共享**，故它们必须 browser-safe。
- `tsconfig.json`：`{"references":[{"path":"./tsconfig.host.json"},{"path":"./tsconfig.client.json"}]}`。
- 根构建：`tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host` → `tsc -b tsconfig.client.json && tsdown --env.DSH_BUILD_FACE client`（根 package.json scripts build:lib:host / build:lib:client）。

### 5.3 tsdown.config.ts（每包一行）

```ts
import { clientBundle } from '../../client/tsdown.client.ts'
export default clientBundle(
  '@deepseek-ai/dsh-api-workspace-controller',  // id 印进 __ModuleLoader__.load
  ['lib/types/index.js'],                        // lib 入口（node 半区）
  { hostPhase: true },
)
```
`hostPhase:true` 语义（packages/client/tsdown.client.ts）：host 面 pass 只发 `[lib]` node 半区；client pass 只发 browser bundle（client 入口固定为 `src/client/index.ts` → `lib/client.js`）。`lib/typert.host.js`/`lib/typert.remote-client.d.ts` 由根 tsdown 内置的 **typert generator tsdown 插件**（`packages/typert/generator/src/tsdown-plugin.ts`）在 build 期扫描 `@Remote`/schema 自动产出——包本身只需声明 exports 与 files（generator README "Publishing Typert artifacts" 段落）。
`./remote` 生成物的消费方式：client 源码 `import type {} from '<own-pkg>/remote'`（transport.ts:3、model.ts:4）拉进生成的端点类型；运行时描述符由 gateway client `ctx.remote.$mount(contribution)` 装载（gateway/client/index.ts:201-…, ClientRemote 见 :102-115）。Host 侧由 `dsh-typert-loader`（typert/loader/src/index.ts:284-437）随 loader 条目自动 import `./typert` 并 `ctx.typert.register(manifest)`。

### 5.4 应用装配（抄官方 cordis.patch.yml）

- Host：一行普通插件 `- id: session-controller / name: '@deepseek-ai/dsh-api-session-controller'`（bundle/web-app/cordis.patch.yml:91-92、:100-101）——gateway 运行期扫 `ctx.reflect.props` 里每个带 `typertRemote` 绑定的 Service（gateway/src/index.ts:277-279、646-648）即自动暴露 Remote 端点，**无需逐方法注册**。
- 事件 BFF：`- id: api-remotes / name: '@deepseek-ai/dsh-api-remotes'`（:171-172）。
- Client roster：feature 包一行 `- id: ui-workspace / name: '@deepseek-ai/dsh-client-ui-workspace'`（:242）；controller 的 client 面作为其它包的 `dsh.client.inject` 目标由 loader 按模块表激活，不单列行。

---

## 6. 照抄清单：新建自己的 controller 包（对齐要点）

1. **目录** `packages/<domain>-controller/{package.json, tsconfig{,.host,.client}.json, tsdown.config.ts, src/, tests/}`。
2. **wire DTO** 全放 `src/types.ts`：纯 interface + `RemoteErrorDetailsMap` 类型合并 +（如需回流）`Events` merge。所有字段 browser-safe JSON。
3. **Host 入口 `src/index.ts`**：`class XController extends TypertRemoteService`；`static inject`（权威域服务）；`constructor(ctx, config){ super(ctx, '<key>', {namespace:'<ns>'}) }`；子控制器分工；`ctx.on(核心域事件)→ctx.emit(域推送事件)`；每个公开 RPC 打 `@Remote`/`@Remote('name')`，AsyncIterable 打 `@Remote({mode:'stream'})` 且先 baseline 后增量；失败抛 `RemoteError`；`export default XController`。
4. **流实现** 抄 control.ts/feed.ts 的 Deque+waiter 拉驱动（每代独立队列，finally 清理，事件订阅 ctx.effect 收尾）。
5. **事件回流**（仅当你需要"列表级通知"而非完整状态）：域包内建 `src/remote-events.ts` 类型选择 + `./remote-events` exports；allowlist 必须在**宿主应用**的 api-remotes 等价物里登记——第三方包本身无法保证推送，**自包含推送请用 Remote 流**。
6. **Client 面 `src/client/`**：`contract/`（窄接口 + 事件窗口类型）、模型类（`getSnapshot/subscribe` + 不变快照缓存 + 批量 notify）、transport.ts（用 gateway 的 `$stream` + `RemoteSnapshotStream`/`RemoteJournalStream` 参数化）、`index.ts` `export function apply(ctx)` + `export const inject`（wire `ctx.remote.$on`/流/`connection/reset`，`ctx.reflect.provide('<key>', this)` 或 Cordis Service 注册窄接口，`declare module Context` 类型 merge）。React-free。
7. **package.json** 按 §5.1：exports 六~七子路径、`dsh.client.{external,inject,platform}`、peer = cordis + 每个注入/类型引用官方包、files 含 4 个 typert/lib 产物。
8. **装配**：Host 行入 cordis patch（或 `ctx.plugin(...)`），client 行/dsh.client.inject 图就绪；typecheck/build/test 三绿。
9. **与 dsh-plugins 现状的对齐注意点**：
   - 官方 client 入口 = 包内 `./client` + `lib/client.js`（ModuleLoader closure）；本项目已沿用（AGENTS.md「client 构建」段）。
   - `./typert`/`./remote` 是 typert generator 构建产物：**在第三方工程里需确认构建管线（官方 preset tsdown 或本项目 esbuild 脚本）会产出并发布这两对文件**，否则 Host 反射面与 client 端点类型缺失（发布后 `.d.ts` 解析会坏——peer 规则同理）。
   - 事件 allowlist 的"应用级唯一家"语义：本项目若要在自己的发行组合里推事件，应建自己的 `api-remotes` 等价包，而不是把 allowlist 摊进各 controller。

---

## 附：关键文件速查（SOURCE 根 = /home/long2015/Code/dsh-harness-alpha5）

- 模板成品：`packages/api/workspace-controller/package.json` · `src/index.ts` · `src/types.ts` · `src/feed.ts` · `src/commands.ts` · `src/client/{index,model,service}.ts`
- 重样板：`packages/api/session-controller/src/index.ts` · `types.ts` · `remote-events.ts` · `control.ts` · `history.ts` · `src/client/{index,transport}.ts` · `client/contract/{sessions,session,events,snapshot}.ts` · `client/sessions/{service,manager,session,remotes,notifier,projection-store}.ts`
- 协议/机制：`packages/typert/protocol/src/{index,types,remote-error}.ts` · `packages/typert/loader/src/index.ts` · `packages/typert/generator/README.md`
- 传输：`packages/api/gateway/src/index.ts` · `src/client/index.ts` · `client/{remote-stream,snapshot-stream,journal-stream}.ts`
- 装配与事件 BFF：`packages/bundle/web-app/cordis.patch.yml` · `packages/api/remotes/src/{index,remote-events}.ts`
- client store / hook 边界：`packages/client/store/src/index.ts`（zustand vanilla 壳 + notifySubscribers + rafBatch）
