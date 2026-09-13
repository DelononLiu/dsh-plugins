# Agent Note: console 实例模型与加固方案（模板 / 版本 / 布局 / 删除 / 事件 / broker 退场）

Status: implemented

## Problem

dsh-console 已实现（`ConsoleService` 2178 行、5 职责 + 3 角色、121 测试），但"实例"这个概念在实现里
同时承载了目录名、profile 名、发行包组合、内核版本四项含义；实例清单还有三个来源（daemon 落盘
`instances.json`、`scripts/dsh-profile.sh` 按名字推导目录、channel 发现），而 console 角色**没有**
持久档案。需求 R1–R7（UI 管理实例、去 broker、跳转、模板、管理事件日志、目录布局、多内核版本）
落地前必须先把这些含义逼到唯一判读，否则每批实施都会返工。

本 note 是一次拷问（5 轮、22 问）后的定稿决策，也是这轮工作的**单点权威**；批次表见本文末。

## 目标清单（验收判据）

| # | 目标 | 判据 |
| --- | --- | --- |
| R1 | UI 创建 / 删除 / 启停 / 重启实例（单机），为多机留口 | 每操作后进程、档案、目录三处一致；**删除请求对 web / 本机 daemon 必须被拒绝** |
| R2 | 不用 broker：直连 + hub/worker，复用 channel | `grep -rn "RELAY_BROKER_URL\|brokerUrl\|brokerStatus"` 归零；多机注册/控制/回执仍通 |
| R3 | 实例列表跳转按钮 | 点「跳转⧉」新标签打开实例地址；离线置灰（已实现，做回归） |
| R4 | 创建时选模板，模板放 `profiles/` | 四个模板名齐；**改模板后已建实例行为不变** |
| R5 | 控制台记录管理事件 | 状态变更操作 + 失败异常入日志；**只读动作不得入日志** |
| R6 | 新实例落 `~/.dsh-home/instance-<名>`，老实例不动 | 注册表列出两套布局；同一实例只出现一处；老实例零重启 |
| R7 | 多内核版本：创建时选、事后可升级 | 档案 `version` 指向池内版本；升级 = 切引用；坏版本自动回滚 |

**Out of Scope**（带触发条件）：权限与端点凭据（`/api/console/*` 免凭据可达）——**上多机前必须重开**；
老实例迁移；模板插件组合调试；插件（自研/社区包）版本升级；内核多版本并存调试。

## Decision

**1. 模板 = 创建时快照。** `profiles/` 是模板库；实例从模板拷贝后自持配置，改模板永不影响已建实例。
档案记 `template` 名 + **创建时模板指纹**（`dsh.lock.json` 的 sha256）。

**2. 模板与版本正交两轴，且版本 = 内核版本。** 模板表达"装哪些插件 + patch"；版本表达"用哪个官方
runtime"（版本号即 dsh 版本号，如 `0.1.2-rc.1`）。**池里只存官方 kernel 与其官方依赖**，不含自研/社区包
——那半边仍随实例安装（与老实例机制一致）。

**3. runtime 池** `~/.dsh-runtimes/<dsh版本>/`：**不可变**（只增不改，就地改会破坏已引用实例）；
**手工导入**（console 提供"导入版本"，不由发布流程自动写）；被实例引用的版本**拒绝删除**。

**4. 布局双轨 + 注册表唯一入口。** 新实例：`~/.dsh-home/instance-<名>/profiles/<模板名>`；
老实例（`~/.dsh-<名>`，自带安装）原地不动。**不做目录扫描**：注册表是唯一入口，老实例由一次
**显式的导入动作**登记（导入是命令，不是自动扫描）；`scripts/dsh-profile.sh` 改为读注册表。

**5. 注册表** `~/.dsh-home/registry.json`：主键 `<host>/<instanceId>`（单机 `host` = 本机，跨主机同名不冲突）。
字段：`id · name · host · home · profileDir · template · templateFingerprint · version · port · role ·
layout(legacy|home) · addr · status`。删除留 **tombstone**（档案不物理消失）。

**6. 删除 = 可恢复归档。** 停进程 → 档案转 tombstone → 目录移入 `~/.dsh-home/.archive/<名>-<ts>`；
归档**只保留最近 20 个**（可配）；恢复**只提供 CLI**。**web（3080）与本机 daemon 禁止删除**。

**7. 升级只换内核版本引用。** 插件组合保持创建时快照（与第 1 条一致）；插件升级不在本轮；
回滚 = 切回旧版本引用（复用既有升级事务：快照 → 滚动重启 → 健康探测 → 失败自动回滚）。

