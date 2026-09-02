# 调研：官方 DSH 0.1.2-alpha.5 Web Client UI 装配分层（Slots / Renderer / Layout / Adapter / 插件样板）

> 调研日期：2026-08-23。源码根：`/home/long2015/Code/dsh-harness-alpha5`（官方 monorepo，`packages/client/`）。目的：为把**第三方 UI 插件工程对齐到官方架构**（注册到 sidebar / conversation / settings 插槽）提供可照抄的分层说明与样板。所有摘录均给出相对源码根的文件路径与行号，可复核。
> 结论先行：官方 UI 装配 = **一条类型轴 + 三条数据轴 + 一个渲染引擎**：类型轴是 `SlotMap`（declare module 合并，声明即渲染授权）；数据轴是 `ctx.slots`（SlotRegistry 服务）、scope adapter（ui-session 把 `ctx.sessions` 可观察模型转成每会话标准 props）、store seats（每入口每会话的引擎 store 实例）；渲染引擎是 ui-renderer（唯一一次 ctx 级 `renderSlot('root')`，其余全部在组件内经 props 的 `renderSlot` 逐层下钻）。第三方插件只做一件事：`apply(ctx)` 里 `ctx.slots.inject(<目标slot>, () => ctx.slots.register({name, kind字段..., children?, store?, inject?}, 纯组件))`。

---

## 0. 分层总览（谁是谁）

```
web boot kernel (packages/client/web/src/boot.ts)
  └─ ctx.plugin(Loader) → loader.create 每个 client entry → loader.await()（全部激活）
  └─ ctx.inject(['uiRenderer'], …) → uiRenderer.mount(container)
       └─ ui-renderer apply (src/client/index.ts)
            └─ ctx.slots = new SlotRegistry(ctx)  (Service，见 registry.ts)
            └─ slots.install(createSlotRenderer())   (React 引擎，见 scoped-slots.tsx)
            └─ mount → renderSlot('root', {})        ← 全应用唯一的 ctx 级渲染
                 └─ Root 占用者 = ui-layout AppFrame (register 进 'root')
                      ├─ renderSlot('sidebar', {collapsed,width})      single/root
                      │    └─ 占用者 ui-sidebar SidebarRoot → 声明 sidebar.workspaces /
                      │        sidebar.settings / sidebar.footer.action …
                      ├─ renderSlot('conversation', {})                single/session-maybe
                      │    └─ 占用者 ui-conversation ConversationRoot → 声明 conversation.session…
                      ├─ <SessionProvider>{renderSlot('details', {})}</SessionProvider>  single/session
                      └─ renderSlot('shell.overlay', {})               list/root（悬浮层）
```

关键架构事实（都是 README/注释原文精神）：
- **声明 = 渲染授权 = 运行时 spec**：谁在 `children:` 里声明某 slot，谁就是唯一允许渲染它的人；组件拿到的 `renderSlot` 被静态窄化到“自己声明的 children 键”。
- **插件写纯 React 组件**，只消费 props；**绝不** import ui-renderer / 自己订阅 observable——渲染器在 slot 出口处把裸 observable source 绑成 selector hooks。
- `dsh.client.inject`（package.json）只是加载/预取元数据，**不做 apply 排序**；真正的排序 = 源码里 `export const inject = [...]`（cordis fiber 服务注入）+ `ctx.slots.inject()`（等 slot 声明上账后再注册）。

---

## 1. Slots 系统（`packages/client/ui-slots/`）

纯核心，零运行时依赖（只有 React 类型）。三个文件：`src/index.ts`（全部类型 + `SlotCore` 纯注册表）、`src/store.ts`（转出 dsh-client-store 类型）、`src/renderer.ts`（React-free 的宿主/渲染器契约）。官方定位原文：“One `register(...)` call contributes a component into a declared slot and, in the same breath, declares child slots, a store seat, and the registrant's business face.”（README.md:12）

### 1.1 SlotMap 声明合并（类型轴）

```ts
// ui-slots/src/index.ts:25-36
/** Slot contract table. Owners extend via declaration merging; entries are SlotEntryDef. */
export interface SlotMap {}
export interface LocaleNamespaceMap {}   // locale 命名空间表，同样靠 declare module 合并
```

消费者在**自己包里** `declare module '@deepseek-ai/dsh-client-ui-slots' { interface SlotMap { … } }` 加行。空接口在“本编译单元”是空 → `keyof SlotMap & string` 模式保证键是字符串字面量类型。每一行是一个：

```ts
// ui-slots/src/index.ts:102-124（SlotEntryDef）
export interface SlotEntryDef {
  kind: SlotKind              // 'single' | 'list' | 'keyed' | 'chain'
  scope: SlotScope            // 'root' | 'session-maybe' | 'session'
  owner?: object              // 父级 renderSlot 调用点提供的 owner props
  keyProps?: Record<string, object>  // keyed 槽：每键的字面量 props
  hookContext?: unknown       // 每渲染实例的透传上下文（只给函数型 injected Hook）
  inject?: object             // Slot 级公共 inject 面（父声明时给，所有 entry 共享）
}
```

