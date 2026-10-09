# Tutorial 3: turn mistakes into rules

Goal: make the next task better because of what this one taught you.

## 1. Let the AI write a diary

After each coached step the AI records:

- **Interpretations**: how it read your request
- **Deviations**: where it did something different from what you literally asked
- **Trade-offs**: what it chose, and why
- **Open questions**

## 2. Keep what is worth keeping

You tick the items that deserve to become rules. Nothing is kept automatically. Kept items are written to `vault/memory/`:

- **Project rules** are carried into later tasks of the same project.
- **Team rules** are carried into every task.

Rules are read once when a task starts. Something you keep mid-task affects the *next* task, so a running task never changes under you.

## 3. Get asked again

Kept rules come back as recall questions on a spaced schedule. Answers are saved. They are not auto-graded, because the point is that you re-think it, not that a machine scores you.

## 4. See what you changed

Every coach call stores the exact prompt, the reply, before and after revisions and the learning suggestion (what changed, why, evidence, the principle, a better question next time). Failures are stored too, with the result marked failed or unknown.
