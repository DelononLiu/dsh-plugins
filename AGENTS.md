# AGENTS.md

本文件是给 AI agent / 协作者的项目指南：描述本仓库的**稳定事实**（定位、布局、命令、约定）。**不是缺陷/待办记录**——开放问题与未定项见 `docs/architecture.md` §9。发现文档与实现不一致时，以本文 + `docs/architecture.md` 为准，并修复不一致处。

## 仓库定位

DSH（DeepSeek Harness）是内核，本仓库产出**面向团队的发行包**：自研核心插件（分层：系统/管理组件/UI）+ 社区聚合插件（vendored）+ 版本锁。

核心价值 = **自定义化**：开箱即用是默认值，可自定义是核心能力，贯穿三层——实例（personal，类型可扩展）、UI（dsh-my-ui 布局/皮肤/组合）、发行包（profile 模板 + cordis.patch.yml 覆盖层）。

## 仓库布局

```
packages/   自研家族（packages/<plugin>/：package.json + tsconfig*.json + src/）
vendored/   社区插件（git submodule 锁定；dst-* 前缀标记第三方）
profiles/   发行包 profile 模板：web=开发+正式 / web2=单插件测试（官方基线）/ web3=多插件测试（核心组合），各含 dsh.lock.json 版本锁
scripts/    bootstrap（SSH 引导装最小 agent）+ release（版本矩阵 bump）
docs/       architecture.md（spec，含开放问题 §9）· community-reference.md（分层社区调研）· research/
.agents/    Agent Notes（一决策一文档，见 .agents/notes/README.md）
```

## 命令

```sh
pnpm install      # workspace 安装
pnpm build        # pnpm -r build（各包 tsc）
pnpm typecheck    # pnpm -r typecheck
pnpm test         # pnpm -r test
```

各包统一脚本：build（tsc -p tsconfig.build.json）/ typecheck（tsc --noEmit）/ test（vitest run）。
开发期接入 profile：`dsh plugin --profile web add <本地包路径>`（linked 安装），改代码后重新 build。

## 分层与依赖纪律（最高优先级）

```
业务 app（vendored 功能应用）  dst-agent-teams（多 Agent 协作编排）· 全家桶功能应用（task-board/ssh/git-graph…）
UI                         dsh-my-ui（UI 平台）· dsh-nav · dsh-tabs · 各界面 · 全家桶 UI 能力（skin-center/better-sidebar）
管理组件                    dsh-console（档案/生命周期/部署编排/inbox）+ 社区 dsh-update-checker / dsh-prometheus
系统                        dsh-user（身份）· dsh-channel（通信）· 认证网关（社区）· 远程访问（社区）
内核                        官方 deepseek-harness（rc 锁定）
```

- **依赖严格向下**：业务 app→UI→管理组件→系统→内核，禁止反向或跨层依赖；UI 层内部允许聚合依赖（meta 包）。
- **整体性**：一套概念模型（身份/主机/实例）贯穿所有层，**禁止逐插件私有模型**。
- **控制面/执行面分离**：console 只编排决策，远程 agent 本地执行，SSH 仅一次性引导。
- **UI 可替换**：UI 层不进入核心契约。
- **自研边界**：系统层自研核心（dsh-user 身份模型 + dsh-channel 通信），**认证网关与远程访问采用社区 vendored**（接入件可替换）；管理组件自研主体 + 社区通用能力；UI/业务 app 以社区为主。完整矩阵见 `docs/architecture.md` §5。

## 命名空间

- `dsh-*` = 自研家族（packages/，发布 npm）；`dst-*` = vendored 第三方。
- `vendored/dsh-web-ui` 保留社区原名（UI 全家桶来源，改造走 cordis.patch.yml 补丁层，不 fork）。
- 新增名字前查 npm + GitHub 占用（已有名字均已实查，见 `docs/architecture.md` §8）。

## 开发模式

参考官方仓库 `/home/long2015/Code/deepseek-harness`（docs/development.md）：

- **Host/Client 双面构建**：官方用 `tsc -b`（Project References）+ `tsdown --env.DSH_BUILD_FACE host|client` 分面构建；插件同时产出 Node 加载入口（host）与浏览器 bundle（client），exports 提供 `"."` 与 `"./client"`。
- **Typert 契约**：Host 面 `@Remote` 方法生成 Host-for-Client 契约，Client 面消费 `ctx.remote`；跨实例远程调用依赖此机制（注意：WS/EventSource 无法带 Authorization 头，鉴权需兼容 cookie 路径）。
- 本项目当前为**占位骨架（无功能实现）**：先补定需求（docs/architecture.md §9），再实现。

## 插件包形态（Conventions）

- `"type": "module"`，ESM 全栈。
- `dsh` 字段：client 插件声明 `client.inject`（官方 client 包）+ `client.platform: "web"`；需补丁的声明 `bundle.patch`。
- **peerDependencies 必列** `@deepseek-ai/cordis` 与所有 inject 目标（对齐官方 rc 版本，如 `^0.1.0-rc.8`）。
- 内部依赖用 `workspace:*`；exports 含 `"./package.json"` 子路径。
- 服务端插件：`export const name` + `export function apply(ctx)`；client 入口在 `src/client.ts`。

## 编辑这些指令

- **AGENTS.md 只记录稳定事实**；未定项/缺陷/待办放 `docs/architecture.md` §9，不写进本文件。
- 文档（architecture.md / README / AGENTS.md）与实现同步更新，禁止一处改了另一处不同步。
- **非平凡变更必须新增/更新 Agent Note**（.agents/notes/，格式与规则见 `.agents/notes/README.md`）：改变行为、架构、共享契约、流程、格式的变更都要附 note；纯机械编辑豁免。决策后不再改 note 为另一个决策，用新 note 取代并交叉链接。

## Vendoring policy

- `vendored/` 用 git submodule 锁定 commit/tag，不 copy 源码进 git 历史（保留上游更新链路）。
- 改造走 `cordis.patch.yml` 补丁层，**不 fork**。
- License 红线：Apache-2.0/MIT 可直接 vendored；AGPL 只可参考设计不可引入；CC BY-NC-SA 商用需剔除（如 dsh-web-ui 的 Maid Atelier 皮肤）。
- 具体清单与例外见 `docs/architecture.md` §5 与 `docs/community-reference.md`。
