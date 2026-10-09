# Security Policy

Mentor is a local tool that launches CLIs you are already logged in to, so security reports are taken seriously.

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's private vulnerability reporting ("Security" tab, "Report a vulnerability") on this repository.

Include what you found, how to reproduce it, and the impact. We aim to acknowledge reports within 7 days.

## Scope

In scope: path traversal or symlink escape from the task output folder, CSRF or Host/Origin bypass, running a CLI with broader permissions than the stage allows, anything that lets one task read or write another task's data.

Out of scope: vulnerabilities in the CLIs Mentor launches (report those upstream), and attacks that need an attacker who already controls your machine.

## Design commitments

- Loopback only, with `Host` and `Origin` checks.
- Same-origin cookie, CSRF token and `Idempotency-Key` on every state-changing request.
- CLIs are called with `argv` and `stdin`, never through a shell, and never with a "bypass permissions" flag.
- Stages get the least access they need (chat-only, read-only, or write in the output folder). Enforcement depends on the CLI: Codex uses its sandbox; Claude Code and Copilot use tool allow-lists plus the working directory. Mentor adds no extra sandbox.
