# Agent Note: dsh 实例前台观察启动器——捕获退出信号/原因

Status: implemented

## Problem

测试实例（web2/3/4）偶尔"莫名消失"。`scripts/dsh-profile.sh` 的 start/restart 用
`nohup … &` 后台化并把输出重定向到 `/tmp/dsh-<名>.log`——后台模型把**子进程的致死
信号/退出码吞掉**，无法区分"被 SIGTERM/SIGKILL 杀、正常退出、崩溃"，排查"为何断"
困难。

## Decision

新增独立脚本 `scripts/dsh-run-fg.sh`（不改 dsh-profile.sh），**前台**跑一个实例：

- 复用 dsh-profile 的实例发现（home/profile/port/relay）与防护（自操作：目标
  home==当前 DSH_HOME 拒绝；正式 ~/.dsh web 拒绝；已在运行拒绝）。
- 子进程在后台起、`wait` 拿真实退出码：`0`=正常；`>128`=被信号杀死（`128+信号号`，
  打印信号名，如 15→SIGTERM、9→SIGKILL）；否则=异常 exit。
- 上报存活时长 + 退出瞬间日志尾部；支持 `--log <文件>`（落文件 + `tail --pid` 实时
  终端）、`--loop`（崩溃后自动重拉、每次上报）、`--dry-run`（只打印将执行命令）。
- 前台语义（阻塞、Ctrl-C 停），stdout/stderr 可见于终端。

## Alternatives

- 扩展 dsh-profile.sh 加 foreground 模式 —— 否决（用户选定独立脚本，不动既有
  start/stop/restart 契约）。
- 仅看 /tmp/dsh-<名>.log —— 不足：stdout 抓不到"被信号杀"这一关键事实。

## Consequences

- 查"实例为何断"：在实例外终端跑 `scripts/dsh-run-fg.sh <名> --log /tmp/dsh-<名>.fg.log`，
  前台观察；退出即见信号/退出码/时长/日志尾部。
- 注意事项：自操作防护使本脚本**不能在承载当前会话的实例内运行自身**（如 agent
  会话 host=web2 时不能在前台跑 web2）——需在实例外（无 DSH_HOME）终端执行。
