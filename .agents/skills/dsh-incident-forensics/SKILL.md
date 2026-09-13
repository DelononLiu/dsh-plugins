---
name: dsh-incident-forensics
description: 受污染现场的排错路径（反向链）：故障现场已被顺手改动/并发改动/半升级/陈旧产物污染时，先取证存档、隔离、证伪，再恢复或修复。用在本仓库（dsh-plugins）以及任何多 agent、多 worktree、多实例并存的工程——用户说「怎么坏了」「先别动」「现场别丢」「取证/复盘」或改动后立刻异常时使用。
---

# dsh Incident Forensics — 受污染现场的排错

**入口**：`../diagnosing-bugs/SKILL.md` 的 Phase 0 判定现场**受污染**时进本技能。判据就是那里三问，
任一不过即受污染：① 现场改动**归属**不清（`git status` / `git stash list` / `refs/forensics` 里的条目
说不清是谁的）；② 有**活的**并发写者（两次指纹采样不一致）；③ 现象不稳定，或只在你的改动之后出现
（同一条 repro 跑两次输出不同即中招）。现场干净时**不要**用本技能——直接走 `diagnosing-bugs` Phase 1。

前提认知：本仓库的"现场"天然易污染——多实例（web 3080 / web2 3082 / web3 3083 / web4 3084 / daemon
headless）同时在跑、多个 agent 可能并行改同一目录、产物 `lib/` 与源码可能不同步、时间戳可能被动过。
**一个看起来合理的失败，很大概率是半途改动或陈旧产物的伪影。**

## 七条铁律

| # | 铁律 | 落到哪个动作 |
| --- | --- | --- |
| 1 | **污染即失证** | 现场一旦被改（重启、重建、顺手修），就不能再当证据——所以 A 步先于一切 |
| 2 | **一变一验** | 每次只动一个变量，动完立刻跑**同一条**命令对比输出 |
| 3 | **证伪实验先行** | 先做能**杀死**假设的实验，不做能"支持"假设的实验；假设来源见 C 步 |
| 4 | **快照是闸门不是习惯** | 任何改动之前先出快照 ref（`git stash create`，不碰工作区） |
| 5 | **恢复优先于理解** | 先回到已知良好状态把业务救回来，再从容查因 |
| 6 | **陈旧文档/产物 = 污染源** | 文档说的 ≠ 代码做的时，两者都不能信，以**可执行命令**为准；时间戳也同理（mtime 可被伪造，ctime 不会） |
| 7 | **维护本人改动清单** | 本次会话自己改了什么，是"是不是我造成的"的唯一判据 |

## A — 取证（Archive）：只读，先别动

### A1 非破坏性快照

```sh
# 工作区快照（产生的是 git 对象 + ref，不碰工作树）
# TS 带 PID：秒级 TS 会让**同秒的第二次取证静默覆盖前一个 ref**（前一份变悬挂对象 = 失证）
TS="$(date +%Y%m%d-%H%M%S)-$$"; SCENE="$(basename "$PWD")"; SNAP=$(git stash create "forensics $TS")
if [ -n "$SNAP" ]; then git update-ref "refs/forensics/$TS" "$SNAP" && echo "snapshot=refs/forensics/$TS $SNAP"; else echo "工作区干净"; fi
# 未跟踪文件不在 stash 里，单独归档——这个 tgz 是它们的唯一副本，收尾时不要删。
# 名字必须带现场名，否则 /tmp 里多份归档无法归属到现场。
git ls-files --others --exclude-standard -z | tar czf "/tmp/forensics-untracked-$SCENE-$TS.tgz" --null -T -
```

若处于"连 `.git` 都不该写"的只读约束下：**只跳过 `git stash create` 与 `git update-ref` 两行**——
第三行的 tar 只写 `/tmp`，仍要跑（否则未跟踪文件就没有副本）；其余输出落成文本存档。

### A2 现场坐标（谁在跑、在哪、什么版本）