派生类型（同文件）：`SlotSpec`、`ChildrenDecl`、`OwnerOf`、`EntryKeyOf/KeyPropsOf`、`SlotInjectOf`、`ScopeOf`、`SlotKind`、`SlotScope`、`ChainSelect`/`ChainRenderOpts`。

### 1.2 四种 kind 语义 + 优先级遮蔽

| kind | 单元 | register 必填 kind 字段 | 渲染规则 |
|---|---|---|---|
| `single` | 槽本身 1 个 cell | `priority?`（默认 0） | 同 priority 第二人注册即 throw；不同 priority 共存，**最低 priority 胜出渲染**（遮蔽/影子） |
| `list` | 每 `id` 一个 cell | `id`（必填）、`order?`、`label?`、`priority?` | 每 cell 的最低 priority 胜者渲染；行序按 `order`；`only:` 过滤 |
| `keyed` | 每 `key` 一个 cell | `key`（必填）、`priority?` | owner 在 `renderSlot(key, props, {entryKey})` 按 key 派发 |
| `chain` | 全体 entry | `select`（必填，纯函数）、`priority?` | 按 priority 升序跑 `select(owner)`，第一个非 null 当选，结果作为组件 `matched` prop；全 null 落 owner 的 `fallback` |

遮蔽语义原文（`ui-slots/src/index.ts:749-755`）：“Shadowing (single/keyed/list): entries sharing one cell … coexist at distinct priorities, sorted ascending … the cell's lowest live entry renders.” 装载期校验（`SlotCore.register`，行 818-874）：注册进未声明槽 throw；重复声明子槽 throw（消息点名第一个声明者）；list 缺 id / keyed 缺 key / chain 缺 select throw；一个共享 store handle 挂到两种 scope throw。

崩溃处理：渲染边界崩溃时，single/keyed/list 的 entry **退位（abdicate）一次**，cell 落到下一个幸存者；chain 崩溃不退位只上报（`reportEntryError`）。

### 1.3 `StoredEntry` 与四 share props

```ts
// ui-slots/src/index.ts:588-603（StoredEntry，渲染机制的运行时读数）
export interface StoredEntry {
  component: unknown
  options: { key?; id?; order?; label?: SlotLabel; priority? }
  select?           // chain 专用
  inject?           // 业务面工厂（注册期参数由声明推导：sessionId?, actions?）
  children?         // 子槽声明表（声明+授权+运行时 spec 一体）
  store?: StoreDecl
  locale?: string
  registrant?: string
}
```

注册期**组件 props 是四个 share 的交集**，组件只引用组合类型、绝不复述：

```ts
// ui-slots/src/index.ts:473-481
export type ComposedProps<K, EntryKey, S, H, I, M = never, N = undefined> =
  PropsRuntime<K, EntryKey>        // owner props + (session/session-maybe 标准件) + 全局座
  & PropsRenderSlots<S>            // renderSlot 窄化到本 entry 声明的 children 键
  & PropsStore<H>                  // useStore + 剥掉 draft 的 actions
  & InjectFace<I>                  // 注册者自己的 inject 面（hooks 舱 → use<Name> 钩子）
  & MatchedShare<SlotMap[K], M>    // chain 当选结果 matched
  & PropsLocale<N>                 // locale 命名空间 → t
```

- `PropsRuntime`（行 214-224）：按 slot scope 条件并入 `SessionStandardProps` / `SessionMaybeStandardProps`，另加 `GlobalStandardProps`。
- `PropsRenderSlots`（行 334-361）：`renderSlot` +（children 含 chain 时）`renderSlotChain` +（children 含 `scope:'session'` 槽时）`SessionProvider` 座位。`__renders` 是幽灵逆变锚点（`component key set ⊆ children declaration` 的编译期强制）。
- 保留舱位：inject 面的 `hooks`/`keyedHooks` 是“裸 observable 源”，渲染器在出口处绑成 `use<Name>` selector hook（`PropsHooks` 行 439-442、`InjectFace` 行 456-463、`standardHookPropName` renderer.ts:42-44：`session` → `useSession`）。
- `InjectParams`（行 491-498）：inject 工厂的形参按声明推导——`scope:'session'` → `(sessionId)`（声明了 store 则 `(sessionId, actions)`）；`'session-maybe'` → `sessionId: SessionId | undefined`；`'root'` → `()` 或 `(actions)`。
- 渲染器契约在 `renderer.ts`：`SlotRendererHost`（行 127-205：subscribe/getVersion/entriesOf/entriesOfSlot/specOf/isLive/storeOf/root/scopeRevision/scope()/locale）+ `SlotRenderer`（行 208-216：`renderRoot(host, ownerProps)`）+ `StaleAuthorizationError`/`SlotOwnershipError`。**所有宿主产物只带 getSnapshot/subscribe，从不带 React hooks**——绑 hook 属于渲染机械（bind.ts）。

### 1.4 官方 slot 分层结构（从哪声明）

