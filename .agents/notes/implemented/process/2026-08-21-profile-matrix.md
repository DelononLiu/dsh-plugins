# Agent Note: Profile 矩阵（web / web2 / web3）

Status: implemented

## Problem

发行包需要区分开发/正式与测试环境。用户已有实践（dsh-user、dsh-tabs 在 web2/web3 试装），需要正式化为发行包模板矩阵：单插件隔离测试与多插件集成测试需要不同的环境组合，正式版不能被测试污染。

## Decision

**三个 profile 模板**（`profiles/web|web2|web3/`，各含 package.json + cordis.patch.yml + dsh.lock.json）：

| profile | 用途 | bundles 内容 |
| --- | --- | --- |
| **web** | 开发 + 正式 | 官方基线 + 全部自研（user/channel/console/nav/tabs/my-ui）+ vendored 全家桶（TBD） |
| **web2** | 单插件测试（隔离） | 官方基线（无自研）——测试时 `dsh plugin --profile web2 add <被测>` 临时装入 |
| **web3** | 多插件测试（集成） | 官方基线 + 核心组合（user/channel/console + nav/tabs）——测试时临时增删 |

原则：
- **web 是正式基线**，web2/web3 是测试隔离环境；web 与测试环境互不污染。
- 测试单插件用 web2（最干净，排除其他插件干扰）；测插件协同用 web3（预置核心组合，在其上增删）。
- 版本矩阵锁（dsh.lock.json）三者各自维护，随 rc 整体 bump。

## Alternatives

- 只保留一个 web profile，测试直接在上面装/卸插件——否决：测试会污染正式环境，且单插件问题难隔离排查。
- web2/web3 预置全部插件、只改配置开关——否决：失去了"最小环境"的隔离价值。

## Consequences

- 开发插件默认在 web 环境验证（AGENTS.md 开发模式）；web2/web3 供测试流程使用。
- profiles/ 目录结构从单一模板扩展为三模板矩阵；README/architecture.md/AGENTS.md 目录说明已同步。
- 三个 dsh.lock.json 的 schema 仍属未定项（U2），矩阵落地不依赖它。

相关：[团队发行包定位](2026-08-21-team-distribution-package.md) · [分层架构](2026-08-21-layered-architecture.md)
