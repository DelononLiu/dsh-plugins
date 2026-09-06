---
name: dsh-subagent-model-test
description: Use when validating a model route's capability as a DSH subagent before relying on it (e.g. adding kilo-free / fallback models during quota outage) — run the deterministic tool-chain + dispatch-reliability smoke protocol and record the verdict
---

# subagent 模型能力验证（dsh-subagent-model-test）

给 DSH 挑选/验收「能当 subagent 干活」的模型（工具调用链路可用 + 派发稳定）时使用。
典型场景：官方 DeepSeek 额度不可用时，把 kilo.ai 免费网关（`api.kilo.ai/api/openrouter`，匿名 `Bearer anonymous`）的 `:free` 模型注册进 web2 当 subagent 备胎。
**纯对话冒烟发现不了工具链问题**（2026-09 实测教训，同 dsh-kernel-upgrade）——必须派一轮会触发工具的真实 subagent。

## 机制前提（先读，决定怎么测）

- **运行时权威源 = `~/.dsh-<env>/settings.yaml`**，不是 `cordis.patch.yml`：web2 一旦在 settings.yaml 持久化 `llm-pi-ai`（用户覆盖），就**整行覆盖 patch**。patch 只是新装实例的种子。加运行时模型 = 改 settings.yaml。
- **subagent 模型白名单按「会话创建时刻」固化**：会话一建立就定死 ACL 快照，之后改 settings / 重启 web2 都不影响已运行会话，只对**之后新建的会话**生效。旧会话派新模型报 `child LLM route "...:free" is not allowed for this Session`——这不是配置没生效，是要开新会话。
- 模型要能派发需同时满足：
  1. 在 settings.yaml 的 `subagent-model-selection.allowedModels`（派发白名单）；
  2. 在 settings.yaml 的 `llm-pi-ai.providers.<p>.models`（注册表，带 `contextWindow`）。
- 模型「能调工具」与「harness 派发稳」是两回事：网关裸 API 工具调用正常 ≠ harness 内一定一次成功（kilo-free 的 nemotron 路由即反例，见下）。

## 0. 前置检查（确定性命令，先跑）

```sh
# 环境权威源：确认目标 env（web2=3082 管理端；禁碰正式 web 3080，见 AGENTS.md）
grep -A6 'subagent-model-selection' ~/.dsh-web2/settings.yaml          # allowedModels 白名单
grep -nE 'id: .*:free' ~/.dsh-web2/settings.yaml                       # llm-pi-ai 注册表（含 contextWindow 段）
```

判读：被测模型两条都命中 → 直接测；只在注册表不在白名单 → 先走「配置就位」；白名单命中与否都**只对新建会话生效**——当前会话若早于配置改动，必须开新会话再派。

## 1. 冒烟协议（两档，都跑）

派 subagent（provider = 网关名如 `kilo-free`，model = 被测模型 id）。subagent prompt 模板直接抄下面，只换 `<tag>` 与测试名。**每次 bash 是全新 shell**：变量不跨调用，文件系统跨调用持久——子 agent 必须把临时目录路径当字面量在后续命令里复用，这正是多步工具链的考点。

### 1a. 简单冒烟（单轮两条命令）

prompt：用 bash 依次执行（各一次调用）：
1. `echo "<tag>-tool-ok-$(date +%s)"`
2. `grep -c 'free' /home/long2015/.dsh-web2/settings.yaml`

报告两条 stdout + 退出码，最后一句话总结是否都成功返回（第 2 条应输出整数计数）。

### 1b. 复杂链路（7 步、跨调用携带状态、写临时文件）

prompt：按序各一次 bash 调用（不许合并、不加命令；D = 第 1 步 `mktemp -d /tmp/kilo-hot-XXXXXX` 输出的字面路径，2-7 步全复用）：
1. `mktemp -d /tmp/kilo-hot-XXXXXX` → 记 D
2. `cat > D/data.txt <<'EOF'` + 6 行内容（含**恰好 3 行含 `free`**）写入
3. `wc -l D/data.txt && grep -c 'free' D/data.txt` → 期望 `6 …/data.txt` + `3`
4. `echo "hot-append-$(date +%s)" >> D/data.txt`
5. `cat D/data.txt` → 读回验证 7 行（6 原始 + 1 追加时间戳）
6. `sha256sum D/data.txt`
7. `rm -rf D && test ! -d D && echo "cleanup-ok"` → 期望 `cleanup-ok`