| slot key | kind / scope | 类型声明处（declare module） | 运行时声明处（谁的 children） |
|---|---|---|---|
| `root` | single / root | `ui-renderer/src/client/registry.ts:27-45` | **SlotCore 构造即种子**（ui-slots index.ts:729-735，built-in），⚠️ 注释明言“DO NOT register here”——换页面注册 `shell.overlay` |
| `sidebar` | single / root | `ui-layout/src/client/index.ts:52` | ui-layout `AppFrame` 的 register('root') children（index.ts:126-131） |
| `conversation` | single / session-maybe | ui-layout index.ts:65 | 同上 |
| `details` | single / session | ui-layout index.ts:75 | 同上 |
| `shell.overlay` | list / root | ui-layout index.ts:86 | 同上 |
| `sidebar.brand.mark` / `.name` | single / root | `ui-sidebar/src/client/contract/slots.ts:23/28` | ui-sidebar register('sidebar') children（client/index.ts:56-62） |
| `sidebar.workspaces` | single / root | ui-sidebar contract/slots.ts:35 | 同上（占用者 ui-workspace） |
| `sidebar.settings` | single / root | ui-sidebar contract/slots.ts:41 | 同上（占用者 ui-settings-general） |
| `sidebar.footer.action` | **list** / root | ui-sidebar contract/slots.ts:46 | 同上（**第三方最友好的 sidebar 加挂点**） |
| `conversation.session` / `.session.header` | single / session | `ui-conversation/src/client/contract/slots.ts:95/97` | ui-conversation apply.ts 各 register children（ConversationRoot/Session/Header…） |
| `conversation.view` / `conversation.composer`(chain) / `.composer.bar`(session-maybe) / `conversation.input.*` | 见各注释 | ui-conversation contract/slots.ts:117-147 | ui-conversation apply.ts |
| `conversation.hero.workspace` / `.brand.mark` / `.agentPreset` | single / root | ui-conversation contract/slots.ts:121-125 | ConversationRoot children（apply.ts:206-208） |
| `settings.trigger` / `.header` / `.action`(list) / `.close` / `.section`(list) / `.onboarding`(list) | 均 root | `ui-settings/src/client/contract/slots.ts:24-89` | ui-settings-general register('sidebar.settings') children（client/index.ts:149-156） |
| `settings.general.item` | **list** / root | ui-settings contract/slots.ts:89 | ui-settings-general GeneralSection entry 的 children（index.ts:181） |
| `settings.models.provider-card`(keyed) / `.footer`(list) | root | `ui-settings-models/src/client/slot-contract.ts` | ui-settings-models ModelsSection entry children（index.ts:137-140） |

要点：**类型声明（SlotMap 行）与运行时声明（register 的 children 表）总是成对出现，分别在“契约模块”和“占用者 apply”**；跨包只需要 `import type {} from '<owner>/client'` 即可把 owner 的 SlotMap 合并拉进当前编译单元。

### 1.5 生命周期

- register 的 disposer：移除本贡献 + **级联折叠所有声明的子槽**（子 entry 递归清理、残留 disposer 变 no-op）——README：“ledger rows, contributions, and store mounts die on one lifecycle axis”。
- `slots.inject(key, cb)`：等 key 的**声明生命周期**（declaration epoch）再跑 cb（declaration 已存在则同步跑）；声明坍缩则 dispose 并等下次声明再跑。generator cb 的事务性装载/逆序卸载见 ui-conversation apply.ts:359-364。
- ui-slots 纯核心**不碰 cordis**；事件桥（`slots/changed`）、注入、store 实例轴都属于 ui-renderer 的 SlotRegistry。

---

## 2. ui-renderer 装配（`packages/client/ui-renderer/`）

### 2.1 ctx.slots 如何提供

`ui-renderer/src/client/index.ts`：cordis merge（行 33-48）加 `Context.slots: SlotRegistry`、`Context.uiRenderer: UiRendererService` 与事件 `'slots/changed'(key)`；`apply`（行 88-97）：

```ts
export function apply(ctx: Context): void {
  const slots = new SlotRegistry(ctx)
  slots.install(createSlotRenderer())
  ctx.reflect.provide('uiRenderer', {
    mount: (container) => {
      const root = mountApp(container, buildRenderApp({ ctx }))  // → () => ctx.slots.renderSlot('root', {})
      return () => { root.unmount() }
    },
  })
}
```

### 2.2 SlotRegistry（`src/client/registry.ts`）

Service 层，职责切分原文（模块 doc 行 1-11）：“ui-slots owns registration semantics… This layer owns what needs a live application”。成员速览：

