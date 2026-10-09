# Design intent

## One sentence

**The task file is the shared source of truth between a human and any AI. The AI reads it before starting and writes back when it stops. The human only decides and reviews.**

Mentor has two goals: get delegated work finished in an orderly way, and help the user remember the judgment calls that made it work, through coach feedback and active recall.

The harness's job is to upgrade the user. People should stop being couriers: no scrolling through chats, no re-explaining background, no checking file versions by hand.

## Where the pain is

These are the failure patterns that shaped the design. They come from real multi-agent work, described generically.

| What happened | Who became the bottleneck | What Mentor does |
|---|---|---|
| Agent A got to v12, agent B took it to v29, and the user edited and renamed a file in between | The user had to remember which file was latest | SHA-256 check on the artifact. A human edit becomes the new baseline. |
| An agent asked a question, did not wait, and proceeded with a default | The decision was buried inside the output | Decisions are separate cards. An AI may not pick a default. |
| A metric definition and a data range were wrong; a stakeholder caught it live | The user re-verified numbers on every version | A facts table. The brief tells the AI to copy it verbatim. |
| Every version after one point got worse, and nobody could say what changed | No record of what each version changed | Reports are bound to a revision and the new artifact. |
| Exit code 0 was treated as "done" | The user believed it was finished | `DONE` only means "ready for review". The checklist resets and waits for a human. |

## Three core objects

1. **Task.** Goal, boundaries (allowed, locked, forbidden), the AI's single next step.
2. **Decision.** Only a human can resolve it. Each card has a recommendation, a basis, the cost of each option and what is unknown. "Ask someone else" is a waiting state, not a resolution.
3. **Evidence.** Automatic checks (the server hashes the artifact) and manual checks are separate. Results are `PASS`, `FAIL` or `NOT_RUN`.

Everything else is derived. The home page's "the one thing you should do now" is computed from these three objects, and so is the handoff brief.

## The handoff loop

```
task file ──generate──▶ brief (≤ 8,000 chars) ──paste or run──▶ Codex / Claude / Copilot
   ▲                                                                  │
   └──── server checks revision, evidence, new artifact ◀── report ───┘
```

- The brief contains boundaries, confirmed decisions, open decisions, agreed numbers, the checklist and the report format. It does not contain chat history.
- A report must carry `TASK_ID`, `BASE_REVISION` and `STATUS`. `DONE` needs evidence. A report based on an old revision is rejected.
- An `ARTIFACT` line in a report rebinds the automatic check to the new file. The old file is kept.

## The home page ranks one thing

Order: pending decision, failed check, report awaiting review, manual check, hand to the AI. Anything an AI or the server can do should not appear on the human's list.

## Principles

- **Zero dependencies.** Fewer moving parts, easier to audit, trivial to run.
- **Human in the loop by construction.** Approvals must come from a person. The AI cannot approve itself.
- **Honest status.** A restart marks unfinished steps as "unknown" rather than re-running. Sensors only advise; they do not pretend to be acceptance.
- **Local first.** Markdown on your disk. No account, no cloud.