报告每步 stdout + 退出码、第 5 步全文、第 6 步校验和、第 7 步确认，最后一句话总结 7 步是否全成。

判读（怎样算过）：
- 7 步全 exit 0、`wc -l`=6、`grep -c`=3、追加行在 readback 可见、`cleanup-ok` → **工具链 + 状态携带正常**；
- 任一步失败/路径复用错乱/读回缺行 → 记失败与现象（区分模型答错 vs 命令本身报错）。

## 2. 结果记录与判读

| 档位 | 记录什么 | 结论 |
| --- | --- | --- |
| 派发 | 首次派发失败？重试后成功？ | 连续失败 → 路由不稳（可能是网关/harness 层，不必然是模型能力） |
| 简单 | 两命令 stdout + 退出码 | 都返回 → 基本工具链通 |
| 复杂 | 7 步逐条 + 期望值比对 | 全对 → 可承载多步状态型任务 |

**报告格式**：成败矩阵表 + 一句话结论（如「stepfun 简单+复杂均一次成功，7/7 退出码 0，状态传递正确」）。失败复测一次再定性：一次失败 ≠ 不可用（见 nemotron 案例），但**记录派发尝试次数**——「3 败 1 成」与「一次成」是不同评级。

## 3. 配置就位（模型不在白名单/注册表时）

```yaml
# ~/.dsh-<env>/settings.yaml（运行时权威源，两处都要有）
subagent-model-selection:
  enabled: true
  allowedModels:
    - provider: kilo-free
      model: <id>:free          # ← 加白名单
llm-pi-ai:
  providers:
    kilo-free:
      models:
        - id: <id>:free         # ← 加注册表（contextWindow 从网关 /models 目录查）
          contextWindow: <n>
```

repo 侧种子同步：仅当该 env 的 profile 模板受控时改 `profiles/<env>/cordis.patch.yml` 的 `llm-pi-ai` 段（web2 = repo + 运行时双处同步；**不动 profiles/web、web3、worktree**——用户口径）。改完**必须开新会话**才能派（ACL 快照机制）。

## 4. 已知实测快照（2026-09-06，会过期——以现跑为准）

| 模型（kilo-free） | 简单冒烟 | 复杂 7 步 | 派发稳定性 | 评级 |
| --- | --- | --- | --- | --- |
| `cohere/north-mini-code:free` | ✅ 一次成 | ✅ 一次成（7/7） | 稳 | 可用备胎 |
| `stepfun/step-3.7-flash:free` | ✅ 一次成 | ✅ 一次成（7/7） | 稳 | 可用备胎 |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | ✅ 重试后成 | ❌ 两次派发均失败 | 差（3 败 1 成） | 网关裸 API 工具调用正常，但 harness 派发间歇失败——要用须配重试 |
| `dots-studio/dots-3-note-preview:free` | 未测 | — | — | allowlist 就位后需**新会话**补测 |

## 边界与禁令

- **禁碰正式 web（3080）**与 `profiles/web` 配置；测试产物只在 `/tmp`，用完即删（子 agent 第 7 步自清）。
- 免费网关随时限流（429）/503/403——失败先换时间段重试，别据此判模型死刑。
- 模型池/上游漂移后结论失效：以本次协议现跑为准，不承诺长期有效（同 `eval/` 巡检口径）。
- 相关资产：`eval/free-models-probe.py`（网关层裸 API 探测 speed/code/tools）· `scripts/check_free_models.py`（kilo 目录实测排序）· `.agents/notes/implemented/process/2026-09-05-free-model-probe-eval.md` · `.agents/notes/implemented/feature/2026-09-05-kilo-free-web-profile-default.md`。