**8. 管理事件并入现有结构化日志**（`Logger.record` JSONL）新增 `category` 字段，复用现有查看器；
记录状态变更操作与失败异常（含 actor、目标、结果），**不记只读动作**；按**总大小 100MB 滚动**。

**9. broker 退场（彻底，不留扩展点）。** 移除 `dsh-profile.sh` 的 `RELAY_BROKER_URL`/`RELAY_SECRET` 与
`DSH_RELAY_*` 注入、channel 的 broker 兜底代码、`brokerStatus` 公共面及其 console 客户端消费
（`ConsoleBadge.tsx` / `ConsolePanel.tsx` / `client/types.ts`——实测调用结果本就被丢弃）。
`DSH_RELAY_AGENT`（实为实例 id 载体）更名 **`DSH_CHANNEL_ID`，旧名兼容读**，因此 daemon patch 与
老实例零改动。传输面 = 直连 + hub/worker，**不预留可插拔后端接口**。

**10. `readLog` 直接改签名（同步 → async），同批同铺。** channel/console/UI/daemon 必须同一批铺开，
混跑旧包会报方法不存在 → **该批回滚 = 整批回滚**，不是单文件回退。

**11. 权限本轮不做**（回环内网信任）。触发条件：上多机前必须重开。

**12. 模板本轮只改名**：`web→master`、`web2→dev`、`web3→explorer`，新建 `minimal`
（= 官方默认：`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`，与 3080 的 bundle 列表去掉
gateway/browser-skill 后的两项一致）；**不留旧名 alias**，文档与技能种子命令同步改。
**内核版本本轮一律不动**（`profiles/explorer` 仍为 `0.1.1-rc.2`），多内核调试留到功能完成后。

**13. UI**：创建向导 = 名称 / 模板 / 版本（**必选，默认最新**）/ 端口 / **主机下拉（默认本机，列出已注册主机）**；
已删除实例**默认隐藏**并另给「已删除」筛选；**列表不展示布局徽标**（并存期靠档案 `layout` 字段判读）。

## 批次表（方案 = 这张表，实现只是执行）

| 批 | 内容 | 覆盖 | 依赖 | 回滚方式 |
| --- | --- | --- | --- | --- |
| 1 | 注册表（`~/.dsh-home/registry.json`）+ 显式导入 + `dsh-profile.sh` 改读注册表 | R6 | — | 删注册表文件即回到现状 |
| 2 | 模板改名 + `minimal` 骨架 + 文档/技能引用同步 | R4 | 批 1 | 目录名与 lock `id/name` 改回（单提交） |
| 3 | runtime 池 + 创建选版本 + 升级切引用 | R7 | 批 1、2 | 档案 `version` 指回旧引用 + 重启 |
| 4 | 删除：归档 + tombstone + 默认实例拒绝 + CLI 恢复 | R1 | 批 1 | 归档移回 + 档案备份 |
| 5 | broker 退场（配置面 + channel + `brokerStatus` + console 客户端 + `DSH_CHANNEL_ID`） | R2 | 与 1–4 无依赖；channel/console 同批 | 整批回滚 |
| 6 | 管理事件（结构化日志 `category`）+ 跨守护 `readLog` 改 async | R5 | 批 1–4 | **整批回滚**（契约变更，同批同铺） |
| 7 | UI 收口：创建向导（名称/模板/版本/端口/主机）+ 跳转回归 + tombstone 筛选 | R3、R1 | 批 2、3 | 前端单提交回退 |

## 实施进度

