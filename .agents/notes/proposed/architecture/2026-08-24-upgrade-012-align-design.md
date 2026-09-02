# Agent Note: dsh-plugins 全面对齐官方 alpha.5 架构——重构设计（v1）

Status: proposed

## Problem

官方内核 0.1.1-rc.2 → 0.1.2-alpha.5 是 client 架构重构（dsh-client-runtime 移除 → everything-is-a-plugin + controller 分层）。用户决策：**全面对齐官方 alpha.5 架构层级，允许完全重构**；官方已覆盖的能力删自研，官方没有的差异化按官方 controller/client-model 模式重构。依据：4 份官方源码调研报告（docs/research/）——controller-pattern / ui-slot-assembly / typert-pipeline / identity-settings。

## 官方 alpha.5 分层（调研定论）

```
UI 层(client)       ui-*           —— dsh.client 行，注册 slots
对象层(client)       *-controller 的 ./client（React-free）—— ctx.sessions/ctx.workspaces
传输层               gateway/connection —— ctx.remote.$mount/$stream/$on
Host BFF            api-remotes    —— 事件转发 allowlist（应用级唯一）
控制器(Host)         *-controller  —— extends TypertRemoteService + @Remote（权威/流）
核心域(Host)         core/*        —— 权威实体
```

**核心模式（controller 成对）**：
- 一域一包双面：Host `class XController extends TypertRemoteService`（super(ctx,key,{namespace})）+ @Remote/@Remote('alias')/@Remote({mode:'stream'})；Client 面 React-free 可观察模型 + 窄接口注入（ctx.sessions 等）
- 权威状态在 Host；Host→Client 推送走 **Remote 流（重连安全）**，forwardable 事件仅列表级摘要
- typert generator 构建期自动产 `./typert` + `./remote` 工件（无需手写 zod）
- UI：ctx.slots.inject(key, ()=>ctx.slots.register({...}, Comp))；ctx.slots 由 ui-renderer 提供
- 官方无用户/角色层（仅匿名 UUID + 会话 cookie）；settings 每 home 单文档、非 loopback 只读

## 我们 6 插件对齐映射

### A. 差异化护城河（官方无 → 按官方模式重构）