```sh
git status --short --untracked-files=all; git stash list; git for-each-ref refs/forensics
git log --oneline -5
git worktree list
# 显式传现场路径（别依赖 $PWD——脚本化调用时不成立）；`|| true`：没有匹配不是"命令失败"
ps -eo pid,ppid,lstart,cmd | grep -F "$(pwd)" | grep -v grep || true
```

`refs/forensics/*` 已有条目 = **别人已经对这里取过证/动过手**：先找上一次取证的结论，别重做一遍。
（刚自己建的那个除外——`$TS` 里带 PID，认得出。）

判读注意：`grep -F` 是**子串**匹配——现场目录名恰好是别的目录前缀时会误报，argv 里不含路径的写者
（`cd` 进去再裸跑）仍会漏；`grep -v grep || true` 之后的空输出 = **没有匹配**，不是"命令没跑成"。

### A3 产物是否陈旧 / 时间戳是否被动过

```sh
# 用提交时间比，别只信文件 mtime（git checkout 会刷新 mtime；mtime 也能被 touch 回拨伪造）
for p in packages/*/; do
  c=$(git log -1 --format=%ct -- "$p/src" 2>/dev/null || true)
  l=$(find "$p/lib" -type f \( -name '*.js' -o -name '*.mjs' \) -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)
  if [ -n "$c" ] && [ -n "$l" ] && [ "$l" -lt "$c" ]; then
    echo "STALE $(basename "$p")：lib 最新产物 $(date -d @$l '+%F %T') 早于 src 最后提交 $(date -d @$c '+%F %T')"
  fi
done
# 时间戳被动过：mtime ≠ ctime（build 产物、cp、touch 都会命中，用来判断"新旧判据可不可信"）
find . -path ./.git -prune -o -type f -printf '%p\n' 2>/dev/null | while read -r f; do
  m=$(stat -c %Y "$f" 2>/dev/null); c=$(stat -c %Z "$f" 2>/dev/null)
  [ -n "$m" ] && [ -n "$c" ] && [ "$m" != "$c" ] && echo "TIMESTAMP 可疑 $f mtime=$(date -d @$m '+%F %T') ctime=$(date -d @$c '+%F %T')"
done | head -20
```

判读：① **产物不存在 ≠ 陈旧**（没有 `lib/` 就别报 STALE，那是"缺产物"，另说）；② 时间戳不一致只说明
"这条新旧判据不可全信"，不等于有人伪造——但**别只拿 mtime 下结论**；③ 陈旧产物最毒的作用是**假绿**：
生产路径跑的是旧产物，于是"生产正常"；④ **输出饱和或截断不算 clean**（`head -20` 截断、或"每个文件都
可疑"时，说明这条判据在这个现场失效，改用内容对比）；⑤ 只比"src 最后**提交**时间"：src 有**未提交**
改动时漏报陈旧——发现未提交改动就手动核对 `lib` 与 `src` 的实际内容差异。

### A4 日志与实例状态（哪一站出的问题，日志里才有；先读，别重启）

```sh
# 通用：先找日志/落盘状态文件与它们的最后写入时间
find . -name '*.log' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -10
# dsh-plugins 专属（其他仓库没有这些路径，跳过即可；下面的「实例名」要替换成真实实例名再执行）
bash scripts/dsh-profile.sh status
tail -n 80 "$HOME/.dsh-实例名/profiles/实例名/"*.log 2>/dev/null || ls "$HOME/.dsh-实例名/"
```

取证**只读**。此阶段唯一允许的写操作就是 A1 的快照与归档。

## B — 隔离（Isolate）：把现场和后续动作隔开

目标不是"修好现场"，而是**让现场停在被污染的那一刻**，同时给自己一块可以随便折腾的地方。

- **冻结写者**：还有别的 agent / 后台任务在改这个目录就先停它们（`git worktree list`、活跃 job、
  A2 的进程扫描）。正在被写的目录不是现场，是流沙。
