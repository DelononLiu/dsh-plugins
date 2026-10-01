# Agent Note: 内核升 0.1.7-rc.2 —— web5 隔离验证与设置模型迁移

Status: proposed

> 部分失效（2026-10-01）：dsh-desk / dsh-focus-tabs 已整包删除，本 note 中针对二者的
> 设置模型迁移条目不再适用——见 [drop-desk-and-focus-tabs](../../implemented/architecture/2026-10-01-drop-desk-and-focus-tabs.md)。

## Problem

官方内核从本仓基线 `0.1.2-rc.1`（2026-09-03）走到 `0.1.7-rc.2`（2026-09-24，npm
`next` 通道；`latest` 通道停在 `0.1.5-rc.3`），5140 提交。隔离试跑（见
`~/.dsh-web6/TRIAL-0.1.7-rc.2.md`、`~/.dsh-web5/TRIAL-0.1.7-rc.2.md`）实测出三个
硬断点：

1. **peer 兼容性闸门**（新）：`dsh plugin add` 预检 + profile 启动都对
   `@deepseek-ai/dsh*` peer 做 `semver.satisfies(runtime, range, {includePrerelease:true})`
   校验，不满足则安装被拒 / 启动时按行禁用。本仓的**精确 pin**
   （`@deepseek-ai/dsh-typert-protocol`、`@deepseek-ai/dsh-api-gateway` = `0.1.2-rc.1`）
   全部不合格（`^0.1.2-rc.1` 反而合格）。
2. **typert 工件格式变更**：TYPERT `{name, schema}` → `{name, create()}`；旧 generator
   产物被 loader 直接拒（`has no create() factory`）。给 exemption 绕过闸门后
   dsh-channel 的 Remote 全链路仍然炸——**只重打 pin 不够**。
3. **设置模型重构**：`ctx.settingsScope` / `ctx.settings.register(ns, schema)` 删除，
   改为「设置 = 插件自身 Config 的 volatile 字段 + profile 条目 id」，client 侧
   `ctx.configForms.get<T>(entryId)`。另 `ctx.uiSession.pendingInteractions`
   删除，改为 `ctx.uiSession.sessionStatus`（每会话单一 `pendingInteraction`）。

## Decision

- **基线**：所有包的 `@deepseek-ai/dsh*` peer/dev 依赖 → `^0.1.7-rc.2`，`@deepseek-ai/cordis`
  → `^4.0.4`，`schemastery` → `^3.18.4`；root `dsh-typert-generator` → `0.1.7-rc.2`。
  `pnpm-workspace.yaml` overrides 归一到 0.1.7-rc.2（`dsh-agent-presets` 已在 0.1.7
  更名，删该条）；`pnpm-lock.yaml` 重新完整解析（官方 npm 漂移会残留 0.1.1-rc.2，
  删 lock 重装即全绿）。
- **tsconfig**：`target` ES2022→ES2024，显式 `lib: [ES2024, DOM, DOM.Iterable,
  ESNext.Disposable]`（vendored protocol 的 `owned-value.ts` 用 `Disposable`/`Symbol.dispose`；
  只加 target 不加 lib 不够）。
- **vendored typert-protocol 同步官方 0.1.7-rc.2 源码**（`git archive` 取
  `packages/typert/protocol/src`，含新增 `json-value.ts`/`owned-value.ts`），新增
  依赖 `@deepseek-ai/dsh-brand`（type-only）。构建期镜像不变、仅源码跟进。
