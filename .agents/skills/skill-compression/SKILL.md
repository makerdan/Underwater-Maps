---
name: Skill Compression
description: >-
  Refine a user-designated custom skill's instructional text for clarity and
  concision without sacrificing correctness, safety, scope, required behavior,
  or adherence. Use this skill whenever a user asks to shorten, tighten,
  simplify, clarify, or improve a custom skill prompt, especially when it has
  safety boundaries, procedural steps, exceptions, or domain terminology.
---

# Skill Compression

Refine a custom skill's instructions without treating brevity as the primary
goal. Preserve what the skill must do, when it must trigger, what it must not
do, and how it must respond. Produce a preview by default; never overwrite the
authoritative source without explicit user approval.

## 1. Establish the invocation contract

Before reading or changing a target, identify:

- **Target designation:** the skill name or exact source-file path supplied by
  the user.
- **Requested scope:** default to the target's instructional text only. Treat
  any request to change metadata, resources, scripts, tests, or mirrors as a
  scope expansion that requires explicit confirmation.
- **Mode:** use `preview` unless the user explicitly requests applying a
  particular approved candidate. A request to "compress" is not approval to
  overwrite.
- **Output:** return the candidate text, a concise diff, risks and findings,
  an apply-or-reject recommendation, and the required change list.

Do not infer a target from a topic, the most recently viewed file, or a similar
name. If the designation is missing, ambiguous, inaccessible, or resolves to
more than one possible source, ask the user for the target name or exact path
and stop. Do not begin brainstorming or editing while target selection is
unresolved.

If the target is this `Skill Compression` skill, refuse recursive invocation
and explain that the workflow cannot compress itself. Do not call this skill
again indirectly, and do not silently substitute another target.

## 2. Resolve and protect the authoritative source

Locate the human-authored, canonical source that defines the target skill.
Confirm all of the following before creating a candidate:

1. The source is the current instructional file, not a generated export,
   runtime mirror, copied snapshot, read-only installation, cache, or build
   output.
2. The source can be read in full and its identity is unambiguous.
3. Its metadata and instructional text can be distinguished without guessing
   where one ends and the other begins.
4. Any referenced resources or executable behavior are dependencies to inspect
   for understanding, not files to edit under the default scope.

If the source is generated, mirrored, read-only, stale, or otherwise
non-canonical, do not edit it. Report what makes it unsafe and request the
authoritative source. If canonical status cannot be established, stop rather
than choosing the most convenient copy.

By default, preserve the target's skill identity, trigger metadata, frontmatter
structure, referenced resources, scripts, and executable behavior exactly.
Propose changes to those surfaces only after the user explicitly expands scope
and approves that expansion separately. Never alter a runtime mirror to make
it match a candidate; the canonical-source owner is the only default write
target.

## 3. Capture the immutable baseline

Before any revision, capture an exact, immutable baseline containing:

- the complete current source text, including frontmatter and whitespace;
- the resolved canonical source identity;
- the boundary between metadata and instructional text;
- the requested scope and mode; and
- a read-only copy or equivalent content snapshot used for every comparison.

Label this `B0 — Baseline`. Never mutate, normalize, reserialize, or silently
repair `B0`. If the source changes during the workflow, discard all candidates,
recapture a new baseline, and restart the workflow. Every candidate and every
review must compare against both `B0` and the immediately preceding candidate.

Do not use a prior draft, a generated mirror, a memory of the file, or a
partial read as the baseline. If exact capture fails, stop and report that no
safe compression can be performed.

## 4. Build the invariant ledger

Read `B0` for meaning before proposing wording. Record an **Invariant Ledger**
with one entry for every applicable item below. Quote or paraphrase the
smallest text that proves each invariant, and mark each as explicit,
inferred-but-necessary, unresolved, or not applicable:

| Ledger area | Record |
|---|---|
| Triggers | When the skill must and must not be invoked |
| Requirements | Outcomes, quality bars, and non-negotiable behavior |
| Workflow steps | Required order, loops, counts, gates, and handoffs |
| Safety and authorization boundaries | Forbidden actions, permissions, consent, and data limits |
| Inputs | Required, optional, validated, and ambiguous inputs |
| Outputs | Files, text, formats, previews, reports, and user decisions |
| Exceptions | Failure, edge-case, retry, cancellation, and unavailable-input behavior |
| Escalation rules | When to stop, ask, defer, refuse, or seek approval |
| Tool and file constraints | Allowed tools, canonical files, read/write limits, and external dependencies |

Also record identity and trigger metadata as protected invariants, even when
the default scope excludes them. Do not resolve a contradiction by choosing
the more convenient interpretation. Mark the contradiction and identify the
competing passages. Mark unresolved ambiguity and domain-specific terminology
as findings that candidates must preserve or surface.

The ledger is the semantic contract. A shorter sentence is not an improvement
if any ledger item becomes weaker, less precise, less observable, or harder to
follow.