| 批 | 状态 | 提交 |
| --- | --- | --- |
| 1 注册表 + 双布局发现（含显式导入） | ✅ 完成 | `03b1452` `d422d14` |
| 2 模板改名 master/dev/explorer + minimal | ✅ 完成 | `05577fc` |
| 3 runtime 池（模块/存储迁移/创建引用/升级切引用/UI 版本页签） | ✅ 完成 | `0be43a8` `b25d392` `(3c)` |
| 4 删除（归档 + tombstone + 默认实例拒绝 + CLI 恢复） | ✅ 完成 | `(4)` |
| 5 broker 退场（5a 术语/5b-1 公共面/5b-2 配置面与文档/**5b-3 channel 内部传输路径**） | ✅ 完成 | `de05f4e` `b925f68` `de3fb80` `(5b-3)` |
| 6 管理事件 + 静默失败收口 | ✅ 完成（6a 管理事件；6b `readLog` 改 async + 回环结论回传） | `3ce8fdc` `(6b)` |
| 7 UI 收口（tombstone 筛选 ✅ + 跳转回归待用户 UI 自验） | ✅ 完成 | `(7)` |

## 实施中发现的台账项（回灌，不静默吞掉）

1. ~~**`deployInstance` 的 `ok` 只代表"已下发"，落地失败时仍返回 ok**~~ → **批 6b 已修**：channel 的
   同进程回环此前丢弃 `onControl` handler 返回的 `ControlOutcome`，现已回传（`ControlDispatchResult.outcome`），
   console 据此把守护的拒绝变成 `ok: false`（只认真正的 ControlOutcome，避免把 handler 的其它返回值当结论）。
   跨守护 `readLog` 也从 "fire-and-forget + 空返回" 改为 await + 返回结果/错误（`LogReadResult.error`）。
5. ~~daemon 的 controlPort 3089 被官方 `dsh-sdk-jsonrpc-server` 占用~~ → **误判，已订正**：
   3089 **是**我们自己的控制面，工作正常。当时探测失败是因为帧格式不合规——`method` 必须带
   namespace 前缀（`"console/listInstances"`，见 `startControlServer` 的 `frame.method.split('/')`），
   我只发了 `listInstances` → 命中 `namespace !== 'console'` 分支回 "unknown method"。教训：
   **探测前先从代码确认 wire 格式**，别把"我的请求写错了"当成"对面坏了"。
   该轮保留的真修复：控制端口**不再乐观宣告**——改成 `listening` 事件才报就绪、`error` 事件响亮报错
   （含 EADDRINUSE 提示），并暴露 `controlServerStatus()`（@Remote + HTTP 面）供部署者查证。
4. **删除后 channel 实例表不会自动收敛**（批 7 实测：删除的实例仍出现在实例列表 = 幽灵行）。
   已在 `listInstances()` 按注册表过滤墓碑（注册表是权威源）；注册表不可读时**不隐藏任何实例**
   （宁可多显示，也不静默吞掉）。
3. **全量测试有并发抖动**：`pnpm -r test` 首次运行时 dsh-user 报 2 项失败（`socket hang up`），
   第二次全量运行全绿、单包复跑 29/29——是并行跑包时端口/socket 争用导致的**假红**。
   判读纪律：全量失败先单包复跑确认，别把它当回归（已同步进 `dsh-pre-push-checks`）。
2. `roleDataRoot('daemon')` 在无 `DSH_HOME` 时回落到 `~/.dsh`（正式 3080 home）——已由 `grilling`
   种子清单里那条"无 DSH_HOME 时 fallback 踩 3080 红线"的命令覆盖，实施时按该判据核对。

## 端到端实机验收（2026-09-13，13/13 通过）

脚本 `packages/dsh-console/tests/e2e-acceptance.mjs`（**手动运行**，不进 CI：会向真实池导入版本、
在临时 DSH_HOME 下真建实例并真拉起进程、跑完删除）。用真实代码 + 真实文件系统 + 真实 spawn 跑通：
池导入/重复拒绝/自检 → 模板清单 → 创建（模板 dev + 内核 0.1.2-rc.1，含真实依赖安装 44s）→
三件套 + `cordis.yml` + 官方包软链到池 + 注册表登记 → 被引用版本禁止删除 → 实例进程真拉起 →
删除（归档 + 墓碑）→ 恢复（目录移回）。

验收暴露并修掉的 4 个实机缺陷（单测 mock 掉了文件系统与 spawn，全都看不见）：

1. 模板不带 `node_modules` 与 `cordis.yml` → 建出来的实例起不来（补依赖安装 + cordis.yml）。
2. 模板用 `link:` 协议，npm 不支持（EUNSUPPORTEDPROTOCOL）→ 拷贝后规范化为 `file:`。
3. 我们的包声明官方 peer，npm 默认严格校验 ERESOLVE → 安装**优先 pnpm**，回退 npm + `--legacy-peer-deps`。
4. `templateHome` 语义二义：`listTemplates` 当"模板目录"、`ensureInstanceHome` 当"含 profiles/ 的 home"
   → 清单为空、创建静默走后备骨架。已统一为一个 helper，**兼容两种布局**。

## UI 自验（验收测试，2026-09-13）

在真实 GUI（web2 3082，管理端 console）逐项走查，证据来自语义树观察（截图本模型不可读）。
**通过项**：控制台入口可开；页签 总览/实例/主机/**版本**/日志；版本页签显示池路径 + 导入入口 +
池内 `0.1.2-rc.1`（无引用可删）；实例页签 跳转⧉/停止/重启/⋯/「新建实例」/「已删除」筛选；
创建向导字段 = 名称/端口/目标守护(`host-master`)/**模板(`dev explorer master minimal`)**/**内核版本(`0.1.2-rc.1`)**；
⋯ 菜单 = 「升级到 0.1.2-rc.1」+「删除实例…」；日志页签 = 来源/级别/搜索/**只看管理事件** + 行数统计。

**自验发现并修掉的两个 UI 缺陷**（纯看代码/单测都发现不了）：

1. 页脚仍写死 `broker OK`（broker 已退场）→ 改为 `{实例数} 实例 · {runtime 数} 个 runtime`。
2. 实例列表只有 3 个（channel 发现 + 自身），**注册表里 6 个**——`listInstances` 没有并入注册表
   → 现并入注册表内（非墓碑）实例，未向本管理端注册者记 `offline`（不做乐观在线）。
   复验：页脚 `6 实例 · 1 个 runtime`、总览"实例总数 6（在线 3 / 离线 3）"、daemon/web 出现在列表。

6. **注册表是"读-改-写"且无锁**（自查发现，未修）：所有写入路径都是 loadRegistry() → 改 → saveRegistry()
   （console 的 persistDeployedInstances / deleteInstance 等包装；脚本的 import / remove）。
   文件级写入是原子的（temp + rename，不会写坏），但**并发写者会互相丢更新**——实测场景：终端跑
   `dsh-registry.mjs import` 的同时守护落盘部署清单。当前靠"实际只有一个写者"的自觉，属**未机械化的约束**。
   修法（未做）：注册表加锁文件（open wx + 重试 + finally 清理），两份实现都要加；或把写入收敛到单一进程。
   归属：**待定批次**。


### 独立代码审查（2026-09-13，`ac582ca..HEAD`）与其处置

审查结论：机制面落地、门禁绿；**3 个阻塞项已修**，其余转台账。

已修：
- **守护名推导错**（阻塞，会导致 UI 删除在真实单机派发到不存在的守护）：注册表的 `host` 是**机器标识**
  （hostname，实测 `DELONON-THINK`），与守护 agent 名（`host-master`）不是一回事。改为按 launch 配置的
  `host` → channel 归属 → 档案 host 的优先级解析；并把 `delete`/`restore` 提为一等控制指令（联合类型 +
  HTTP 白名单 + 直连 RPC 的 `remoteLifecycle`），local 模式的限制同步放宽。
- **归档早于进程退出**（阻塞，违反决策 6 顺序）：删除改异步，先停进程并**确认退出**（子进程 exitCode +
  端口释放，上限 5s），超时即放弃归档并显式失败——绝不归档活实例。
- **异步下发谎报成功**（阻塞）：管理事件新增「已受理」态——下发型操作不再记「成功」，真实结果由执行面
  另记一条；`deleteInstance` 的返回文案同步改为「已下发守护 X（异步；完成态见列表/墓碑）」。
- 顺手清理：`void spec` 残留、`DSH_RELAY_AGENT` 不再被**新写入**（只保留兼容读）、e2e 脚本两处假绿判据
  （`||` 二选一、全局 `pgrep`）改为确定性断言（池状态 + 本次实例端口监听）。
- 回归用例：新增 console 角色删除路由（断言派发到 `host-master`、不是 `host-<hostname>`、事件记「已受理」
  而非「成功」）+ 守护不可达时显式失败且目录/档案原样。

转台账（未修，按优先级）：
- **实例启动用的内核来自 PATH/守护自身，而不是它引用的池 runtime**（去掉 e2e 的假绿判据后暴露，**已修**）：
  `daemonStart` 原来用"守护自己的 CLI"（意图是版本一致），但实例档案里的 `version` 于是**只是登记值**——
  实测守护 CLI 0.1.1-rc.2 与池 0.1.2-rc.1 错配时，实例起不来且报 `ctx.userQuestions.registerProvider is not a function`
  （毫无指向性）。改为**池内版本优先**（`~/.dsh-runtimes/<ver>/node_modules/.bin/dsh`），缺 `.bin/dsh` 时回退
  守护自身 CLI 并告警，且每次都记一行"启动 CLI = …（档案版本 …）"。修后严格判据（实例端口真被监听）13/13 通过。

7. 注册表主键 `host/id` 未被查找使用（`findInstance`/`removeInstance` 只按 id）→ 跨主机同名误伤。
8. `instancesUsingVersion` 过滤墓碑 → 删除仅被墓碑引用的版本后，`restoreInstance` 会恢复出悬空软链。
9. `importRuntime` 失败抛异常而非返回 `{ok:false}`；`cp -al` 与来源共享 inode →「池不可变」在来源
   就地改写时不成立（需内容指纹或真拷贝兜底）。
10. `currentRuntimeVersion` 只做前缀比较 → 池根 `/a/.dsh-runtimes` 会把 `/a/.dsh-runtimes-old/...` 误判成版本。
11. `persistDeployedInstances` 对老实例默认写 `layout: 'home'`，与决策 13 的判读口径矛盾。
12. 判据缺测试：R4「改模板后已建实例不变」、R7 升级失败自动回滚、R2 多机注册/回执（当前靠 e2e 脚本覆盖一部分）。
13. 越界项：`restoreInstance` 同时上了 @Remote 与 HTTP 面（决策 6 原写"只提供 CLI"）。**修正决策口径**：
   恢复只提供**命令入口**（@Remote/HTTP，UI 不出按钮）——UI 上仅显示墓碑与归档路径。

### 真机全链路复验（2026-09-13，运行中的 daemon + web2，最新构建）

不是测试桩，而是真守护进程 + 真控制面 RPC + 真实例：

1. `console/deployInstance`（模板 dev + 内核 0.1.2-rc.1）→ **实例真监听 3097**；
   日志一行证到 R7：`e2e-final 启动 CLI = /home/long2015/.dsh-runtimes/0.1.2-rc.1/node_modules/.bin/dsh（档案版本 0.1.2-rc.1）`。
2. `console/controlInstance {command: delete}` → 受理回执「删除已受理（本机守护执行：停进程 → 确认退出 → 归档）」；
   现场核对：端口释放 ✓ / 目录移走 ✓ / 归档 `/…/.archive/e2e-final-<ts>` ✓ / 档案 `deleted` + 归档路径 ✓。
3. 复验中修掉一个真缺陷：本机守护收到 delete/restore 时**不该要求"宿主信息"**（它自己就是执行面），
   原先会回「实例 X 无守护宿主信息」——已改为本地执行（与 @Remote 同实现）。
4. 顺带把 `deployInstance` 补进守护 HTTP 派发链（此前只有 @Remote，CLI/验证驱动不了）。

## Alternatives



- **布局一次性全迁移**：要停 6 个实例、改脚本发现规则、改 AGENTS.md 矩阵、迁档案 → 否决，共存 + 迁移 backlog。
- **目录扫描 + 自动回写**：一个"查看"命令产生写入副作用 → 否决，改显式导入（代价是忘导入就"看不见"）。
- **版本 = 发行包组合（kernel + bundles 整体）**：拷问中出现过并被**否**——池里只有官方 runtime 时该定义
  自相矛盾（见第 2 条）。
- **池 = 按模板组合各装一份**：磁盘 ×（模板数 × 版本数）→ 否决，改池只装官方、自研/社区随实例。
- **模板自带版本快照（`dev@v1`）**：同一版本被多模板重复存、跨模板统一升级退化 → 否决，改正交两轴。
- **删除 = `rm -rf`**：与"管理事件可审计"矛盾且误删不可恢复 → 否决，改归档 + tombstone。
- **保留 broker 兜底代码 / 预留传输接口**：零实现或零使用的抽象长期没人敢动 → 否决，删净。
- **`readLog` 加新方法保留旧签名**：留一轮双面 → 用户选择直接改签名（代价见第 10 条）。
- **本轮收紧权限到 admin**：单机自用摩擦大，真正需要的时机是上多机 → 否决，改为显式 Out of Scope。

## Consequences

- **双机制长期并存**：老实例自带安装（`layout: legacy`），新实例引用 runtime 池（`layout: home`）。
  判读"这台实例长什么样"必须看档案字段；UI 不展示布局徽标（第 13 条）意味着排障时这一步得回命令行。
- **池不可变**：任何"就地改版本目录"的做法都会破坏已有实例；新增版本 = 新目录。
- **`readLog` 改签名**把 channel ↔ console ↔ UI ↔ daemon 绑成一个升级单元，铺开必须整批完成。
- **不扫描**：老实例必须先显式导入一次，否则脚本看不见它——导入是批 1 的必交付动作。
- **待复核的不一致**：`AGENTS.md` 写 `web` = 总控（dsh-console + dsh-channel），实测 3080 的
  `package.json` 依赖只有 `dsh-gateway` + `@wxg-prc-cpg/browser-skill-dsh-plugin`、bundle 为
  base/web-app/gateway/browser-skill（**未装 console/channel**）。收口时与用户确认是改文档还是改实装。
- 其余不一致（console 测试数 121 vs 文档 116/37/124；`profiles/explorer` 内核版本漂移）随对应批次同步。
