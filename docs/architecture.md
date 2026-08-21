# dsh 团队发行包 · 架构设计

> 状态：已收敛（2026-08，讨论确认）
> 定位：DSH（DeepSeek Harness）是内核，本仓库产出**面向团队的发行包**——内核 + 自研核心插件 + 社区聚合插件 + 版本锁，一条命令/一次 clone 得到可用团队环境。

---

## 1. 分层架构（内核 → 系统 → 管理组件 → UI → 业务 app）

依赖方向严格向下：每层只消费下层能力，不跨层。

```
┌─ 业务 app（当前无，预留）─────────────────────────────┐
│  面向用户业务价值的应用（协作/分析/工作流…）；          │
│  消费 UI + 系统能力；当前为空，inbox/投递未来可         │
│  长成第一个业务 app                                   │
├─ UI（可替换）────────────────────────────────────────┤
│   dsh-my-ui：UI 平台（布局/组合/皮肤自定义；            │
│   meta-package 定位；"我的"= personal 哲学）           │
│   dsh-nav · dsh-tabs · 各界面 · dst-agent-teams        │
│   消费管理组件与系统数据，不定义模型                   │
├─ 管理组件（自研核心）─────────────────────────────────┤
│   dsh-console：主机/实例档案 · 生命周期 · 部署编排 ·    │
│   inbox/投递（v1 承载，未来可独立为业务 app）· 总览     │
│   控制面：决策与编排，执行在远程 agent                  │
├─ 系统 ────────────────────────────────────────────────┤
│   dsh-user（身份模型：用户/归属/授权基础，自研）          │
│   dsh-channel（通信：发现/心跳 · 事件总线 · 鉴权 ·       │
│   typert 远程调用 · 控制指令=远程管理，自研）            │
│   认证网关（社区 vendored：登录/会话/鉴权执行）          │
│   远程访问（社区 vendored：对外暴露实例 UI/API）         │
│   基础设施能力，无业务含义                             │
├─ 内核（官方 rc 锁定）─────────────────────────────────┤
│   deepseek-harness + 官方内置（dsh-base / dsh-web-app） │
└───────────────────────────────────────────────────────┘
```

### 分层判据

- **系统**：基础设施能力（身份、通信），被上层消费，自身无业务含义。
- **管理组件**：面向"系统/资源运维"的能力（主机、实例、部署、健康）——IT 管理面。
- **UI**：界面层（布局、组件组合、导航、标签），消费管理组件与系统数据。
- **业务 app**：承载独立业务逻辑/服务（编排、状态机、调度、持久化）的应用——**首个成员：dst-agent-teams（vendored 协作应用）；全家桶功能应用（task-board/ssh/git-graph 等）随 vendored dsh-web-ui 拆分归入**；**跨层依赖严格向下，UI 层内部允许聚合依赖**（meta 包，如 dsh-my-ui）。

### 插件协作模式（服务定义 / 提供者 / 消费者）

插件间协作采用 DSH 生态标准模式（官方 capability seam），**不引入独立"契约"概念**：

- **dsh-channel = 实例服务提供者**：定义实例类型（id/name/addr/status/health）+ 暴露发现/心跳/状态服务（@Remote，host 面）——实例是通信层发现的对象，放 channel 名正言顺。
- **dsh-console = 实例管理服务提供者**：定义管理档案类型（在 channel 的实例类型上扩展 owner/type/host/version）+ 暴露生命周期/部署服务。
- **dsh-nav / dsh-console-ui = 消费者**：`import type` 引用提供者的类型（编译期，运行时零依赖）+ 经 Typert `ctx.remote` 调用服务（client 面）：
  - dsh-nav → channel（导航只需实例身份/状态，依赖降到系统层）
  - dsh-console-ui → console（管理界面）
- 依赖方向向下；"一套概念模型"由提供者唯一定义类型保证。

### UI 四区布局（2026-08 定）

发行包 UI 利用**四个区域**，**功能优先（不采用皮肤中心，不做换肤）**：

```
┌─ 顶部区域 ─────────────────────────────┐
│  dsh-nav：实例导航（跳转/在线状态）+ 全局操作入口 │
├──────────┬─────────────────────────────┤
│ 侧边栏    │  tab 区                     │
│ 工作区/   │  dsh-tabs：固定会话标签       │
│ 会话树    │  Alt+1..9 跨工作区切换       │
│          │                             │
│ 左侧按钮区│  （内容区）                  │
│ （设置上方）│                             │
│ console 入口│                            │
│ 快捷按钮  │                             │
├──────────┴─────────────────────────────┤
```

