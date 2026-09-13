---
name: grilling
description: Grill the user relentlessly about a plan or design. Use when the user wants to stress-test a plan before building, or uses any 'grill' trigger phrases.
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing. Asking multiple questions at once is bewildering.

If a *fact* can be found by exploring the codebase, look it up rather than asking me. The *decisions*, though, are mine — put each one to me and wait for my answer.

Do not enact the plan until I confirm we have reached a shared understanding.

## 本项目必问的高危种子（dsh-plugins）

先自由拷问设计树；以下种子是**本仓库反复复发**的高危面，按复发频率排序。每条都要么被代码/文档回答（去查，别问我），要么作为一个问题问出来。与本次改动无关的种子跳过，但**跳过要有理由**。

每条种子都先跑它的"查证命令"，把实测结果作为问题的前提——不要问我能自己查到的事实。

1. **内核基线假设**——这个改动是否依赖某个内核版本的具体行为？升到下一版会破在哪？
   ```sh
   grep -rho '"@deepseek-ai/[^"]*": "[^"]*"' packages/*/package.json | sort -u
   ```
   基线 = 上面输出的版本（当前 0.1.2-rc.1）。已知破面（0.1.2-rc.1 → 0.1.3-alpha.1）：session 格式 v2
   自动迁移、`agentLoop` 转 async、flock 会话锁——见
   `../../../docs/research/2026-09-05-kernel-0.1.3-session-breaking-impact.md`。

2. **内核包双实例**——是否给自研包新增了**承载 Symbol 键服务**的内核包依赖（`dsh-tools`/`dsh-session`/
   `dsh-llm` 之类）？Symbol 跨模块实例不共享，双实例 = 工具调用崩
   （`ctx.tools[scheduler].prepare` undefined），且纯聊天冒烟测不出来。注意 `@deepseek-ai/schemastery`
   是普通库、进 `dependencies` 正常——别一刀切成"禁止一切 @deepseek-ai/"。
   ```sh
   grep -l '"@deepseek-ai/dsh-\(tools\|session\|llm\)"' packages/*/package.json || echo clean
   ```

3. **实例作用域与目录隔离**——改动读写了 `DSH_HOME` / sessions / settings / storages 吗？会不会
   串到别的实例（web 3080 / web2 3082 / web3 3083 / web4 3084 / daemon headless）？端口从哪来
   （必须从各实例自己的 `cordis.patch.yml` 读，不许猜）？
   ```sh
   grep -rn 'DSH_HOME\|process\.env\.DSH_' packages/<pkg>/src | head
   ```

4. **3080 禁令**——是否需要触碰正式 web（`~/.dsh/profiles/web`）的配置或端口？需要就停下问：测试一律
   走独立 `DSH_HOME` + 独立端口。

5. **回滚路径**——出问题时怎么回到改动前？给出**确切命令**，并要求它非破坏性（不覆盖现场）。

6. **文档同步与陈旧文档**——这次改动会让哪些文档/Agent Note 变成谎言？（`AGENTS.md` /
   `docs/architecture.md` / `README` / 相关 note）"陈旧文档 = 污染源"，同提交内修。

7. **UI 以官方为基准**——改了 UI 吗？官方对应组件（DOM 结构 / CSS 机制 / 属性值）是哪个？默认直接
   照抄，不手写近似（见 `../../notes/implemented/process/2026-08-22-ui-official-alignment.md`）。

8. **一套概念模型**——是否引入插件私有模型（身份 / 主机 / 实例）？新依赖方向是否严格向下
   （业务 app→UI→管理组件→系统→内核）？

9. **验证闸门**——这次改动的**一条**验证命令是什么？它能在改动前变红、改动后变绿吗？说不出这条
   命令 = 这个计划还没有完成判据（参考 `../dsh-pre-push-checks/SKILL.md`）。

## 收尾

拷问产出的种子清单与 `../dsh-incident-forensics/SKILL.md` 共用：**排错时按同一份清单优先怀疑**。
事故结论若指向新的高危面，回灌到本清单（同一提交内更新），否则正反两链会各自漂移。
