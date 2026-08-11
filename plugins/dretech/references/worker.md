# Worker contract

Workers receive a plan only after both review manifests and the plan digest pass validation. They run from the project root and produce task-sized commits. The worker writes `worker-result.json` to the path in `DRETECH_WORKER_RESULT_PATH`; the result includes the run id, terminal status, and commit summary.

The controller records `latest-worker.json`, preserves combined-output verification logs, and writes `verify.md` with command, timing, exit code, and log digest records. Verification stops at the first failure. Partial worker commits remain in history and failed runs are terminal.

Interactive mode uses the worker steward; headless mode dispatches directly. Manual provider smoke commands are intentionally separate from deterministic CI.