| 区域 | 职责 | 插件 |
| --- | --- | --- |
| 顶部区域 | 全局导航与状态（实例跳转/在线）、全局操作入口 | dsh-nav + 快捷操作 |
| tab 区 | 会话级切换（固定标签 + Alt+1..9 跨工作区） | dsh-tabs |
| 侧边栏 | 工作区/会话树管理 | 官方原生 + better-sidebar 增强（社区） |
| 左侧设置上方按钮区 | 功能区快捷入口（console 管理、inbox/投递、命令面板） | console 入口 + 快捷按钮 |

**皮肤中心（dsh-web-ui 的 skin-center v2）不引入**：用户明确"不喜欢换皮肤，功能优先"；dsh-my-ui 自定义维度收敛为**布局 + 插件组合**（vendored 全家桶时可不装 skin-center 包）。

### 设计原则

- **整体性**：一套概念模型（身份/主机/实例）贯穿所有层，不允许逐插件私有模型。
- **控制面/执行面分离**：console 只编排决策，远程 agent 本地执行，SSH 仅用于一次性引导。
- **UI 可替换**：UI 层纯消费层，社区插件随时可换，不进入核心契约。dsh-my-ui 是 meta-package 定位（类比 ubuntu-desktop：装一个 = 装齐业务插件集），非组件库、非脚手架。
- **自定义化为核心**：开箱即用是默认值，可自定义是核心能力，贯穿三层——实例（personal 类型可扩展）、UI（dsh-my-ui 组合/布局/皮肤自定义，继承社区皮肤中心 v2 纯资产机制）、发行包（profile 模板 + cordis.patch.yml 覆盖层）。
- **命名空间**：`dsh-*` = 自研家族；`dst-*` = vendored 第三方（明确标记，非家族）。

---

## 2. 核心概念模型

### 用户（身份，系统层）

- 多用户：同一部署可承载多个用户身份；身份来源双模式——网关注入 / 静态配置。
- 身份是所有层的根：实例归属、通道鉴权、投递目标、部署授权都基于它。
- 角色概念（谁能部署、谁能访问 shared 实例）v1 落进系统层的授权模型。

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

### 最小 agent（远程主机代理）

- 形态：**发行包的 headless host 实例**（无 web UI 的最小组件集），即远程主机的常驻代表。
- 职责：接收 console 指令（部署/创建/启停/升级），本地执行，回传状态；凭据不出主机。
- agent 即 DSH 实例：随时可升级为完整实例直接进去调试，扩展能力不加新协议。

---

## 3. 部署链路（已确认：混合方案）

```
SSH（仅一次性引导）──► 装最小 agent ──► 之后全走 agent/channel
```

### 引导（bootstrap，一次性）

1. console 通过 SSH 在远程主机跑一条引导脚本（局域网内零成本）。
2. 引导内容：部署发行包最小集 → 起 headless host 实例（agent）。
3. agent 上线，向 console 注册主机档案 + 实例档案。

### 日常管理（control，全走 channel）

- console → agent：`deploy` / `create-instance` / `stop` / `start` / `upgrade` 等结构化指令（typert RPC）。
- agent 本地执行（克隆模板 → 新 profile → 起进程 → 注册档案），回传结构化回执。
- 心跳经 channel 上报；主机在线状态 = 其下实例心跳聚合。
- 升级 = 推新版本发行包 → 逐实例滚动重启 → 心跳恢复确认。

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
- 落地形式：`profiles/web/dsh.lock.json`（版本锁：内核 rc + 自研 + 社区锁定版本，schema 未定，见 §9 开放问题）。

### Profile 矩阵（三个模板）

| profile | 用途 | bundles 内容 |
| --- | --- | --- |
| **web** | 开发 + 正式 | 官方基线 + 全部自研（user/channel/console/nav/tabs/my-ui）+ vendored 全家桶（TBD） |
| **web2** | 单插件测试（隔离） | 官方基线（无自研）——测试时 `dsh plugin --profile web2 add <被测>` 临时装入 |
| **web3** | 多插件测试（集成） | 官方基线 + 核心组合（user/channel/console + nav/tabs）——测试时临时增删 |

原则：**web 是正式基线，web2/web3 是测试隔离环境**；版本矩阵锁（dsh.lock.json）三者各自维护。

---

## 5. 分层 × 插件矩阵

