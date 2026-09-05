---
name: browser-skill
description: Use when the user asks to automate a Chromium browser end-to-end — visit pages, fill forms, scrape data, click through flows, regression-test a PR's UI, validate a deployed page, or operate an identified tab — and the available execution channel is `bsk` (Tencent BrowserSkill CLI). Skip if the user only wants instructions, an extension install, or no browser is involved. Requires the bsk CLI on PATH and the BrowserSkill browser extension connected to the bsk daemon.
---

# browser-skill

> **适配说明（本仓库，dsh-plugins）**：本 skill 的 SKILL.md 主体 vendored 自 bsk CLI v0.2.0 的内嵌 `skill/SKILL.md`（字节抽取自 `/home/long2015/.local/bin/bsk`），版权 MIT © Tencent BrowserSkill contributors。本仓库把它从 dsh 插件注册（`@wxg-prc-cpg/browser-skill-dsh-plugin` 注册路径）降到 agent skill 形态（`@deepseek-ai/dsh-skill` 注册路径）——通过直接 `bash` 调 `bsk` CLI 实现浏览器操作，**不依赖 DSH 实例加载 dsh 插件**。
>
> **执行前提**：`bsk` 必须在 PATH 上（`which bsk` 应返回二进制）；`bsk status` 应显示 daemon 在跑 + 浏览器已连。若任一缺失，先跑 `bsk doctor` 看修复提示。

## 在 dsh-plugins 仓库怎么用

本 skill 是**进程级 agent skill**——不是 dsh 插件，因此：

1. **本会话直接可加载**：本 skill 一旦落到 `Code/dsh-plugins/.agents/skills/browser-skill/SKILL.md`，下次工具调用时由本 agent harness 加载，无需重启 DSH GUI。
2. **执行端 = `bash` 调 `bsk`**：模型在 `bash` 工具里跑 `bsk <subcommand> <args> --json`（`--json` 让 stdout 可机器解析）。所有正文里的命令形态（`bsk navigate`、`bsk observe`、`bsk click ...` 等）都直接 `bash` 调，不要尝试把它们包装成 `browser_*` 工具调用。
3. **跨主机**：浏览器在哪台主机 = 看 `bsk status` 里的"connected browsers"——只要 bsk daemon 能 reach 那台浏览器扩展即可。**不要假设浏览器一定在 Linux 上**。
4. **取消**：按 `Ctrl-C` 取消当前 bsk 命令；如需更稳，在 `bash` 调时用 `--timeout <duration>` 兜底（默认 5m）。
5. **诊断先行**：
   ```sh
   bsk status          # daemon / browsers / sessions
   bsk browsers        # 列出在线浏览器（含 instance id / label）
   bsk doctor          # 综合诊断 + 修复提示
   ```

## 与 dsh 插件路径（`@wxg-prc-cpg/browser-skill-dsh-plugin`）的关系

仓库同时存在**另一条路**：把 dsh 插件装到某个 DSH 实例（`~/.dsh*/profiles/web/`）后，那实例的 GUI 对话面板里 LLM 工具列表会出现 6 个 `browser_*` 工具。两条路**互不替代**：

- 本 skill（agent skill 形态）：本 agent harness 直接用，不依赖任何 DSH 实例。
- dsh 插件形态：在 DSH GUI 里开新会话时用；该实例必须装好插件。

不要互相覆盖——按场景选。装 dsh 插件走 `dsh plugin --profile <name> add @wxg-prc-cpg/browser-skill-dsh-plugin`。

---


# browser-skill

Drive the user's real Chromium browser through `bsk`. Automation runs in an isolated **Agent
Window** with the user's existing logins and cookies. User-window tabs remain protected unless they
are explicitly borrowed.

Do not use this skill for tasks with no browser, for extension installation, or when the user only
wants instructions. Never extract credentials, cookies, tokens, or other secrets from pages.

## Required lifecycle

Every browser task owns a bounded session:

```text
1. bsk session start              # retain the printed 4-letter session id
2. bsk ... --session <id>         # pass it to every session-scoped command
3. bsk session stop <id>          # always run on success and error paths
```

