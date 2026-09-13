---
name: grilling
description: Grill the user relentlessly about a plan or design. Use when the user wants to stress-test a plan before building, or uses any 'grill' trigger phrases.
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing. Asking multiple questions at once is bewildering.

If a *fact* can be found by exploring the codebase, look it up rather than asking me. The *decisions*, though, are mine — put each one to me and wait for my answer.

Do not enact the plan until I confirm we have reached a shared understanding.

## 本项目必问的高危种子（dsh-plugins）

先自由拷问设计树；以下种子是**本仓库反复复发**的高危面，按复发频率排序。每条都要么被代码/文档回答（**去跑命令，别问我**），要么作为一个问题问出来。与本次改动无关的种子跳过，但**跳过要有理由**。

**每条种子先跑它的查证命令**，把实测输出当作提问前提。命令块里的路径都是本仓库语境；换成别的仓库时按注释改。

**命令判读规则**：命令**报错**（stderr 非空、退出码非 0）≠ clean——那说明命令没跑成，先修命令再谈结论。空 stdout 也只在命令确实跑过之后才算 clean。

### 1. 内核基线假设

这个改动是否依赖某个内核版本的具体行为？升到下一版会破在哪？

```sh
grep -rn '"@deepseek-ai/[^"]*": "0\.' packages/*/package.json | grep -v '\^'   # 精确锁 = 升级时必须逐条核对
grep -rn '"@deepseek-ai/' packages/*/package.json | sort | head -40            # 带文件名：哪个包依赖什么
grep -rn '"kernel"' profiles/*/dsh.lock.json                                  # 基线权威源（模板锁，不是 package.json 的推测）
```

已知破面（0.1.2-rc.1 → 0.1.3-alpha.1）：session 格式 v2 自动迁移、`agentLoop` 转 async、flock 会话锁——
见 `../../../docs/research/2026-09-05-kernel-0.1.3-session-breaking-impact.md`。

### 2. 内核包双实例

是否给自研包新增了**承载 Symbol 键服务**的内核包依赖（`dsh-tools`/`dsh-session`/`dsh-llm` 之类）？
Symbol 跨模块实例不共享，双实例 = 工具调用崩（`ctx.tools[scheduler].prepare` undefined），且纯聊天
冒烟测不出来。注意 `@deepseek-ai/schemastery` 是普通库、进 `dependencies` 正常——别一刀切成"禁止一切 @deepseek-ai/"。

```sh
# 本仓库：自研包是否显式依赖内核服务包（`packages/*` 不存在时 grep 会报错——那是"命令没跑成"，不是 clean）
grep -l '"@deepseek-ai/dsh-\(tools\|session\|llm\)"' packages/*/package.json 2>/dev/null || echo clean
# 通用：内容相同的源文件副本（>=200B）——同一份 Symbol()/契约定义两次 → 身份不相等
find . -path ./.git -prune -o -path '*/node_modules' -prune -o -type f \
  \( -name '*.ts' -o -name '*.js' -o -name '*.mjs' \) -size +200c -print0 \
  | xargs -0 md5sum | sort | awk '{c[$1]++; f[$1]=f[$1]" "$2} END{for(h in c) if(c[h]>1) print "重复副本:"f[h]}'
