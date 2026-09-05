# Agent Note: dsh-profile.sh 去 web 别名 + 自操作防护（restart web 误杀管理端修复）

Status: implemented

## Problem

`bash scripts/dsh-profile.sh restart web` 会把 web2（3082 管理端，用户 GUI）重启掉。
两重问题：
1. **静默别名**：canonical() 把 `web` 映射成 `web2`——但 `web` 不是真实实例名
   （无 ~/.dsh-web，实例 = web2/3/4/daemon），restart web 本应报「未知环境」却静默
   动了管理端。别名源自早期「web=web2 日常简称」，与「profile 目录名=实例名」
   模型矛盾。
2. **自杀风险**：若当前 shell 的 DSH_HOME 就是目标实例（如在该实例的终端/GUI 里
   跑 restart web2），脚本 kill 掉的是承载当前命令的进程——自己杀自己。

## Decision

- canonical() 去掉 web→web2 别名：参数只认真实实例名（web2/3/4/daemon），未知名
  直接报错退出（find_env 文案同步）。
- 新增 guard_no_self_operate()：目标实例 home == 当前环境 DSH_HOME 时，stop/restart
  拒绝并提示（改用 start/status 或在实例环境外执行）。
- 文档同步：AGENTS.md 测试环境段——去「别名 web=web2」，加「未知名报错 + 自操作
  防护」描述。

## Consequences

- `restart web` → 「未知环境: web（可用: web2 web3 web4 daemon）」，不再误动 web2。
- 在 web2 环境内 `stop/restart web2` → 自操作拒绝（提示需离开实例环境），防自杀。
- 干净环境（无 DSH_HOME）操作不受影响——status/start/stop 均可正常。
- 用法/注释/usage 文案全面去别名。
