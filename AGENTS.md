# AGENTS.md

本文件是给 AI agent / 协作者的项目指南：描述本仓库的**稳定事实**（定位、布局、命令、约定）。**不是缺陷/待办记录**——开放问题与未定项见 `docs/architecture.md` §9。发现文档与实现不一致时，以本文 + `docs/architecture.md` 为准，并修复不一致处。

## 仓库定位

DSH（DeepSeek Harness）是内核，本仓库产出**面向团队的发行包**：自研核心插件（分层：系统/管理组件/UI）+ 社区聚合插件（vendored）+ 版本锁。

核心价值 = **自定义化**：开箱即用是默认值，可自定义是核心能力，贯穿两层——实例（personal，类型可扩展）、UI（dsh-desk 布局/插件组合；**不做换肤，皮肤中心否决**）、发行包（profile 模板 + cordis.patch.yml 覆盖层）。

## 仓库布局

```
packages/   自研家族（packages/<plugin>/：package.json + tsconfig*.json + src/）
vendored/   社区插件（git submodule 锁定；dst-* 前缀标记第三方）
profiles/   发行包 profile 模板：web=开发+正式 / web2=单插件测试（官方基线）/ web3=多插件测试（核心组合），各含 dsh.lock.json 版本锁
scripts/    bootstrap（SSH 引导装最小 agent）+ release（版本矩阵 bump）
docs/       architecture.md（spec，含开放问题 §9）· community-reference.md（分层社区调研）· research/
.agents/    Agent Notes（一决策一文档，见 .agents/notes/README.md）+ Skills（dsh-code-review / dsh-prose-standard / dsh-trim-cot-leakage / dsh-pre-push-checks / record-browser-gif，vendored 自官方 harness 并适配）
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
UI                         dsh-desk（四区布局平台 + 工具入口组装器）· dsh-quick-nav（顶部区域）· dsh-tabs（tab 区）· 各界面 · 全家桶 UI 能力（better-sidebar 侧边栏；无皮肤）
管理组件                    dsh-console（档案/生命周期/部署编排/inbox，升级回滚为遗留项）+ 社区 dsh-prometheus
系统                        dsh-user（身份）· dsh-channel（通信）· 认证网关（社区）· 远程访问（社区）· LLM 记忆（社区 dsh-memento）
内核                        官方 deepseek-harness（rc 锁定）
```

- **依赖严格向下**：业务 app→UI→管理组件→系统→内核，禁止反向或跨层依赖；UI 层内部允许聚合依赖（meta 包）。
- **整体性**：一套概念模型（身份/主机/实例）贯穿所有层，**禁止逐插件私有模型**。
- **控制面/执行面分离**：console 只编排决策，远程 agent 本地执行，SSH 仅一次性引导。
- **UI 默认与官方一致（抄官方）**：任何 UI 元素以官方对应组件（DOM 结构 / CSS 机制 / 属性值）为唯一基准，默认直接照抄，不手写近似、不自由发挥——官方组件实现即样式契约（见 [.agents/notes/implemented/process/2026-08-22-ui-official-alignment.md](.agents/notes/implemented/process/2026-08-22-ui-official-alignment.md)）。
- **UI 可替换**：UI 层不进入核心契约。
- **自研边界**：系统层自研核心（dsh-user 身份模型 + dsh-channel 通信），**认证网关与远程访问采用社区 vendored**（接入件可替换）；管理组件自研主体 + 社区通用能力；UI/业务 app 以社区为主。完整矩阵见 `docs/architecture.md` §5。

## 命名空间

- `dsh-*` = 自研家族（packages/，发布 npm）；`dst-*` = vendored 第三方。
- `vendored/dsh-web-ui` 保留社区原名（UI 全家桶来源，改造走 cordis.patch.yml 补丁层，不 fork）；`vendored/dsh-memento` 同样保留原名（LLM 记忆，社区组件）。
- 新增名字前查 npm + GitHub 占用（已有名字均已实查，见 `docs/architecture.md` §8）。

## 开发模式

参考官方仓库 `/home/long2015/Code/deepseek-harness`（docs/development.md）：

- **Host/Client 双面构建**：官方用 `tsc -b`（Project References）+ `tsdown --env.DSH_BUILD_FACE host|client` 分面构建；插件同时产出 Node 加载入口（host）与浏览器 bundle（client），exports 提供 `"."` 与 `"./client"`。
- **Typert 契约**：Host 面 `@Remote` 方法生成 Host-for-Client 契约，Client 面消费 `ctx.remote`；跨实例远程调用依赖此机制（注意：WS/EventSource 无法带 Authorization 头，鉴权需兼容 cookie 路径）。
- 本项目当前为**已实现 + 部分接入**：6 插件实现（39 测试全绿）；dsh-web 真实接入见 `.agents/notes/implemented/process/2026-08-21-dsh-web-integration.md`。
- **测试环境 = 目录隔离**（2026-08 定）：web2/web3 用**独立 DSH_HOME**（`~/.dsh-web2`、`~/.dsh-web3`），`DSH_HOME=<dir> dsh --profile web` 启动——sessions/settings/storages 完全隔离，不污染正式 `~/.dsh`。独立 home 的 profile 用 `dsh plugin --profile web add` 创建，自研插件经 cordis.patch.yml insert（不进 bundles），webserver 端口独立配置（避开正式 3080）。
- **🔴 硬性禁令：禁止启动/触碰正式 web（3080）**（2026-08 用户强调）：3080 是当前 DSH GUI 常驻端口，**绝不**用 `dsh web` 或 `dsh --profile web` 启动（默认 3080），**绝不**修改 `~/.dsh/profiles/web` 的配置（bundles/cordis.patch.yml/package.json）。测试一律走独立 DSH_HOME + 独立端口（3082 等）。误操作会占用 3080 导致 GUI 冲突或污染正式环境。
- **client 构建**：声明 dsh.client 的插件必须产出 `lib/client.js`（官方 ModuleLoader closure 格式）——`scripts/build-client.mjs`（esbuild）生成，4 个 UI 插件 build 已接入。

