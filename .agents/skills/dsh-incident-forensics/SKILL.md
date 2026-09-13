---
name: dsh-incident-forensics
description: 受污染现场的排错路径（反向链）：故障现场已被顺手改动/并发改动/半升级/陈旧产物污染时，先取证存档、隔离、证伪，再恢复理解。用在本仓库（dsh-plugins）以及任何多 agent、多 worktree、多实例并存的工程——用户说「怎么坏了」「先别动」「现场别丢」「取证/复盘」或改动后立刻异常时使用。
---

# dsh Incident Forensics — 受污染现场的排错

**入口**：`../diagnosing-bugs/SKILL.md` 的 Phase 0 判定现场**受污染**（本人改动清单不清 / 有并发写者 /
现象与改动关系不明），或用户明确要求保住现场、复盘事故。**现场干净时不要用本技能**——直接走
`diagnosing-bugs` Phase 1（构造反馈环）。

前提认知：本仓库的"现场"天然易污染——多实例（web 3080 / web2 3082 / web3 3083 / web4 3084 / daemon
headless）同时在跑、多个 agent 可能并行改同一目录、内核包/产物/lib 与源码可能不同步。**一个看起来
合理的失败，很大概率是半途改动或陈旧产物的伪影。**

## 七条铁律

| # | 铁律 | 落到哪个动作 |
| --- | --- | --- |
| 1 | **污染即失证** | 现场一旦被改（重启、重建、顺手修），就不能再当证据——所以 A 步先于一切 |
| 2 | **一变一验** | 每次只动一个变量，动完立刻跑**同一条**命令对比输出 |
| 3 | **证伪实验先行** | 先做能**杀死**假设的实验，不做能"支持"假设的实验 |
| 4 | **快照是闸门不是习惯** | 任何改动之前先出快照 ref（`git stash create`，非破坏性） |
| 5 | **恢复优先于理解** | 先回到已知良好状态把业务救回来，再从容查因 |
| 6 | **陈旧文档/产物 = 污染源** | 文档说的 ≠ 代码做的时，两者都不能信，以**可执行命令**为准 |
| 7 | **维护本人改动清单** | 本次会话自己改了什么，是"是不是我造成的"的唯一判据 |

## A — 取证（Archive）：只读，先别动

```sh
# A1 非破坏性快照：工作区（不改工作树）+ 未跟踪文件归档
TS=$(date +%Y%m%d-%H%M%S); SNAP=$(git stash create "forensics $TS")
if [ -n "$SNAP" ]; then git update-ref "refs/forensics/$TS" "$SNAP"; echo "snapshot=refs/forensics/$TS $SNAP"; else echo "工作区干净"; fi
git ls-files --others --exclude-standard -z | tar czf "/tmp/forensics-untracked-$TS.tgz" --null -T -

# A2 现场坐标：谁在跑、在哪、什么版本
git status --short --untracked-files=all; git stash list; git log --oneline -5
git worktree list
ps -eo pid,lstart,cmd | grep -E 'dsh .*--profile' | grep -v grep   # 进程 + 启动时刻 = 现场时间锚

# A3 产物是否陈旧（用提交时间比，别用文件 mtime——git checkout 会刷新 mtime，误报）
for p in packages/*/; do
  c=$(git log -1 --format=%ct -- "$p/src"); l=$(stat -c %Y "$p/lib/index.js" 2>/dev/null || echo 0)
  [ "$l" -lt "$c" ] && echo "STALE $(basename $p): src提交 $(date -d @$c '+%F %T') > lib构建 $(date -d @$l '+%F %T')"
done

# A4 日志与实例状态（哪一站出的问题，日志里才有；先读，别重启）
bash scripts/dsh-profile.sh status
tail -n 80 ~/.dsh-<实例>/profiles/<实例>/*.log 2>/dev/null || ls ~/.dsh-<实例>/
```

取证**只读**。此阶段唯一允许的写操作就是 A1 的快照与归档。

