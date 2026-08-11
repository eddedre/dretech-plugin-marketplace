---
name: worker
description: Execute a reviewed DreTech plan with a bounded worker and independent verification.
---

# Reviewed worker

Use this skill only after spec review and plan review have produced bound manifests.

1. Run the role-workflow handoff check from the repository root.
2. Write `latest-worker.json` when dispatch begins and again at terminal completion.
3. Execute only the exact commands in the plan's `## Verification` section. Each command runs from the repository root with the inherited environment and a five-minute timeout.
4. Stop at the first failed command. Preserve partial commits and mark the run failed; never roll back or resume a failed run.

The worker must write a JSON `worker-result.json` at `DRETECH_WORKER_RESULT_PATH` containing the run id, status, and a task-sized commit summary. A worker result is evidence, not permission to skip independent verification.

Interactive launcher mode always invokes the Haiku steward. Headless mode dispatches directly. Any other launcher mode, or an interactive worker that cannot be spawned, fails closed.