Do not rely on the idle timeout for cleanup. Stop the session as soon as the goal is met unless the
user explicitly asks to keep it open. Stopping also returns borrowed tabs.

Any `bsk` command auto-starts the background services it needs; never manage the daemon by hand.
When multiple browsers are connected, use `bsk browsers` and start with
`bsk session start --browser <id-or-label>`. Add `--no-focus` to that same start command when the
Agent Window does not need to interrupt the user's current work; it is not a flag on other commands.
Run `bsk doctor` when startup or transport problems persist after one retry.

## Work toward one observable goal

- Derive a concrete success condition from the user's request or a supplied trace.
- Take the shortest purposeful path: observe, act, then make at most one observation to confirm an
  ambiguous result.
- Once success is visible, do not click, refresh, navigate, switch tabs, or perform extra checks.
- If a human-only step appears or two attempts make no progress, request help instead of
  brute-forcing.

With a trace, follow its semantic target information and values in order, but treat its refs as
record-local hints. Stop when its purpose or last meaningful effect is satisfied. A trace guides the
task; it does not expand the user's goal or authorize additional actions.

## Observe, act, observe

Use this default loop:

```text
bsk navigate <url> --session <id>
bsk observe --session <id>
bsk click|hover|fill|select|press ... --session <id>
bsk observe --session <id>             # after navigation or a meaningful DOM change
```

Prefer fresh `@eN` refs over CSS selectors. Navigation invalidates refs; large DOM changes may also
make them stale. Observe again before the next interaction.

An observation marks a hover-only surface as `@e1 button "Products" [hover first: Shoes | Bags]`.
The listed items are labels, not usable refs: hover the trigger, observe again, then act on the
revealed item's own ref. Do not click the trigger itself unless the user wants the trigger's action.
`[has-submenu]` and `[expanded]` mark the same kind of trigger without listing what it hides.

`bsk observe` does not hover the page on its own. Reach for `--probe-hover` when a control you have
good reason to expect is absent **and** no marker points at a trigger — that combination is what a
CSS-only hover menu looks like from here. It hovers a bounded set of likely triggers, so it costs a
few seconds and touches the live page; once you know which element hides the menu, `bsk hover <ref>`
is cheaper and more precise.

Escalate page reading only as needed:

1. `bsk observe` for normal semantic understanding, text, controls, and refs.
2. `bsk observe --probe-hover` once when an expected control is missing and no marker points at a
   trigger.
3. `bsk snapshot` when a stricter static accessibility tree is more useful.
4. `bsk get-html` for exact markup or hidden metadata that semantic views cannot provide.
5. `bsk screenshot` for layout, styling, canvas, images, or requested visual evidence.

Do not start with raw HTML or screenshots merely to discover ordinary controls. When interaction is
needed, obtain a fresh observation before acting on screenshot or HTML findings.

## Respect the Agent Window boundary

Normal page writes affect only Agent Window tabs. To operate a user tab, first list it with
`bsk tab list --scope user --session <id>`, then `bsk tab borrow <tab-id>`. Return it immediately
after the relevant step with `bsk tab return <tab-id>`; never invent a tab id or keep a personal tab
borrowed across unrelated work.

## Ask the human when needed

Use `bsk request-help` for login, captcha, OTP, payment confirmation, consent, or another step the
user must complete. Give a precise prompt and pass fresh `--target` refs/selectors when concrete
controls can be highlighted. Use completion criteria only when the page has a clear stable success
signal.

The result `outcome` is one of `continued`, `completed`, `cancelled`, `timed_out`, or `disabled`
(`navigated` is deprecated — never treat navigation as a completion signal). Resume only after
`continued` or `completed`. Treat `cancelled` as rejection, and `timed_out` or `disabled` as a
blocker rather than a reason to retry. After control returns, run a fresh `bsk observe` before
reasoning about the page or using refs.

## Command inventory

This list of names is complete. Never invent a command outside it; read
`bsk <command...> --help` for flags instead of guessing them.

