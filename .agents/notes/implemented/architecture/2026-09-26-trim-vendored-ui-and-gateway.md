# Agent Note: 发行包收敛——移除 vendored UI 应用、agent-teams 与认证网关

Status: implemented

> 后续（2026-10-01）：本次瘦身时保留的 dsh-desk host 面（布局配置服务）与 dsh-focus-tabs
> 也已整包删除——见 [drop-desk-and-focus-tabs](2026-10-01-drop-desk-and-focus-tabs.md)。

## Problem

发行包里的 vendored 面越堆越宽，且与两条纪律冲突/重复：

1. **UI 重复造**：`@linxin666/*` 四包（task-board / git-graph / ssh / skill-explorer）
   带来一整套自绘侧栏/文件/终端/Git 面，而本仓纪律是「UI 默认与官方一致（官方组件
   即样式契约）」。它们的入口还要靠 dsh-desk 的**工具入口组装器**（re-parent +
   CSS 覆盖）与 **slots 显隐控制器**（git-graph）维护——一份只为 vendored UI 存在
   的适配层。
2. **协作编排重复造**：`@nanmicoder/dsh-agent-teams` 选定未接入，而官方 0.1.7 已自带
   agent-team（`@deepseek-ai/dsh-experimental-agent-team*`，实验态）。
3. **认证网关悬空**：`dsh-gateway`（clarknu）因官方 BrowserAuth fence 挡反代，
   多用户登录一直是 backlog；0.1.7 上其 `scope.settings.register` 调用更是直接
   失效（设置页/持久化退化）。2026-09 起已决定网关**不随实例启动**。

用户决定（2026-09-26）：这四个 UI 包不要了、agent-teams 删掉用官方的、网关也先去掉。

## Decision

- **移除 `@linxin666/*` 四包**：从 `profiles/master`（4 包）、`profiles/dev`（3 包）的
  依赖 + `dsh.profile.bundles` + lock + dev patch insert 移除；模板闸门
  （`EXPECTED_BUNDLES`）同步。
- **dsh-desk 随之瘦身**（组装器/显隐只为 vendored UI 服务）：
  - 删除 `src/client/`（ToolAssembler / SlotsController / client 入口）、
    `tests/assembler.spec.ts`、`tests/slots-controller.spec.ts`、`vitest.config.ts`；
  - 删 `AssembledToolId` / `AssembledSlotId` / `AssemblerConfig` / `DEFAULT_ASSEMBLER`、
    `Config.assembler`、`MyUiService.assembler()`；
  - `package.json` 去掉 `exports["./client"]`、`dsh.client`、client 构建步骤与
    仅 client 用的 devDeps（react / happy-dom / client-ui-* / client-store）。
  - 保留：布局配置（`ctx.myUi`，被 quick-nav / focus-tabs 消费）。**本包自此只有 host 面。**
    （该保留项后于 2026-10-01 随 dsh-desk 整包删除，见 [drop-desk-and-focus-tabs](2026-10-01-drop-desk-and-focus-tabs.md)。）
- **移除 agent-teams**：master 锁的 `@nanmicoder/dsh-agent-teams`、explorer 锁的旧名
  `dst-agent-teams`（该名字在 npm 上已不存在）一并删除；协作编排改用官方 agent-team。
- **移除认证网关**：三个模板 lock 的 `dsh-gateway` 条目删除；活环境 `~/.dsh/profiles/web`
  与 `~/.dsh-web5/profiles/web5` 去掉依赖 + bundle（若含 patch 行一并去掉）。
  独立部署（单一共享网关 + 官方会话桥）仍是 backlog，见 `docs/architecture.md` §9。
  dsh-user 的网关身份解析器（`gatewayHeaders` / `gatewayCookie`）保留但默认不启用。
- 文档同步：`AGENTS.md`（分层表三行、web 行、登录入口段、命名空间段、自研边界）、
  `docs/architecture.md`（架构图、业务 app 定义、四区表、§5 矩阵、§9）、
  `vendored/README.md`（下架清单）与 `docs/community-reference.md` 的 vendored 表述。

## Alternatives

- **保留 UI 四包再逐个 bump 到 0.4.2**：与「官方唯一基准」冲突，且要继续维护组装器
  适配层；用户明确不要了。
- **保留 agent-teams**：官方已有 agent-team，重复；且它 peer 逐版本钉死，维护成本高。
- **网关留在实例里**：0.1.7 上功能残缺（settings 集成失效），且与"单一共享网关"决策冲突。

## Consequences

- **UI = 官方原生 + 自研消费层**（focus-session 侧栏关注区、show-me；quick-nav 保留不加载）；
  UI 平台 dsh-desk 与标签行 dsh-focus-tabs 均已整包删除。
- 官方侧栏重新成为可用面：此前记为"未接入面"的**官方侧栏会话行「添加到置顶区」**
  现在可接（待办）。
- 0.1.7 升级的 vendored bump 清单归零（`@linxin666/*` 不再需要 bump）。
- web2 / web(3080) / web5 的侧栏与工具入口回到官方形态；web 的认证网关随下次重启下线
  ——**实例只走官方 token 登录**（此前事实即如此，因 fence 挡反代）。
- `docs/architecture.md` §5 的社区矩阵只剩 dsh-memento（选定未接入）；dsh-prometheus 仍挂起
  （npm 0.1.0 的 peer 精确钉 0.1.0-rc.6，在 0.1.7 上会被 peer 闸门拒）。
- 遗留待办：dsh-memento 装或撤（避免"声明了却不能装"的僵尸条目）；`vendored` 段缺机械闸门。