- 构造（行 133-136）：`_core.onMutate(key => ctx.emit('slots/changed', key))`。
- **`register`**：保留在 prototype（行 602-613）以让 `this.ctx` 在调用时绑定到**调用者 fiber**——自动 `ctx.effect(..., 'slots.register()')`，插件卸载即级联。实现 `_register`（436-462）：store 传 factory 时先 mint 成 per-entry handle；registrant 诊断戳；核心先写（装载校验在核心抛）。
- **`inject(key, cb)`**（172-234）：外层 `ctx.effect` 建控制器 → 订阅 `subscribeDeclaration` → `reconcile()` 读 spec+epoch，为每个声明生命周期开**嵌套 ctx.effect**（generator cb 事务化）；callback 同步失败会永久退役注入。
- `install(renderer)` / `installLocale(face)`：boot-once（二次 throw），都挂调用者 fiber。
- `provideRoot(contribution)`（275-292）：域 UI 包贡献根级标准源，原子重组 `_rootBinding`；重名 prop 直接 throw（copyUnique）。
- `installScope(scope, adapter)`（300-315）：装 scope adapter；`session-maybe` 与 `session` 解析到同一 adapter（hostFace 行 487）。
- `bindStoreScope` / `resolveStore` / `clearStoreScope`（326-335 / 527-559）：session-scoped store 实例轴——root 槽每 handle 单实例；session 槽 **每 session id 一实例**（`handle.create(key)`，引擎以 key 后缀持久键）；scope 死时清实例并 `clearPersisted()`。
- **`renderSlot(key, owner)`**（345-359）：三个 fail-loud 守卫——只允许 `'root'`、renderer 已安装、root 有注册。
- `hostFace()`（465-491）：一次性构建 `SlotRendererHost`（locale 是 live getter，HMR 换面不失效）。

### 2.3 React 引擎（`src/client/scoped-slots.tsx` + `bindings.tsx` + `bind.ts`）

`createSlotRenderer()`（939-953）：

```tsx
renderRoot(host, ownerProps) {
  return (
    <HostContext.Provider value={host}>
      <RootStandardProvider>          {/* observableHook(host.root) → RootBindingContext */}
        <ScopeProvider scope="session-maybe">   {/* adapter.current → ScopeBindingContext */}
          <RootOutlet ownerProps={ownerProps} />
        </ScopeProvider>
      </RootStandardProvider>
    </HostContext.Provider>
  )
}
```

- **`RootOutlet`**（895-931）：订阅 root 版本；无注册 → `SlotAssemblyError('… before any root registration (boot order)')`；渲染根 entry（RootEntry，640-654）。
- **`SlotOutlet`**（694-720）：每个渲染位都包 `<div data-slot={key} style={{display:'contents'}}>`（可寻址锚点 + 布局中性）；订阅该 key 版本 + locale revision；`renderOutletContent`（723-873）按 spec.kind 派发：未声明返回 null；strict-session 槽无 binding → SlotAssemblyError；single 取 `entriesOfSlot()[0]`；keyed 按 `opts.entryKey`；chain 按顺序跑 selector（抛错的 selector 视为 decline 并上报）；list 按 cell 胜者 + `order` 排序 + `only` 过滤。每个 entry 用 `SlotErrorBoundary`（key=entryKeyOf(entry)）隔离，崩溃按 kind 决定是否 abdicate（行 747-756）。
- **标准 props 合成**：`standardProps`（367-394）→ root binding 物化 + session binding 物化（session-maybe 可选物化，缺源时保持 hook 顺序稳定的 `maybeObservableHook`）；`standardKit`（425-476）→ `t`（localeSeat 按 (face, ns, revision) 缓存、locale 切换换新函数引用）、`useStore`/`actions`（storeOf）、`renderSlot`/`renderSlotChain`/`SessionProvider`（children 声明相应 scope 时）。Entry 分支：root/session/session-maybe（RootEntry/SessionEntry/SessionMaybeEntry，537-654）；**SessionMaybeEntry 的“收养（adoption）”身份**（584-628）：无会话出生的实例收养第一个到达的会话（DOM 不重挂），之后再切会话按 incarnation 重挂。
- **inject 绑定**（104-135）：`runInject` 按声明推参数（sessionId? → actions?）；`hooks`/`keyedHooks` 舱 → `use<Name>`；entry 级 inject 缓存按 entry（root）或 entry×binding（session）。
- **hook 构造只有一处**：`bind.ts:21-27` 的 `bindSnapshotSelector`（`useSyncExternalStoreWithSelector` 封装）——域代码一律给裸 source。

### 2.4 hydrate 流程

`mountApp`（index.ts:71-82）：容器里有 boot kernel 的 `[data-dsh-boot]` → `hydrateRoot` + `BootHandoff`（一帧 pass-through 保留加载 DOM 再切应用）；否则 `createRoot` + `flushSync`。boot 全流程（`packages/client/web/src/boot.ts`）：`AppWebEntry.run()` → 等 `__DSH_BOOT_READY__` → `modules = win.__ModuleLoader__.create(...)` → `runPluginBoot`（`ctx.plugin(Loader)`、逐 entry `loader.create`、**`loader.await()` 等整个 roster 落定**、`assertEntriesActive` 审计）→ `mountApp`（`ctx.inject(['uiRenderer'], scope.effect(() => scope.uiRenderer.mount(this.container)))`）。

---

## 3. ui-layout（`packages/client/ui-layout/src/client/`）

### 3.1 注册与声明

apply（index.ts:119-147）：一个 `register({name:'root', …}, AppFrame)` 同时声明四个子槽、挂 store 工厂、接服务面：

