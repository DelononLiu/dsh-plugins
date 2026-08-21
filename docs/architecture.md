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
├─ 系统（自研核心）─────────────────────────────────────┤
│   dsh-user（身份：网关注入/静态配置双模式）             │
│   dsh-channel（通信：发现/心跳 · 事件总线 · 鉴权 ·      │
│   typert 远程调用 · 控制指令通道）                     │
│   基础设施能力，无业务含义                             │
├─ 内核（官方 rc 锁定）─────────────────────────────────┤
│   deepseek-harness + 官方内置（dsh-base / dsh-web-app） │
└───────────────────────────────────────────────────────┘
```

### 分层判据

- **系统**：基础设施能力（身份、通信），被上层消费，自身无业务含义。
- **管理组件**：面向"系统/资源运维"的能力（主机、实例、部署、健康）——IT 管理面。
- **UI**：界面层（布局、组件组合、导航、标签），消费管理组件与系统数据。
- **业务 app**：面向"最终用户业务价值"的应用（沟通、协作、分析）——当前无，未来扩展；**跨层依赖严格向下，UI 层内部允许聚合依赖**（meta 包，如 dsh-my-ui）。

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

---

## 5. 插件职责表

| 插件 | 层 | 职责 | 状态 |
| --- | --- | --- | --- |
| dsh-user | 系统 | 身份模型、网关注入/静态配置、归属/授权基础 | 设计（试装过 web2/web3） |
| dsh-channel | 系统 | 发现/心跳、事件总线、鉴权、typert 远程调用、控制指令 | 设计（P1） |
| dsh-console | 管理组件 | 主机/实例档案、生命周期、部署编排、inbox/投递（v1 承载）、总览（原名 dsh-hub，host-manager 作废） | 重新设计 |
| dsh-nav | UI（档案读端） | 顶栏实例快捷导航（跳转/在线状态），消费实例档案 | 已上线三端 |
| dsh-tabs | UI | 固定会话标签页、Alt+1..9 跨工作区切换（原名 dsh-session-tabs） | web2 试装 |
| dsh-my-ui | UI（UI 平台） | 开箱即用业务插件集（侧边栏/Git/文件浏览/任务看板/皮肤等），meta-package 定位，"我的"=personal 哲学 | 立项 |
| dst-agent-teams | UI | vendored 自 NanmiCoder/dsh-agent-teams | 已装（仓库未引入，以实际为准） |

> dsh-nav 已上线三端，说明实例档案模型已有雏形——后续需把它抽成共享契约（系统发现 + 管理组件档案），nav 转纯读端。

---

## 6. 社区参考（已核实）

| 参考 | 项目 | 说明 | License |
| --- | --- | --- | --- |
| dsh-web-ui | [zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) | DSH Web GUI 插件+皮肤全家桶，含聚合包 dsh-web-ui-all、皮肤中心 v2 | Apache-2.0 |
| dst-agent-teams | [NanmiCoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) | 船长式多 Agent 编排（持久成员/任务 DAG/直接消息/活动面板） | MIT |
| 插件包参考 | [baihejiangnan/dsh-plugin-pack-web](https://github.com/baihejiangnan/dsh-plugin-pack-web) | 30 插件一键复刻包，Plugin Pack Schema v1 | — |

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

- [ ] 身份双模式的具体机制（网关注入的 header 契约 / 静态配置格式）
- [ ] 通道鉴权细节（agent↔console 认证：token？证书？）
- [ ] 事件总线传输与投递语义（at-least-once？顺序？）
- [ ] 权限模型细节（角色、shared 实例的授权粒度）
- [ ] 版本矩阵的落地形式（lock 文件格式 / release 表维护流程）
- [ ] 局域网内的发现方式（console 已知地址列表 vs 局域网广播）
- [ ] 实例档案共享契约载体（nav 读端契约：共享包 vs 系统层发现 + 管理组件档案）
- [ ] 升级回滚策略
- [ ] 总览 UI 归属（console 自带 client vs UI 层独立界面）
- [ ] agent 最小组件集清单（bootstrap 依赖）
- [ ] vendored submodule 机制落地
- [ ] 皮肤中心 v2 接入方式