- **复制出实验副本**（原件不动；命名带 `copy` + 时间戳 + PID，以免和 A1 的证据归档混淆、
  也免得并发的另一个现场互相砸）：
  ```sh
  TS="$(date +%Y%m%d-%H%M%S)-$$"; SCENE="$(basename "$PWD")"
  cp -a . "/tmp/forensics-copy-$SCENE-$TS"                  # 当前现场副本（含未提交状态）
  cp -a "$HOME/.dsh-实例名" "/tmp/forensics-copy-实例名-$TS"  # 实例目录副本（含 sessions/settings）
  BASE="$(mktemp -d "${TMPDIR:-/tmp}/probe-$SCENE-XXXX")"   # 只要"已提交基线"时用这个
  git archive HEAD | tar -x -C "$BASE"                      # 注意：只含已跟踪文件
  ```
  **别用固定名**（如 `/tmp/probe-head`）：并发的另一个 agent/现场会 `rm -rf` 掉它，而且静默。
- **一切实验都在副本里做**：红态构造、单变量对照、修复尝试。需要跑起来的实验用**独立 `DSH_HOME` +
  独立端口**（web2/3/4），不碰被污染实例，**永不碰 3080**。
- 副本**保留到 D/E 做完**再删（D 要靠副本构造红态、E 可能要在副本上演练恢复）。
- 记下隔离时刻：`date +%F' '%T' '%s`——后面所有结论都相对这个时刻。

## C — 证伪（Falsify）：一次一个变量，先杀假设

**假设来源**：先取 [`../grilling/SKILL.md`](../grilling/SKILL.md) 的**高危种子清单**（双实例/模块副本、
实例串目录、陈旧产物、状态多路写入、数据面权威源…）——那是两链共用的怀疑顺序，比临场想更全。

对每个假设先写下**预测**，再设计能杀死它的实验：

> 若 <X> 是原因，则 <改变 Y> 后故障应消失 / <改变 Z> 后故障应加重。

- 一次只改一个变量；改完立刻跑同一条判据命令，把输出并排比对。
- 优先挑**成本最低、最能杀死假设**的实验（换回上一版产物、在副本上回滚那一个文件、用干净基线复现）。
- 假设之间要有排序并说明理由；不要"先修修看"。
- 若某个实验会破坏现场（要重建产物、要重启实例、要覆盖文件）——**一律在副本上做**。
- **掩蔽不是证据**：把"必然失败的查找"改成可选链/兜底默认值后症状消失，只说明它被藏起来了
  （`ctx[SCHED].prepare()` → `ctx[SCHED]?.prepare()` 让 TypeError 变成静默 `undefined`）。
  这类"顺手修"本身就是污染源，第一件事是把它从快照里认出来。

## D — 验证（Verify）：一条能红的命令

任何"恢复了""修好了"的结论，必须由**一条已经跑过的命令**支撑（粘贴调用与输出）：

- [ ] **能红**：它驱动的正是用户报的那个症状，不是"没报错"。**先留档红态**：把修复前的输出
      （或 HEAD 版复现的输出）原样存到 `/tmp/forensics-redstate-$SCENE-$TS.txt`（与副本、证据归档同一套命名，
      收尾清单里点名），并在报告里引用；红态不够时**在副本里**把变量改回去构造，别在现场来回改。
- [ ] **可重复**：同一命令重跑，判据一致——"一致"指**判据那一行落在同一侧**（都红/都绿），
      不是输出逐字相同（含时间戳/pid 的输出不可能逐字相同）。跑两遍以上，两次输出都贴出来。
- [ ] **明确**：退出码/输出里的哪一行是判据，事先说清。

没有这条命令，D 步不算完成——"看起来正常了"不是判据。

## E — 恢复优先（Restore）：先救业务，再查因

先分清**恢复**与**修复**——判据不同：

