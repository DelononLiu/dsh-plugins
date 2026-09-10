# Agent Note: dsh-profile.sh 动态发现模型（去硬编码清单）

Status: implemented

## Problem

dsh-profile.sh 原以 ENVS 硬编码四实例（web2/3/4/daemon + 各自 port/relay）。用户指出
这不对："profile 不是写死 web2 web3 web4，而是根据传的名字去找，校验 OK 了就重启"。
现状也证实：~/.dsh-web5/6/77 等多实例已存在（虽老布局），写死清单无法覆盖。

## Decision

脚本改为**动态发现模型**（不写死实例清单）：
- 参数 = 实例名 → `home=$HOME/.dsh-<名>`；
- 校验 per-instance 布局：`<home>/profiles/<名>` 存在（老布局 profiles/web 不认，
  报错提示——见 web5/6/77 教训）；
- **port 从该实例自己的 `cordis.patch.yml` 读**（webserver.config.port 段）——
  每实例端口各自配置（web2=3082、web3=3083、web77=30123…不能猜）；
  daemon 无 webserver = headless（port 空）；
- relay agent：daemon 特判 host1，其它 = 实例名（web3 → DSH_RELAY_AGENT=web3）；
- 未知名/布局非法 → 报错退出（延续：不设别名、不静默操作）。
- status 动态扫描 `~/.dsh-<名>/profiles/<名>` 全量。
- 自操作防护保留：目标 home == 当前 shell DSH_HOME 时 stop/restart 拒绝。
- **启动环境清洗**：`env` 只叠加、不清除，因此启动前显式剔除会话/宿主作用域变量
  （`DSH_SESSION_ID`/`DSH_SESSION_JSONL`/`DSH_SHELL`/`DSH_WEB_URL`/`DSH_WEB_MODE`）——
  否则从 agent shell 里执行 start/restart，**调用方自己的**会话变量会进实例。
- **restart 的 env 继承只取实例作用域**：保留 provider 凭证（`*_API_KEY` 等）与 relay
  配置；会话/宿主变量与 shell 噪声（PATH/HOME/TERM/VSCODE_/WSL/XDG_/CLAUDE_ 等）剔除。
  前缀项必须写成 `PREFIX.*`——锚定的 `^PREFIX=` 只匹配完全同名变量（这正是旧过滤器的坑）。
  摘要只打印**变量名**：值可能含凭证，不进终端回滚缓冲。
- **启动后等待就绪**（`READY_TIMEOUT`，默认 20s）：轮询「进程在 + 端口监听」（headless
  只看进程），就绪打印 `就绪 pid=… port=…（监听）`；超时打印日志尾部并以非零退出。

## Alternatives

- 保留 ENVS + 动态兜底：两套来源规则并存，认知负担高、优先级易混 → 否决。
- 兼容老布局（profiles/web）：web5/6/77 是历史遗留，per-instance 是目标态，
  兼容会延续混乱 → 否决（报错明确提示布局要求）。

## Consequences

- 新增实例流程 = 建 `~/.dsh-<名>/profiles/<名>`（内容可拷自有实例），脚本即识别，
  无需改 ENVS。
- awk 读 port 必须整体单引号（双引号内 `$0` 会被外层 shell 展开成空 → 语法错，
  已踩坑修正）。
- 默认无参数仍操作已知四实例（daemon web2 web3 web4）；其余需显式点名。
- 曾现网缺陷（2026-09 修）：旧过滤器写成 `^(…|CLAUDE_|XDG_|DBUS_)='`（精确匹配而非前缀），
  `DSH_SESSION_*`/`DSH_WEB_URL`/`DSH_SHELL` 全部漏进新实例——实测 web3 进程带着 web2 的
  `DSH_SESSION_JSONL`（指向 `~/.dsh-web2/sessions/…`），它派生的 shell 会把别的实例的会话
  当成自己的，破坏「测试环境目录隔离」。两条泄漏路径（旧进程继承、调用方 env）都已堵住。
- restart 不再「一下就过去」：成功与失败都有明确结果行，失败附日志尾部。
