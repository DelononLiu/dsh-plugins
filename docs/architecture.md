# dsh 团队发行包 · 架构设计

> 状态：已收敛（2026-08，讨论确认）
> 定位：DSH（DeepSeek Harness）是内核，本仓库产出**面向团队的发行包**——内核 + 自研核心插件 + 社区聚合插件 + 版本锁，一条命令/一次 clone 得到可用团队环境。

---

## 1. 分层架构（内核 → 系统 → 管理组件 → UI → 业务 app）

依赖方向严格向下：每层只消费下层能力，不跨层。

```
┌─ 业务 app（vendored 功能应用）───────────────────────┐
│  dst-agent-teams（多 Agent 协作编排，第一个成员）      │
│  全家桶功能应用（task-board/ssh/git-graph…，按需组合） │
├─ UI（可替换）────────────────────────────────────────┤
│   dsh-desk：UI 平台（布局/插件组合自定义；            │
│   不做换肤——皮肤否决；meta-package；"我的"=personal）  │
│   dsh-quick-nav · dsh-tabs · 各界面（console UI 并入   │
│   dsh-console client 半区）· 消费管理组件与系统数据，   │
│   不定义模型                                          │
├─ 管理组件（自研核心）─────────────────────────────────┤
│   dsh-console：主机/实例档案 · 生命周期 · 部署编排 ·    │
│   inbox/投递（v1 承载，未来可独立为业务 app）· 总览     │
│   控制面：决策与编排，执行在远程 agent                  │
├─ 系统 ────────────────────────────────────────────────┤
│   dsh-user（身份模型：用户/归属/授权基础，自研）          │
│   dsh-channel（通信：发现/心跳 · 事件总线 · 鉴权 ·       │
│   typert 远程调用 · 控制指令=远程管理，自研）            │
│   认证网关（社区 vendored：登录/会话/鉴权执行）          │
│   LLM 记忆（社区 vendored：dsh-memento——ctx.memory     │
│   seam + SQLite + 门控注入）                            │
│   基础设施能力，无业务含义                             │
├─ 内核（官方 rc 锁定）─────────────────────────────────┤
│   deepseek-harness + 官方内置（dsh-base / dsh-web-app） │
└───────────────────────────────────────────────────────┘
```

### 分层判据

- **系统**：基础设施能力（身份、通信），被上层消费，自身无业务含义。
- **管理组件**：面向"系统/资源运维"的能力（主机、实例、部署、健康）——IT 管理面。
- **UI**：界面层（布局、组件组合、导航、标签），消费管理组件与系统数据。
- **业务 app**：承载独立业务逻辑/服务（编排、状态机、调度、持久化）的应用——**首个成员：dst-agent-teams（vendored 协作应用）；全家桶功能应用（task-board/ssh/git-graph 等）随 vendored dsh-web-ui 拆分归入**；**跨层依赖严格向下，UI 层内部允许聚合依赖**（meta 包，如 dsh-desk）。

### 插件协作模式（服务定义 / 提供者 / 消费者）

插件间协作采用 DSH 生态标准模式（官方 capability seam），**不引入独立"契约"概念**：

- **dsh-channel = 实例服务提供者**：定义实例类型（id/name/addr/status/health）+ 暴露发现/心跳/状态服务（@Remote，host 面）——实例是通信层发现的对象，放 channel 名正言顺。
- **dsh-console = 实例管理服务提供者**：定义管理档案类型（在 channel 的实例类型上扩展 owner/type/host/version）+ 暴露生命周期/部署服务。
- **dsh-quick-nav = 消费者**：`import type` 引用提供者的类型（编译期，运行时零依赖）+ 经 Typert `ctx.remote` 调用服务（client 面）；dsh-quick-nav → channel（导航只需实例身份/状态，依赖降到系统层）；**console-ui 已并入 dsh-console 包**（client 半区），其管理界面消费同一 console 服务面。
- 依赖方向向下；"一套概念模型"由提供者唯一定义类型保证。

### UI 布局（2026-08 定）

发行包 UI 利用**三个区域**（topbar/tabs/sidebar；官方无独立 actions 区），**功能优先（不采用皮肤中心，不做换肤）**：

```
┌─ 顶部区域 ─────────────────────────────┐
│  dsh-quick-nav：实例导航（跳转/在线状态）+ 全局操作入口 │
├──────────┬─────────────────────────────┤
│ 侧边栏    │  tab 区                     │
│ 工作区/   │  dsh-tabs：固定会话标签       │
│ 会话树    │  Alt+1..9 跨工作区切换       │
│          │                             │
│ 底部      │  （内容区）                  │
│ 工具入口  │                             │
│ console 入口│                            │
│ 设置      │                             │
│ 用户徽标  │                             │
├──────────┴─────────────────────────────┤
```