```ts
ctx.slots.register({
  name: 'root',
  locale: 'common',
  children: {
    'sidebar':        { kind: 'single', scope: 'root' },
    'conversation':   { kind: 'single', scope: 'session-maybe' },
    'details':        { kind: 'single', scope: 'session' },
    'shell.overlay':  { kind: 'list',   scope: 'root' },
  },
  store: createLayoutStore,          // 独占 factory → 框架 per-entry 实例化
  inject: (actions: PanelActions) => { layout.attachPanels(actions); return {} },
}, AppFrame)
```

SlotMap 各行注释即“seat 政策”（index.ts:36-88）：sidebar/conversation/details 是 single——**直接注册=整列替换并带走其声明的全部子 seat**；往侧栏“加东西”要注册进 ui-sidebar 的内层 seat；全应用浮层用 `shell.overlay`（list，加性）。`inject = ['slots','theme','locale']`。

### 3.2 AppFrame 渲染什么（AppFrame.tsx）

纯组件，props = `PropsRuntime<'root'> & PropsRenderSlots<四槽> & PropsStore<…> & PropsLocale<'common'>`（行 24-28），零框架 import。三列 grid（sidebar | center | details），子槽渲染（行 188-212）：

```tsx
{renderSlot('sidebar', { collapsed: sidebarCollapsed, width: cols.sidebar })}   // owner 传活参数
<CenterColumn>{renderSlot('conversation', {})}</CenterColumn>                   // session-maybe 常驻
<DetailsColumn>
  <SessionProvider>{renderSlot('details', {})}</SessionProvider>                // strict-session 门控
</DetailsColumn>
{renderSlot('shell.overlay', {})}
```

即：**strict session 子槽要包在 `SessionProvider` 里**（无会话时渲染 empty 分支、有会话按 sessionId 重挂 children）；details 关闭时列宽 0 但子树保持挂载。拖拽句柄、折叠、窄屏逻辑都在 frame（列几何存 layout store）。

### 3.3 ctx.layout（service.ts）

```ts
export interface ILayout { toggleSidebar(): void; openDetails(): void; closeDetails(): void }
```

实现 `LayoutController`：无状态，`attachPanels(actions)` 在 root entry 的 inject 里被调用一次（“ sanctioned assembly side effect ”），之后把调用转发给 layout store 的 bound actions。列宽偏好本身在 store（stores.ts `createLayoutStore`，`defineStore({init, actions})`，actions 第一参是 immer 式 draft）。**会话选择不在 layout**——属于 sessions controller；每会话活动视图在 ui-conversation 的 session store。

---

## 4. ui-adapter 模式：controller 可观察模型 → hooks / session-scoped slot sources

### 4.1 client model（controller 的可观察面）

`ctx.sessions` 是 `ISessions`（`packages/api/session-controller/src/client/contract/sessions.ts:21`）：
- `readonly list: ObservableSnapshot<SessionListState>`（含 `current` + byId 行）+ 写面 `open(id)`/`create()`/`clear()`/`refresh()`/`fork()`/`search()`；
- `binding(id): SessionBinding | undefined`（`sessions/service.ts:128`：`{ sessionId, session: SessionFace, eventSource, ctx: AgentContext }`）——**per-session 稳定绑定**，`SessionFace` 是 per-session 控制面；
- `scope(id): AgentContext | undefined`（fiber+ctx.extend scope tag，一个会话一个 scope，agent id === session id）；`scopeOf(ctx)`/`sessionOf(ctx)`。

### 4.2 ui-session：把上面转成标准 props + scope adapter（`packages/client/ui-session/src/client/index.ts`）

类型合并（104-129）：`GlobalStandardProps` += `useSessions`（`sessions.list`）、`useSessionPendingInteraction`；`SessionStandardProps` += `sessionId`（品牌化）、`useSession`、`useProjection`；`SessionMaybeStandardProps` 为可选版。这些**声明在这里为空、成员由 ui-session 运行时提供**，域 UI 包（ui-conversation 等）再往里并自己的 hook。

`UiSession extends Service`：构造时建 `adapter: SlotScopeAdapter`（246-256）——
- `current: HostObservable<StandardSourceBinding>`：跟随当前会话选择；无选择时为 `absent` 投影（所有成员名保留、值为 undefined → **hook 调用顺序稳定**）；
- `resolve(sessionId): ScopedStandardSourceBinding | undefined`：per-session 物化绑定（`{key: sessionId, ctx: binding.ctx, hooks, keyedHooks, props}`）；
- `renderArea` = `renderSessionArea`（session-provider.tsx：`binding.key === undefined ? empty() : <Fragment key={sessionId}>{children}</Fragment>`）。

物化 = 遍历 `descriptors`（`BUILTIN_SOURCE` 起，197-210：hooks `session`←binding.session、keyedHooks `projection`←projections.faceOf(key)、props `sessionId`）逐个 `resolve(binding)` 合并，重名即 throw。物化时调 `ctx.slots.bindStoreScope(value)` 把该会话的 store 实例绑定到会话 ctx 生命周期。

