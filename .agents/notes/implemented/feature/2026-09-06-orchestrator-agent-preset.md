# Agent Note: 调度模式（orchestrator）agent preset

Status: implemented

## Problem

需要一个新 Agent 预设模式：主模型作为**编排者**——分析需求、拆解任务、派发
subagent 干活、验收结果，再分析再派发，循环迭代直至完成。本质是"指挥别人干活，
自己不亲自下场实现"。

用户要求该 preset **在当前工程（dsh-plugins）版本化、提交 git**，下次 clone 发行
包后"安装即可用"。

## Decision

- **中文名「调度模式」，英文 preset id `orchestrator`**（业界多 agent 架构标准术语
  *orchestrator-worker*；中文 UI 名与英文 id 不必对译，先例：cordis=创造）。
- **内容 = 官方 `standard` preset 派生**：工具面与 standard 完全一致，唯一本质
  差异是 `persona` 段——把 agent 从"亲自实现"改为"分析→拆解→派发→验收→迭代"
  的编排者行为约束。**第 0 步分诊**：简单需求（目标明确、改动仅几行）可亲自
  处理，其余一律必须派发 subagent，拿不准按不简单处理。亲自动手只允许两类：
  简单需求、只读自查（读文件/跑测试——编排者需掌握状态才能指挥与验收）；失败先
  分析再重试，用 goal/todo 跟踪长循环。
- **落地机制 = 官方 user preset root**（`$DSH_HOME/.agent-presets/<id>/`，被
  `includeUserRoot` 自动扫描，零配置）。**不走** shipped（改内核源码+重建 CLI）也
  不走 `roots` 注入（cordis.patch.yml 配共享目录）。
- **资产位置 = dsh-plugins 仓库新目录 `presets/<id>/`**（含 `agent.cordis.yml` +
  `preset.yml`）。**安装 = 把目录铺到目标环境的 `$DSH_HOME/.agent-presets/<id>/`**，
  删除目录即卸载。README/AGENTS.md 布局同步登记。
- web2 验证：文件已铺 `~/.dsh-web2/.agent-presets/orchestrator/`，真实发现读取为
  healthy（显示名「调度模式」），设置页 Agent 预设区可见可选。

## Alternatives

- **shipped（deepseek-harness 源码 presets/）**：agent preset 本属内核，随官方包
  发布最正统；但 web2 跑独立 alpha5-cli，改源码需重建 CLI 才生效，且 dsh-plugins
  无法单方推进官方发布。否决为当前路径。
- **`agent-presets` 插件行配 `roots`**：部署级团队共享 preset 的官方通道，但需
  patch 配置 + 路径可移植性负担。用户点出 UI 已有「自定义预设」（= 复制到 user
  root）后否决——user root 就是官方创作位，无需注入。
- **preset id `dispatcher`**：只含"派发"，缺"验收/整体把控"语义；agent 领域标准是
  orchestrator。否决。
- **中文名**：编排模式/领导模式/棋手模式/指挥模式/执行者模式（语义反了）均被否；
  定「调度模式」。

## Consequences

- 新环境的"安装"依赖文档/人工铺目录到 `$DSH_HOME/.agent-presets/`（无自动化脚本
  步骤）；将来可考虑安装脚本承接。
- preset 是 user preset：任何会话可复制/删除它（UI 提供），删除不影响已按它组装
  的运行中会话。
- 后续调 persona 提示词只改本仓库 `presets/orchestrator/agent.cordis.yml` 并重铺，
  无需动内核。