**原则**：系统层（身份/通信）全自研（护城河，社区仅作设计参考）；管理组件自研主体 + 通用能力采用社区；UI/业务 app 以社区为主（vendored），自研只做差异化插件（nav/tabs/my-ui 平台）。

### 自研插件（packages/）

| 插件 | 层 | 职责 | 状态 |
| --- | --- | --- | --- |
| dsh-user | 系统·身份 | 身份模型（用户/归属/授权基础）；认证实现已拆出走认证网关 | 设计（试装过 web2/web3） |
| dsh-channel | 系统·通信 | 发现/心跳、事件总线、鉴权、typert 远程调用、控制指令（远程管理）；**实例服务提供者**（实例类型 + 发现/状态服务） | 设计（P1） |
| dsh-console | 管理组件 | **纯服务端**：主机/实例档案、生命周期、部署编排、inbox/投递、总览数据；**实例管理服务提供者**（扩展类型 + 生命周期/部署服务） | 重新设计 |
| dsh-console-ui | UI | 总览/管理界面（四区：左侧按钮区入口 + 内容区），消费 dsh-contracts + ctx.remote | 新立 |
| dsh-nav | UI | 顶栏实例快捷导航（跳转/在线状态），实例档案读端 | 已上线三端 |
| dsh-tabs | UI | 固定会话标签页、Alt+1..9 跨工作区切换 | web2 试装 |
| dsh-my-ui | UI（平台） | 布局（四区）/插件组合自定义平台（不包含皮肤——皮肤中心已否决），meta-package，"我的"=personal 哲学 | 立项 |

> dsh-nav 已上线三端，说明实例模型已有雏形——后续按插件协作模式（channel 提供实例服务，nav 作消费者转纯读端）。

### 社区直接采用（vendored，相似度极高不重复造）

| 插件 | 层 | 用途 | 说明 |
| --- | --- | --- | --- |
| dsh-web-ui 全家桶（@linxin666 scope） | UI + 业务 app | UI 能力（better-sidebar 侧边栏 / 布局；**不含 skin-center，皮肤否决**）+ 功能应用（task-board 任务看板 / git-graph / ssh / pet…） | Apache-2.0（4 子包 BSD-3-Clause；Maid Atelier 皮肤 CC BY-NC-SA 商用需剔除——不装皮肤则无关） |
| dst-agent-teams | 业务 app | 多 Agent 协作编排（船长+成员+任务 DAG+直接消息） | vendored 自 NanmiCoder，MIT；**业务 app 层第一个成员** |
| dsh-gateway（clarknu） | 系统·认证网关 | 登录/认证（scrypt、fail-closed、限速、吊销、多站点） | ✅ 已选定（2026-08）；dsh-user 身份接口对接；dsh-webui-auth 安全手法作补强参考 |
| dsh-remote-web-ui（全家桶内） | 系统·远程访问 | 局域网扫码配对远程控制（SSH 同步、令牌门控） | ✅ 已选定（2026-08）；零额外 vendored；dsh-relay 作跨网扩展参考（v2） |
| dsh-update-checker | 管理组件 | 升级/备份/回滚/watchdog | U3 回滚答案，console 集成 |
| dsh-prometheus | 管理组件 | 有界指标 + Grafana 总览数据面 | console 总览复用 |
| dsh-agent-relay | 系统·通信（可选） | HMAC 事件总线骨架 | 若 channel 事件总线直接采用 |
| dsh-topbar-manager | UI | 顶栏按钮治理（nav/tabs 均注入顶栏，统一注册表） | — |
| dsh-daemon | 部署 | headless host 常驻/自愈（watchdog + /health） | 引导装 agent 后的守护 |

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
| dsh-Remote | 远程访问 | 多服务器选优、远程审批（v2 参考） |

### 排除边界（避免误引）

- dsh-AuthInOne / dsh-oauth：LLM provider 登录域，非用户身份
- ZinkLu/dsh-channel / 各 IM 渠道插件：消息渠道，非跨实例通信
- HuanLinOTO/dsh-plugin-ya-workspace-sidebar：**AGPL-3.0**，不可 vendored（license 红线）

---

## 6. 社区参考（已核实）

