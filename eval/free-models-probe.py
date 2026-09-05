#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Free-tier LLM gateway probe: kilo.ai gateway + opencode zen.

Why this exists: 免费模型池（kilo / opencode zen）作为 coding agent 的“打下手”
模型候选。它们没有公开的“质量榜”，只有实测。本脚本对每个候选跑一组小探测：

  speed  —— 流式 chat/completions：HTTP 状态、首 token 延迟（TTFB）、总时长
  code   —— 一个编码小任务（is_palindrome），看是否真的产出可执行代码
  tools  —— OpenAI 格式 tool_calls 探测（agent 必须能工具调用才有用）

两个网关的鉴权差异（务必记住）：
  * kilo   https://api.kilo.ai/api/openrouter      需要头 Authorization: Bearer anonymous（免费档匿名 key）
  * zen    https://opencode.ai/zen/v1              免费模型匿名可用；一旦带 Authorization 头反而 401

用法示例：
  ./eval/free-models-probe.py --list --gateway zen
  ./eval/free-models-probe.py --gateway zen                       # zen 全部免费模型，speed+code
  ./eval/free-models-probe.py --gateway kilo --probes speed,code,tools
  ./eval/free-models-probe.py --gateway kilo \
      --models minimax/minimax-m3:free,cohere/north-mini-code:free --probes all
  ./eval/free-models-probe.py --gateway all --out results.json    # 全量存档

结果解读：http=200 且 finish 不是 error；tools 栏出现 get_weather 即支持工具调用；
code 栏 def/ret 为 True 且 snippet 干净 = 值得打下手。免费档有限流（429）与配额，
换时间段重试即可；模型/上游可用性随时会变，本脚本跑的就是“此刻”的实测。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from http.client import HTTPSConnection

GATEWAYS = {
    # gateway 名 -> (host, url 前缀, 匿名 bearer；None 表示不带 Authorization 头)
    "kilo": ("api.kilo.ai", "/api/openrouter", "anonymous"),
    "zen": ("opencode.ai", "/zen/v1", None),
}

SPEED_TOKENS = 64        # 速度探测的 max_tokens（推理模型会把预算花在 reasoning 上，勿再调小）
CODE_TOKENS = 700        # 编码探测的 max_tokens
TOOL_TOKENS = 200

CODE_PROMPT = "Write Python only:\ndef is_palindrome(s: str) -> bool"
TOOLS_BODY = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Query weather of a city",
            "parameters": {
                "type": "object",
                "properties": {"city": {"type": "string"}},
                "required": ["city"],
            },
        },
    }
]


def now() -> float:
    return time.monotonic()