- **恢复**（回到**已知良好**状态，适用于"曾经好的东西坏了"）——**注意：A1 的快照是事故当时（污染态），
  不是良好态**，别拿它当恢复源：
  - 良好基线取 `HEAD`，或改动前的那个提交/版本：`git archive "$GOOD_REF" | tar -x -C "$BASE"`（`GOOD_REF` = 良好基线 ref）（副本里跑）；
  - 若确要把事故现场整体搬回工作区（例如为了继续观察），用 `git stash apply "refs/forensics/$TS"`，
    **并且**手动解开 A1 的 `/tmp/forensics-untracked-*.tgz`——快照里没有未跟踪文件；
  - 产物类问题重建（`pnpm build`）；内核/依赖类按
    [`../dsh-kernel-upgrade/SKILL.md`](../dsh-kernel-upgrade/SKILL.md) 的回滚路径；
    实例类 `bash scripts/dsh-profile.sh restart 实例名`（先确认它不是当前 shell 的实例）。
  - **重建产物不是无条件"恢复"**：根因若在源码，重建只会把假绿揭穿、把问题带进产物——那是诊断动作，
    按 C 步在副本上做。
- **修复**（首次引入的新功能/新缺陷，没有"良好状态"可回）：做**最小**改动并说明为什么是这一处——
  仍要满足 D 的判据，且不得用掩蔽（C 步末）收场。改完保留现场快照，别顺手清理。
- **恢复动作本身也要有判据**：跑 D 步那条命令 + 该实例的闸门（`bash scripts/verify-kernel-upgrade.sh 实例名`）。
- 恢复/修复完成前不要顺手重构、不要"顺便清理"——那会把还没取完的证据一起清掉。

## F — 复核（Review）：时间线 + 结论 + 回灌

- [ ] **时间线**：A2/A4 的现场坐标 × 本人改动清单 × 隔离时刻，按时间排出"什么时候发生了什么"。
      结论必须能对上时间线；对不上的假设丢掉。**归因不了的就写"归因不了"**，不要编。
- [ ] **结论**：哪条假设被证伪、哪条活下来、剩下什么没解释。**没解释的留着说，不要圆**。
- [ ] **回灌**：复发类高危面（模块重复副本、实例串目录、陈旧产物、时间戳不可信…）要补进
      [`../grilling/SKILL.md`](../grilling/SKILL.md) 的高危种子清单。**若你的写范围被限制在现场内、
      改不了那个文件，就把待回灌条目整理好输出给调用方**——不要静默跳过。条目格式与种子一致：
      **一句危害 + 一条可跑的查证命令 + 判读规则**（只写得出一句话的属纯判断，不要塞进种子里）。
- [ ] **收尾**（**不要用无作用域的全局 glob**——`rm -rf /tmp/forensics-copy-*` 会删掉并发方还没用完的副本）：
      - 删本次自己的实验副本与基线：`rm -rf "/tmp/forensics-copy-$SCENE-$TS" "$BASE"`
        （`$BASE` 是 B 步 `mktemp -d` 出来的那个）；
      - **保留** `/tmp/forensics-untracked-*.tgz`（未跟踪文件的唯一副本）、
        `/tmp/forensics-redstate-*.txt`（红态证据）与仍需的证据快照 ref；
      - 其余快照 ref 在报告里点名后 `git update-ref -d "refs/forensics/$TS"` 清理；
      - 结论写进 commit message 或 `.agents/notes/`（行为/流程类结论）。

## 什么时候停下取证

现场完全无法复现、且没有可取证的残留（无日志、无快照、已被重建）时：**直说取证失败**，
列出试过什么，转入"恢复 + 加固闸门"（E + F 的回灌），不要用推测填满证据的空白。

（另：`git stash create` 产生的对象会出现在 `git log --all` 里，形如 `On master: forensics <ts>`；
`git stash list` 不会列出它，工作区也确实没动——别把它当成一段真实历史。）
