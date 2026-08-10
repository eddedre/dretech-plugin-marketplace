#!/usr/bin/env node
// Dispatch one or more prompts to non-Anthropic models via `opencode run`.
// Claude Code's Agent tool only spawns Anthropic models; this bridge reaches
// GPT/Codex/Qwen/etc. through the OpenCode CLI.
//
// Usage: node dispatch.mjs <tasks.json>
//
// tasks.json:
// [
//   { "id": "review-spec", "model": "provider/model", "agent": "optional-agent",
//     "prompt": "...", "cwd": "/path", "timeoutMs": 180000 },
//   ...
// ]
//
// Prompt goes on STDIN (not argv) — no Windows ~30KB limit; EOF is required.
//
// Output (stdout):
// { "schemaVersion": 1, "results": [ { id, model, agent, status, exitCode,
//   timedOut, durationMs, startedAt, finishedAt, stdout, stderr, artifactPath } ] }
//
// status: ok | empty | cli_error | timeout | preflight_failed

import { spawn, execFile } from "node:child_process";
import { readFileSync, writeFileSync, renameSync, mkdirSync, createWriteStream, existsSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 180_000;
const OPENCODE_BIN = process.env.OPENCODE_BIN || "opencode";
const SKIP_PREFLIGHT = process.env.DRETECH_DISPATCH_SKIP_PREFLIGHT === "1";
const children = [];
let shuttingDown = false;
function onSignal() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const ch of children.slice()) {
    try { killTree(ch && ch.pid); } catch {}
  }
}
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);

export function isEmptyOutput(raw) {
  // eslint-disable-next-line no-control-regex
  const cleaned = String(raw || "")
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .split("\n")
    .filter((line) => !/^\s*>\s*build\b/.test(line))
    .filter((line) => line.trim().length > 0)
    .join("\n")
    .trim();
  // Truly empty / whitespace-only only. Short success tokens like "Done." are ok.
  return cleaned.replace(/\s+/g, "").length === 0;
}

export function classifyStatus({ timedOut, exitCode, stdout }) {
  if (timedOut) return "timeout";
  if (exitCode === null || exitCode === undefined) return "cli_error";
  if (exitCode !== 0) return "cli_error";
  if (isEmptyOutput(stdout)) return "empty";
  return "ok";
}

export function mapEnvelopeToJobStatus({ envelopeStatus, role, workerContract }) {
  if (envelopeStatus === "timeout") return "timeout";
  if (envelopeStatus === "contract_failed") return "contract_failed";
  if (envelopeStatus === "ok") {
    if (role === "worker") {
      if (workerContract && workerContract.status === "succeeded") {
        return "completed";
      }
      return "contract_failed";
    }
    return "completed";
  }
  if (envelopeStatus === "empty" || envelopeStatus === "cli_error" || envelopeStatus === "preflight_failed") {
    return "failed";
  }
  return "failed";
}

export function validateWorkerResult(obj, { jobId, runId }) {
  const errors = [];
  if (!obj || typeof obj !== "object") {
    errors.push("not an object");
    return { ok: false, errors };
  }
  if (obj.schemaVersion !== 1) {
    errors.push("schemaVersion must be 1");
  }
  if (obj.jobId !== jobId) {
    errors.push("jobId mismatch");
  }
  if (obj.runId !== runId) {
    errors.push("runId mismatch");
  }
  const validStatuses = ["succeeded", "failed", "blocked"];
  if (!validStatuses.includes(obj.status)) {
    errors.push("invalid status");
  }
  if (typeof obj.summary !== "string" || obj.summary.trim().length === 0) {
    errors.push("summary must be non-empty string");
  }
  for (const k of ["commits", "filesChanged", "checks", "blockers"]) {
    if (!Array.isArray(obj[k])) {
      errors.push(k + " must be array");
    }
  }
  if (obj.status === "succeeded") {
    const commits = Array.isArray(obj.commits) ? obj.commits : [];
    const files = Array.isArray(obj.filesChanged) ? obj.filesChanged : [];
    if (commits.length === 0 && files.length === 0) {
      errors.push("commits or filesChanged must be non-empty for succeeded");
    }
  }
  return { ok: errors.length === 0, errors };
}

export function isValidRunId(s) {
  if (typeof s !== "string") return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(s);
}

export function resolveRuntimeRoot(cwd) {
  const base = path.resolve(cwd || process.cwd());
  const root = path.resolve(base, ".dretech");
  const rel = path.relative(base, root);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("runtime root escapes cwd");
  }
  return root;
}

function atomicWriteJson(p, obj) {
  const tmp = p + ".tmp." + randomUUID();
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, p);
}

async function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/pid", String(pid), "/T", "/F"]);
    } catch {
      /* already gone */
    }
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
}

function runCapture(bin, args, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      killTree(child.pid);
    }, timeoutMs);
    child.stdout.on("data", (c) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: err.message, exitCode: null });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr, exitCode: code });
    });
  });
}