**域插件贡献“session-scoped standard source”**的公开 API 是 `service.provide(descriptor)`（274-295）：

```ts
ctx.uiSession.provide({
  hooks: ['conversation', 'input'],        // 静态名册
  props: ['inputActions'],
  resolve: (binding) => ({                 // 每会话绑定 → 裸源
    hooks: { conversation: conversation.snapshot, input: shell.state },
    props: { inputActions: shell.actions },
  }),
})   // ui-conversation apply.ts:180-195 的真实用法
```

于是任何 session/session-maybe 槽组件 props 里自动出现 `useConversation`/`useInput`/`inputActions`（ui-conversation 在 SessionStandardProps 里的合并，contract/slots.ts:155-171）。

apply（505-514）：`new UiSession(ctx, ctx.sessions)` + `ctx.slots.provideRoot({hooks:{sessions: sessions.list, …}})` + `ctx.slots.installScope('session', service.adapter)`。**渲染端**：bindings.tsx `ScopeProvider` 读 `host.scopeRevision` 后取 adapter、订阅 `adapter.current` 供到 Context；`bind.ts` 把 source 绑成 selector hook——`useSessions(s => …)`/`useSession(s => s.openState)` 由此而来。

### 4.3 ui-workspace（同模式第二个样本）

- `GlobalStandardProps` += `useWorkspaces`（client/index.ts:39-49）；apply 里 `ctx.slots.provideRoot({hooks:{workspaces: workspaces.list}})`（行 77）→ 全应用组件都能 `useWorkspaces(s => …)`。
- 典型 **root 槽带 inject actions** 的注册（138-156，注册进 `sidebar.workspaces`——ui-sidebar 声明的 hole），inject 工厂返回回调集 + `hooks` 裸源（含“洞是否被占”的反应式源：`flowSource(hole)` = `{getSnapshot: () => ctx.slots.entries(hole).length > 0, subscribe: …}`）。

---

## 5. 第三方 UI 插件完整样板（新插件怎么写）

### 5.1 包骨架与 package.json（对齐官方字段）

以最简官方 feature 包 `ui-schedule` 为基准：

```jsonc
// 仿 packages/client/ui-schedule/package.json
{
  "name": "@your-scope/dsh-client-ui-my-feature",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".":        { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./src/*":  "./src/*",
    "./package.json": "./package.json"
  },
  "dsh": { "client": { "inject": [ /* 本插件 UI 依赖的其他 client 包（预取/依赖元数据，非排序） */ ], "platform": "web" } },
  "scripts": { "bundle": "tsdown", "watch": "tsdown --watch" },
  "files": ["lib/index.js", "lib/client.js", "lib/types/**/*.d.ts"],
  "peerDependencies": { "@deepseek-ai/cordis": "..." }
  // 官方 monorepo 里类型依赖全放 devDependencies(workspace:^)；npm 分发时被注入目标也须进 peerDependencies
}
```

构建（每个包一个 `tsdown.config.ts`）：

```ts
import { clientBundle } from '../tsdown.client.ts'
export default clientBundle('@your-scope/dsh-client-ui-my-feature', ['lib/types/index.js'])
```

要点（tsdown.client.ts 文档注释）：client bundle 是 **closure 工厂产物**——banner/footer 调 `window.__ModuleLoader__.load({id, factory})`，经模块表解析外部（cordis DI 实体、无 globals）；CSS Modules 编译进包内并在 factory 执行时注入 `<style data-plugin-css>`。**纯度门**：`@deepseek-ai/*` 的 value import 要么是模块表行（baseline platform modules 或自己 `dsh.client.external` 请求的），要么是 inline-safe 的 wire 层；跨插件 value import 直接构建报错——跨插件协作只能走 cordis 服务 / slots。类型-only import 被擦除、不撞门。

两个面：host 面 `src/index.ts`（浏览器特性通常是 `export function apply(): void {}`），client 面 `src/client/index.ts`（真正注册）。类型合并为了让 target slot 的行可见，在 client 入口做 `import type {} from '<owner>/client'`。

### 5.2 最小完整范例（三个目标槽各一注册）

以官方 `ui-schedule`（会话 header 动作）、`ui-sidebar` 的 `sidebar.footer.action`（root list）、`ui-settings-models`（settings.section）为模板拼出的通用骨架：