| 区域 | 职责 | 插件 |
| --- | --- | --- |
| 顶部区域 | 全局导航与状态（实例跳转/在线）、全局操作入口 | dsh-quick-nav + 快捷操作 |
| tab 区 | 会话级切换（固定标签 + Alt+1..9 跨工作区） | dsh-tabs |
| 侧边栏 | 工作区/会话树管理 | 官方原生 + better-sidebar 增强（社区） |
| 侧边栏底部 | 功能区快捷入口（工具/控制台/设置），**工具入口经 dsh-desk 组装器摆到控制台上方** | 全家桶工具入口（task-board/ssh/skill-explorer）+ console 入口 + 设置 |
| 侧边栏底部·用户徽标 | 当前用户（人形图标 + 用户名 + 角色 + 经网关时登出），**设置下方**，只消费身份模型 | dsh-user client 半区（/api/user/me） |

**皮肤中心（dsh-web-ui 的 skin-center v2）不引入**：用户明确"不喜欢换皮肤，功能优先"；dsh-desk 自定义维度收敛为**布局 + 插件组合**（vendored 全家桶时可不装 skin-center 包）。

**布局自定义机制**（2026-08 定，v1 从简）：插件组合走 cordis.patch.yml（DSH 原生）；布局调整（显隐/顺序/宽度）走 dsh-desk 的 Config 字段（cordis.yml 可配）+ 设置页开关（参考顶栏治理模式）；**布局配置按实例存**（每实例一套）——"每用户布局"（跨实例一致）留 v2（需用户级配置存储）。

**工具入口组装器**（2026-08 实现，dsh-desk client）：全家桶工具（task-board/ssh/skill-explorer）不走官方 sidebar 插槽，而是各自 MutationObserver + 直接 DOM 注入侧边栏 entry（落点 logoRow 后、工作区上）。dsh-desk 组装器接管摆位：re-parent 到 foot 区（控制台上方）+ 样式对齐官方 `.trigger` 契约 + 间距统一。开放边界见 §9 与 [sidebar-slot-assembly-boundary](../.agents/notes/proposed/architecture/2026-08-23-sidebar-slot-assembly-boundary.md)。

### 设计原则

- **整体性**：一套概念模型（身份/主机/实例）贯穿所有层，不允许逐插件私有模型。
- **控制面/执行面分离**：console 只编排决策，远程 agent 本地执行，SSH 仅用于一次性引导。
- **UI 可替换**：UI 层纯消费层，社区插件随时可换，不进入核心契约。dsh-desk 是 meta-package 定位（类比 ubuntu-desktop：装一个 = 装齐业务插件集），非组件库、非脚手架。
- **自定义化为核心**：开箱即用是默认值，可自定义是核心能力，贯穿两层——实例（personal 类型可扩展）、UI（dsh-desk 布局/插件组合自定义；**不做换肤，皮肤否决**）、发行包（profile 模板 + cordis.patch.yml 覆盖层）。
- **命名空间**：`dsh-*` = 自研家族；`dst-*` = vendored 第三方（明确标记，非家族）。

---

## 2. 核心概念模型

### 用户（身份，系统层）

- 多用户：同一部署可承载多个用户身份。
- 身份是所有层的根：实例归属、通道鉴权、投递目标、部署授权都基于它。
- **用户模型机制**（2026-08 定）：`ctx.user.current()` → `User { id, name, roles }`；身份来源**可插拔**（`IdentityResolver` 接口——网关签发、dsh-user 验签，JWT 标准化方向，可替换 APISIX 类网关）：
  - 网关注入：dsh-gateway 认证后注入身份头（`X-DSH-User-Id` / `X-DSH-User-Roles`），dsh-user 解析；
  - 网关 cookie 验签：clarknu/dsh-gateway 私有 cookie（`dsh_gw_sid`，HMAC-SHA256 + secretFile 读 gateway state.json，**不改 vendor**）；仅接受经可信网关（`x-forwarded-proto: https`）的请求（防重放/CSRF）；
  - 静态配置：cordis.patch.yml 配置用户列表（id/name/roles）。
  - **用户显示**：client 半区侧边栏左下角徽标（人形图标 + 用户名 + 角色 + 经网关时登出按钮，跳 gateway /logout），只消费身份模型、网关可替换。
- **角色三档**（v1）：`admin`（全权）/ `member`（自有实例全权 + shared 按授权）/ `guest`（被授权实例只读）。
- **归属**：实例档案 owner = userId；shared 实例授权记录（owner 授权其他用户可访问/只读）在实例档案。
- **shared 跨实例访问路径**（2026-08 定，SSH 公钥式）：每个实例持有身份密钥对（私钥留本地，v1 每实例一对）；owner 在目标实例配置授权用户/实例的**公钥列表**（authorized_keys 式）；访问者用私钥签名请求 → 目标实例验证公钥 + 授权列表 → 放行（只读/可访问按授权）。不做证书链/CA（v2 再考虑用户级密钥与信任体系）。
- **授权落点**：dsh-user 提供 `instanceAccess(instanceId)` 授权查询，console 执行控制指令时校验（操作分级：查看 member+ / 控制 owner·admin / 部署·主机管理 admin）。

