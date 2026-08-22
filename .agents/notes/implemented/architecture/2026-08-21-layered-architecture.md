# Agent Note: 分层架构（内核 → 系统 → 管理组件 → UI → 业务 app）

Status: implemented

> 取代原「L0-L4 分层」决策（2026-08-21 同日修订）：原 L3 称"业务层"但 console 实为管理，命名不准确；身份与通信同质合并为系统层；新增业务 app 预留位。

## Problem

多个自研插件（身份/通信/管理/导航/标签页/UI）如果各自为政，会出现概念模型分裂（比如 nav 和 console 各建一套"实例"模型）、依赖混乱、UI 与业务耦合。需要一套整体分层约束，且分层要贴合实际：管理（运维/编排）不是业务，基础设施（身份/通信）同质，业务应用未来会独立出现。

## Decision

**五层，依赖严格向下**，每层只消费下层能力、不跨层：

```
业务 app（当前无，预留）  面向用户业务价值的应用（协作/分析/工作流…）
UI                         dsh-desk（UI 平台）· dsh-quick-nav · dsh-tabs · dst-agent-teams · 各界面
管理组件                    dsh-console（主机/实例档案、生命周期、部署编排、inbox/投递）
系统                        dsh-user（身份）· dsh-channel（通信）
内核                        官方 deepseek-harness（rc 锁定）
```

**分层判据**：
- **系统**：基础设施能力（身份、通信），被上层消费，自身无业务含义。
- **管理组件**：面向"系统/资源运维"的能力（主机、实例、部署、健康）——IT 管理面。
- **UI**：界面层（布局、组件组合、导航、标签），消费管理组件与系统数据。
- **业务 app**：承载独立业务逻辑/服务（编排、状态机、调度、持久化）的应用——**首个成员：dst-agent-teams（vendored 协作应用）；全家桶功能应用（task-board/ssh/git-graph 等）随 vendored dsh-web-ui 拆分归入**。

**自研边界原则**（2026-08 社区调研后定）：
- 系统层：**dsh-user（身份模型）+ dsh-channel（通信）自研**（护城河）；**认证网关与远程访问采用社区 vendored**（接入件可替换，2026-08 用户确认）——认证从 dsh-user 拆出（dsh-user 变薄：只管用户/归属/授权基础接口），远程访问（对外暴露 UI/API）新纳入系统层。
- 管理组件：自研主体（console），通用能力采用社区（dsh-update-checker 升级回滚、dsh-prometheus 指标）。
- UI/业务 app：**以社区为主**（vendored），自研只做差异化（dsh-desk 平台、dsh-quick-nav、dsh-tabs）。
- 完整矩阵见 docs/architecture.md §5 分层×插件矩阵。

配套纪律：
- **整体性**：一套概念模型（身份/主机/实例）贯穿所有层，禁止逐插件私有模型。
- **控制面/执行面分离**：console 只编排决策，远程 agent 本地执行，SSH 仅一次性引导。
- **UI 可替换**：UI 层纯消费层，不进入核心契约。
- **同层聚合例外**：UI 层内部允许聚合依赖（meta 包，如 dsh-desk 聚合同层 nav/tabs）——跨层仍严格向下。
- **inbox/投递归属**：v1 由管理组件（console）承载，未来可长成第一个业务 app。

## Alternatives

- **原 L0-L4 五层**（L1 身份 / L2 通信 / L3 业务 / L4 UI）——否决（2026-08 同日修订）：L3"业务层"命名不准确（console 是管理不是业务）；身份与通信同质却分两层；无业务扩展预留位。
- **插件平铺、靠口头约定**——否决：无法机械约束依赖方向，概念模型必然分裂。
- **UI 组件层独立（GTK 式组件库）**——否决（2026-08 用户澄清）：UI 包是"开箱即用业务插件集"，不是组件库。

## Consequences

- workspace 内用 ESLint import 规则锁定依赖方向（实现期落地），UI 层内部聚合例外需在规则中体现。
- 系统层（身份）是所有层的根：归属、鉴权、投递目标都基于它；系统层接口应先稳定。
- 实例服务协作模式：channel 提供实例服务（类型+发现/状态），console 提供管理服务（扩展类型+生命周期），nav 消费 channel、console-ui 消费 console（type-only + ctx.remote）。
- 文档同步：architecture.md §1/§5、README、AGENTS.md 分层部分均按此更新（2026-08-21）。

相关：[团队发行包定位](2026-08-21-team-distribution-package.md) · [自定义化为核心](2026-08-21-customization-core.md) · [实例模型](2026-08-21-instance-model.md)