**dsh-console → 拆 controller 包**（最大重构）
- 现状：ConsoleService extends TypertRemoteService 已有 + 混 HTTP 端点 /api/console/* + daemon/instance 角色大单体
- 对齐：拆 **api/console-controller 成对包**（参照 session-controller）
  - Host：ConsoleController extends TypertRemoteService（namespace 'console'）+ @Remote：listInstances/controlInstance/inbox 方法；实例管理逻辑拆子控制器（daemon 进程管理/实例生命周期）；**删 HTTP 端点**（client 已走 ctx.remote）；daemon control server 保留（跨实例直连载体，参照官方 connection 信封）
  - Client：React-free ConsoleClientModel（实例列表 observable）+ 窄接口 ctx.console
  - UI：ConsoleBadge（sidebar.footer.action）+ 控制面板消费 ctx.console
- 跨实例 RPC：channel.callRemote 已实现（typert 第三期）——保留，是官方无的差异化（跨主机），按官方 connection 信封对齐

**dsh-channel → controller 化**
- 现状：ChannelService extends TypertRemoteService + @Remote list/get/brokerStatus + 跨实例传输（callRemote/broker 兜底）
- 对齐：拆 controller 包（namespace 'channel'）；传输层（跨实例）是差异化保留；@Remote 面规范化；client 侧加 React-free 模型（channel 状态镜像）

**dsh-user → 保留（官方无用户层）**
- 官方 identity 仅 anonymous-user-id → 无对齐对象
- 保留差异化身份模型（ctx.user）+ gateway resolver；按官方 host 服务模式（declare module Context）对齐即可，改动小

### B. 官方有 → 迁移/复用官方

**dsh-tabs → 迁移官方会话模型**
- 现状：深用 rc.2 ctx.sessions（list.getSnapshot/open）
- 对齐：改用 alpha.5 api/session-controller 的 ctx.sessions（ClientSessions 新模型）；固定标签（Alt+P）是差异化保留（官方无"固定标签"）
- 关键：确认新 ctx.sessions API 形态（list/subscribe/open 是否保留）→ 迁移

**dsh-quick-nav → 对齐 client model 层**
- 现状：ctx.remote.channel.list 直接调
- 对齐：channel client model（React-free）→ UI adapter（hooks）→ QuickNav 消费

**dsh-desk → 对齐官方 layout/settings**
- 布局：官方 ui-layout 已有 ctx.layout（toggleSidebar 等）——布局消费方改用官方（删自研 LayoutConsumer 的折叠逻辑？待确认）
- 设置：settings.section/general.item 注册 + host settings.register 命名空间（照官方两步）——我们现有写法已近对齐，settingsNamespace import 改 api/settings-controller
- 组装器/工具显隐：差异化保留（官方无）

### C. 官方已覆盖 → 删自研/不装
- vendored dst-agent-teams / task-board：官方 experimental agent-team 有 roster/task board/nav——但 experimental 未转正，**暂不删**（记录为后续候选）
- 官方已提供的基础（会话/workspace/布局/settings UI）——我们不再自研，全用官方

## 执行顺序

1. **官方基建接入**（先立架构）：typert generator 管线（tsconfig.host/client + exports 形状 + zod dep）+ 各包 exports 规范化
2. **dsh-user**（改动小先做，验证管线）
3. **dsh-channel 拆 controller**（传输保留 + 面规范化）
4. **dsh-console 拆 controller**（最大）
5. **dsh-tabs/quick-nav/desk** client 迁移官方装配
6. typecheck 全绿 → web5 验证 → 铺开 → skill

## 风险与注意

- 事件回流 allowlist 属应用级（官方 api-remotes 唯一）——第三方自包含推送走 Remote 流
- package.json dsh.client.inject ≠ apply 排序（仅预取元数据）——注册依赖靠 ctx.slots.inject
- settings 非 loopback 只读 memory 态——多实例布局持久化需自研通道（经 console 宿主）
- client 返回值是 RemoteResult 信封（判别 ok/value/error）
- 我们 typert-protocol 是 vendored rc.2——需整体同步 alpha.5（含 registry 等）

## Web5 隔离验证进展（2026-08-24，goal round 2）

- **自研 host 插件 alpha.5 兼容已验证**：web5（~/.dsh-web5，独立 alpha.5 CLI @ 0.1.2-alpha.5，端口 3085）启动成功；dsh-console/channel/user host 面工作——console API 返回真实实例表（web3/web4 online，跨实例发现正常）。
- **隔离验证成功**：web2/3/4（rc.2 全局内核）全程未受影响（200）。
- **发现的问题**：
  1. **全家桶 vendored（@linxin666 0.2.9）不兼容 alpha.5**——其 host 面用 rc.2 dsh-settings API（installSettingsSection/settingsNamespace），alpha.5 崩。需全家桶新版本或评估。
  2. **alpha.5 client bundle 服务机制与 rc.2 不同**——rc.2 /plugins/<id>/client.js 在 alpha.5 404（页面经 boot 图 + client-modules manifest 加载）。第三方 client 插件收录方式需查（构建期打包进 dist?）。
  3. profile 需 dsh-tools alpha.5 + gateway 端口独立。
- **待续**：alpha.5 client 插件加载机制研究 → 自研 client 面验证 → controller 化重构。

## Web5 验证通过（2026-08-24 goal round 2 续）

- **自研 client bundle 在 alpha.5 全部服务正常**：dsh-user/console/quick-nav/tabs/desk bundle 200（路径 `/plugins/??<id>/client.js&rev=...` + cookie——rc.2 的 `?rev=` 改 `&rev=` + `??` 前缀）。dsh-channel 404 属预期（纯 host 无 client）。
- **bundle 内容正确**：dsh-desk 含组装器（ToolAssembler/slot-hider/data-dsh），dsh-console 含 ConsoleBadge。
- **自研 host 面 alpha.5 兼容**：console API 返回真实实例表（跨实例发现 web3/web4 online）。
- **全家桶 vendored 不兼容 alpha.5**（rc.2 API），web5 临时注释——待全家桶新版本或专项处理。
- 隔离成功：web2/3/4 全程健康。

## 全家桶 vendored 升级方案（2026-08-24 goal round 3）——4b 解决

- **根因**：全家桶 0.2.9 用 rc.2 dsh-settings API（installSettingsSection），alpha.5 崩。
- **解**：全家桶已发 **0.3.12**（`dsh.engines.dsh: >=0.1.2-alpha.4`，明确适配 alpha.5，无 rc.2 API）；better-sidebar **0.18.0-alpha.0**（peer 依赖 0.1.2-alpha.2 官方）。
- **验证**：web5 升级全家桶 0.3.12 + better-sidebar 0.18.0-alpha.0 后——全家桶 5 bundle 全 200 + 自研 + 官方共存、console API 正常、零错误日志。
- **profile 升级**：dsh.lock.json 全家桶 0.2.9 → 0.3.12（better-sidebar 0.15.2 → 0.18.0-alpha.0 待定——alpha.0 是否上正式基线需评估）。
