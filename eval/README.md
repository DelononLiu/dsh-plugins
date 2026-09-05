# eval/ — 免费模型可用性探测

给 DSH（以及任何 OpenAI 协议客户端）挑选“打下手”免费模型的实测工具。
覆盖两个免注册/匿名的模型网关：

| 网关 | 端点 | 鉴权 | 免费模型筛选 |
| --- | --- | --- | --- |
| kilo | `https://api.kilo.ai/api/openrouter` | `Authorization: Bearer anonymous`（免费档匿名 key） | 目录 `pricing == 0`（约 20+ 个，随池子波动） |
| opencode zen | `https://opencode.ai/zen/v1` | **不带** Authorization 头（带假 key 反而 401） | 目录里 `-free` 后缀模型（8 个） |

> 背景：2026-09 实测结论速记（会过期，以脚本现跑为准）
> * kilo 免费档多为推理模型：`max_tokens` 给太小会全烧在 reasoning 上导致 `content` 为空，不是故障；
> * 工具调用（agent 必需）经 kilo 匿名网关可用：`minimax/m3:free`、`cohere/north-mini-code:free`、`stepfun/step-3.7-flash:free` 均 ✓；
> * zen 免费模型匿名可用，但 DSH 的 `llm-pi-ai` 每条 provider 路由强制要求可用的 key（zen 会拒绝假 key），故 zen 目前只能独立测、暂不能直接注册进 DSH；
> * 免费档随时会限流（429）/上游 503/地区 403，测到失败先换个时间段重试。

## 用法

```sh
python3 eval/free-models-probe.py --list --gateway zen          # 只看免费目录
python3 eval/free-models-probe.py --gateway zen                 # zen 全量 speed+code
python3 eval/free-models-probe.py --gateway kilo --probes all   # kilo 全量 三项探测（较慢）
python3 eval/free-models-probe.py --gateway kilo \
    --models minimax/minimax-m3:free,cohere/north-mini-code:free --probes all
python3 eval/free-models-probe.py --gateway all --out /tmp/free.json   # 全量存档 JSON
```

选项：`--probes speed,code,tools`（`all`=三样）· `--models id1,id2` · `--sleep 秒`（限流保护）
· `--budget 秒`（单请求硬超时）· `--out 路径`（JSON 存档）。

## 结果怎么读

每行汇总形如：

```
  [kilo] minimax/minimax-m3:free | http=200 ttfb=1.5s total=4.1s | code(def=True,ret=True,len=781) | tools=get_weather
```

* `http=200` 且无 `ERR=` → 此刻可用；429 = 限流，403 = 地区限制，503 = 上游挂；
* `tools=get_weather` → 支持 OpenAI 工具调用（agent 打下手的前提）；
* `code(def/ret=True, len>0)` 且 sample 干净 → 编码题能正确产出代码；
* `ttfb=None` + `finish=length` → 流式没等到 content（reasioning 吞预算），属正常，非故障。
