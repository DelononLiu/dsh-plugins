# skills 功能测试：对照结论（GROUND TRUTH）

这里不是语法校验（那在 `scripts/verify-skills.sh`），而是**功能验证**：造出真故障与真污染现场，
让模型照 skill 走一遍，再拿结论对照本文。语法全绿也可能判错——只有这一层能发现。

重建现场：`bash scripts/tests/fixtures/skills-fn/build-scenes.sh`（默认建到 `${TMPDIR:-/tmp}/dsh-skills-fn`）。
并发写者：`bash scripts/tests/fixtures/skills-fn/start-writer.sh <现场>`（默认 600s，`kill <pid>` 停）。

## 现场 1：`forensics/` —— 受污染现场下的反向排错

被测 skill：`dsh-incident-forensics`（A–F + 七条铁律）。

| 项 | 正确结论 |
| --- | --- |
| 现场是否可信 | **不可信**：`packages/consumer/src/index.mjs` 有未提交改动（有人把 `ctx[SCHED].prepare()` 改成 `ctx[SCHED]?.prepare()`，把 TypeError 变成静默 `undefined`），另有未跟踪的 `scene-notes.txt` |
| 原始症状 | `TypeError: Cannot read properties of undefined (reading 'prepare')`——**必须从 `git show HEAD:packages/consumer/src/index.mjs` 之类的历史状态恢复**，工作区已经被抹平（`run-src.sh` 只打印 `prepare = undefined`） |
| 根因 | `packages/consumer/src/index.mjs` 导入 `dup/registry/index.mjs`——registry 模块的**重复副本**；`Symbol("scheduler")` 不是全局注册 Symbol，两份副本各有自己的 Symbol，`ctx[SCHED]` 取不到。与 dsh 的「内核包双实例 → Symbol 键服务跨实例不共享」是同一类故障 |
| 陈旧产物陷阱 | `packages/consumer/lib/index.mjs` 是**陈旧构建**（当初导入的是正规 registry）→ 生产路径 `run.sh` 打印 `prepare = 42`（绿），与源码路径矛盾。A3 判据（`src` 最后提交时间 > `lib` 构建时间）应报 `consumer` 陈旧 |
| 修复 | `consumer/src` 改回导入正规 registry（`../../registry/lib/index.mjs`），并删掉 `dup/` 副本 |
| D 步验证命令 | `bash run-src.sh` → `prepare = 42`（修复前是 `undefined` / 抛 TypeError，能红） |
| 取证不得破坏现场 | 任何 `git checkout` / `git stash` / `git restore` 之前必须先落快照（`git stash create` + `refs/forensics/<ts>`），否则「有人顺手改过」这条证据消失 |
| 不该有的结论 | 把 `undefined` 当成"本来就这样"、只改 `lib/`、或直接 `git checkout -- .` 抹掉工作区 |

## 现场 2：`phase0-clean/` —— 干净现场的入口判决

被测：`diagnosing-bugs` Phase 0（污染检查闸门）。正确答案：**干净**，可以进 Phase 1 构造反馈环。

判据：`git status --short --untracked-files=all` 空、`git stash list` 空、`node check.mjs` **确定红**
（exit 1，`total = 2（期望 6）`，重复跑结论一致）、没有别的进程在改这个目录。

注意：干净 ≠ 没 bug。这里恰恰是"bug 稳定复现且与任何在途改动无关"，正是 Phase 1 该上场的情况。

## 现场 3：`phase0-contaminated/` —— 受污染现场的入口判决

正确答案：**受污染**，应转 `dsh-incident-forensics`，不得在 Phase 1 上直接开工。

判据：`M src/calc.mjs`（在途改动）+ `?? src/discount.wip`（未跟踪残留）+ `stash@{0}: 别人的半成品`
（陈旧 stash，不是本次会话的），且 `src/calc.mjs` 正被后台写者每 2 秒追加一行——
所以「现象是否与我的改动有关」根本无从判定。

## 现场 4：`repo` —— 计划拷问

被测：`grilling`（含本项目 9 条高危种子）。没有文件现场，用真实计划考：*"给 dsh-console 加实例健康巡检"*。

必须做到的：
- 「能查到的事实自己查」——种子自带的查证命令要真跑（`packages/*/package.json` 的 `@deepseek-ai/*` 基线、
  `dsh-tools/dsh-session/dsh-llm` 双实例扫描等），并把命令输出当作提问前提，而不是反过来问用户。
- 至少问到与本次计划真正相关的高危面：**实例作用域与目录隔离**（巡检要读写多个实例）、**3080 禁令**
  （巡检会不会去碰正式 web）、**回滚路径**、**文档同步**、**一套概念模型**（主机/实例/身份）、**验证闸门**。
- 跳过某条种子必须给出理由。
- 一次一个问题，每条附推荐答案；**不得开始实现**。

## 判定标准

功能测试通过 = 上面每个现场的结论与本文一致，且**判据来自命令输出**（贴得出命令与原文），
不是"看起来对"。任何一处不一致，要么改 skill，要么改本文——两者不能同时不动。