```

判读：命中的副本里，凡是参与**身份/契约标识**的（Symbol 键、服务名、常量枚举、单例状态）都是双实例
风险的来源——两份定义互不相等。本仓库实见：`focus-session` 与 `focus-tabs` 各有同名 `session-status`
副本（当前只读数据、不参与身份，属可接受；一旦它承载 Symbol/服务键就立刻变成高危）。

**同类风险不限内核包**：任何"两份逐字节相同的模块副本"都会造成同样的身份不匹配（同一份 `Symbol()`
定义两次 → 不相等）。看到新目录里出现与既有模块内容相同的副本，就当种子命中。

### 3. 实例作用域与目录隔离

改动读写了 `DSH_HOME` / sessions / settings / storages 吗？会不会串到别的实例（web 3080 / web2 3082 /
web3 3083 / web4 3084 / daemon headless）？端口从哪来？

```sh
# 换成实际包名——写 <pkg> 会被 shell 当重定向，命令静默失败（stdout 空、退出码 0，看着像 clean）
grep -rn 'DSH_HOME\|process\.env\.DSH_\|dshHome' packages/dsh-console/src | head -30
grep -rn 'roleDataRoot\|homedir()' packages/*/src | head -20        # 无 DSH_HOME 时 fallback ~/.dsh = 直接踩 3080 红线
grep -rn 'webserver' profiles/*/cordis.patch.yml scripts/dsh-profile.sh | head -20   # 端口权威源只在这里
```

判读：端口**必须**从目标实例自己的 `profiles/<profile>/cordis.patch.yml` 的 `webserver.port` 读
（与 `scripts/dsh-profile.sh` 同源）。管理端 `launch.*` 里**没有 port 字段、只有 addr**（端口藏在字符串里）
——用 addr 反解端口就是"猜"，与配置不一致时必须报黄，不能给假绿灯。

### 4. 3080 禁令

是否需要触碰正式 web（`~/.dsh/profiles/web`）的配置或端口？

```sh
grep -rn 'role: console' profiles/*/cordis.patch.yml     # 哪个模板是总控（3080）；其余是测试场
```

需要碰 3080 就停下问：实现与验证一律走独立 `DSH_HOME` + 独立端口；"部署到 3080"必须是用户手动执行的独立动作。

### 5. 数据面权威源（UI 到底读谁）

"写回档案 → UI 就能看见"这类隐含前提，**先查 UI 的数据是从哪来的**。本仓库踩过：console 档案是进程内
内存态，UI 读的是 channel 实例表，`registerHost/listHosts` 没有生产调用方——写进档案在 UI 上是零效果。

```sh
grep -n 'channel.list()\|listInstances()\|setInstanceRecord(' packages/dsh-console/src/index.ts
grep -rn 'registerHost\|listHosts' --include=*.ts packages/ | grep -v tests   # 无生产 caller = 死档案
```

### 6. 状态写入者冲突

要新增一个状态（健康/可用/降级…）时，先数清**已有的写入方**：本仓库 channel 的 status 有
`declare` / `heartbeat` / `setStatus` / worker 注册覆写四个写入方，UI 侧还有 offlineOverride。不说清
优先级，多个写入方必然互相覆盖。

```sh
grep -n 'setStatus(\|heartbeat(\|declare(\|offlineOverride' packages/dsh-console/src/index.ts packages/dsh-channel/src/index.ts
```

优先复用既有字段还是新开字段？——注意 `InstanceRecord.health` 已被"升级结果"占用（`'upgraded'|'rollback'`），
语义冲突要靠改名消歧，不能两种含义共用一个字段。

### 7. 内存态 / 持久化幻觉

新写的数据落在内存还是磁盘？进程内实现重启即失忆（本仓库 console 档案与 inbox 均为内存态 v1）。

```sh
sed -n '1,20p' packages/dsh-console/src/index.ts          # 包注释里会写"进程内实现/持久化后续"
grep -n 'instances.json' packages/dsh-console/src/index.ts  # 已经落盘的那一份长什么样
```

### 8. 增量闸门（已有能力，先问增量在哪）

计划里的能力，**先确认仓库里是不是已经有了**，否则会重复造：console 已有 15s `fetch(addr)` 可达性探测 +
daemon 启动端口对账（`isPortFree`）+ UI 10s 轮询。

```sh
grep -n 'PROBE_INTERVAL_MS\|reconcileInstances\|isPortFree\|REFRESH_LIST_MS' \
  packages/dsh-console/src/index.ts packages/dsh-console/src/client/ConsolePanel.tsx
```

### 9. 回滚路径

出问题时怎么回到改动前？给出**确切命令**，并要求它非破坏性（不覆盖现场）。

```sh
git worktree list && git log --oneline -3    # 分支态：worktree remove / git revert
```

实例跑的是 `lib/`——回滚代码后**不重建产物等于没回滚**（`pnpm build`）；要停掉常驻行为，最好有 kill switch
（默认 off），别让"出问题只能改代码"。

### 10. 文档同步与陈旧文档

这次改动会让哪些文档/Agent Note 变成谎言？

```sh
grep -rn '属性：\|档案字段' docs/architecture.md | head            # 字段清单
grep -rn '测试' docs/architecture.md AGENTS.md | grep -E '[0-9]+ 测试'   # 测试数字常已陈旧
```

"陈旧文档 = 污染源"：同提交内修。顺带核对文档里的**数字**（测试数/端口/版本）——实测经常早就是错的。

### 11. UI 以官方为基准

改了 UI 吗？官方对应组件是哪个？**官方没有对应组件时不要硬找一个"照抄"**——那就照官方的语义变量与
形态约定做，并把这个判断写成决策。

```sh
grep -rn 'state-.*-primary' packages/*/src/client/*.css.ts | head    # 本仓库用的官方语义变量
ls /home/long2015/Code/deepseek-harness/packages/client/ | head      # 官方组件清单（找最接近的等价物）
```

默认直接照抄官方（DOM 结构 / CSS 机制 / 属性值），不手写近似——
见 `../../notes/implemented/process/2026-08-22-ui-official-alignment.md`。

### 12. 一套概念模型

是否引入插件私有模型（身份 / 主机 / 实例）？新依赖方向是否严格向下（业务 app→UI→管理组件→系统→内核）？

```sh
grep -n 'HostRecord\|InstanceRecord\|health\|status' packages/dsh-console/src/types.ts packages/dsh-channel/src/types.ts
```

同一概念在别的层已有字段吗？有就复用/改名，不要另起一套。

### 13. 验证闸门

这次改动的**一条**验证命令是什么？它能在改动前变红、改动后变绿吗？

```sh
grep -n '机械检查' -A 20 .agents/skills/dsh-pre-push-checks/SKILL.md   # 仓库标准闸门（语义三条见同文件"语义检查"段）
```

说不出这条命令 = 这个计划还没有完成判据。

## 收尾

- 拷问产出的种子清单与 `../dsh-incident-forensics/SKILL.md` 共用：**排错时按同一份清单优先怀疑**
  （该 skill 的 C 步就是从这里取假设来源）。事故结论若指向新的高危面，回灌到本清单（同一提交内更新），
  否则正反两链会各自漂移。
- 回灌时**只加能带命令的种子**；只写得出一句"要注意 X"的，属于纯判断，别伪装成闸门。
