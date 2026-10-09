# Tutorial 1: your first task in 5 minutes

Goal: see the whole loop once, with fictional data and no CLI needed.

## 1. Start the demo

```sh
npm run demo
```

Open <http://127.0.0.1:4317>. You see three fictional tasks and one card at the top: **"Decide: 7-day or 30-day active users?"**

## 2. Decide

Click **決定並繼續** ("Decide and continue"). Each option shows its cost and what is still unknown. Pick one. The task moves on, and the top card switches to the next thing that needs *you*.

The point: the home page shows exactly one thing for you. Everything an AI or the server can do is kept off your list.

## 3. Look at the task file

Open `.demo-home/vault/TASK-demo-0001.md` in any editor or Obsidian. Compare it with [`examples/sample-task.md`](../../examples/sample-task.md). Add a line under the human notes section and click around in the UI again. Your line is still there, because the server only rewrites the generated block.

## 4. Review

Open the "新人上手指南" task and click **開始驗收**. Auto checks (file hash) are already filled by the server. The manual check is yours: write how you confirmed it before marking it passed.

## Next

[Tutorial 2](02-handoff.md): hand the same task to a second AI.
