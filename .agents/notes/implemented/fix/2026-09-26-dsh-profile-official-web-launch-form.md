# Agent Note: dsh-profile.sh 认得正式实例的 `dsh web` 启动形态（3080 半升级事故后修复）

Status: implemented

## Problem

两件事叠在一起，共同点是**进程与磁盘上的包不是同一代**：

1. **事故现场**：3080 的进程 07:14 用 `dsh web` 起，09:31 内核包（全局安装 + `~/.dsh/profiles/web`
   依赖）升到 0.1.7-rc.2——旧进程仍在内存里跑升级前的宿主代码，却从磁盘发新版 client bundle
   （served rev `b24ab13fe1a1` = 新 `dsh-client-modules/lib/client.js` 的 sha1）。旧宿主拼的 boot
   manifest 是旧 wire 格式（只有 `rev`/`entries`，**没有 `batches`**），新 client 要求 `batches`
   → 浏览器 `client-modules: boot manifest batches must be an array` + "Failed to load plugins"。
2. **让它无法自愈的盲点**：`scripts/dsh-profile.sh` 的 `is_running()` 只认
   `node …/dsh --profile <p>`，而正式实例 3080 的官方启动形态是 `node …/dsh web`（`dsh web` 的
   默认 profile 就是 web，命令行**不带** `--profile`）。该进程于是对 `status/stop/restart` 全部
   隐形：`restart web` 不会杀它，新进程 bind 3080 失败退出，而就绪判据只看「端口在听 + HTTP 200」
   ——旧进程答的 200 把这个失败误报成「就绪」。

## Decision

- `is_running()` 认两种启动形态：`--profile <p>` 与 `web`（等价 profile web）。形态判据用 **argv
  精确解析**（剥掉 argv[0] 与入口脚本后只看首参），不用宽松 glob——`*dsh*web*` 会把 `dsh web2`／
  `dsh web5` 也算进 `web`。`pgrep` 前缀相应放宽到 `dsh`，包装/gateway 旁支由 argv 解析排除。
- `launch_instance()` 的就绪判据加一条 `kill -0 <pid>`：pid 可能在 `is_running` 与端口判定之间退出，
  「新进程已死、别的进程仍占着端口」不该算就绪。
- 文档与种子同步：AGENTS.md「测试环境」段写明两种形态与三合就绪判据（pid 存活 + 端口监听 + HTTP
  应答）；`grilling` 高危种子追加 19（换包后进程是否重启）。停/重启的自操作防护仍是
  [2026-09-05 那条决策](../fix/2026-09-05-dsh-profile-restart-self-guard.md)，本次不动。

## Alternatives

- **只在启动处用 `dsh web`，脚本不管**：盲点留着——下次换内核重启 3080 仍会「误报就绪 + 旧进程继续服务」。
- **放宽成 `case "$cmd" in *dsh*web*)`**：一个 home 下多实例（web/web2/web5），`status web` 会张冠李戴到 `web2`，错杀风险比现状更大。
- **给 `dsh web` 加别名映射到 `--profile web`**：argv 是上游 CLI 决定的，脚本改不了别人的命令行；只能在**识别侧**兼容。
- **就绪只看端口**：本次事故的第二个陷阱就是它，不重复踩。

## Consequences

- `status/stop/restart web` 能定位 `dsh web` 起的 3080（`stop` 会真的杀掉它），不再出现
  「脚本说 stopped、端口却有人答」的分裂状态。
- 换内核/换包后必须**重启实例进程**才算升级完成；种子 19 是这条的机械查证方式。
- 测试：`scripts/tests/profile-registry.test.sh` 新增一节（伪造 `exec -a "node …/dsh web"` 的进程 +
  假 `DSH_BIN` 记录误启动），修复前红（status 报 stopped、start 误拉第二个进程），修复后绿。
  副作用：红灯路径下 `launch_instance` 的日志是 `/tmp/dsh-$name.log`（按实例名推导），跑旧代码时
  可能截断该实例的临时日志。
