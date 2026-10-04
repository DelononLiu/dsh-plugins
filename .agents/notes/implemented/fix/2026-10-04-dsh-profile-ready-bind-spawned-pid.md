# Agent Note: dsh-profile.sh 就绪判定绑到本次 spawn 的 pid（杜绝「假重启」）

Status: implemented

## Problem

`restart web` 报「未在运行 → 启动 → 就绪 pid=…」，但端口 3080 上仍是几小时前的老进程
（`ss -ltnp` 显示老 pid），脚本报就绪的新 pid 早已因 `EADDRINUSE` 退出（`/tmp/dsh-web.log`
里是 `listen EADDRINUSE`）——**根本没重启**。三个独立缺陷叠出了这个假象：

1. **进程探测不容错**：扫候选 pid 后读 `/proc/<pid>/cmdline`，候选在 pgrep 与读取之间退出
   （ENOENT）时，shell 级重定向报错会打到 stderr（`< file` 的失败 `2>/dev/null` 吞不掉），
   该候选也没被干净地跳过。
2. **只靠 pgrep，不认端口占用者**：正式实例 3080 是官方 `dsh web` 启动形态，**不显式设
   DSH_HOME**；旧代码拿 `DSH_HOME` 环境变量和实例 home 比对，官方形态永远比不中 →
   `is_running` 对 3080 隐形 → 老进程占着端口却被判「未在运行」。
3. **就绪判据能被旧进程骗过**：判据是「某进程活着 + 端口在听 + HTTP 有 200/401」，
   三件事都由**占着端口的老进程**满足，于是新进程已死也算「就绪」（假就绪）。

## Decision

- **进程探测容错**：读 `/proc/<pid>/{cmdline,environ}` 前先判可读（`[[ -r … ]]`），并把
  整块 stderr 重定向兜住 TOCTOU 窗口；ENOENT 候选跳过继续扫，不当「没匹配」也不报错。
- **端口占用者反查**：`find_instance_pid` = argv 形态扫（pgrep）→ 端口占用者反查
  （`ss -ltnp` 取 pid）双路；占用者仍要过 `pid_is_instance`（home + profile 双匹配）。
  身份判据新增回落：进程无 `DSH_HOME` 时按官方默认 `~/.dsh` 认。start/stop/restart/status
  一律用它，不再只靠 pgrep。
- **就绪绑本次 spawn 的 pid**：`launch_instance` 记录 `$!`，就绪 = **该 pid 存活**（排除
  僵尸：`kill -0` 对未回收的子进程仍返回 0）**且** 该端口的占用者就是这个 pid；
  spawn 退出立即判失败，打印 `/tmp/dsh-<名>.log` 尾部并非零退出。别人答的 200/401 不再算数。
- stop 的等待判据也从「pid 不在了」改为「实例端口不再被自己占用」，避免残余进程占端口时
  start 竞态 bind 失败。

## Alternatives

- **只修 home 匹配（认 `dsh web`）**：治不了就绪误报——老进程仍占端口、新进程仍会
  EADDRINUSE，假就绪照旧（这是 2026-09-26 那次同源事故的残留面）。
- **只把 pgrep 前缀放宽**：`dsh` 前缀早就是宽的，漏的是 **DSH_HOME 比对**，不是模式。
- **就绪只等进程退出再超时**：spawn 已退就该立即失败，等满 20s 是把真因（EADDRINUSE）
  埋到超时信息里；即时判失败能立刻给出日志尾部。
- **给 spawn 的进程写 pid 文件**：改运行时契约（官方 CLI 不产 pid 文件），成本高于
  `$!` + 端口占用者两者同时成立。

## Consequences

- `restart web` 真的换进程：老进程占端口时先停掉再起；失败（EADDRINUSE）不再被报成就绪。
- **不碰 3080 即可复现**：`scripts/tests/dsh-profile.test.mjs`（3 项，`node --test`）用假
  dsh/假 pgrep 覆盖三条——候选 pid 消失不误报、端口占用者即本实例（pgrep 失明也认）、
  spawn 死掉不报就绪且非零退出；真机闸门用 web5（3085）跑「旧进程占端口 → restart 换 pid」。
- 排除僵尸后，`pid_alive` 依赖 `/proc/<pid>/status` 的 `State:`；非 Linux 上无 `/proc`
  会回落「只信 `kill -0`」，行为与旧代码一致。
- 相关：[2026-09-26 认 `dsh web` 启动形态](2026-09-26-dsh-profile-official-web-launch-form.md)
  的识别侧修复保留；本次补上「home 回落 + 端口反查 + 就绪绑 spawn」三处，取代不了它。