## 5. Represent and compare candidates

Represent each candidate as a complete proposed instructional text plus:

- its source label (`B0`, round candidate, pass candidate, or final candidate);
- a concise diff from `B0` and from the prior candidate;
- ledger coverage and any changed invariant interpretations;
- unresolved contradictions, ambiguity, domain terms, and risks; and
- the reason each change is safer or clearer, or why a no-op was retained.

Keep `B0` and every earlier candidate available for comparison. Do not compare
only word counts. Evaluate semantic coverage, decision clarity, safety,
scope, adherence, and user-visible outputs before considering length.

## 6. Run exactly two brainstorm-and-iterate rounds

Run the following two rounds, in order, before Final Review. Do not add,
remove, merge, or repeat a round. These rounds are exploratory reviews, not
the three compression passes below.

### Brainstorm-and-iterate Round 1 — find safe opportunities

Review `B0` and the ledger for loopholes, duplicated instructions, hidden
assumptions, human-error paths, weak boundaries, and unnecessary wording.
Generate multiple possible improvements, including the possibility of no
change. Reject any idea that depends on an unstated interpretation. Apply only
ideas that preserve every invariant and produce `C1`; otherwise retain `B0`.
Record rejected ideas and the risk that caused each rejection.

### Brainstorm-and-iterate Round 2 — challenge and iterate

Independently challenge `C1` against `B0` and the ledger. Look for conflicting
instructions, dropped exceptions, accidental scope expansion, ambiguous
pronouns or references, unsafe authorization implications, and instructions a
future agent could reasonably misread. Iterate on only demonstrably safe
improvements to produce `C2`, or retain the strongest earlier candidate as a
no-op. Record why `C2` is better, equal, or rejected.

Do not treat brainstorming as permission to edit the target. Both rounds
operate on snapshots and produce candidates only. Do not describe a brainstorm
round as a compression pass.

## 7. Run exactly three ordered compression and clarification passes

Run exactly these three passes, in order, on the strongest candidate from the
two rounds. Each pass must compare its result with `B0` and the prior
candidate, then record ledger coverage, risks, and rejected alternatives.
Every pass may be a reviewed no-op. If a later candidate is not demonstrably
better, retain the strongest earlier wording rather than forcing reduction.

### Pass 1 — Remove redundancy

Remove repeated meaning, unnecessary restatement, filler, and duplicate
examples only when doing so leaves each invariant, exception, boundary, and
required output explicit or unambiguously covered. Do not combine statements
when the combination hides a condition, changes precedence, or weakens
adherence. Call the result `P1`, or retain the prior candidate as a no-op.

### Pass 2 — Clarify decision boundaries

Make conditions, permissions, stop rules, inputs, outputs, exceptions, and
escalation points explicit. Replace vague references only when the baseline
supports the intended meaning. Preserve deliberate terminology and expose
contradictions or unresolved ambiguity instead of guessing. Call the result
`P2`, or retain the strongest prior candidate as a no-op.

### Pass 3 — Polish language and ordering

Improve grammar, parallel structure, scanability, and instruction order
without changing meaning, scope, priority, or required counts. Keep concrete
domain terms when they carry meaning. Do not turn a required action into a
suggestion, or a stop condition into an optional note. Call the result `P3`,
or retain the strongest prior candidate as a no-op.

The pass order is mandatory: do not polish before clarifying boundaries, and
do not remove redundancy based on wording introduced by a later pass.

## 8. Apply correctness-first stop conditions

At any point, stop the affected change and retain earlier wording when
shortening, merging, reordering, or generalizing would:

- drop, weaken, or obscure correctness, safety, authorization, scope, or
  adherence;
- remove a required trigger, workflow step, exception, escalation rule,
  input, output, tool constraint, or file constraint;
- make a decision boundary depend on inference or unstated context;
- change the identity or trigger metadata by default;
- hide or resolve a contradiction or unresolved ambiguity without evidence;
- replace necessary domain terminology with a misleading generic term;
- make frontmatter malformed or make the instructional text structurally
  ambiguous;
- target a non-canonical, generated, mirrored, inaccessible, or read-only file;
  or
- cause recursive self-invocation or any unapproved scope expansion.

A stop condition is not a failure of compression. Record the finding, retain
the safer wording, and explain why the shorter alternative was rejected. A
no-op is a valid result for a round or pass. Never force a word-count
reduction, and never silently repair a contradiction as if it were a wording
problem.

## 9. Perform adversarial acceptance checks

Before Final Review, test the strongest candidate against representative
scenarios. Use the target's actual content, not invented application-specific
examples. At minimum, check:

1. **Concise target:** a short skill still retains every trigger, boundary,
   output, and stop rule.
2. **Safety-sensitive target:** permissions, consent, refusal, privacy, and
   authorization cannot be inferred away.
