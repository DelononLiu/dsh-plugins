# Agent Note: 测试实例 profile 目录名 = 实例名（per-instance profile 命名）

Status: implemented

## Problem

测试环境固定矩阵（2026-08 定：web2/3/4/daemon 各独立 DSH_HOME）最初让三个 web 实例都 boot 同一份 `profiles/web` 拷贝。2026-09-05 迁移到「profile 目录名 = 实例名」但只做了一半：脚本 ENVS、web2 console 的 launch 配置（cordis.patch.yml，实例矩阵权威源）、以及 web3/web4/daemon 的 home（`~/.dsh-webX/profiles/webX`）都已先行切换，**唯 web2 home 的 profile 目录仍是 `web` 未改名**——`dsh --profile <名>` 即 boot `$DSH_HOME/profiles/<名>`，于是 `dsh-profile.sh restart web2` 报 `profile "web2" does not exist`。同时 AGENTS.md / docs/architecture.md 测试矩阵仍写 `--profile web`，文档与实现脱节。

## Decision

- **测试实例 profile 目录名 = 实例名**：web2/3/4 各持自家 home 下 `profiles/web2|web3|web4`（内容同源 web 全家桶，目录各归各实例——console launch 逐实例指向、各自打补丁/升级）；daemon 同（`profiles/daemon`）。
- `dsh-profile.sh` 参数 = 实例名；「web」是 web2 的日常简称（管理端 3082）。
- 发行包模板（repo `profiles/{web,web2,web3}`，含 dsh.lock.json）是**另一层命名**，勿混。
- 补齐迁移：`~/.dsh-web2/profiles/web` → `web2`（内容原样 mv——hoisted node_modules 无绝对路径引用，web3 同法先行验证可行）。
- 同步文档：AGENTS.md 测试矩阵启动列、docs/architecture.md §4 测试矩阵与脚本头部注释，改述为 per-instance 命名。

## Alternatives

- 回滚为三个 web 实例共用 `profiles/web`：需把 web3/web4 home 的 profile 目录改回 web 并重装 node_modules、改回 launch 配置（见 `.rc2.bak` 基线）——与已落地的权威源（console launch 配置 `profile: web2|web3`）和 3/4 个 home 现状矛盾 → 否决。
- 仅把脚本 web2 一行改回 `profile web`：与 console launch 配置（`profile: web2`）及「目录名 = 实例名」模型不一致，留下半吊子 → 否决。

## Consequences

- 测试环境现状：四实例 profile 目录名 = 实例名；`scripts/dsh-profile.sh restart web2|web3|web4|daemon`（别名 web = web2）可用。
- 新增实例流程：建 DSH_HOME → 装同名 profile 目录 → 更新 console launch 与脚本 ENVS。
- 原 3443 冲突项已消除：web2 的 dsh-gateway 已从实例组合移除（网关不随 dsh 实例启动，见 [gateway-standalone-deployment](../architecture/2026-09-05-gateway-standalone-deployment.md)），3443 现归正式 GUI 独占。
