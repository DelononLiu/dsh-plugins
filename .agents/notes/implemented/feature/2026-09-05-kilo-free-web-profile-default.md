# Agent Note: web profile 默认 kilo 免费 provider 路由

Status: implemented

## Problem

DeepSeek 官方额度不可用期间，需要免费模型"打下手"。kilo.ai 网关的免费档
（OpenRouter 兼容、匿名可用）经实测可用且有工具调用支持。希望按仓库
`profiles/web` 构建/部署的 web 实例**开箱即带**这批免费模型，而不必每台
手写 `settings.yaml`。

## Decision

在发行包 profile 补丁层 `profiles/web/cordis.patch.yml` 里以 row 覆盖方式给
base bundle 中 dormant 挂载的 `llm-pi-ai` 行补默认 providers：

- 路由 key `kilo-free`：`api: openai-completions`，`baseURL: https://api.kilo.ai/api/openrouter`，
  `apiKeyEnv: KILO_API_KEY`（免费档匿名，值固定为字符串 `anonymous`）；
- 四个模型（实测筛选，2026-09-05）：`kilo-auto/free`（自动路由兜底）、
  `cohere/north-mini-code:free`（30B/3B 激活，快速问答）、
  `minimax/minimax-m3:free`（主力备胎，限流 30 req/min）、
  `nvidia/nemotron-3-ultra-550b-a55b:free`（550B/55B，主力备胎）。

机制依据（源码确认）：`llm-pi-ai` 适配器支持 profile 行 config 的 `providers` 直接注册路由
（settings 文档只是覆盖层）；patch 覆盖行 config 是发行包"团队默认配置"的既有通道，
用户设置文档仍可整行覆盖——默认值可自定义，符合仓库定位。

## Alternatives

- 仅手写各实例 `settings.yaml`：不可复用、易漏——否决。
- zen（opencode）免费模型进默认：zen 匿名形态（不带 Authorization 头）与 llm-pi-ai
  的强制 key 语义冲突（实测 `No API key for provider`），且其自带 `opencode` 目录
  provider 也是 `OPENCODE_API_KEY` 强鉴权——暂不接入（拿到真 key 另配）。
- dsh-console deploy 时种默认设置（代码方案）：曾提议但用户决定**先不改产品代码**，
  保持配置层方案（见 Consequences）。

## Consequences

- 按 `profiles/web` 构建/部署的 web 实例开箱带 4 个 kilo 免费模型；运行前提 =
  环境能解析 `KILO_API_KEY`（值 `anonymous`：export 或写 DSH_HOME/.credentials.yaml refs）。
- **边界（重要）**：dsh-console（daemon）部署的实例**不吃**这条默认——console 的
  deploy 重建实例 `cordis.patch.yml`、upgrade 显式跳过实例 patch（身份层归实例），
  providers 属用户设置文档。console 部署实例如需默认免费模型，需另行在 deploy 时种
  settings.yaml（曾提议 dsh-console deploy 种子；用户决定先不改产品代码，留待办）。
- 免费池易波动（429/503/下架），默认只是"可用选项"，不改变默认 agent 模型
  （仍是 DeepSeek-V4-Flash）；复测与刷新靠 eval/free-models-probe.py。
- 匿名免费档为第三方通道：对公发行前应评估是否保留或换正式 key。
