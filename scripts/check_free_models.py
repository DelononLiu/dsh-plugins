#!/usr/bin/env python3
"""
check_free_models.py

从 Kilo 免费 gateway 拉取模型目录，筛选免费模型，逐个做一次最小 chat 请求
实测可用性，并按“可用 → 单次实测耗时低 → max_tokens 高 → 上下文大 → id”综合
排序输出。仅依赖标准库 + 可选 pyyaml（没有 pyyaml 时退回轻量解析）。

Key 解析优先级：
  1. 环境变量 KILO_API_KEY
  2. 本机现网凭据 ~/.dsh-web2/.credentials.yaml 的 refs.KILO_API_KEY
可用 DSH_CREDENTIALS 环境变量覆盖凭据文件路径。

用法：
  python3 check_free_models.py
  KILO_API_KEY=xxx python3 check_free_models.py          # 显式给 key
  BASE_URL=https://api.kilo.ai/api/openrouter python3 check_free_models.py
  MODELS_ONLY=1 python3 check_free_models.py             # 只拉目录清单，不实测
  ONLY="a:b:free,c:d:free" python3 check_free_models.py  # 只测指定模型

跑分 / agent / tool 能力查询来源（需要给某个模型补公开跑分时去这些地方，
不要臆造数字，能查到多少算多少）：
  - SWE-bench Verified（软件工程 agent 基准，真源）: https://www.swebench.com
  - Artificial Analysis（综合，按模型名搜 SWE-bench/代码分数，更新快）:
      https://artificialanalysis.ai/models
  - llm-stats（免费/新模型跑分集中）: https://llm-stats.com
  - Terminal-Bench（agent 终端任务）: https://www.terminalbench.ai
  - LMArena leaderboard（SWE-bench 过滤）: https://lmarena.ai
"""

import concurrent.futures
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

DEFAULTS = {
    "base_url": "https://api.kilo.ai/api/openrouter",
    "credentials_path": str(Path.home() / ".dsh-web2" / ".credentials.yaml"),
}
MAX_OUTPUT_TOKENS = 512
RETRIES = 3
RETRY_DELAY_MS = 4.0
PARALLEL = 6
TIMEOUT_S = 50

# 查模型 agent/tool 跑分的权威来源。要补某模型的公开跑分时，用这些；查不到就留空，不臆造。
AGENT_SCORE_SOURCES = {
    "SWE-bench Verified": "https://www.swebench.com",
    "Artificial Analysis": "https://artificialanalysis.ai/models",
    "llm-stats": "https://llm-stats.com",
    "Terminal-Bench": "https://www.terminalbench.ai",
    "LMArena": "https://lmarena.ai",
}

# 实测中反复无法完成任务/不可靠、应从候选剔除的模型（逐步积累）。
EXCLUDED_MODELS = {
    "nvidia/nemotron-3-super-120b-a12b:free",  # 多次无法完成 P2 编辑任务
}

# 常见 free 模型的参数量标注（逐步积累）。
# 键 = Kilo/OpenRouter 模型 id；值 = 人类可读的参数量。
# 值语义：数字来自模型命名/官方规格（如 -120b-a12b 表示 120B 总参数、12B 激活）；
# 标 "?" 的表示暂未确证，后续确认后改填即可；不要臆造。
KNOWN_PARAMS = {
    "cohere/north-mini-code:free": "30B total / 3B active",
    "dots-studio/dots-3-note-preview:free": "288B total / 17B active",
    "inclusionai/ling-3.0-flash-fin:free": "~124B total / 5.5B active",
    "inclusionai/ling-3.0-flash-sante:free": "~124B total / 5.5B active",
    "kilo-auto/free": "auto 路由(非单一模型)",
    "liquid/lfm-2.5-2.6b:free": "2.6B",
    "minimax/minimax-m2.7:free": "230B total / 10B active",
    "minimax/minimax-m3:free": "427B total / 26B active",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": "30B total / 3B active",
    "nvidia/nemotron-3-super-120b-a12b:free": "120B total / 12B active",
    "nvidia/nemotron-3-ultra-550b-a55b:free": "550B total / 55B active",
    "nvidia/nemotron-3.5-content-safety:free": "4B (Gemma-3-4B-it 微调)",  # 内容安全分类器
    "nvidia/nemotron-3.5-lightning:free": "30B total / 3B active",
    "poolside/laguna-s-2.1:free": "118B total / 8B active",
    "poolside/laguna-xs-2.1:free": "33B total / 3B active",
    "stepfun/step-3.7-flash:free": "~198B total / 11B active",
    "thinkingmachines/inkling-small:free": "276B total / 12B active",
    "thinkingmachines/inkling:free": "975B total / 41B active",
}


