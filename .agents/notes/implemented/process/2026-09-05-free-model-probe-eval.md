# Agent Note: 免费模型可用性巡检脚本（eval/）

Status: implemented

## Problem

kilo.ai 网关与 opencode zen 提供大量"免费档"模型（匿名/免 key），但没有公开质量榜；
此前靠一次性 curl 手测，结果不可复现、无法归档。需要一个可重复的实测工具来为
DSH（以及任何 OpenAI 协议客户端）挑选"打下手"模型，并在模型池漂移时快速复测。

## Decision

在 `eval/free-models-probe.py`（+ `eval/README.md`）落地独立于包体系的 Python3 巡检脚本：

- 覆盖两个匿名词关：`kilo`（`api.kilo.ai/api/openrouter`，`Bearer anonymous`）与
  `opencode zen`（`opencode.ai/zen/v1`，**不带** Authorization 头）；
- 自动拉取免费模型目录（kilo 按 `pricing==0`，zen 按 `-free` 后缀），支持 `--models` 指定子集；
- 三项探测：`speed`（流式 TTFB/总时长）、`code`（编码小任务是否产出代码）、`tools`
  （OpenAI 格式 tool_calls——agent 打下手的前提）；
- 表格输出 + `--out` JSON 存档；`--sleep/--budget` 防免费档限流/超时。
- 脚本自包含、零第三方依赖（stdlib + curl 语义），放在仓库 `eval/`，不属于任何 npm 包。

## Alternatives

- 一次性 curl 手测：不可复现、无归档——否决。
- 放进某插件包（如 dsh-console）带单测：巡检是运营工具不是产品行为，且要联网打真实网关，
  不适合进包测试体系——放 `eval/` 独立维护。
- Node/TS 实现：与仓库语言一致，但需运行时/依赖；python3 零依赖更贴"随手跑"场景。

## Consequences

- 选型依据可复现、可存档；模型池漂移（下架/503/429/地区 403）后一键复测。
- 实测要点已固化进 README：免费档多为推理模型，`max_tokens` 过小 content 为空不是故障；
  zen 带假 key 反而 401（只能无头或真 key）——这条直接影响 DSH 注册决策。
- 不承诺结果长期有效：免费池与上游可用性随时变，以脚本现跑为准。