### 主机（部署单元，管理组件档案）

- 物理/远程机器；局域网内（小团队场景）。
- 属性：地址、在线状态（聚合自其下实例心跳）、已部署的发行包版本。
- 一台主机可跑**多个实例**（不限定）。

### 实例（运行单元，管理组件档案）

- **一个实例 = 主机上一个 profile 进程**（本地或远程）。
- 所有实例都是 **personal**（归属某个用户）；**没有 team 实例**。
- 可创建**特殊 personal 实例**，类型为可扩展枚举：
  - `normal`：个人调试/测试，仅本人可见可管
  - `shared`：owner 授权后其他用户可访问（团队协作载体）
  - `host`：承载 console 服务 / 常驻 agent 的实例
  - 后续可扩展：`ci`、`sandbox` 等
- 档案字段：id / name / owner / type / host / addr / status / health / 版本。

### inbox（系统事件消息，v1 于管理组件）

- **实例级**：每实例一份 inbox（console 持久化，按 owner 隔离）；跨实例事件经 channel 同步。
- **聚焦系统级消息**：升级完成 / 任务结果 / 健康异常 / 部署事件——非用户聊天（user 类投递 v2/业务 app 再做）。
- 消息结构：`{id, sender, owner, type, title, body, ts, read}`；投递复用事件总线语义（at-least-once + 幂等）。
- **与 channel 关系**：跨实例事件经 channel 的 **task 平面**（幂等投递）进入本实例 inbox。
- UI：console-ui 消息区（未读角标 + 列表）。

### 最小 agent（远程主机代理）

- 形态：**发行包的 headless host 实例**（无 web UI 的最小组件集），即远程主机的常驻代表。
- 职责：接收 console 指令（部署/创建/启停/升级），本地执行，回传状态；凭据不出主机。
- **通道鉴权**（2026-08 定）：agent↔console 用**实例令牌**（bootstrap 时生成注入 agent，32 hex 随机）——agent 注册/心跳/指令请求携带，console 校验 + 操作级鉴权（角色/授权）；**实例令牌与用户会话分离**（机↔机 vs 人↔机，参考 dsh-relay 双凭证）；浏览器端走 dsh-gateway 会话（cookie 路径，WS/EventSource 无法带 Authorization 头的解法）。
- agent 即 DSH 实例：随时可升级为完整实例直接进去调试，扩展能力不加新协议。

---

## 3. 部署链路（已确认：混合方案）

```
SSH（仅一次性引导）──► 装最小 agent ──► 之后全走 agent/channel
```

### 引导（bootstrap，一次性）

1. console 通过 SSH 在远程主机跑一条引导脚本（局域网内零成本）。
2. 引导内容：部署发行包最小集（agent 组件集）→ 起 headless host 实例（agent）。
3. agent 上线，向 console **主动注册**主机档案 + 实例档案（**不做局域网自动发现**，地址由主机登记时配置/注册获得）。

### 日常管理（control，全走 channel）

- console → agent：`deploy` / `create-instance` / `stop` / `start` / `upgrade` 等结构化指令（typert RPC）。
- agent 本地执行（克隆模板 → 新 profile → 起进程 → 注册档案），回传结构化回执。
- 心跳经 channel 上报；主机在线状态 = 其下实例心跳聚合。
- 升级 = 推新版本发行包 → 逐实例滚动重启 → 心跳恢复确认。
- **patch 层升级适配**（2026-08 定，半自动）：升级前校验 patch 层的 target id 是否在新 rc 存在——**校验失败默认回滚**（安全），管理员**显式确认后可跳过失效 patch 继续**（升级 + 报告待适配项）。**回滚保留 3 份**（默认，可配）。

### 传输与调用分层（2026-08 定：typert 在 channel 之上，broker 为 channel 可选后端）

```
浏览器 UI（console 面板 / quick-nav）
    │  ctx.remote 调用（@Remote / @RemoteScope 业务方法）
    ▼
typert（服务调用层：类型契约 / InvokeRemoteRequest 帧 / Zod 校验）──依赖──►
    ▼
dsh-channel（传输底座：实例发现/心跳/事件总线/实例令牌鉴权/帧路由）
    │  物理承载（可插拔 transport）
    ├── transport: 直连（同进程 / HTTP-WS 直连远程实例）
    └── transport: broker（出站代理，daemon 安全模型）
```