def build_headers(gateway: str, content: bool = True) -> dict:
    headers = {"User-Agent": "dsh-eval-free-probe/0.1"}
    if content:
        headers["Content-Type"] = "application/json"
    token = GATEWAYS[gateway][2]
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def http_get_json(gateway: str, path: str) -> dict:
    host, prefix, _ = GATEWAYS[gateway]
    req = urllib.request.Request(
        f"https://{host}{prefix}{path}", headers=build_headers(gateway, content=False)
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return {"error": {"status": e.code, "message": e.read()[:300].decode("utf-8", "replace")}}


def list_free_models(gateway: str) -> list[dict]:
    """返回 (id, context_window) 列表。kilo 按 pricing==0 过滤；zen 无价格字段，按 -free 后缀启发。"""
    doc = http_get_json(gateway, "/models")
    if "error" in doc:
        print(f"[{gateway}] 拉取模型目录失败: {doc['error']}")
        return []
    data = doc.get("data", [])
    out = []
    for m in data:
        mid = m.get("id", "")
        if gateway == "kilo":
            p = m.get("pricing") or {}
            try:
                if float(p.get("prompt", 1)) == 0 and float(p.get("completion", 1)) == 0:
                    out.append({"id": mid, "ctx": m.get("context_length")})
            except (TypeError, ValueError):
                pass
        else:  # zen
            if mid.endswith("-free") or "free" in mid.lower():
                out.append({"id": mid, "ctx": m.get("context_length")})
    # zen 目录里偶发把非 free 也带 -free 的情形；按稳定排序便于复现
    out.sort(key=lambda x: x["id"])
    return out


def stream_probe(gateway: str, model: str, budget: float) -> dict:
    """流式请求：度量 TTFB(首个 content delta) 与总时长。"""
    host, prefix, _ = GATEWAYS[gateway]
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": "用一句话介绍你自己。"}],
        "stream": True,
        "max_tokens": SPEED_TOKENS,
    }).encode("utf-8")

    conn = HTTPSConnection(host, timeout=budget)
    t0 = now()
    ttfb = None
    finish = None
    text = []
    status = None
    error = None
    try:
        conn.request("POST", f"{prefix}/chat/completions", body=body, headers=build_headers(gateway))
        resp = conn.getresponse()
        status = resp.status
        if status != 200:
            error = resp.read(400).decode("utf-8", "replace")[:200]
        else:
            while True:
                if now() - t0 > budget:
                    error = "timeout"
                    break
                line = resp.readline()
                if not line:
                    break
                line = line.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    chunk = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                if chunk.get("error"):
                    error = str(chunk["error"])[:200]
                    break
                if chunk.get("choices"):
                    ch = chunk["choices"][0]
                    if ch.get("finish_reason"):
                        finish = ch["finish_reason"]
                    delta = (ch.get("delta") or {}).get("content")
                    if delta:
                        if ttfb is None:
                            ttfb = now() - t0
                        text.append(delta)
    except Exception as e:  # noqa: BLE001
        error = f"{type(e).__name__}: {e}"
    finally:
        conn.close()
    total = now() - t0
    return {
        "model": model,
        "http": status,
        "ttfb_s": round(ttfb, 2) if ttfb is not None else None,
        "total_s": round(total, 2),
        "finish": finish,
        "sample": "".join(text)[:60],
        "error": error,
    }


def post_json(gateway: str, model: str, payload: dict, budget: float) -> tuple[int | None, dict | None, str | None]:
    """非流式 POST，返回 (status, parsed_json, error)。"""
    host, prefix, _ = GATEWAYS[gateway]
    conn = HTTPSConnection(host, timeout=budget)
    try:
        conn.request(
            "POST",
            f"{prefix}/chat/completions",
            body=json.dumps(payload).encode("utf-8"),
            headers=build_headers(gateway),
        )
        resp = conn.getresponse()
        raw = resp.read()
        if resp.status != 200:
            return resp.status, None, raw[:300].decode("utf-8", "replace")
        try:
            return resp.status, json.loads(raw.decode("utf-8")), None
        except json.JSONDecodeError as e:
            return resp.status, None, f"bad json: {e}"
    except Exception as e:  # noqa: BLE001
        return None, None, f"{type(e).__name__}: {e}"
    finally:
        conn.close()


def code_probe(gateway: str, model: str, budget: float) -> dict:
    status, doc, err = post_json(gateway, model, {
        "model": model,
        "messages": [{"role": "user", "content": CODE_PROMPT}],
        "max_tokens": CODE_TOKENS,
    }, budget)
    if err or status != 200 or doc is None:
        return {"http": status, "has_def": False, "has_return": False, "len": 0, "sample": "", "error": err or "http!=200"}
    msg = (doc.get("choices") or [{}])[0].get("message") or {}
    content = msg.get("content") or ""
    finish = (doc.get("choices") or [{}])[0].get("finish_reason")
    return {
        "http": status,
        "has_def": "def is_palindrome" in content,
        "has_return": "return" in content,
        "len": len(content),
        "finish": finish,
        "sample": content[:100],
        "error": None,
    }