## 插件包形态（Conventions）

- `"type": "module"`，ESM 全栈。
- `dsh` 字段：client 插件声明 `client.inject`（官方 client 包）+ `client.platform: "web"`；需补丁的声明 `bundle.patch`。
- **peerDependencies 必列** `@deepseek-ai/cordis`（`^4.0.1`，稳定版）与所有 inject 目标（对齐官方 rc，如 `^0.1.0-rc.8`）；type-only 引用的内部服务包也放 peerDependencies（发布后 .d.ts 解析需要）。
- 内部依赖用 `workspace:*`；exports 含 `"./package.json"` 子路径。
- 服务端插件：`export const name` + `export function apply(ctx)`；client 入口在 `src/client.ts`。

## 开发流程（worktree 分支）

- **大功能在独立 worktree 分支开发**（互不影响）：
  ```sh
  git worktree add ../dsh-plugins-feat-xxx feat/xxx   # 独立工作目录 + 功能分支
  # 功能开发/自检/提交后：
  git merge feat/xxx --no-ff                          # 合入 main
  git worktree remove ../dsh-plugins-feat-xxx         # 删除 worktree
  ```
- **main 保持稳定基线**：小改动/文档可直接在 main 提交（原子、单功能）；**大功能（跨多文件/多提交）一律走 worktree 分支**，分支命名 `feat/<功能名>`。
- 功能完成自检（typecheck/测试/文档/Agent Note）后合入，合入 = 一个功能单元（见"提交规则"）。
- 注意：worktree 是独立目录，各自 `pnpm install`（node_modules 不共享）。
- **依赖链串行开发**（2026-08 定）：**有依赖关系的插件不能同时开 worktree**——worktree 隔离使上层看不到下层的未合入改动。依赖链必须串行：先底层（合入 main）再上层（开新 worktree）。依赖链：dsh-user → dsh-channel → dsh-console → dsh-console-ui → dsh-quick-nav（type-only 依赖 channel）→ dsh-desk（聚合 nav/tabs）；**dsh-tabs 无内部依赖，独立**。无依赖关系的插件可并行。

## 提交规则（Commit Rules）

- **一个提交 = 一个逻辑单元**：一个功能 / 修复 / 文档 / 重构。按功能拆分提交，**禁止把无关改动混合进同一提交**；补丁式碎提交（临时修改、调试残留）不得进入 main。
- **语义化前缀**：`feat:` 新功能 · `fix:` 修复 · `docs:` 文档 · `chore:` 构建/杂项 · `refactor:` 重构 · `test:` 测试 · `style:` 格式。
- **main 分支纪律（按功能提交）**：
  - 功能开发在**分支**进行，自检通过后合入 main；main 上每个提交必须是**可独立成立的功能单元**（原子、可单独回滚、不依赖未提交的兄弟改动）。
  - 一次合并 = 一个功能，不留半成品/中间态在 main。
  - 文档与实现同步变更、Agent Note 与实现**同一提交**（见"编辑这些指令"）。
- **提交前自检**：`pnpm typecheck` 通过（除已知占位期）、无调试残留、文档同步、非平凡变更已附 Agent Note。
- **提交信息格式**：`<prefix>: <中文或英文摘要>`，必要时正文说明为什么（不是做了什么）。

## 编辑这些指令

- **AGENTS.md 只记录稳定事实**；未定项/缺陷/待办放 `docs/architecture.md` §9，不写进本文件。
- 文档（architecture.md / README / AGENTS.md）与实现同步更新，禁止一处改了另一处不同步。
- **非平凡变更必须新增/更新 Agent Note**（.agents/notes/，格式与规则见 `.agents/notes/README.md`）：改变行为、架构、共享契约、流程、格式的变更都要附 note；纯机械编辑豁免。决策后不再改 note 为另一个决策，用新 note 取代并交叉链接。

## Vendoring policy

- `vendored/` 用 git submodule 锁定 commit/tag，不 copy 源码进 git 历史（保留上游更新链路）。
- **双模式**（2026-08 定）：
  - 轻量单包（如 dst-agent-teams）：submodule 进 vendored/，profile 本地安装——完全锁定 + dst- 标记。
  - 重量全家桶（如 dsh-web-ui 17 包）：submodule 锁源码快照（审查/补丁参考），**安装走 npm 发布版**（@linxin666 scope），`dsh.lock.json` 锁版本，改造走 profile 层 patch。
- 改造走 `cordis.patch.yml` 补丁层，**不 fork**。
- License 红线：Apache-2.0/MIT 可直接 vendored；AGPL 只可参考设计不可引入；CC BY-NC-SA 商用需剔除（如 dsh-web-ui 的 Maid Atelier 皮肤）。
- 具体清单与例外见 `docs/architecture.md` §5 与 `docs/community-reference.md`。