- **设置模型迁移**（4 个 client 插件）：
  - dsh-desk：`Config.layout/.assembler` 标 `volatile()`，删 `my-ui-layout` 命名空间
    与 `LayoutSettingsSchema`；client 改 `ctx.configForms.get('dsh-desk')`。
  - dsh-focus-session：`pinned`/`tags` 成为本插件 `Config` 的 volatile 字段，删
    `dsh-focus-pinned`/`dsh-focus-tags` 命名空间（及遗留 `dsh-tabs-pinned` 迁移）；
    client 改 `ctx.configForms.get('dsh-focus-session')`。
  - dsh-focus-tabs / dsh-quick-nav：只读消费同一份表单（按条目 id 跨插件读，与旧
    命名空间字符串等价）——**条目 id 即命名空间**，故 profile 的 insert 行 id 必须
    是 `dsh-desk` / `dsh-focus-session`（本仓 profile 已如此）。
  - 各 host 面 `ctx.settings.configure({ auto: false }, ctx.fiber)`（官方同款：自绘
    UI 的插件不生成自动设置页）。
  - `pendingInteractions` → `sessionStatus.getSnapshot()` / `.subscribe()`。
- **version lock**：`profiles/*/dsh.lock.json` 的 kernel/base/web-app → 0.1.7-rc.2。
- **验证环境**：web5（`~/.dsh-web5`，3085）用独立 CLI `~/dsh-017-cli`（
  `@deepseek-ai/dsh@0.1.7-rc.2`），自研 7 包 link 到 worktree 构建产物，3080 全程未动。

## Verification

worktree `feat/upgrade-0.1.7`：`pnpm -r build` / `typecheck` / `test` 全绿
（440 测试：channel 38 / console 174 / desk 25 / focus-session 101 / focus-tabs 24 /
quick-nav 6 / plan-show 43 / user 29）。

web5（内核 0.1.7-rc.2）实跑：

- 启动日志**零 peer 闸门禁用、零 typert loader 错误**；`[dsh-console] console 角色：
  webServer 可用，注册控制端点`（typert 新形状生效）。
- 页面 200；boot 图 72 模块，自研 7 个 client 包全部在图中。
- host API：`/api/console/instances` 200（真实实例表 + hosts）、
  `/api/quick-nav/instances` 200、`/api/user/me` 200（身份）。
- `--dump-config-schema`：自研 7 条目全部出现、88 处 volatile（官方
  `dsh-agent-preset` 条目自身报 `unrecognized Loader tree carrier`，与本仓无关）。

## Alternatives

- **只重打 pin + 授 exemption**：实测不够——typert 工件仍被拒（web6 试跑证据）。
- **保留自定义 settings 命名空间**：官方 0.1.7 已无该 API，无法注册 schema，命名空间
  不再是可寻址条目。
- **把 vendored 全家桶一起 bump（@linxin666 0.4.2 / better-sidebar 0.21.1）**：本轮
  未做——web5 未纳入该集合，避免把未验证的组合写进模板。

## Consequences

- 自研栈在 0.1.7-rc.2 上可用；3080（`~/.dsh`）/ web2 未动，回滚 = 换回旧 CLI。
- **旧设置数据未自动搬家**：0.1.7 把 `settings.yaml` 改名为 `settings.yaml.imported`
  并把能对上**条目 id** 的段写进 profile patch；旧段名（`my-ui-layout`、
  `dsh-focus-pinned`、`dsh-focus-tags`）不是条目 id → 置顶列表/标签/布局偏好不会自动
  迁入新 Config 字段，需一次性导入（待办，见下）。
- 0.1.7 启动会**改写** profile 的 `cordis.patch.yml`（YAML 风格归一 + 追加
  `agent-default-model`/`ui-settings-general`/`permission` 三行）并新建 `cordis.yml`
  ——手维护的 profile 文件从此会被程序写入，模板/运维脚本需按此预期。
- 社区网关 `dsh-gateway` 1.6.0（npm 最新 1.7.0 同）仍调 `scope.settings.register`，
  在 0.1.7 上退化为「仅 composition 配置」（设置页/持久化失效）——上游待适配。
- 未验证项：客户端半区在浏览器内的实际激活（无浏览器工具，需人工开 3085 看顶栏/
  关注区/tab 行）；工具调用冒烟（web5 无 provider 凭证）；vendored 全家桶 bump；
  `scripts/verify-kernel-upgrade.sh`（其矩阵按 link→main 判定，铺开后才适用）。