async function preflightModels(tasks) {
  const ver = await runCapture(OPENCODE_BIN, ["--version"]);
  if (!ver.ok) {
    return {
      ok: false,
      reason: `opencode --version failed: ${ver.stderr || ver.stdout || "not found"}`,
    };
  }
  const models = await runCapture(OPENCODE_BIN, ["models"], 60_000);
  if (!models.ok) {
    return {
      ok: false,
      reason: `opencode models failed: ${models.stderr || models.stdout || "error"}`,
    };
  }
  const catalog = models.stdout;
  for (const t of tasks) {
    if (!t.model || typeof t.model !== "string") {
      return { ok: false, reason: `task ${t.id || "?"}: missing model` };
    }
    // Exact line match preferred; also accept substring for provider/model lines
    const lines = catalog.split("\n").map((l) => l.trim()).filter(Boolean);
    const hit =
      lines.some((l) => l === t.model) ||
      lines.some((l) => l.endsWith(t.model) || l.includes(t.model));
    if (!hit) {
      return {
        ok: false,
        reason: `model not in opencode models catalog: ${t.model}`,
      };
    }
  }
  return { ok: true, version: ver.stdout.trim() };
}

function prepareJob(task) {
  const cwd0 = task.cwd || process.cwd();
  const runtimeRoot = resolveRuntimeRoot(cwd0);
  let runId = task.runId || process.env.DRETECH_RUN_ID || null;
  const jobId = randomUUID();
  let runDir;
  if (!runId) {
    runDir = path.join(runtimeRoot, "runs", "ad-hoc", jobId);
  } else if (!isValidRunId(runId)) {
    runId = null;
    runDir = path.join(runtimeRoot, "runs", "ad-hoc", jobId);
  } else {
    runDir = path.join(runtimeRoot, "runs", runId);
  }
  const jobDir = path.join(runDir, "jobs", jobId);
  mkdirSync(jobDir, { recursive: true });
  const workerResultPath = path.join(jobDir, "worker-result.json");
  const statePath = path.join(jobDir, "state.json");
  const resultPath = path.join(jobDir, "result.json");
  const stdoutLogPath = path.join(jobDir, "stdout.log");
  const stderrLogPath = path.join(jobDir, "stderr.log");
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const role = task.role || "other";
  atomicWriteJson(statePath, {
    status: "running",
    jobId,
    runId: runId || null,
    role,
    model: task.model ?? null,
    agent: task.agent ?? null,
    startedAt,
    finishedAt: null,
    lastError: null,
  });
  return {
    task,
    jobId,
    runId: runId || null,
    runDir,
    jobDir,
    workerResultPath,
    statePath,
    resultPath,
    stdoutLog: stdoutLogPath,
    stderrLog: stderrLogPath,
    role,
    startedAt,
    start,
  };
}