## B — 隔离（Isolate）：把现场和后续动作隔开

目标不是"修好现场"，而是**让现场停在被污染的那一刻**，同时给自己一块可以随便折腾的地方。

- **冻结写者**：还有别的 agent / 后台任务在改这个目录（`git worktree list`、活跃 job）就先停它们。
  正在被写的目录不是现场，是流沙。
- **复制出实验副本**：在副本上做实验，原件不动——
  ```sh
  cp -a ~/.dsh-<实例> /tmp/forensics-<TS>-<实例>     # 实例目录副本（含 sessions/settings）
  cp -a <可疑目录> /tmp/forensics-<TS>-<目录名>
  ```
- 需要跑起来的实验用**独立 `DSH_HOME` + 独立端口**（web2/3/4），不碰被污染实例，**永不碰 3080**。
- 记下隔离时刻：`date +%F' '%T' '%s`——后面所有结论都相对这个时刻。

## C — 证伪（Falsify）：一次一个变量，先杀假设

对每个假设先写下**预测**，再设计能杀死它的实验：

> 若 <X> 是原因，则 <改变 Y> 后故障应消失 / <改变 Z> 后故障应加重。

- 一次只改一个变量；改完立刻跑同一条判据命令，把输出并排比对。
- 优先挑**成本最低、最能杀死假设**的实验（换回上一版产物、在副本上回滚那一个文件、用干净基线复现）。
- 假设之间要有排序并说明理由；不要"先修修看"。
- 若某个实验会破坏现场（要重建产物、要重启实例、要覆盖文件）——**先在副本上做，或先补快照**。

## D — 验证（Verify）：一条能红的命令

任何"恢复了""修好了"的结论，必须由**一条已经跑过的命令**支撑（粘贴调用与输出）：

- [ ] **能红**：它驱动的正是用户报的那个症状，不是"没报错"。
- [ ] **可重复**：同一命令重跑，判据一致。
- [ ] **明确**：退出码/输出里的哪一行是判据，事先说清。

没有这条命令，D 步不算完成——"看起来正常了"不是判据。

## E — 恢复优先（Restore）：先救业务，再查因

- 回到**已知良好**的状态：`git update-ref` 出的快照 ref 可 `git stash apply refs/forensics/<ts>`（在副本上）；
  内核/产物类问题按 `../dsh-kernel-upgrade/SKILL.md` 的回滚路径走；实例类问题用
  `bash scripts/dsh-profile.sh restart <实例>`（先确认它不是当前 shell 的实例）。
- **恢复动作本身也要有判据**：跑 D 步那条命令 + 该实例的闸门
  （`bash scripts/verify-kernel-upgrade.sh <实例>`）。
- 恢复完成前不要顺手重构、不要"顺便清理"——那会把还没取完的证据一起清掉。

## F — 复核（Review）：时间线 + 结论 + 回灌

- [ ] **时间线**：现场坐标（A2/A4）× 本人改动清单 × 隔离时刻，按时间排出"什么时候发生了什么"。
      结论必须能对上时间线；对不上的假设丢掉。
- [ ] **结论**：哪条假设被证伪、哪条活下来、剩下什么没解释。**没解释的留着说，不要圆**。
- [ ] **回灌**：若这是复发类高危面（内核包双实例、实例串目录、陈旧产物、端口/实例错配…），把种子补进
      [`../grilling/SKILL.md`](../grilling/SKILL.md) 的高危种子清单——否则下一次还会踩。
- [ ] **收尾**：实验副本删除（`/tmp/forensics-*`）；留存的快照 ref 在报告里点名
      （`git for-each-ref refs/forensics`），其余 `git update-ref -d`；结论写进 commit message 或
      `.agents/notes/`（行为/流程类结论）。

## 什么时候停下取证

现场完全无法复现、且没有可取证的残留（无日志、无快照、已被重建）时：**直说取证失败**，
列出试过什么，转入"恢复 + 加固闸门"（E + F 的回灌），不要用推测填满证据的空白。
