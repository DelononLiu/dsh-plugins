---
name: dsh-kernel-upgrade
description: Use when upgrading the dsh kernel / official dependency baseline (e.g. 0.1.2-alpha.5 → 0.1.2-rc.1) in dsh-plugins — run the isolated migration + web5 verification flow that does not disturb the running web2/3/4 test environments
---

# dsh 内核升级流程（dsh-plugins）

在 dsh-plugins 升级官方内核/依赖基线（如 rc → alpha / rc → rc）时使用。流程保证**不影响当前运行的 web2/3/4/daemon 测试环境**（它们在全局 rc 内核上，3080 禁令见 AGENTS.md）。

规则来源：[AGENTS.md](../../AGENTS.md)（测试环境矩阵 / vendoring / worktree 流程）+ 2026-08 rc.2→alpha.5 升级实测（见 `.agents/notes/proposed/architecture/2026-08-24-upgrade-012-align-design.md`）。

## 0. 升级前决策

1. **确认目标版本 + 差异性质**：`npm view @deepseek-ai/dsh dist-tags`（latest/next/alpha）。大版本跳跃前先判断是否**架构重构**（如 rc.2→alpha.5 移除 dsh-client-runtime）——重构 ≠ 版本 bump，适配量大。
2. **拉官方目标版本源码**（架构重构必做）：本地 `deepseek-harness` 停在旧 tag → `git fetch origin tag dsh-v<ver>` + 独立 worktree 检出（不碰旧 master）：
   ```sh
   cd /home/long2015/Code/deepseek-harness
   git fetch origin tag dsh-v0.1.2-alpha.5 --depth 1
   git worktree add ../dsh-harness-alpha5 dsh-v0.1.2-alpha.5
   ```
3. **架构调研**（重构时）：对照新版本分层（官方 `docs/subsystems/` + `docs/architecture.md`），产出每自研插件映射（官方已覆盖删自研 / 差异化按官方模式重构）。可用并行子代理研究官方各子系统。

## 1. 代码适配（worktree 分支）

```sh
git worktree add -b feat/upgrade-<ver> ../dsh-plugins-feat-upgrade-<ver>
```

按官方实际 API 迁移（**以目标版源码为准，不猜**）：

1. **版本 bump**：各 package.json 官方依赖 + profiles/web/dsh.lock.json（kernel/bundles）→ 目标版。
2. **核心包移除/改名**（如 dsh-client-runtime 移除）：
   - client 插件 `ClientContext` 从被移除包 → `@deepseek-ai/cordis` 的 `Context`（官方同款）。
   - `dsh.client.inject` 换按需服务（用 slots→ui-renderer、remote→api-remotes、settingsScope→ui-settings、sessions→api-session-controller）。
   - peer 只 `@deepseek-ai/cordis`；devDeps 列类型包；cordis 版本对齐（^4.0.1→^4.0.2）。
3. **类型副作用 import**：`import type {} from '<官方包>/client'`（拉 Context merge）——按官方样板逐包加。
4. **helpers 迁移**（如 settingsNamespace 移除 → 纯字符串命名空间常量 + `import type {} from 'dsh-settings'`）。
5. **错误类型**：RemoteError code 需 merge 官方 `RemoteErrorDetailsMap`（`declare module` 扩展），回执构造用 `new RemoteError(code, msg, details)`。
6. **ctx.remote 去自声明**：第三方 namespace 经 owner 的 `./remote` 工件 module augmentation 并入官方 `ClientRemote`——不自声明 `Context.remote`。

## 2. 依赖安装与类型修复（迭代）

```sh
pnpm install   # 预期失败/警告 → 逐个修
pnpm typecheck # 编译器驱动：报错 → 查官方源码 → 修
```

**官方 npm 漂移处理**（大版本常见）：官方包间 peer 版本不一致（部分包仍引旧 core）→ `pnpm-workspace.yaml` override 强制单实例 + 归一到目标版：
```yaml
overrides:
  '@deepseek-ai/dsh-typert-protocol': link:./packages/typert-protocol  # 单实例
  '@deepseek-ai/dsh-session': 0.1.2-alpha.5   # 官方漂移包归一到目标版
```
**声明合并污染**（同名 ctx.x 被 host 类型覆盖）：官方分编译面（tsconfig client/host）隔离；单 tsconfig 插件用**局部最小契约**绕过（`ctx.x as LocalInterface`）。

验收线：全 workspace typecheck 全绿 + 测试全过（`pnpm typecheck && pnpm test`）。

## 3. 隔离验证（web5——不动 web2/3/4）