3. **Procedural target:** order, exact counts, gates, retries, and handoffs
   remain executable.
4. **Exception-heavy target:** failures, missing inputs, cancellation,
   escalation, and recovery behavior remain distinct.
5. **Contradictory target:** conflicting baseline instructions remain visible
   as findings and are not silently harmonized.
6. **Domain-specific target:** necessary terms retain their meaning and are
   not replaced by generic wording merely to sound portable.

For each check, record the scenario, the relevant ledger entries, the result,
and any candidate change or retained wording. If a check exposes a risk, stop
that change and return to the strongest safe earlier candidate.

## 10. Conduct Final Review in two separate stages

Final Review happens after both brainstorm rounds and all three ordered
passes. Perform these stages separately and record their results.

### Final Review A — semantic fidelity

Compare `P3` (or the retained strongest candidate) with `B0`, the ledger, and
all adversarial findings. Confirm that every applicable trigger, requirement,
step, boundary, input, output, exception, escalation rule, tool constraint,
and file constraint is still present and has the same force and scope.
Confirm that protected identity and trigger metadata remain unchanged unless
the user explicitly expanded scope. Reject the candidate if any invariant is
weaker, missing, ambiguous, or contradicted.

### Final Review B — general language

Remove accidental framing tied to a particular workspace, repository,
provider, framework, or implementation environment when that framing is not
necessary to the target's meaning. Keep target-specific terms that are
necessary for precision, safety, or correct execution. Do not generalize away
canonical-source distinctions, file/tool constraints, or domain vocabulary
that the target genuinely requires. Surface, rather than rewrite away, any
contradiction that cannot be resolved from `B0`.

If either review fails, retain the strongest safe earlier candidate and report
the failed check. Do not reopen completed passes or invent a fourth pass.

## 11. Preview, approval, and safe application

The default response is a preview with this exact content:

1. **Proposed instructional text** — the complete candidate, not an excerpt.
2. **Concise diff** — the meaningful changes from `B0`, plus any protected
   metadata and out-of-scope content explicitly marked unchanged.
3. **Unresolved risks and findings** — contradictions, ambiguity, rejected
   shorter alternatives, and any stop conditions.
4. **Recommendation** — `Apply` only if all checks pass, otherwise `Reject`
   or `Retain baseline`, with a short reason.
5. **Change list** — the itemized report required in the next section.

Ask for explicit approval before writing. Approval must clearly identify the
candidate to apply; silence, a request for preview, or an ambiguous response
is not approval. If the user rejects it, do not write. If the user requests
changes, create a new candidate from the immutable baseline and repeat the
required comparisons; do not edit the target in place.

After explicit approval, write only the approved scope to the authoritative
source. Preserve metadata and all referenced resources or executable behavior
outside the approved scope. Re-read the source, verify that it equals the
approved candidate within the approved scope, and report any write mismatch
as a failure rather than silently retrying on another file.

## 12. Report every proposed change

End both preview and applied responses with a concise, itemized change list.
Cover every category below; write `None` when it has no entries:

- **Accepted changes:** each accepted wording or ordering change with a short
  explanation of the preserved meaning or improved clarity.
- **Materially shorter rejected alternatives:** each shorter option that was
  considered but rejected, with the invariant, ambiguity, safety boundary, or
  other reason it was unsafe or weaker.
- **Retained wording:** wording intentionally left unchanged, with why it is
  necessary, already clear, or protected.
- **Unresolved wording and findings:** each contradiction, ambiguity, domain
  term, or source concern left visible, with what user decision or evidence is
  needed.
- **Scope and source status:** the authoritative source used, the scope applied,
  and confirmation that metadata, resources, scripts, and mirrors were not
  changed unless explicitly approved.

Do not claim that a change was accepted if it was only brainstormed, rejected,
or retained from an earlier candidate. The report must account for every
proposed change, not merely the final diff.

## 13. Self-check before finishing

Before presenting the recommendation or applying an approved candidate, verify:

- the frontmatter parses and the skill name and trigger description are intact;
- the target was explicitly designated and the source is canonical;
- `B0` was captured before any revision and remained immutable;
- the invariant ledger covers all required areas;
- exactly two brainstorm-and-iterate rounds were completed;
- exactly three passes ran in the order redundancy, decision boundaries,
  language and ordering;
- every pass compared with `B0` and the prior candidate, including no-ops;
- stop conditions, contradiction handling, domain-term handling, and the
  recursion guard were applied;
- all six adversarial check categories were addressed;
- Final Review checked semantic fidelity before general language;
- the preview includes complete text, diff, risks, and recommendation;
- explicit approval gates every write to the authoritative source;
- the final change list covers accepted, rejected, retained, and unresolved
  wording; and
- no workspace-specific branding, paths, frameworks, provider assumptions, or
  unrelated files were introduced.

If any check fails, do not apply the candidate. Report the failed check and
retain the safest available wording.