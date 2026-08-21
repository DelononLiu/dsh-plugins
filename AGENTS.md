# AGENTS.md

本文件是给 AI agent / 协作者的项目指南。开工前必读；发现文档与实现不一致时，以本文 + docs/architecture.md 为准，并修复不一致处。

## 仓库定位

DSH（DeepSeek Harness）是内核，本仓库产出**面向团队的发行包**：自研核心插件（分层：系统/管理组件/UI）+ 社区聚合插件（vendored）+ 版本锁。核心价值 = **自定义化**（开箱即用是默认值，可自定义是核心能力：实例 personal、UI "my"、发行包 patch 层）。

## 分层与依赖纪律（最高优先级）

```
业务 app（当前无，预留）  面向用户业务价值的应用（协作/分析/工作流…）
UI                         dsh-my-ui（UI 平台）· dsh-nav · dsh-tabs · dst-agent-teams · 各界面
管理组件                    dsh-console（主机/实例档案、生命周期、部署编排、inbox/投递）
系统                        dsh-user（身份）· dsh-channel（通信）
内核                        官方 deepseek-harness（rc 锁定）
```

- **依赖严格向下**：业务 app→UI→管理组件→系统→内核，禁止反向或跨层依赖。
- **UI 层内部允许聚合依赖**（meta 包，如 dsh-my-ui 聚合同层 nav/tabs）。
- **整体性**：一套概念模型（身份/主机/实例）贯穿所有层，**禁止逐插件私有模型**。
- **控制面/执行面分离**：console 只编排，远程 agent 本地执行，SSH 仅一次性引导。
- **UI 可替换**：UI 层不进入核心契约。

## 命名空间

- `dsh-*` = 自研家族（packages/，发布 npm）。
- `dst-*` = vendored 第三方（vendored/，明确标记非家族）。
- `vendored/dsh-web-ui` 保留社区原名（特殊：UI 全家桶来源，submodule 锁定，改造走 cordis.patch.yml 补丁层，不 fork）。
- 命名前查 npm/GitHub 占用（本仓库所有名字均已实查，见 docs/architecture.md §8）。

## 目录布局

```
packages/   自研家族（packages/<plugin>/：package.json + tsconfig*.json + src/）
vendored/   社区插件（git submodule 锁定；dst-* 前缀）
profiles/   发行包 profile 模板（git clone 即用）：web=开发+正式 / web2=单插件测试（官方基线）/ web3=多插件测试（核心组合），各含 dsh.lock.json 版本锁
scripts/    bootstrap（SSH 引导装最小 agent）+ release（版本矩阵 bump）
docs/       架构文档（architecture.md 是 spec）
```

## 开发模式

参考官方仓库 /home/long2015/Code/deepseek-harness（docs/development.md）的开发模式：

- **Host/Client 双面构建**：官方用 `tsc -b`（TypeScript Project References）+ `tsdown --env.DSH_BUILD_FACE host|client` 分面构建；插件同时产出 Node 加载入口（host）与浏览器 bundle（client），包 exports 提供 `"."` 与 `"./client"` 子路径。
- **Typert 契约**：Host 面 `@Remote` 方法生成 Host-for-Client 契约，Client 面消费 `ctx.remote`；跨实例远程调用依赖此机制。
- **profile 集成**：开发期 `dsh plugin --profile web add <本地包路径>`（linked 安装），改代码后重新 build。
- 本项目当前为**占位骨架（无功能实现）**：功能不着急开发，**先补定需求**（见下）。

## 命令

```sh
pnpm install      # workspace 安装
pnpm build        # pnpm -r build（各包 tsc）
pnpm typecheck    # pnpm -r typecheck
pnpm test         # pnpm -r test
```

各包统一脚本：build（tsc -p tsconfig.build.json）/ typecheck（tsc --noEmit）/ test（vitest run）。

## 已知未定项（评审 2026-08 发现，开工前必须补定）

1. **实例档案共享契约载体**：nav 是档案读端，当前直接依赖 dsh-console；文档要求"抽成共享契约"——契约放共享包还是 dsh-channel？未定。
2. **版本矩阵落地格式**：dsh.lock.json 的 schema 未定。
3. **升级回滚策略**：文档只写了滚动重启，无回滚。
4. **总览 UI 归属**：console 自带 client（./client 导出）vs UI 层"不进核心契约"的边界。
5. **agent 最小组件集清单**：bootstrap 脚本依赖它，未列。
6. ~~dsh-my-ui 的 cordis.patch.yml：package.json 的 dsh.bundle.patch 引用它，文件不存在~~ —— **已修复**：占位文件已建（内容待实现期填充）。
7. **vendored submodule 机制**：未落地（dst-agent-teams、dsh-web-ui 尚未引入）。
8. **皮肤中心 v2 引用方式**：社区 dsh-web-ui 的皮肤机制如何接入未定。

## 已知文档矛盾（评审发现，部分已修复）

- ~~dsh-nav 的分层标注：分层图写 L4，职责表写"L1/L3 读端"~~ —— **已修复**：统一为"UI（档案读端）"。
- ~~dst-agent-teams 状态"已装" vs vendored/ 为空~~ —— **已修复**：职责表标注"仓库未引入，以实际为准"。
- dst-* 命名规则 vs vendored/dsh-web-ui 保留原名——规则需注明例外（见"命名空间"，已注明）。
- ~~dsh.lock.json 在 README 有、architecture.md §4 无~~ —— **已修复**：§4 已补（见下）。

## 编辑约定

- 文档（architecture.md / README / AGENTS.md）与实现同步更新，禁止一处改了另一处不同步。
- 新增插件名/概念前，查 npm + GitHub 占用。
- 占位代码写 TODO 并标注所属层与契约来源。
- **非平凡变更必须新增/更新 Agent Note**（.agents/notes/，一决策一文档，格式与规则见 `.agents/notes/README.md`）：改变行为、架构、共享契约、流程、格式的变更都要附 note；纯机械编辑豁免。决策后不再改 note 为另一个决策，用新 note 取代并交叉链接。