# ---------------------------------------------------------------- key 读取
def read_ref_key(file: str, key_name: str):
    """从 credentials.yaml 的 refs 段读 key（无 pyyaml 时用的轻量行解析）。"""
    path = Path(file)
    if not path.exists():
        return None
    in_refs = False
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line == "refs:":
            in_refs = True
            continue
        if line.startswith("records:") or line.startswith("refs"):
            in_refs = False
        if not in_refs:
            continue
        # 形如  KEY: value  或  KEY: "value"
        parts = line.split(":", 1)
        if len(parts) == 2 and parts[0].strip() == key_name:
            value = parts[1].strip().strip("\"'")
            if value:
                return value
    return None


def read_ref_key_yaml(file: str, key_name: str):
    """优先用 pyyaml 精确解析，失败退回轻量解析。"""
    try:
        import yaml  # type: ignore
        data = yaml.safe_load(Path(file).read_text(encoding="utf-8"))
        refs = data.get("refs") or {}
        value = refs.get(key_name)
        return str(value) if value else None
    except Exception:
        return read_ref_key(file, key_name)


# ---------------------------------------------------------------- HTTP
def http_json(url, *, method="GET", key=None, payload=None, timeout=TIMEOUT_S):
    req = urllib.request.Request(url, method=method)
    if key:
        req.add_header("Authorization", f"Bearer {key}")
    if payload is not None:
        req.add_header("Content-Type", "application/json")
        data = json.dumps(payload).encode("utf-8")
    else:
        data = None
    try:
        with urllib.request.urlopen(req, data=data, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", "replace")
            try:
                parsed = json.loads(body) if body else {}
            except json.JSONDecodeError:
                parsed = {"raw": body}
            return resp.status, parsed
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(body) if body else {}
        except json.JSONDecodeError:
            parsed = {"raw": body}
        return e.code, parsed
    except urllib.error.URLError as e:
        return -1, {"raw": f"network error: {e.reason}"}
    except Exception as e:  # 超时等
        return -1, {"raw": f"error: {e}"}


# ---------------------------------------------------------------- 模型判断
def _pricing_num(value):
    """把 pricing 字段值规范成可比较数值：缺失/空/-1(缺省/特殊) 一律归 None。

    只有 gateway 显式给出 >=0 的数值才参与判断；缺失与 -1 都表示“未承诺”，
    不当作免费依据。
    """
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if f >= 0 else None


def is_free(model):
    """真正的免费聊天模型：带 :free 后缀，或显式 request=0 且 prompt/completion=0。

    仅当 gateway 明确计费为 0 才视为免费。缺失 request 字段或 output 非文本的
    模型（如音频/图像生成类）不会被误纳。
    """
    p = model.get("pricing") or {}
    mid = str(model.get("id", ""))
    if ":free" in mid:
        return True
    prompt = _pricing_num(p.get("prompt"))
    comp = _pricing_num(p.get("completion"))
    request = _pricing_num(p.get("request"))
    if request is None:
        return False
    return request == 0.0 and prompt == 0.0 and comp == 0.0


def describe_provider(model):
    top = model.get("top_provider") or {}
    if isinstance(model.get("provider"), str) and model["provider"]:
        return model["provider"]
    if isinstance(top.get("provider"), str) and top["provider"]:
        return top["provider"]
    name = model.get("name")
    return f"vendor:{str(name)[:12]}" if name else "—"


# ------------------------------------------------- 能力画像 + subagent 适宜度
def capability_profile(model):
    """从模型目录元数据提取与 agent/subagent 相关的能力画像。"""
    arch = model.get("architecture") or {}
    sp = (model.get("supported_parameters") or [])
    has = lambda w: any(w in p.lower() for p in sp)
    top = model.get("top_provider") or {}
    in_mods = arch.get("input_modalities") or []
    return {
        "id": model.get("id"),
        "name": model.get("name"),
        "params": KNOWN_PARAMS.get(model.get("id"), "?"),
        "modalities_in": ",".join(in_mods) if in_mods else "text",
        "vision": "image" in in_mods,
        "tools": has("tool"),
        "tool_choice": has("tool_choice"),
        "structured_outputs": has("structur"),
        "response_format": has("response_format"),
        "json_mode": has("json"),
        "reasoning": has("reasoning"),
        "reasoning_effort": has("reasoning_effort"),
        "seed": has("seed"),
        "stream": has("stream"),
        "context": top.get("context_length") or model.get("context_length"),
        "max_output": top.get("max_completion_tokens"),
    }


def grade_subagent(cap):
    """按能力给出该模型作为 subagent 的适宜度评级与原因（纯能力维度）。

    权重取向：通用 coding/工具调用子任务 + 快速轻量子任务。
    分四档：适合 / 可用 / 受限 / 不适合。
    只评估能力，不含运行时可用性（限流与否由调用方单独过滤）。
    """
    id_ = cap["id"]
    reason = []
    # 专用/无工具模型：不是通用 agent（content-safety 是无工具的内容安全分类器）
    if not cap["tools"] or "content-safety" in str(id_).lower():
        return "不适合", ["无 tools 支持，为专用/分类模型，不是通用 agent"]
    context = cap.get("context") or 0
    max_out = cap.get("max_output") or 0

    # 通用 coding/工具调用：需 tools+reasoning+足够 context；structured_outputs 加分
    coding_ok = cap["tools"] and cap["reasoning"] and context >= 128000
    coding_strong = coding_ok and max_out >= 32000 and cap["structured_outputs"]

    if coding_strong:
        grade = "适合"
        reason.append("tools+reasoning 齐备")
        if context >= 500000:
            reason.append(f"长上下文 {context}")
        if cap["structured_outputs"]:
            reason.append("支持 structured_outputs")
        if max_out >= 50000:
            reason.append(f"大输出 {max_out}")
    elif coding_ok:
        grade = "可用"
        reason.append("tools+reasoning 可用")
        if context >= 128000:
            reason.append(f"context {context}")
    else:
        grade = "受限"
        if not cap["reasoning"]:
            reason.append("无 reasoning")
        if context < 128000:
            reason.append(f"context 偏小 {context}")
        if max_out > 0 and max_out < 16000:
            reason.append(f"输出上限偏低 {max_out}")
        if not cap["structured_outputs"] and not cap["json_mode"]:
            reason.append("无结构化输出")
    return grade, reason


# ---------------------------------------------------------------- 单模型实测
def test_model(key, base_url, model_id):
    url = f"{base_url.rstrip('/')}/chat/completions"
    payload = {
        "model": model_id,
        "messages": [{"role": "user", "content": "Reply with exactly the two characters: OK"}],
        "max_tokens": MAX_OUTPUT_TOKENS,
    }
    started = time.time()
    for attempt in range(1, RETRIES + 1):
        status, body = http_json(url, method="POST", key=key, payload=payload)
        elapsed = time.time() - started
        if status == 200:
            choices = body.get("choices") or []
            msg = (choices[0].get("message") or {}) if choices else {}
            content = msg.get("content") or ""
            finish = (choices[0].get("finish_reason") or "") if choices else ""
            ok = isinstance(content, str) and content.strip()
            usage = body.get("usage") or {}
            if not ok and attempt < RETRIES:
                # reasoning 模型可能把 max_tokens 花在思考上导致 content 空，重试减少假阴性
                time.sleep(1.0)
                continue
            return {
                "status": "ok" if ok else "empty",
                "elapsed_s": round(elapsed, 2),
                "content": (content.strip()[:60].replace("\n", " ") if ok else "(empty content)"),
                "finish": finish,
                "prompt_tokens": usage.get("prompt_tokens"),
                "completion_tokens": usage.get("completion_tokens"),
            }
        detail = (body.get("error") or {}).get("message") or body.get("raw") or ""
        detail = str(detail)[:160]
        is_rate = status == 429 or "rate.?limit" in detail.lower() or "daily limit" in detail.lower()
        if status == 429 and attempt < RETRIES:
            time.sleep(RETRY_DELAY_MS)
            continue
        return {
            "status": "ratelimited" if is_rate else f"err{status}",
            "elapsed_s": round(elapsed, 2),
            "detail": detail,
        }
    return {"status": "ratelimited", "elapsed_s": round(time.time() - started, 2), "detail": "retries exhausted (429)"}


def run_one(args):
    key, base_url, model = args
    m = model
    result = test_model(key, base_url, m["id"])
    result["id"] = m["id"]
    result["context"] = m.get("context_length")
    result["max_tokens"] = (m.get("top_provider") or {}).get("max_completion_tokens") \
        or (min(m.get("context_length") or 0, 64000) if m.get("context_length") else None)
    result["provider_name"] = describe_provider(m)
    result["cap"] = capability_profile(m)
    return result


def rank_key(r):
    # 可用性权重最高，其次耗时；展示表头已含 max_tokens/context，排序以可用+快为主
    order = {"ok": 0, "empty": 1, "ratelimited": 2, "err-1": 3}
    base = order.get(r["status"], 9)
    return (base, r.get("elapsed_s") or 0, -1 * (r.get("max_tokens") or 0), -(r.get("context") or 0), r["id"])


def print_help():
    print("""用法：
  python3 check_free_models.py              # 拉取+实测+能力画像+subagent 适宜度分级
  KILO_API_KEY=... python3 ...              # 显式 key
  BASE_URL=... python3 ...                  # 覆盖 gateway
  MODELS_ONLY=1 python3 ...                 # 只列目录与能力画像，不实测
  ONLY="a:b:free,c:d:free" python3 ...      # 只测指定模型

输出分两段：
  (1) 实测：可用性 / 耗时 / context / max_output(目录声明的输出上限)
  (2) subagent 候选：仅列「今日实测可用 且 通用」的模型，按 适合/可用/受限 排序。
      今日限流(429)/错误 = 不可用，直接排除；无 tools 的专用/分类模型(如 content-safety)也排除。
      取向 = 通用 coding/工具调用 + 快速轻量子任务。
      每日运行即可刷新可用清单；free 池为共享非独占配额，限流会波动。

参数量列来自脚本内置表 KNOWN_PARAMS（目录不提供该字段）。值为模型命名/官方规格；
未确证的显示 "?"，确认后在 KNOWN_PARAMS 里补一行即可（逐步积累）。
""")


def main():
    if "-h" in sys.argv or "--help" in sys.argv:
        print_help()
        return
    base_url = os.environ.get("BASE_URL", DEFAULTS["base_url"])
    cred_file = os.environ.get("DSH_CREDENTIALS", DEFAULTS["credentials_path"])
    key = os.environ.get("KILO_API_KEY") or read_ref_key_yaml(cred_file, "KILO_API_KEY")
    if not key:
        print("未找到 KILO_API_KEY：请设置环境变量 KILO_API_KEY，或在凭据文件中配置。", file=sys.stderr)
        sys.exit(2)
    mask = f"{key[:5]}…{len(key)}位"
    only = [s.strip() for s in os.environ.get("ONLY", "").split(",") if s.strip()]

    # 1) 拉取目录
    models_url = f"{base_url.rstrip('/')}/models"
    print(f"[1/3] 拉取模型目录 {models_url}（key={mask}）", file=sys.stderr)
    status, body = http_json(models_url, key=key, timeout=30)
    if status != 200 or not isinstance(body.get("data"), list):
        print(f"拉取模型目录失败 HTTP {status}: {json.dumps(body)[:300]}", file=sys.stderr)
        sys.exit(3)
    all_models = body["data"]
    candidates = [m for m in all_models if is_free(m)]
    if only:
        # 显式点名(ONLY)时不过滤排除表，便于单独复测某个被排除模型的状态。
        candidates = [m for m in candidates if m.get("id") in only]
    else:
        candidates = [m for m in candidates if m.get("id") not in EXCLUDED_MODELS]
    candidates.sort(key=lambda m: m.get("id", ""))
    print(f"目录共 {len(all_models)} 个模型，其中 free 候选 {len(candidates)} 个"
          f"（已按 EXCLUDED_MODELS 排除 {len([m for m in all_models if is_free(m) and m.get('id') in EXCLUDED_MODELS])} 个）。", file=sys.stderr)

    if os.environ.get("MODELS_ONLY") == "1":
        print("ID\tPROVIDER\t参数量\tCONTEXT\tMAX_TOKENS\tTOOLS\tSTRUCT\tREASON\tVISION")
        for m in candidates:
            c = capability_profile(m)
            def yn(v): return "Y" if v else "."
            print("\t".join(str(x) for x in [
                m.get("id"), describe_provider(m), c.get("params") or "?",
                c.get("context") or "?", c.get("max_output") or "?",
                yn(c["tools"]), yn(c["structured_outputs"] or c["json_mode"]), yn(c["reasoning"]), yn(c["vision"]),
            ]))
        return

    # 2) 实测
    print(f"[2/3] 并发 {PARALLEL} 个实测 {len(candidates)} 个 free 模型…", file=sys.stderr)
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=PARALLEL) as ex:
        futures = [ex.submit(run_one, (key, base_url, m)) for m in candidates]
        for fut in concurrent.futures.as_completed(futures):
            results.append(fut.result())

    # 3) 排序输出
    print("[3/3] 排序输出…", file=sys.stderr)
    results.sort(key=rank_key)
    label = {"ok": "可用", "empty": "空响应(异常)", "ratelimited": "今日限流(429)"}
    print("\n# Kilo Free 模型实测报告")
    print(f"# gateway={base_url}  时间={time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}  候选={len(results)}")
    print()
    print("可用性\t实测耗时\t模型ID\t厂商\t上下文\tmax_tokens\t详情")
    for r in results:
        content = r.get("content") or r.get("detail") or ""
        print("\t".join(str(x) for x in [
            label.get(r["status"], r["status"]), f"{r.get('elapsed_s', 0)}s", r["id"],
            r.get("provider_name") or "—", r.get("context") or "?", r.get("max_tokens") or "?", content,
        ]))
    counts = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    summary = "  ".join(f"{k}={v}" for k, v in counts.items())
    print(f"\n# 汇总：{summary}")

    # 4) 能力画像 + subagent 适宜度
    # 每日自动化：候选 = 今日实测可用 且 能力评级非「不适合」；限流/错误/专用模型一律排除。
    print("\n\n# ===== subagent 候选（今日实测可用、通用）===== 取向：通用 coding/工具调用 + 快速轻量")
    print()
    print("评级\t模型ID\t参数量\t工具\t结构输出\treasoning\t图像\tcontext\tmax_out\t实测\t说明")
    order_grade = {"适合": 0, "可用": 1, "受限": 2, "不适合": 3}
    yn = lambda v: "Y" if v else "."
    available = []
    unavailable = []
    for r in results:
        grade, _ = grade_subagent(r["cap"])
        if r["status"] == "ok" and grade != "不适合":
            available.append(r)
        else:
            unavailable.append((r, grade))
    for r in sorted(available, key=lambda x: (order_grade.get(grade_subagent(x["cap"])[0], 9), x.get("elapsed_s") or 0, x["id"])):
        cap = r["cap"]
        grade, reason = grade_subagent(cap)
        elapsed = r.get("elapsed_s")
        if elapsed is not None and elapsed < 3.0:
            reason.append(f"低延迟 {elapsed:.1f}s")
        print("\t".join(str(x) for x in [
            grade, r["id"], cap.get("params") or "?",
            yn(cap["tools"]), yn(cap["structured_outputs"] or cap["json_mode"]), yn(cap["reasoning"]),
            yn(cap["vision"]), cap.get("context") or "?", cap.get("max_output") or "?",
            f"{elapsed}s" if elapsed is not None else "?", "; ".join(reason),
        ]))

    if unavailable:
        label_u = {"ratelimited": "今日限流(429)", "empty": "空响应(异常)", "err-1": "网络错误"}
        print(f"\n# 今日不可用/不适用（{len(unavailable)} 个，已排除）：")
        for r, grade in sorted(unavailable, key=lambda x: x[0]["id"]):
            detail = r.get("detail") or r.get("content") or ""
            if r["status"] == "ok" and grade == "不适合":
                note = "[专用模型，非通用 agent]"
            else:
                note = f"[{label_u.get(r['status'], r['status'])}]"
            print(f"  - {r['id']}  {note} {detail[:120]}")
    print(f"\n# 可用候选 {len(available)}/{len(results)}（仅列可用且通用项；free 池为共享配额，可每日重跑刷新）")


if __name__ == "__main__":
    main()