- **依赖方向**：`typert → dsh-channel`（上层调用下层）——**typert 的调用帧由 channel 传输**；channel 是 typert 的传输底座，broker 是 channel 的可选物理后端（**保留 broker 扩展能力**：daemon 只出站连 broker、不开放入站端口的安全模型不变；单机/可直连场景用直连 transport，broker 可不装）。
- **职责边界**：typert 只做方法级调用契约（不实现传输）；channel 做寻址（实例表 id/addr/status）、鉴权（实例令牌）、事件（三平面承载 typert `$on` 事件面）；broker 只做物理投递（HMAC 签名 wire 协议，参考 dsh-agent-relay 蓝本）。
- **对齐官方**：官方为 `typert（协议）→ Connection 层（ctx.connection.rpc.intercept('/api')，HTTP/WS 传输）`；我们把官方 Connection 的职责放到 dsh-channel（既有通信层），不发明新分层。
- **待实现**：channel 提供 typert transport 契约（`rpc.send(frame, target)` / `intercept(endpoint, handler)`，对齐官方 `connection.rpc.intercept` 签名）；transport 选择策略（目标可达→直连，不可达/daemon→broker）；跨实例调用鉴权复用实例令牌；typert forwardable events ↔ channel 三平面映射。当前跨实例仍走 relay+HTTP 端点（/api/console/* + EventSource），见 §9。

### 部署状态机

```
主机登记 → SSH 引导装 agent → agent 上线注册 → 按需创建实例
        → 升级（版本矩阵整体推进） → 下线/移除
```

### console 单点（已接受）

- console 自身跑在一个 host 实例上；v1 接受单控制面，不做接管机制（设计上留扩展余量）。

---

## 4. 版本矩阵（发行包的版本锁）

发行包 = 内核 rc.x + 自研插件 x.y + 社区插件 a.b 的**锁定组合**。

- 建立 release 表：每个 rc 对应一套自研插件版本 + 一套社区插件锁定版本。
- 升级路径：跟随 DSH rc 整体 bump，不散装升级。
- 部署/升级 = 版本矩阵整体推进，console 协调所有主机/实例。
- 分发形态（已确认）：**完整 profile 模板**（git clone 现成 profile 目录直接用），模板即实例种子。
- 落地形式：`profiles/web/dsh.lock.json`（版本锁 schema 已定稿：schemaVersion/id/name/version/kernel/bundles/vendored，见 §9）。边界语义：`kernel` = CLI 入口（@deepseek-ai/dsh）版本；`bundles` = profile 组件（含官方内置 base/web-app 与自研插件）；`vendored` = 社区插件锁定。

### Profile 矩阵（三个模板）

| profile | 用途 | bundles 内容 |
| --- | --- | --- |
| **web** | 开发 + 正式 | 官方基线 + 全部自研（user/channel/console/nav/tabs/my-ui）+ vendored 全家桶（TBD） |
| **web2** | 单插件测试（隔离） | 官方基线（无自研）——测试时 `dsh plugin --profile web2 add <被测>` 临时装入 |
| **web3** | 多插件测试（集成） | 官方基线 + 核心组合（user/channel/console + nav/tabs）——测试时临时增删 |

原则：**web 是正式基线（~/.dsh），测试环境用独立 DSH_HOME 目录隔离**（非共享 home 的 profile 隔离，sessions/settings/storages 完全独立）；自研插件经 cordis.patch.yml insert（不进 bundles）；webserver 端口独立配置（避开正式 3080）。版本矩阵锁（dsh.lock.json）各自维护。

**测试环境固定矩阵**（2026-08 定，不靠猜——脚本 `scripts/dev-test-env.sh` 一键启停/status）：

| 环境 | DSH_HOME | profile | 端口 | 角色 |
| --- | --- | --- | --- | --- |
| web2 | `~/.dsh-web2` | web | 3082 | 管理端 console（全家桶 + 组装器验证） |
| web3 | `~/.dsh-web3` | web | 3083 | instance（`DSH_RELAY_AGENT=web3`） |
| web4 | `~/.dsh-web4` | web | 3084 | instance（`DSH_RELAY_AGENT=web4`） |
| daemon | `~/.dsh-daemon` | daemon | 无 web（headless） | 守护 host1（broker `http://127.0.0.1:19121` 出站连） |

实例矩阵权威源 = 管理端 web2 的 `dsh-console.launch` 配置；quick-nav/console 从 `DSH_CONSOLE_ADDR=http://127.0.0.1:3082` 拉实例表。

---

## 5. 分层 × 插件矩阵

**原则**：系统层（身份/通信）全自研（护城河，社区仅作设计参考）；管理组件自研主体 + 通用能力采用社区；UI/业务 app 以社区为主（vendored），自研只做差异化插件（nav/tabs/my-ui 平台）。

### 自研插件（packages/）

| 插件 | 层 | 职责 | 状态 |
| --- | --- | --- | --- |
| dsh-user | 系统·身份 | 身份模型（用户/归属/授权基础）；**身份来源可插拔（IdentityResolver 接口）**；client 半区侧边栏用户徽标（/api/user/me） | ✅ 已实现（29 测试；gateway cookie 验签 + 侧边栏徽标/登出，见 §9） |
| dsh-channel | 系统·通信 | 发现/心跳、事件总线（at-least-once/幂等/TTL/三平面）、鉴权、控制指令；**实例服务提供者**（实例类型 + 发现/状态服务） | ✅ 已实现（29 测试；Typert 远程化未接入——跨实例走 relay+HTTP，见 §9） |
| dsh-console | 管理组件 | **纯服务端**：主机/实例档案、生命周期、部署编排、inbox/投递、总览数据；**实例管理服务提供者**（扩展类型 + 生命周期/部署服务） | ✅ 已实现（37 测试 + 3 HTTP 端点 instances/control/broker；daemon/instance 三角色；升级回滚挂起，见 §9） |
| dsh-console-ui | UI（并入 dsh-console） | 总览/管理界面——**client 半区并入 dsh-console 包**（ConsoleBadge + 实例控制面板，sidebar.footer.action 入口，仅管理端显示） | ✅ 已并入（非独立包） |
| dsh-quick-nav | UI | 顶栏实例快捷导航（跳转/在线状态），实例档案读端 | ✅ 已上线三端（2 测试） |
| dsh-tabs | UI | 固定会话标签页（Alt+P 固定/取消、× 关闭、编号标题） | ✅ 已实现（2 测试，web2 验证） |
| dsh-desk | UI（平台） | 布局/插件组合自定义平台（不包含皮肤——皮肤中心已否决），meta-package，"我的"=personal 哲学；**工具入口组装器（2026-08：全家桶 entry 摆位到控制台上方 + 样式对齐官方契约）** | ✅ 组装器已实现（10 测试）；布局配置开关已实现，见 §9 |

> dsh-quick-nav 已上线三端，说明实例模型已有雏形——后续按插件协作模式（channel 提供实例服务，nav 作消费者转纯读端）。

### 社区直接采用（vendored，相似度极高不重复造）

| 插件 | 层 | 用途 | 说明 |
| --- | --- | --- | --- |
| dsh-web-ui 全家桶（@linxin666 scope） | UI + 业务 app | UI 能力（better-sidebar 侧边栏 / 布局；**不含 skin-center，皮肤否决**）+ 功能应用（task-board 任务看板 / git-graph / ssh / skill-explorer；**v1 引入 5 包**） | Apache-2.0（4 子包 BSD-3-Clause；Maid Atelier 皮肤 CC BY-NC-SA 商用需剔除——不装皮肤则无关） |
| better-sidebar（omdsh-dev） | UI | 侧边栏框架（文件/编辑器/终端/Git 面板），registerTab/registerFileViewer 扩展点 | MIT；全家桶已集成，也可独立引入 |
| dst-agent-teams（@nanmicoder） | 业务 app | 多 Agent 协作编排（船长+成员+任务 DAG+直接消息） | vendored 自 NanmiCoder，MIT；**业务 app 层第一个成员**；npm 安装 + lock 锁版本（v0.1.12） |
| dsh-gateway（clarknu） | 系统·认证网关 | 登录/认证（scrypt、fail-closed、限速、吊销、多站点） | ✅ 已选定 + web2 接入（3443 登录/登出；dsh-user 验签其 cookie 会话）；强制 HTTPS——HTTP 直连走 web2 3082（静态兜底，无登录） |
| dsh-memento（PerryLink） | 系统·LLM 记忆 | ctx.memory seam + 本地 SQLite + memory 工具 + 门控/审计注入 | ✅ 已选定（2026-08，npm v0.4.4 活跃）；纯本地；npm 安装 + lock 锁版本；**消费方 = agent 会话/上层插件经 ctx.memory 运行时使用（非 type-only 协作）**；官方无 memory，社区填补 |
| dsh-prometheus | 管理组件 | 有界指标 + Grafana 总览数据面 | 挂起（console 总览复用，见 §9） |

> **已移除/已实现**：dsh-topbar-manager（顶栏治理）删除——nav/tabs 直接注入顶栏，不设统一注册表；dsh-update-checker（升级/备份/回滚）删除——作为 dsh-console 遗留项（console 生命周期未来补）；dsh-agent-relay（HMAC 事件总线骨架）submodule 移除——仅作 channel 设计蓝本，事件总线已由 channel 自研实现；dsh-daemon 已实现——**融入 dsh-console 的 daemon 角色**（守护进程：本机实例 spawn/kill/追踪/重启三分支/busy 锁，控制面在 console）。

### 设计参考（不引入，只借鉴）

| 插件 | 层 | 借鉴点 |
| --- | --- | --- |
| dsh-weave（Iroh P2P） | 系统·通信 | channel 发现/心跳/事件投递的设计蓝本（stage=design-preview） |
| SunNull/dsh-relay（Wire-Trunk） | 系统·通信 | 主动拨出 + 认证补在入口 + 实例/用户凭证分离 |
| deepseek-harness-remote | 系统·通信 | typert 远程调用面收缩（ApiProxy-only）+ 版本协商 |
| dsh-remote-link | 系统·通信 | QR+HMAC 配对、cookie 会话（WS 无法带 Authorization 的解法） |
| dsh-agent-message | 系统·通信 | 控制指令投递模式/回执状态机/离线恢复 |
| dsh-passwords / dsh-local-hanaccount | 系统·身份 | 多租户（v1 不做）、静态配置 workspace scoping |
| dsh-remote-tunnel | 管理组件 | 主机档案 + 生命周期 + 审计 CLI 结构 |
| dsh-plugin-doctor | 管理组件 | 发行包质量门禁（版本锁校验 + 冒烟） |
| dsh-better-session-title / dsh-hotkeys | UI | nav+tabs 功能对照 / 快捷键实现层 |
| dsh-skin-switcher | UI | 双皮肤引擎协调（启动迁移） |

### 排除边界（避免误引）

- dsh-AuthInOne / dsh-oauth：LLM provider 登录域，非用户身份
- ZinkLu/dsh-channel / 各 IM 渠道插件：消息渠道，非跨实例通信
- HuanLinOTO/dsh-plugin-ya-workspace-sidebar：**AGPL-3.0**，不可 vendored（license 红线）

---

## 6. 社区参考（已核实）

> 完整分层调研见 **[docs/community-reference.md](community-reference.md)**（按新架构六条线扫描，含每层可借鉴点与 License 红线）。核心结论：
> - **身份（dsh-user）**：dsh-passwords（多租户主/子用户+配额）、dsh-local-hanaccount（静态配置模式）、dsh-webui-auth / dsh-gateway（网关注入模式）——双模式均有社区对标
> - **通信（dsh-channel）**：dsh-weave（Iroh P2P 发现/心跳，设计蓝本）、dsh-remote-link（QR+HMAC 配对鉴权）、dsh-agent-relay（事件总线骨架）、SunNull/dsh-relay（Wire-Trunk 传输底座）
> - **管理（dsh-console）**：dsh-remote-tunnel（部署编排）、dsh-update-checker（升级回滚蓝本）、dsh-forge mailbridge（inbox 对应物）
> - **UI**：dsh-web-ui（vendored 全家桶，含 License 陷阱；皮肤中心已否决）、dsh-plugin-pack-web（版本锁 schema 参考）
> - **远程/agent**：dsh-ssh（主机档案+执行面板）、dsh-daemon（headless host 常驻）

| 参考 | 项目 | 说明 | License |
| --- | --- | --- | --- |
| dsh-web-ui | [zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) | DSH Web GUI 插件+皮肤全家桶，含聚合包 dsh-web-ui-all、皮肤中心 v2 | Apache-2.0（4 子包 BSD-3-Clause、1 皮肤 CC BY-NC-SA） |
| dst-agent-teams | [NanmiCoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) | 船长式多 Agent 编排（持久成员/任务 DAG/直接消息/活动面板） | MIT |
| 插件包参考 | [baihejiangnan/dsh-plugin-pack-web](https://github.com/baihejiangnan/dsh-plugin-pack-web) | 30 插件一键复刻包，Plugin Pack Schema v1（版本锁格式参考） | MIT |

---

## 7. 已确认决策记录（ADR 摘要）

| # | 决策 | 结论 |
| --- | --- | --- |
| 1 | 定位 | DSH 是内核，本仓库产出团队发行包 |
| 2 | 分发形态 | (c) 完整 profile 模板，git clone 直接用 |
| 3 | 实例归属 | 无 team 实例，全部 personal；特殊类型 shared/host 可扩展 |
| 4 | 远程主机 | 支持；一台主机可跑多个实例 |
| 5 | 远程部署 | dsh-console 承担（控制面）；SSH 仅一次性引导，日常全走 agent/channel |
| 6 | 最小 agent | 发行包 headless host 实例（凭据不出主机） |
| 7 | console 单点 | 接受，v1 单控制面 |
| 8 | host-manager | 历史遗留作废，dsh-console 重新设计 |
| 9 | UI 层 | 社区或社区改造；dst-* 标记 vendored |
| 10 | 网络环境 | 小团队局域网，SSH 引导与 agent 通信均简单 |

---

## 8. 命名冲突调查（2026-08，npm + GitHub 实查）

| 计划名 | npm 占用 | GitHub 占用 | 判定 |
| --- | --- | --- | --- |
| dsh-user | 无（官方 dsh-user-questions/-approval 为审批 seam，语义不同） | 无 | ✅ 可用 |
| dsh-channel | 无 | ⚠️ ZinkLu/dsh-channel（IM 消息渠道：Telegram/微信/飞书） | ⚠️ 名字被占，语义不同（消息渠道 vs 跨实例通信） |
| dsh-hub | ❌ @marecgents/dsh-hub（Tauri 桌面壳）、dsh-hub-oauth-gateway | ❌ 多个（均为插件市场/目录语义） | ❌ 必须改名 |
| dsh-quick-nav | 无 | 有 dsh-quick-navbar（不同名） | ✅ 可用 |
| dsh-session-tabs | 无 | 有 dsh-session-manager / dsh-side-session（不同名） | ✅ 可用 |
| 发行包定位 | — | dsh-web-ui-all（个人全家桶）、dsh-plugin-pack-web（个人复刻包） | ✅ 团队发行包无同类 |

**最终命名决定（2026-08 拍板）**：
- dsh-channel：**保留原名**（dsh- 前缀为自研家族标记，社区撞名不影响）
- dsh-hub → **`dsh-console`**（总览/管理/编排控制台；dsh-cockpit 已被 npm 占用，排除）
- dsh-session-tabs → **`dsh-tabs`**（短、与 dsh-quick-nav 风格统一；npm/GitHub 均无占用）
- dsh-web-ui2 → **`dsh-desk`**（个人化工作台语义，呼应"实例皆 personal"哲学；dsh-ui 被 2021 空壳包占用、dsh-toolkits 与 dsh-plugins 集合概念混淆、dsh-web-ui2 为将就续作名、dsh-fleet-ui 社区已有 dsh-fleet 系列、dsh-distributed-ui 过于学术；npm/GitHub 均无占用）
- 社区全家桶：**dsh-web-ui（@linxin666 npm）**（npm 安装 + lock 锁版本，保留原名，改造走 cordis.patch.yml 补丁层，不 fork）

---

## 9. 开放问题（下一阶段设计）

> 标注"有答案"的项，答案来自社区调研（docs/community-reference.md），补定时先读对应条目。

- [x] ~~身份模型的具体机制~~（已定 2026-08 → **2026-08 实现**）：`ctx.user.current()` → User{id,name,roles}；身份来源可插拔（`IdentityResolver` 接口：网关注入头 / gateway cookie 验签 / 静态配置）；角色 admin/member/guest；授权查询 instanceAccess + console 校验；侧边栏用户徽标（client 半区 /api/user/me + 登出）
- [x] ~~认证网关选型~~（已定 2026-08）：**dsh-gateway（clarknu）** 为主选（成熟/多站点/fail-closed/热生效），dsh-webui-auth 安全手法作补强参考；vendored 实测二选一
- [x] ~~通道鉴权细节~~（已定 2026-08）：agent↔console 用**实例令牌**（bootstrap 注入，32 hex）+ 操作级鉴权；令牌与用户会话分离；浏览器端走网关 cookie（WS 无法带 Authorization 的解法）
- [x] ~~事件总线传输与投递语义~~（已定 2026-08）：**at-least-once + UUID 幂等去重 + 7 天 TTL + 指数退避**；事件三平面分类 control（request/ack）/ task（幂等）/ session（仅显式共享）——参考 dsh-weave（dsh-agent-relay 曾作蓝本，submodule 已移除——channel 已自研实现）
- [x] ~~权限模型细节~~（已定 2026-08）：角色 admin/member/guest；shared 实例 owner 授权（可访问/只读）；操作分级（查看 member+ / 控制 owner·admin / 部署·主机管理 admin）——参考 dsh-passwords
- [x] ~~版本矩阵落地格式~~（已定 2026-08）：dsh.lock.json 定稿 schema（schemaVersion/id/name/version/kernel/bundles/vendored）——参考 Plugin Pack Schema v1
- [x] ~~局域网内的发现方式~~（**否决** 2026-08）：不做局域网自动发现（mDNS 广播）——实例发现 = **agent 主动注册 + console 已知地址列表**（主机登记时手配地址）
- [x] ~~实例档案共享契约载体~~（已定 2026-08，最终表述）：**不提"契约"概念**——插件协作模式：dsh-channel 提供实例服务（类型+发现/状态），dsh-console 提供管理服务（扩展类型+生命周期），nav 消费 channel、console-ui 消费 console（`import type` + `ctx.remote`）
- [x] ~~升级回滚策略~~（已定 2026-08）：升级前快照（bundles+lock+patch）→ patch 校验（失败默认回滚/管理员确认可跳过）→ 滚动重启 → 心跳确认 → 失败自动回滚，**保留 3 份**——参考 dsh-update-checker
- [x] ~~总览 UI 归属~~（已定 2026-08 → **2026-08 并入 console**）：原"console 纯服务端、总览界面独立为 dsh-console-ui"——**已并入 dsh-console 包**（client 半区：ConsoleBadge + 实例控制面板，sidebar.footer.action 入口，仅管理端显示）；无独立 dsh-console-ui 包
- [x] ~~agent 最小组件集清单~~（已定 2026-08）：**dsh-base + dsh-channel + dsh-user**（无 console/无 UI——agent 只执行，控制面/执行面分离）
- [x] ~~vendored 机制落地~~（已定 2026-08 → **2026-08 改统一 npm**）：原"dst-agent-teams submodule 本地安装；dsh-web-ui submodule 锁源码 + npm 安装"——**已改为统一 npm 安装 + lock 锁版本**（dsh-memento / dst-agent-teams npm 均有发布版，submodule 已移除；见 Vendoring policy）
- [x] ~~皮肤中心 v2 接入方式~~（**否决** 2026-08）：用户明确不喜欢换肤、功能优先——不引入皮肤中心，dsh-desk 自定义维度=布局+插件组合
- [ ] **全家桶工具入口组装边界**（2026-08 提出，见 [sidebar-slot-assembly-boundary](../.agents/notes/proposed/architecture/2026-08-23-sidebar-slot-assembly-boundary.md)）：task-board/ssh/skill-explorer 不走官方 sidebar 插槽而是 DOM 注入，dsh-desk 组装器（re-parent + CSS 覆盖）已实现摆位；**2026-08 已落地**——③ 组装配置化（footSpacing/tools 显隐进设置页）、⑤ 通用性（运行时发现 `data-dsh-part` entry）、② CSS 回退静默；**剩余**——① 官方 slots 型插件（git-graph/better-sidebar）的组装语义（v1 只做显隐开关）、④ rail 折叠态视觉验收（缺浏览器）。
- [ ] **typert 接入（传输与调用分层落地）**（2026-08 定分层，见 §3「传输与调用分层」）：`typert → dsh-channel`（typert 调用帧经 channel 传输，broker 为 channel 可选后端）。**未实现**：① channel 的 typert transport 契约（`rpc.send`/`intercept`）② console/quick-nav client 面改 `ctx.remote` 消费（替换手写 HTTP /api/console/* + EventSource）③ 跨实例 `@RemoteScope` 控制指令（console→instance/daemon）④ transport 选择策略（直连 vs broker）⑤ typert forwardable events ↔ channel 三平面映射。当前跨实例仍走 relay+HTTP。
- [x] ~~dsh-desk 布局配置消费方~~（**已实现** 2026-08，见 [dsh-desk-layout-consumer](../.agents/notes/implemented/architecture/2026-08-23-dsh-desk-layout-consumer.md)）：方案 B（跨插件契约 = 共享 settings 配置）——sidebar 经 `ctx.layout.toggleSidebar` + `data-sidebar-collapsed` 对齐折叠/展开（**实时生效**）；tabs/topbar 由 dsh-tabs / dsh-quick-nav 订阅 `my-ui-layout` **实时注册/注销**（slots.inject 内订阅配置，visible=false 注销、恢复重新注册）；组装器配置化（tools 显隐，实时响应）+ 通用性（运行时发现 entry）+ CSS 回退静默。剩余：slots 型插件组装语义、rail 视觉验收（见组装边界）。

### 实现状态总表（2026-08 核）

**✅ 已完成**

| 项 | 证据 |
| --- | --- |
| dsh-user 身份模型（current/instanceAccess/isOwner + IdentityResolver 适配层 + 侧边栏用户徽标/登出） | 29 测试 + web2 实测 |
| dsh-channel 通信（发现/心跳/事件总线 at-least-once/鉴权/控制指令） | 29 测试 |
| dsh-console（档案/生命周期/inbox/三角色 daemon·instance·console + 3 HTTP 端点） | 37 测试 |
| console UI（并入 dsh-console client 半区：ConsoleBadge + 控制面板） | sidebar.footer.action，仅管理端 |
| dsh-quick-nav 顶栏导航（三端在线） | 2 测试 |
| dsh-tabs 固定会话标签（Alt+P/×/编号） | 2 测试 |
| dsh-desk 工具入口组装器（re-parent 到 foot 区控制台上方 + 官方 trigger 契约样式 + 间距） | 10 测试 + web2 验证 |
| dsh-desk 布局消费方（sidebar 折叠/展开 + tabs/topbar 注册开关 + 组装器配置化/通用性） | 20 测试（含 layout-consumer 5、组装器 3） |
| vendored 全家桶 5 包（better-sidebar/git-graph/ssh/task-board/skill-explorer） | profile 依赖 + lock 锁版本 |
| 测试环境固定矩阵（web2/3/4/daemon 端口角色）+ dev-test-env.sh | scripts/ 已实测 |
| vendoring 统一 npm（submodule 归零） | AGENTS.md policy |

**❌ 未完成（开放项，见上）**

| 项 | 状态 | 差距 |
| --- | --- | --- |
| **typert 接入** | 待实现 | channel 无 transport 契约；console/quick-nav client 仍手写 HTTP/EventSource；无 @RemoteScope 跨实例指令；无 transport 选择策略；无事件映射 |
| **组装器开放边界** | 部分（剩 ①④） | ③配置化/⑤通用性/②CSS 回退已落地；剩 slots 型插件组装语义（v1 显隐开关）、rail 视觉验收（缺浏览器） |
| **dsh-gateway 集成** | 待实现 | 选定未装（dsh-user 网关对接预留） |
| **dsh-memento / dst-agent-teams** | 待接入 | 选定未接入（v1 无消费方 / 未来成员） |
| **dsh-prometheus** | 挂起 | 指标总览非 v1 必需——console 总览先用手工数据，指标面后续评估 |
| **升级回滚** | 挂起 | 生命周期核心 v1 已够用（stop/start/restart/deploy 三角色），快照回滚等后续补 |