function runJobWithLogs(ctx) {
  const { task, jobId, runId, runDir, jobDir, workerResultPath, statePath, resultPath, stdoutLog, stderrLog, role, startedAt, start } = ctx;
  const model = task.model;
  const agent = task.agent || null;
  const cwd = task.cwd || process.cwd();
  let prompt = task.prompt || "";
  const cenv = {
    ...process.env,
    DRETECH_JOB_ID: jobId,
    DRETECH_RUN_ID: runId || "",
    DRETECH_WORKER_RESULT_PATH: workerResultPath,
  };
  if (role === "worker") {
    const inj = "\n\nWORKER_RESULT_PATH=" + workerResultPath + "\nDRETECH_JOB_ID=" + jobId + "\nDRETECH_RUN_ID=" + (runId || "") + "\nYou MUST write worker-result.json to WORKER_RESULT_PATH before finishing.\n";
    prompt = prompt + inj;
  }
  const args = [
    "run",
    "--model",
    model,
    "--dangerously-skip-permissions",
    "--dir",
    cwd,
  ];
  if (agent) args.push("--agent", agent);
  return new Promise((resolve) => {
    const outStream = createWriteStream(stdoutLog, { flags: "a" });
    const errStream = createWriteStream(stderrLog, { flags: "a" });
    const child = spawn(OPENCODE_BIN, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: cenv,
    });
    children.push(child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const to = task.timeoutMs || DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, to);
    child.stdout.on("data", (chunk) => {
      const s = chunk.toString();
      stdout += s;
      outStream.write(s);
    });
    child.stderr.on("data", (chunk) => {
      const s = chunk.toString();
      stderr += s;
      errStream.write(s);
    });
    try {
      child.stdin.end(prompt ?? "");
    } catch {}
    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      outStream.end();
      errStream.end();
      const finishedAt = new Date().toISOString();
      const outTrim = stdout.trim();
      const errTrim = stderr.trim();
      let envelopeStatus = classifyStatus({ timedOut, exitCode, stdout: outTrim });
      let workerContract = null;
      if (role === "worker") {
        if (existsSync(workerResultPath)) {
          try {
            workerContract = JSON.parse(readFileSync(workerResultPath, "utf8"));
            const vr = validateWorkerResult(workerContract, { jobId, runId: runId || "" });
            if (!vr.ok) {
              workerContract = null;
              envelopeStatus = "contract_failed";
            }
          } catch {
            workerContract = null;
            envelopeStatus = "contract_failed";
          }
        } else {
          envelopeStatus = "contract_failed";
        }
        if (workerContract && workerContract.status !== "succeeded") {
          envelopeStatus = "contract_failed";
        }
      }
      const jobStatus = mapEnvelopeToJobStatus({ envelopeStatus, role, workerContract });
      const resItem = {
        id: task.id,
        jobId,
        runId: runId || null,
        role,
        model,
        agent,
        status: envelopeStatus,
        exitCode,
        timedOut,
        durationMs: Date.now() - start,
        startedAt,
        finishedAt,
        stdout: outTrim,
        stderr: errTrim,
        artifactPath: null,
      };
      atomicWriteJson(resultPath, resItem);
      const termState = {
        status: jobStatus,
        jobId,
        runId: runId || null,
        role,
        model,
        agent,
        startedAt,
        finishedAt,
        lastError: shuttingDown ? "interrupted" : (timedOut ? "timeout" : (exitCode !== 0 ? "cli_error" : null)),
        envelopeStatus,
      };
      atomicWriteJson(statePath, termState);
      if (role === "worker" && jobStatus === "completed") {
        const latestPath = path.join(runDir, "latest-worker.json");
        atomicWriteJson(latestPath, { jobId, finishedAt });
      }
      const idx = children.indexOf(child);
      if (idx >= 0) children.splice(idx, 1);
      resolve(resItem);
    };
    child.on("close", (exitCode) => finish(exitCode));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      outStream.end();
      errStream.end();
      const finishedAt = new Date().toISOString();
      const resItem = {
        id: task.id,
        jobId,
        runId: runId || null,
        role,
        model,
        agent,
        status: "cli_error",
        exitCode: null,
        timedOut: false,
        durationMs: Date.now() - start,
        startedAt,
        finishedAt,
        stdout: stdout.trim(),
        stderr: "spawn error: " + err.message,
        artifactPath: null,
      };
      atomicWriteJson(resultPath, resItem);
      atomicWriteJson(statePath, {
        status: "failed",
        jobId,
        runId: runId || null,
        role,
        model,
        agent,
        startedAt,
        finishedAt,
        lastError: err.message,
        envelopeStatus: "cli_error",
      });
      const idx = children.indexOf(child);
      if (idx >= 0) children.splice(idx, 1);
      resolve(resItem);
    });
  });
}

async function main() {
  const tasksPath = process.argv[2];
  if (!tasksPath) {
    console.error("Usage: node dispatch.mjs <tasks.json>");
    process.exit(2);
  }

  const tasks = JSON.parse(readFileSync(tasksPath, "utf8"));
  if (!Array.isArray(tasks) || tasks.length === 0) {
    console.error("tasks.json must be a non-empty array");
    process.exit(2);
  }

  const jobContexts = tasks.map(prepareJob);

  if (!SKIP_PREFLIGHT) {
    const pf = await preflightModels(tasks);
    if (!pf.ok) {
      const now = new Date().toISOString();
      const results = jobContexts.map((ctx) => {
        const resItem = {
          id: ctx.task.id,
          jobId: ctx.jobId,
          runId: ctx.runId,
          role: ctx.role,
          model: ctx.task.model ?? null,
          agent: ctx.task.agent ?? null,
          status: "preflight_failed",
          exitCode: null,
          timedOut: false,
          durationMs: 0,
          startedAt: ctx.startedAt,
          finishedAt: now,
          stdout: "",
          stderr: pf.reason,
          artifactPath: null,
        };
        atomicWriteJson(ctx.resultPath, resItem);
        atomicWriteJson(ctx.statePath, {
          status: "failed",
          jobId: ctx.jobId,
          runId: ctx.runId,
          role: ctx.role,
          model: ctx.task.model ?? null,
          agent: ctx.task.agent ?? null,
          startedAt: ctx.startedAt,
          finishedAt: now,
          lastError: pf.reason,
          envelopeStatus: "preflight_failed",
        });
        return resItem;
      });
      process.stdout.write(
        JSON.stringify({ schemaVersion: 1, results }, null, 2) + "\n",
      );
      process.exit(0);
    }
  }

  const results = await Promise.all(jobContexts.map(runJobWithLogs));
  process.stdout.write(
    JSON.stringify({ schemaVersion: 1, results }, null, 2) + "\n",
  );
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("dispatch.mjs") ||
    process.argv[1].includes("dispatch.mjs"));

if (isMain) {
  main().catch((err) => {
    console.error("dispatch.mjs fatal error:", err);
    process.exit(1);
  });
}