1. **独立 alpha CLI**：`mkdir ~/dsh-alpha5-cli && cd 那里 && npm install @deepseek-ai/dsh@<ver>`（不装全局——web2/3/4 共用全局旧内核）。
2. **web5 home**：`mkdir ~/.dsh-web5 && cp -r ~/.dsh-web2/profiles/web ~/.dsh-web5/profiles/web`，改：
   - 自研依赖 `link:` → worktree 的 packages
   - webserver 端口 → 3085、gateway 端口 → 3445（避开 web2 的 3082/3443）
   - profile `@deepseek-ai/dsh-tools` → 目标版（旧版与内核不兼容会崩）
3. **启动**：`env DSH_HOME=~/.dsh-web5 <alpha-cli>/dsh --profile web --no-open`（无浏览器环境用 curl 验证）。
4. **验证清单**：
   - [ ] 页面 200（`curl -L "http://127.0.0.1:3085/?token=<boot-token>"` 取 cookie → 带 cookie 访问）
   - [ ] 自研 host API（如 `console /api/console/instances` 返回真实数据）
   - [ ] **bundle 路径注意**：新版本可能改格式（rc.2 `?rev=` → alpha.5 `??<id>/client.js&rev=`）——从页面 boot 图提取完整 URL 验证自研/官方 bundle 200
   - [ ] vendored 全家桶兼容（不兼容 → 查新版：全家桶常随内核发新版，如 0.2.9→0.3.12 适配 alpha.5）
5. **隔离确认**：验证期间 web2/3/4 全程健康（`curl` 各端口 200）。

## 4. 通过后铺开（逐环境，不停机）

1. worktree 自检通过（dsh-pre-push-checks）→ 合入 main（原子 merge，typecheck 全绿）。
2. **逐环境切 alpha CLI**（各环境独立 DSH_HOME，与正式内核解耦，可不停机逐个切）：
   - 更新 `~/.dsh-<env>/profiles/<p>/package.json`：自研 `link:` → **worktree 路径**先验证 → merge 后**切回 main 路径**；删已合并/已删包的残留依赖（如 dsh-console-ui/dsh-nav）；`@deepseek-ai/dsh-tools` → 目标版（`<alpha-cli>` 的 node_modules 无法直接 serve——必须 profile 自己装）。
   - 在 profile 目录 `pnpm install`（⚠️ 别在仓库根跑——装错位置，daemon 曾因此炸 dsh-tools/dsh-llm 版本错配）。
   - 重启该环境：`env DSH_HOME=~/.dsh-<env> <alpha-cli>/dsh --profile <p> [--no-open]`，验证 0 错误 + 管理端视角该实例 online。
3. **全部切完后收尾**：`scripts/dev-test-env.sh` 的 `DSH_BIN` 指向 alpha CLI；删 worktree（`git worktree remove` + `git branch -d`）；`AGENTS.md` 同步内核版本/矩阵/登录入口事实。
4. lock/依赖已在步骤 1 bump——确认 profile 模板一致。
5. **回滚预案**：单环境秒回 = 换回旧 CLI + 还原 package.json 备份（`pnpm install` 前先 `cp package.json package.json.<旧版>.bak`）。

## 常见坑（2026-08 实测）

- **架构重构**（如 runtime 包移除）不是版本 bump——先调研官方新分层再动手。
- 官方 npm 发布常有 core 漂移（部分包旧 peer）——override 归一是标准解。
- 全家桶 vendored 锁旧版会在新内核崩（rc.2 API）——查全家桶是否有适配新版（engines.dsh 字段）。
- bundle 路径格式随内核变——从页面 boot 图取真实 URL，别猜。
- client 插件类型污染（host 类型泄漏）——官方靠 tsconfig 分面隔离，单 tsconfig 用局部契约绕过。
- **alpha.5 起官方 client-connection 给 web 加 BrowserAuth fence**（`?token=` 换 cookie，无用户/角色）——自研 HTTPS gateway 反代会 401（登录成功也进不去），需官方会话桥（见 `.agents/notes/proposed/architecture/2026-09-03-alpha5-auth-official-token-vs-user-login.md`）。
- **typert-protocol vendored 不可移除**：typert generator 的 `isTypeMetaSymbol` 要求 `@Remote` 符号声明位于 **workspace 注册包内**（registrationForFile 命中）——npm 版声明在 node_modules 里不命中 → 报 "publishes Remote artifacts but has no Remote methods"。vendor 保留 + `tsconfig.host.json` paths/references 指向它。官方若内置了同内容（rc.1 已含 remote-error），vendor 只是构建期镜像，仍不能删。
- **vendoed 同步官方源码**：升级后对比官方 tag（`packages/typert/protocol/src`）与本地 vendored src，diff 一致即无需动；不一致则用 `git archive dsh-v<ver> packages/typert/protocol/` 同步。