def tools_probe(gateway: str, model: str, budget: float) -> dict:
    status, doc, err = post_json(gateway, model, {
        "model": model,
        "messages": [{"role": "user", "content": "上海的天气怎么样？请调用工具查询。"}],
        "tools": TOOLS_BODY,
        "tool_choice": "auto",
        "max_tokens": TOOL_TOKENS,
    }, budget)
    if err or status != 200 or doc is None:
        return {"http": status, "tool_call": False, "error": err or "http!=200"}
    msg = (doc.get("choices") or [{}])[0].get("message") or {}
    calls = msg.get("tool_calls") or []
    if calls:
        fn = calls[0].get("function") or {}
        return {"http": status, "tool_call": True, "name": fn.get("name"), "args": (fn.get("arguments") or "")[:40]}
    return {"http": status, "tool_call": False, "error": None}


def probe_all(gateway: str, models: list[dict], probes: list[str], sleep_s: float, budget: float) -> list[dict]:
    rows = []
    for item in models:
        mid = item["id"]
        row = {"gateway": gateway, "model": mid, "ctx": item.get("ctx")}
        for probe in probes:
            if probe == "speed":
                row["speed"] = stream_probe(gateway, mid, budget)
            elif probe == "code":
                row["code"] = code_probe(gateway, mid, budget)
            elif probe == "tools":
                row["tools"] = tools_probe(gateway, mid, budget)
            if sleep_s:
                time.sleep(sleep_s)
        rows.append(row)
        compact = summarize_row(row)
        print(f"  [{gateway}] {compact}")
        sys.stdout.flush()
    return rows


def summarize_row(row: dict) -> str:
    parts = [row["model"]]
    s = row.get("speed") or {}
    c = row.get("code") or {}
    t = row.get("tools") or {}
    parts.append(f"http={s.get('http', c.get('http', t.get('http', '-'))) }")
    parts.append(f"ttfb={s.get('ttfb_s') or '-'}s total={s.get('total_s') or '-'}s")
    if "code" in row:
        parts.append(f"code(def={c.get('has_def')},ret={c.get('has_return')},len={c.get('len')})")
    if "tools" in row:
        parts.append(f"tools={t.get('tool_call') and t.get('name') or (t.get('error') or 'no')}")
    err = (s or {}).get("error") or (c or {}).get("error") or (t or {}).get("error")
    if err:
        parts.append(f"ERR={err[:80]}")
    sample = (c or {}).get("sample") or (s or {}).get("sample") or ""
    if sample:
        parts.append(f":: {sample[:70]!r}")
    return " | ".join(parts)


def main() -> int:
    ap = argparse.ArgumentParser(description="Probe free-tier LLM gateways (kilo / opencode zen).")
    ap.add_argument("--gateway", choices=["kilo", "zen", "all"], default="all")
    ap.add_argument("--models", default="", help="逗号分隔的模型 id；缺省自动用各网关的免费目录")
    ap.add_argument("--probes", default="speed,code", help="逗号分隔: speed,code,tools（或 all）")
    ap.add_argument("--list", action="store_true", help="只列出免费模型")
    ap.add_argument("--sleep", type=float, default=1.0, help="请求间 sleep 秒（免费档限流保护）")
    ap.add_argument("--budget", type=float, default=90.0, help="单请求硬超时秒")
    ap.add_argument("--out", default="", help="JSON 结果存档路径（可选）")
    args = ap.parse_args()

    probes = ["speed", "code", "tools"] if args.probes == "all" else [p.strip() for p in args.probes.split(",") if p.strip()]
    gateways = ["kilo", "zen"] if args.gateway == "all" else [args.gateway]
    override = [m.strip() for m in args.models.split(",") if m.strip()]

    all_rows = []
    for gw in gateways:
        print(f"\n===== gateway: {gw}  probes: {probes} =====")
        models = [{"id": m, "ctx": None} for m in override] if override else list_free_models(gw)
        if args.list:
            for m in models:
                print(f"  {m['id']:<44} ctx={m.get('ctx')}")
            continue
        if not models:
            print("  （无模型：目录为空或网络失败）")
            continue
        print(f"共 {len(models)} 个模型")
        all_rows.extend(probe_all(gw, models, probes, args.sleep, args.budget))

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(all_rows, f, ensure_ascii=False, indent=2)
        print(f"\n结果已存档: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
