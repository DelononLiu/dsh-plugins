---
name: dsh-trim-cot-leakage
description: Use when auditing or fixing prose that reads like a leaked reasoning transcript — dead design-session citations such as (decision N), audit item codes, or §N of uncommitted drafts; change narration such as "used to", "no longer", "this cut"; stack or review vantage ("a later PR in this stack", "rejected in review"); reviewer-addressed justifications; control-flow narration; or hedged planning residue in comments, JSDoc, docs, or Agent Notes.
---

# Trimming Chain-of-Thought Leakage

Chain-of-thought leakage is prose whose vantage is the authoring session rather than the repository: it cites artifacts only that session could see, narrates the change instead of the state, or argues with a reviewer who has left. The fix is never deletion alone when a passage carries factual clauses — restate each so it stands at HEAD, then delete the transcript around it; a passage carrying none (an audit code, control-flow narration) is deleted outright. **REQUIRED BACKGROUND:** [dsh-prose-standard](../dsh-prose-standard/SKILL.md) owns the complete-proposition rule this skill applies. It is guidance, not a script.

## The one test

For every suspect passage ask: **could a reader at HEAD, with no access to any session transcript, PR thread, or uncommitted draft, resolve every reference and verify every claim?** If no, restate the surviving facts from the repository's vantage and delete the rest. If yes, it is not leakage, however historical it sounds — but resolvability only clears this skill's bar: on current-state surfaces (READMEs, docs, JSDoc) a resolvable change story is still change narration, and class 3 routes it to its sanctioned home.

## Taxonomy

1. **Dead design-session citations** — `(decision 7)`, `(audit C2)`, `design §4.7`, `plan §1.4`, phase labels (`T4`, `W3`, `P-I`), "the design ledger", "(B ruling)". If the decision has a committed owner, cite it by name and path; otherwise delete the citation and restate its factual clause to stand alone.
2. **Stack and PR vantage** — "a later PR in this stack", "this PR adds", "the previous commit". State the shipped mechanism or the extension point; deferred work moves to a `TODO` marker or an issue reference.
3. **Change narration and version stamps** — "used to", "no longer", "the old X", and indexical stamps ("v1", "this cut", "today", "now" contrasting with a past state). State the present behavior; a fixed regression becomes a present-tense counterfactual ("without X, Y happens"), never repo history ("used to Y").
4. **Review choreography** — "Rejected in review:", "the reviewer confirmed", draft ordinals ("v5 of this note"), round attributions. Keep the surviving decision and rationale as plain fact; delete who said it when.
5. **Reviewer-addressed justification** — "the cast is safe — it simply…", "this is correct because…". A comment arguing its own correctness addresses a reviewer, not a maintainer. State the invariant that makes the code safe, or delete the comment if the code shows it.
6. **Restatement and derivation transcripts** — control-flow narration ("first we X, then we Y"), test walkthroughs, proofs of obvious branches. Delete; keep only a non-obvious contract or invariant.
7. **Hedges and planning residue** — "probably fine for now", "should be enough", deferrals with no marker. Promote to `TODO`/`FIXME` or restate as the actual bound; delete the hedge.
8. **Authoring-language slips** — untranslated working-language fragments (端, 设计稿, `---- 私有 ----` separators) in prose whose language is otherwise English, or the reverse in a zh counterpart. Translate or delete.

## What is not leakage

Unaided citation passes fail in both directions by deleting durable references and keeping dead ones. Apply these keep rules as written; [examples](references/examples.md) calibrates each:

- **Issue references** — `#1470`, `TODO(name):`, "issue #N owns the follow-up" resolve at HEAD; keep them on any surface, including READMEs. Do not relocate them to Agent Notes.
- **Merged-PR and issue citations inside Agent Notes and postmortems** — sanctioned evidence per the [documentation standard](../../../docs/AGENTS.md)'s change-story routing.
- **Suppression justifications** — `oxlint-disable … -- reason`, coverage-ignore reasons, empty-catch explanations are required prose; fix a false reason, never delete it.
- **Counterfactual-present regression pins** — "without X, Y happens", "a naive X would…".
- **Measured bounds** — "(measured: 512 nests ≈ 0.15s)" calibrating a constant; the provenance word "measured" is load-bearing.
- **Runtime old/new states** — "the old connection drains before the new one accepts" is runtime lifecycle, not change history.
- **Historical stage names inside a note's change-story sections** — "the first cut shipped X" is current-state-safe there; indexical stamps ("this cut") stay banned everywhere.
- **External references that resolve outside the repo by design** — standards sections (RFC 9110 §10.1.5), Figma frame names; the §-ban covers uncommitted internal drafts, not external standards or committed docs that own their §-numbering.
- **Project voice and genre forms** — "we" as project voice; a note's Alternatives-considered section.

## Workflow

1. Scope and exclusions per [dsh-prose-standard](../dsh-prose-standard/SKILL.md): require an explicit scope; never touch `vendor/`, `.agents/notes/archived/`, or recorded fixtures and snapshots — recorded model output and sealed history keep their original voice.
2. Audit read-only first: run the [recall batteries](references/recall-batteries.md), then judge every hit semantically. 最小可跑命令（scope 为审查目标，如 `docs/ packages/dsh-user/src`；exclusions 放最后）：

```sh
SCOPE='<scope>'   # 例：docs/ packages/dsh-user/src
# 中文泄漏探针（-i 覆盖句首大写；rg 默认跳过 .agents——需 --hidden）
rg -n --hidden -i '设计稿|评审|上一?轮|旧版|老的|不再|以前|本版|遗留' $SCOPE \
  --glob '!vendor/**' --glob '!node_modules/**' --glob '!.agents/notes/archived/**' \
  --glob '!.agents/skills/dsh-trim-cot-leakage/**'
# 英文泄漏探针（零命中模式先对已知正例验证，勿信空结果）
rg -n --hidden -i 'this PR|this branch|used to |no longer|previously|rejected in review|review round' $SCOPE \
  --glob '!vendor/**' --glob '!node_modules/**'
# .agents 内 Agent Notes（最大漏检源）单跑
rg -n --hidden -i '评审|上一?轮|旧版|不再|this PR|used to ' .agents/notes/implemented/ \
  --glob '!**/archived/**'
```

判读：batteries 是 probe 不是定义——每个命中做语义判断（见 Taxonomy/已知误报族）；batteries 漏检过案例，故仍需对范围内最密的散文（模块 JSDoc/README/Agent Note）做一次无模式通读。
3. Fix owner-first per surface: generated catalogs → fix the source JSDoc or generator template, then regenerate; model-visible strings → wording is behavior, so flag for a snapshot-backed change instead of silently rewording.
4. Before deleting anything, enumerate the passage's propositions (prose-standard) and check the [overcorrection traps](references/examples.md#overcorrection-traps): trims that flip an obligation into an endorsement, promote a hypothetical to a shipped feature, delete a true fact, or drop provenance.
5. Verify: re-run the batteries expecting only sanctioned keeps, this skill's own directory, and the owning note's quoted evidence; confirm every remaining citation resolves at HEAD; run the repository's standing checks for touched surfaces:

```sh
pnpm typecheck 2>/dev/null || true   # 触 src 时必过（纯文档可跳）
git diff --check
git status --short | grep -vE '^\?\?'   # 无意外新增
```
