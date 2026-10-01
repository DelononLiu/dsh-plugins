# Agent Note: 内核新版本自动检测（开发侧闸门 + 管理端只读展示）

Status: implemented

## Problem

发行包的版本轴是官方内核（`docs/architecture.md` §4：内核 rc.x + 自研 x.y + 社区 a.b
的锁定组合）。但**没有任何地方去发现官方发了新版本**——基线只在人记得去看时才会
被推进，事实是它确实落后了：仓库四个模板锁 `0.1.7-rc.2`，而 npm `latest` 已是
`0.2.0-rc.2`（检测脚本首次运行即报出）。

两类消费者各缺一半：

- **维护者**：升级流程（[dsh-kernel-upgrade](../../../skills/dsh-kernel-upgrade/SKILL.md) skill，含隔离实例验证）
  齐全，但缺"该不该升级"的入口判据——只能靠人定期跑 `npm view`。
- **管理端**：升级引擎（[unified-upgrade-engine](../architecture/2026-09-04-unified-upgrade-engine.md)）
  已实现快照/对齐/重启/回滚，`upgradeInstances(ids, version)` 的 version 却是**调用方
  传入的记录值**，没有任何版本来源。UI 侧更直白：升级对话框的目标版本写死
  `"0.1.2-rc.1"`（落后当时基线两个版本）。

约束：**升级 = 发行包整体推进**（不散装升级），且内核升级会重启实例、改变插件
兼容面——发现与执行必须分开，检测**不得**触发任何写操作。

## Decision

检测 = **只读报告**，两侧各自落点，都不自动升级：

1. **开发侧闸门** `scripts/check-kernel-version.mjs`（`pnpm kernel:check`）：
   基线读 `profiles/*/dsh.lock.json` 的 `kernel`；向 npm registry 查
   `@deepseek-ai/dsh` 的 dist-tags 与版本清单；报出高于基线的版本并指向升级
   skill。两种模式：无参数 = 报告（总是 0）；`--check` = 闸门（有新版本**或**
   仓库内漂移 → 1）。退出码 2 专表**检测失败**（registry 不可达/响应不可解析），
   不让"没查到"冒充"没有新版本"——这是本类工具最容易骗自己的地方。
   同一脚本顺带做仓库内漂移检测：各模板 `kernel` 是否一致、官方 bundle 版本
   是否等于同模板的 kernel（版本锁是人写的，靠自觉对齐必然漂）。

2. **管理端只读展示**（`dsh-console`）：新增 `checkKernelUpdate(refresh?)`
   @Remote 方法——比较**本机 runtime 池最高版本**与 npm `latest`，结果落盘缓存
   （TTL 内秒回，`refresh` 强制重查），网络失败只回 `error` 字段，不改任何状态、
   不预填升级目标。版本页签展示「官方最新 / 本机池最高 / 检测时间」，人工决定
   是否走升级流程。

## Alternatives

- **检测到就自动升级**：否决——内核升级要过隔离实例验证与 peer 兼容面
  （`verify-kernel-upgrade.sh`），无人值守自动推进会把"能跑"换成"看起来新"。
- **只做 DEV 侧脚本 / 只做管理端**：否决——维护者看得到、用管理端的人看不到，
  两个缺口都真实存在（前者决定基线推进，后者决定实例何时对齐）。
- **管理端直接查 registry 并允许选版升级**：否决（本期）——升级 v1 的 version
  参数是记录值，且多版本发行包源是二期；预填一个本机并不存在的版本会往
  `.dsh-release.json` 写入不实记录。展示与执行解耦，等二期发行包源到位再接。
- **把检测塞进 CI/hook**：否决——仓库无 CI，且网络依赖的检查放进 pre-push 会
  把"网络抖动"变成"拦人"；`--check` 保留为显式调用。

## Consequences

- 基线落后从"没人知道"变成"一条命令可见、可闸门"：`pnpm kernel:check --check`
  退出 1 可直接当发布前检查项（非零即待处理）。
- 管理端只报告，不改变升级路径的任何语义。顺带修掉同一处的过期事实：升级对话框的
  目标版本原为写死的 `0.1.2-rc.1`（落后当时基线两个版本），改为**本机池派生**
  （池最新版本；池不可用时回落实例已记录版本 = 引擎 v1 的"重新对齐源"语义）。
  不预填 npm latest——v1 的 version 是记录值，预填本机不存在的版本会往
  `.dsh-release.json` 写不实记录。
- 检测语义边界要记住：`latest` 是官方 dist-tag（当前为 rc），"有新版本"不等于
  "应该升级"——是否推进仍由人按 skill 流程判。
- 缓存文件落在 runtime 池旁（TTL 6h），不污染实例配置；池不可用时检测退化为
  「本机版本未知」，不报假绿。

## 测试

- `scripts/tests/kernel-version.test.mjs`（14 项，`node --test`，网络全部注入）：
  版本序（预发布 < 正式、rc.2 < rc.10、alpha < rc）、只留严格高于基线、dist-tag
  命中、两类仓库漂移、报告渲染、四种退出码路径（报告 0 / 有新版本 1 / 漂移 1 /
  检测失败 2）、参数缺值。
- `packages/dsh-console/tests/kernel-update.spec.ts`（17 项，vitest）：版本序、
  池版本降序、latest 检测与 `next` 回落、本机已最新不谎报、池为空时不下结论、
  TTL 缓存命中不再打网络、**池变则缓存失效**、`refresh` 绕过缓存、检测失败 →
  `error` 且 `latest=null`（**不得**当已是最新）、失败也进短 TTL 缓存、5xx 与
  残缺响应各自报错、缓存文件内容可审计、池目录不存在时检测不凭空造池。
- 真实环境一次：`node scripts/check-kernel-version.mjs` 报出 `0.2.0-rc.2`（`latest`）
  高于基线 `0.1.7-rc.2`，`--check` 退出 1。
- 全仓：`pnpm build` / `pnpm typecheck` 通过；`pnpm test` 435 项全绿（console 191）。