```ts
// src/client/index.ts（概念样板；owner props 以目标槽声明的为准）
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'        // ctx.locale 合并
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'    // ctx.slots 合并
import type {} from '@deepseek-ai/dsh-client-ui-session/client'     // useSessions/useSession…
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'      // 'sidebar' 行（如需）
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'     // sidebar.footer.action 行（如需）
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'    // settings.section 行（如需）
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'// header.actions 行（如需）
import { MyFooterAction } from './MyFooterAction.tsx'
import { MySettingsSection } from './MySettingsSection.tsx'
import { MyHeaderAction } from './MyHeaderAction.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'my-feature': MyFeatureKey }   // 自己的字典命名空间
}

const NS = 'my-feature'

/** 服务注入 = 激活排序（fiber 级）；dsh.client.inject 不是这个 */
export const inject = ['slots', 'locale', /* 需要的服务 */]

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'my-feature: dictionaries')

  // (a) 侧栏脚部动作：root / list —— 声明者是 ui-sidebar，先等它声明
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    { name: 'sidebar.footer.action', id: 'my-action', order: 10, locale: NS },
    MyFooterAction,                       // 收 owner props { wide }
  ))

  // (b) 设置页 section：root / list —— 声明者是 ui-settings-general
  ctx.slots.inject('settings.section', () => ctx.slots.register(
    {
      name: 'settings.section',
      id: 'my-feature', order: 30, label: () => t('nav'),   // label 用 thunk 随 locale
      inject: (): MySettingsInjected => ({ hooks: { config: myObservable }, save: (v) => … }),
      children: { /* 需要就声明自己的 child slot，如 'settings.my-feature.row': {kind:'list',scope:'root'} */ },
    },
    MySettingsSection,
  ))

  // (c) 会话 header 动作：scope:'session' 的 list —— 组件 props 里直接有标准件
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    { name: 'conversation.session.header.actions', id: 'my-action', order: 20, locale: NS },
    MyHeaderAction,                       // 收 sessionId/useSession/useSessions/useConversation…
  ))
}
```

组件侧（都是纯函数，props = 组合类型；示例 a，root list，只有 owner + global + locale）：

```ts
// MyFooterAction.tsx
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

export type MyFooterActionProps =
  PropsRuntime<'sidebar.footer.action'> & PropsLocale<typeof NS>   // 实际收 { wide, useSessions, t }

export function MyFooterAction({ wide, useSessions, t }: MyFooterActionProps) {
  const count = useSessions(s => Object.keys(s.byId).length)
  return wide ? <button>{t('label', { count })}</button> : null   // rail 态只出图标
}
```

示例 c（scope:'session'）的组件与官方 ui-schedule 完全同构（ScheduleCatalogAction.tsx:104）：`({ useSession, useProjection, t }) => { useSession(s => s.openState); useProjection('schedule'); … }`。**官方纪律**：数据一律走 props 里的标准 hooks / inject hooks / 自己的 store；需要会话对象层动作时在 apply 闭包持有 ctx 服务，别在组件里碰 cordis。

### 5.3 需要“会话级对象层”时的完整范式（照 ui-message-feedback / ui-conversation）

- **per-session 控制器 + hooks 源**：apply 里 `Map<SessionId, Controller>` 惰性建（ui-message-feedback index.ts:47-55），在 `ctx.slots.inject('<session槽>', …)` 的注册 inject 工厂里 `inject: (sessionId) => ({ hooks: { feedback: controllerFor(sessionId) }, … })`——控制器实现 getSnapshot/subscribe 即成为裸源 → 组件得 `useFeedback`；teardown 时 dispose 全 map（该文件 83-87）。`conversation.chat.assistant-actions` 声明在 ui-chat。
- **贡献 session-scoped standard hooks（整个 scope 的 props 面）**：`ctx.uiSession.provide({hooks: [...], props: [...], resolve(binding)})`（ui-conversation apply.ts:180-195）+ 在 `SessionStandardProps` 里并类型。比 per-entry inject 更“全局”，适合会话级领域面（conversation、input 等）。
- **register 需在声明期后跑**：凡是目标槽由别的插件 apply 声明、又无服务依赖保证先后，一律 `ctx.slots.inject(targetKey, () => ctx.slots.register(...))`（ui-conversation 甚至用 generator 一次注入四个注册：apply.ts:359-364 `slots.inject('conversation', function* () { yield registerConversationRoot(); … })`）。反过来 ui-layout/ui-sidebar 这类“直接占位 + 声明子槽”的壳，其 apply 依赖的服务（如 layout）在声明提交后才可见，故可直连 register。

### 5.4 locale 三件套

`declare module …LocaleNamespaceMap { interface … { ns: KeyUnion } }`（类型）→ `ctx.effect(() => ctx.locale.register(NS, { zh, en }), '…: dictionaries')`（运行时）→ 注册 `locale: NS` 拿 typed `t`；list 的 `label` 建议给 thunk `() => t('…')`（随 active locale 重读，见 `resolveSlotLabel` ui-slots index.ts:612）。列表标签与 section 导航文本都走此路径；shell 从不自己订 locale 状态。

---

## 6. context / scope 模型：session-scoped slot 如何把会话上下文注入 props

一条数据流串起全部（从 render 到组件）：