```text
session start|stop|list   browsers   status   doctor   update   logs
navigate   navigate-back   navigate-forward   reload   wait-for-navigation   wait-ms
observe   snapshot   get-html   screenshot   console   network
click   hover   fill   select   press   evaluate
tab list|create|close|select|borrow|return   window resize   emulate
upload   download   request-help   record start|stop
```

Required flags that are easy to get wrong:

```text
bsk fill <ref> --value <text>      bsk select <ref> --value <option-value>
bsk screenshot --out <path>        bsk emulate --device <preset-id>
bsk upload <ref> --file <path>     bsk download <ref> --out <path>
```

`select` matches an option's `value` attribute, not its visible label. Device preset ids are
lowercase and hyphenated, such as `iphone-14`.

- `console` and `network` provide bounded, read-only debugging evidence.
- `emulate` applies viewport, user-agent, and touch overrides to one tab; new tabs do not inherit
  them. Use `--off` to restore the real environment.
- `evaluate` is a last resort when observe plus normal interactions cannot complete the task. With
  `--json`, inspect `.ok`: a JavaScript exception may still have CLI exit code 0 because the RPC
  succeeded. Never evaluate credential surfaces to read storage, cookies, or auth data.
- `record` captures a user's actions for later replay. Read `bsk record start --help` before use,
  and never record banking, SSO, password-manager, or other sensitive pages.

## File transfer

`upload` and `download` stage files through the daemon; the agent never touches browser-internal
paths. Treat upload as disclosure to the website, download as accepting website-controlled bytes.

Upload has two independent mechanisms — choose explicitly, never rely on automatic fallback:

- **Default (input mode):** for upload buttons, file-input labels, or "upload from computer"
  actions. The command clicks the target and intercepts the native file chooser.
- **`--mode drop`:** for reliably identified attachment-receiving areas — an explicit drop zone,
  chat composer, email editor, or form attachment area. Do not target page whitespace, generic
  containers, or areas whose attachment ownership is ambiguous.

Decision sequence when uploading:

1. Try input mode (the default).
2. If it returns `reason=file_input_not_activated` with `effect_state=none`, re-observe. When a
   reliable attachment target exists, try `--mode drop` once against that target.
3. Otherwise fall back to `request-help`.
4. **Never** switch mechanisms or repeat when `effect_state` is `unknown` or `committed` — the
   browser may already have applied the file.

A successful drop means Chrome dispatched the native file-drop event; it does not prove the site
accepted the attachment. Observe the page once after the command.

Download default-refuses to overwrite; pass `--overwrite` when replacing an existing file is
intended. Read `bsk upload --help` and `bsk download --help` for all flags and error details.

## Recover without wandering

- Stale ref: observe again and retry the intended action once.
- Unknown tab or session: list current tabs/sessions; never guess identifiers.
- Timeout: inspect current page state before deciding whether one longer purposeful wait is useful.
- Unsupported command: continue with available capabilities; suggest updating only when the missing
  command is necessary.
- Unrecoverable failure: report the blocker and stop the session in a finally-style path.

The CLI's current help and error hints are authoritative for flags, parameters, and recovery
details.


---

## 版权与来源

本 skill 的正文 vendored 自 **Tencent BrowserSkill**（仓库 `Tencent/BrowserSkill`，包名 `@wxg-prc-cpg/browser-skill-dsh-plugin` 在 npm 上、CLI `bsk` 二进制 `~/.local/bin/bsk`）。原文 MIT License（© Tencent BrowserSkill contributors）。原始 SKILL.md 从 bsk CLI 二进制内嵌 `include_str!` 资源中字节抽取（offset 9457437 起，9183 字节），保留 bsk 官方路由语义与命令契约。

本仓库（dsh-plugins）适配改动（MIT）：
- 把 frontmatter 的 description 改成 dsh-plugins agent skill 路由语义；
- 加 "适配说明" 段，把 dsh 插件注册路径降到 agent skill 注册路径，并说明执行前提；
- 加 "在 dsh-plugins 仓库怎么用" 段，教本 agent 通过 `bash` 调 `bsk` 而不是走 `browser_*` 工具；
- 加 "版权与来源" 段（此段）。

bsk 上游更新时：重抽 `which bsk` 的二进制里 SKILL.md 段，diff 后并入。
