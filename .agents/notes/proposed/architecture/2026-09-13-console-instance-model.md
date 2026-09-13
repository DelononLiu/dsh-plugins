# Agent Note: console 实例模型与加固方案（模板 / 版本 / 布局 / 删除 / 事件 / broker 退场）

Status: proposed

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
**内核版本本轮一律不动**（`profiles/web3` 仍为 `0.1.1-rc.2`），多内核调试留到功能完成后。

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
- 其余不一致（console 测试数 121 vs 文档 116/37/124；`profiles/web3` 内核版本漂移）随对应批次同步。