1. **scope adapter 持有“当前绑定”**：ui-session `adapter.current` = 跟随 `sessions.list` 的 `HostObservable<StandardSourceBinding>`；无会话 = absent 投影（键名齐全、值为 undefined，hook 顺序稳定）。
2. **渲染根包一层 `ScopeProvider scope="session-maybe"`**（scoped-slots.tsx:945；bindings.tsx:130-143）：订阅 `host.scopeRevision` 后取 adapter、把 `adapter.current` 的当前值放进 `ScopeBindingContext`——整棵树（含 root 槽）都在“当前会话绑定”上下文里；root-scope entry 只是不消费它。
3. **strict-session 槽渲染**：`renderOutletContent` 发现 `spec.scope==='session' && scopeBinding.key===undefined` 直接 `SlotAssemblyError`（行 738-740），所以 owner 要么把它包在 `SessionProvider` 里（AppFrame 包 details；`renderSessionArea` 无会话渲染 empty、有会话按 sessionId keyed Fragment），要么自己 `sessionId === undefined ? null : renderSlot(...)` 门控（ConversationRoot.tsx:374-377）。有会话时 `StrictSessionEntry`（656-684）用 `binding.key` 作 React key → **切会话即整体重挂**（组件本地状态天然不跨会话泄漏）。
4. **标准 props 注入组件**：`standardProps`（367-394）把 root binding + scope binding 物化：每个裸 `hooks` 源名字 `session` → prop `useSession`（`observableHook` 绑定，source 级缓存，`React.memo` 不抖动）；session-maybe 用 `maybeObservableHook`（缺源返回 undefined 占位）。合并进 `standardKit` 再与 entry inject、slot inject、owner props 一起 spread 给组件（`renderEntry` 505-535：`<Comp {...kit} {...injected} {...slotInjected.props} {...ownerProps} />`，owner 最后、胜出）。
5. **inject 工厂的会话参数**：`runInject`（104-113）按声明推 `(binding.key /*=sessionId*/, actions?)`——所以 strict-session 注册的 `inject: (sessionId) => …` 里 sessionId 必然有值（类型层 `InjectParams` 也这么推导），根注册是 `()`。
6. **每会话 store 实例**：`SlotRegistry.resolveStore`（527-549）：scope 'session' 的 handle → `handle.create(sessionId)` 每 (handle×session) 一实例（引擎以 sessionId 后缀持久键）；`bindStoreScope` 把该会话实例的清理挂到会话 ctx 生命周期，scope 死时 `clearStoreScope` 清实例并清持久态（552-559）。root 槽 handle 单实例无 key。
7. **跨会话要存活的状态**：放“会话绑定源/engine store/hooks”（第 4/6 条），不放组件本地 state（SessionMaybeEntry 的收养/incarnation 规则就是为把这条做成 load-bearing）。

会话身份语义速记：`scope:'session'` = 无会话不渲染、切会话重挂、inject 收 definite sessionId；`scope:'session-maybe'` = 常驻占位、收养首个会话（undefined→first id 不重挂）、之后切会话重挂、inject 收 `SessionId | undefined`；`scope:'root'` = 与会话无关，但若组件在会话作用域树内仍可取全局 useSessions。

---

## 7. 关键文件路径索引

| 主题 | 文件 |
|---|---|
| slot 纯核心（类型 + SlotCore） | `packages/client/ui-slots/src/index.ts` |
| store 类型转出 | `packages/client/ui-slots/src/store.ts` |
| 宿主/渲染器契约（React-free） | `packages/client/ui-slots/src/renderer.ts` |
| ctx.slots 服务（SlotRegistry） | `packages/client/ui-renderer/src/client/registry.ts` |
| renderer apply / mount / hydrate | `packages/client/ui-renderer/src/client/index.ts` |
| React 引擎（outlet/标准件/session 分支） | `packages/client/ui-renderer/src/client/scoped-slots.tsx` |
| hook 绑定/上下文 Provider | `packages/client/ui-renderer/src/client/bindings.tsx` · `bind.ts` |
| 根装配（唯一 renderSlot('root')） | `packages/client/ui-renderer/src/client/app.tsx` |
| 根布局（AppFrame + ctx.layout） | `packages/client/ui-layout/src/client/{index.ts,AppFrame.tsx,service.ts,stores.ts}` |
| 会话适配器（标准件 + scope adapter） | `packages/client/ui-session/src/client/index.ts` · `session-provider.tsx` |
| 工作区适配器 + 复合注册范例 | `packages/client/ui-workspace/src/client/index.ts` · `contract/slots.ts` |
| controller client model | `packages/api/session-controller/src/client/contract/sessions.ts` · `sessions/service.ts` |
| 官方插槽树类型声明样例 | ui-layout / ui-sidebar / ui-conversation / ui-settings / ui-settings-models 各 `contract|client` 下的 SlotMap 合并 |
| 最简 feature 插件 | `packages/client/ui-schedule/src/client/{index.ts,ScheduleCatalogAction.tsx}` |
| 会话级对象层 feature | `packages/client/ui-message-feedback/src/client/index.ts` |
| 中型复合注册 | `packages/client/ui-conversation/src/client/apply.ts`（含 uiSession.provide + generator inject） |
| settings 域 | ui-settings（base: settingsScope/类型）→ ui-settings-general（shell: 占 sidebar.settings + 声明 settings.*）→ ui-settings-models（section 页样例） |
| boot/hydrate | `packages/client/web/src/boot.ts` |
| client bundle 构建（ModuleLoader closure） | `packages/client/tsdown.client.ts`（`clientBundle()`、纯度门、CSS 注入） |