> 完整分层调研见 **[docs/community-reference.md](community-reference.md)**（按新架构六条线扫描，含每层可借鉴点与 License 红线）。核心结论：
> - **身份（dsh-user）**：dsh-passwords（多租户主/子用户+配额）、dsh-local-hanaccount（静态配置模式）、dsh-webui-auth / dsh-gateway（网关注入模式）——双模式均有社区对标
> - **通信（dsh-channel）**：dsh-weave（Iroh P2P 发现/心跳，设计蓝本）、dsh-remote-link（QR+HMAC 配对鉴权）、dsh-agent-relay（事件总线骨架）、SunNull/dsh-relay（Wire-Trunk 传输底座）
> - **管理（dsh-console）**：dsh-remote-tunnel（部署编排）、dsh-update-checker（**U3 回滚答案**）、dsh-forge mailbridge（inbox 对应物）
> - **UI**：dsh-web-ui（vendored 全家桶，含 License 陷阱）、皮肤中心 v2（**U8 答案**）、dsh-plugin-pack-web（**U2 版本锁 schema 参考**）
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
| dsh-nav | 无 | 有 dsh-navbar（不同名） | ✅ 可用 |
| dsh-session-tabs | 无 | 有 dsh-session-manager / dsh-side-session（不同名） | ✅ 可用 |
| 发行包定位 | — | dsh-web-ui-all（个人全家桶）、dsh-plugin-pack-web（个人复刻包） | ✅ 团队发行包无同类 |

**最终命名决定（2026-08 拍板）**：
- dsh-channel：**保留原名**（dsh- 前缀为自研家族标记，社区撞名不影响）
- dsh-hub → **`dsh-console`**（总览/管理/编排控制台；dsh-cockpit 已被 npm 占用，排除）
- dsh-session-tabs → **`dsh-tabs`**（短、与 dsh-nav 风格统一；npm/GitHub 均无占用）
- dsh-web-ui2 → **`dsh-my-ui`**（个人化工作台语义，呼应"实例皆 personal"哲学；dsh-ui 被 2021 空壳包占用、dsh-toolkits 与 dsh-plugins 集合概念混淆、dsh-web-ui2 为将就续作名、dsh-fleet-ui 社区已有 dsh-fleet 系列、dsh-distributed-ui 过于学术；npm/GitHub 均无占用）
- 社区全家桶：**vendored/dsh-web-ui**（submodule 锁定社区原版，保留原名，改造走 cordis.patch.yml 补丁层，不 fork）

---

## 9. 开放问题（下一阶段设计）

> 标注"有答案"的项，答案来自社区调研（docs/community-reference.md），补定时先读对应条目。

- [ ] 身份模型的具体机制（用户模型接口、归属模型；认证已拆出走网关，见下）
- [x] ~~认证网关选型~~（已定 2026-08）：**dsh-gateway（clarknu）** 为主选（成熟/多站点/fail-closed/热生效），dsh-webui-auth 安全手法作补强参考；vendored 实测二选一
- [x] ~~远程访问选型~~（已定 2026-08）：**dsh-remote-web-ui（全家桶内）** 为主（局域网扫码配对，零额外 vendored）；dsh-relay（Wire-Trunk）作跨网扩展参考（v2）
- [ ] 通道鉴权细节（agent↔console 认证：token？证书？；注意 WS/EventSource 不能带 Authorization 头，需兼容 cookie 路径）
- [ ] 事件总线传输与投递语义（at-least-once？顺序？；参考 dsh-agent-relay）
- [ ] 权限模型细节（角色、shared 实例的授权粒度；参考 dsh-passwords 授权矩阵）
- [ ] **版本矩阵落地格式**（有答案）：dsh.lock.json schema 参考 Plugin Pack Schema v1
- [ ] 局域网内的发现方式（console 已知地址列表 vs 局域网广播）
- [x] ~~实例档案共享契约载体~~（已定 2026-08，最终表述）：**不提"契约"概念**——插件协作模式：dsh-channel 提供实例服务（类型+发现/状态），dsh-console 提供管理服务（扩展类型+生命周期），nav 消费 channel、console-ui 消费 console（`import type` + `ctx.remote`）
- [ ] **升级回滚策略**（有答案）：参考 dsh-update-checker 备份→更新→回滚闭环
- [x] ~~总览 UI 归属~~（已定 2026-08）：console **纯服务端**，总览界面独立为 UI 层 **dsh-console-ui**
- [ ] agent 最小组件集清单（bootstrap 依赖）
- [x] ~~vendored submodule 机制落地~~（已定 2026-08）：dst-agent-teams submodule 本地安装；dsh-web-ui submodule 锁源码 + npm 安装 + lock 锁版本 + patch 层改造
- [x] ~~皮肤中心 v2 接入方式~~（**否决** 2026-08）：用户明确不喜欢换肤、功能优先——不引入皮肤中心，dsh-my-ui 自定义维度=布局+插件组合
