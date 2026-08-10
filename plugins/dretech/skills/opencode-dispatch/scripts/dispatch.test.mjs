import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyStatus,
  isEmptyOutput,
  mapEnvelopeToJobStatus,
  validateWorkerResult,
  isValidRunId,
  resolveRuntimeRoot,
} from "./dispatch.mjs";
import path from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dispatchBin = path.resolve(__dirname, "dispatch.mjs");
const fakeBin = path.resolve(__dirname, "fake-opencode");

function tmp() {
  const d = path.join(tmpdir(), `dispatch-it-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}
function cleanup(d) {
  try { rmSync(d, { recursive: true, force: true }); } catch {}
}

test("empty output is empty", () => {
  assert.equal(isEmptyOutput(""), true);
  assert.equal(isEmptyOutput("   "), true);
  assert.equal(isEmptyOutput("ok enough content here yes"), false);
});

test("classifyStatus timeout", () => {
  assert.equal(
    classifyStatus({ timedOut: true, exitCode: null, stdout: "x".repeat(50) }),
    "timeout",
  );
});

test("classifyStatus ok", () => {
  assert.equal(
    classifyStatus({
      timedOut: false,
      exitCode: 0,
      stdout: "peer found three issues in the design document",
    }),
    "ok",
  );
});

test("classifyStatus cli_error", () => {
  assert.equal(
    classifyStatus({ timedOut: false, exitCode: 1, stdout: "" }),
    "cli_error",
  );
});

test("classifyStatus ok on short success token", () => {
  assert.equal(
    classifyStatus({ timedOut: false, exitCode: 0, stdout: "Done." }),
    "ok",
  );
});

test("classifyStatus empty on whitespace-only stdout", () => {
  assert.equal(
    classifyStatus({ timedOut: false, exitCode: 0, stdout: "  \n  " }),
    "empty",
  );
});

test("isValidRunId", () => {
  assert.equal(isValidRunId("c017b6"), true);
  assert.equal(isValidRunId("../x"), false);
  assert.equal(isValidRunId("a/b"), false);
});

test("mapEnvelopeToJobStatus ok worker succeeded", () => {
  assert.equal(
    mapEnvelopeToJobStatus({
      envelopeStatus: "ok",
      role: "worker",
      workerContract: { status: "succeeded" },
    }),
    "completed",
  );
});

test("mapEnvelopeToJobStatus ok worker missing contract", () => {
  assert.equal(
    mapEnvelopeToJobStatus({
      envelopeStatus: "ok",
      role: "worker",
      workerContract: null,
    }),
    "contract_failed",
  );
});

test("mapEnvelopeToJobStatus timeout", () => {
  assert.equal(
    mapEnvelopeToJobStatus({ envelopeStatus: "timeout", role: "other", workerContract: null }),
    "timeout",
  );
});

test("validateWorkerResult requires ids and succeeded shape", () => {
  const r = validateWorkerResult(
    {
      schemaVersion: 1,
      jobId: "j1",
      runId: "r1",
      attempt: 1,
      baseSha: "a".repeat(40),
      status: "succeeded",
      summary: "did the thing",
      commits: ["b".repeat(40)],
      filesChanged: ["hello.txt"],
      checks: [],
      blockers: [],
    },
    { jobId: "j1", runId: "r1" },
  );
  assert.equal(r.ok, true);
  const bad = validateWorkerResult({ schemaVersion: 1 }, { jobId: "j1", runId: "r1" });
  assert.equal(bad.ok, false);
});

test("resolveRuntimeRoot", () => {
  const r = resolveRuntimeRoot("/tmp/foo");
  assert.ok(r.endsWith(".dretech"));
  assert.ok(path.isAbsolute(r));
});

async function runDispatch(tasks, envOverrides = {}, cwdOverride) {
  const c = cwdOverride || tmp();
  const tp = path.join(c, "tasks.json");
  writeFileSync(tp, JSON.stringify(tasks));
  const env = { ...process.env, ...envOverrides, DRETECH_DISPATCH_SKIP_PREFLIGHT: envOverrides.DRETECH_DISPATCH_SKIP_PREFLIGHT || "1" };
  const { stdout, stderr } = await execFileAsync(process.execPath, [dispatchBin, tp], { env, cwd: c, maxBuffer: 10 * 1024 * 1024 });
  return { stdout, stderr, cwd: c, tasksPath: tp };
}

test("integration: peer/other creates job dir + envelope status ok", async () => {
  const c = tmp();
  const { stdout } = await runDispatch([{
    id: "peer-x",
    model: "m",
    prompt: "peer work",
    cwd: c,
    role: "crossreview",
  }], { OPENCODE_BIN: fakeBin }, c);
  const out = JSON.parse(stdout);
  assert.equal(out.schemaVersion, 1);
  const r0 = out.results[0];
  assert.equal(r0.status, "ok");
  assert.ok(r0.jobId);
  assert.equal(r0.role, "crossreview");
  const rt = resolveRuntimeRoot(c);
  const jobDir = path.join(rt, "runs", "ad-hoc", r0.jobId, "jobs", r0.jobId);
  assert.ok(existsSync(path.join(jobDir, "state.json")));
  assert.ok(existsSync(path.join(jobDir, "result.json")));
  assert.ok(existsSync(path.join(jobDir, "stdout.log")));
  assert.ok(existsSync(path.join(jobDir, "stderr.log")));
  const st = JSON.parse(readFileSync(path.join(jobDir, "state.json"), "utf8"));
  assert.equal(st.status, "completed");
  assert.equal(st.jobId, r0.jobId);
  const resf = JSON.parse(readFileSync(path.join(jobDir, "result.json"), "utf8"));
  assert.equal(resf.status, "ok");
  cleanup(c);
});

test("integration: worker no contract -> contract_failed", async () => {
  const c = tmp();
  const { stdout } = await runDispatch([{
    id: "w1",
    model: "m",
    prompt: "work",
    cwd: c,
    role: "worker",
  }], { OPENCODE_BIN: fakeBin }, c);
  const out = JSON.parse(stdout);
  const r0 = out.results[0];
  assert.equal(r0.status, "contract_failed");
  const rt = resolveRuntimeRoot(c);
  const jobDir = path.join(rt, "runs", "ad-hoc", r0.jobId, "jobs", r0.jobId);
  const st = JSON.parse(readFileSync(path.join(jobDir, "state.json"), "utf8"));
  assert.equal(st.status, "contract_failed");
  cleanup(c);
});

test("integration: worker write-contract -> completed + latest-worker.json", async () => {
  const c = tmp();
  const { stdout } = await runDispatch([{
    id: "w2",
    model: "m",
    prompt: "work",
    cwd: c,
    role: "worker",
    runId: "r123",
  }], { OPENCODE_BIN: fakeBin, FAKE_OPENCODE_MODE: "write-contract" }, c);
  const out = JSON.parse(stdout);
  const r0 = out.results[0];
  assert.equal(r0.status, "ok");
  assert.equal(r0.runId, "r123");
  const rt = resolveRuntimeRoot(c);
  const runDir = path.join(rt, "runs", "r123");
  const jobDir = path.join(runDir, "jobs", r0.jobId);
  assert.ok(existsSync(path.join(jobDir, "worker-result.json")));
  const st = JSON.parse(readFileSync(path.join(jobDir, "state.json"), "utf8"));
  assert.equal(st.status, "completed");
  const latest = JSON.parse(readFileSync(path.join(runDir, "latest-worker.json"), "utf8"));
  assert.equal(latest.jobId, r0.jobId);
  assert.ok(latest.finishedAt);
  cleanup(c);
});

test("integration: worker write-contract-failed -> contract_failed", async () => {
  const c = tmp();
  const { stdout } = await runDispatch([{
    id: "w3",
    model: "m",
    prompt: "work",
    cwd: c,
    role: "worker",
  }], { OPENCODE_BIN: fakeBin, FAKE_OPENCODE_MODE: "write-contract-failed" }, c);
  const out = JSON.parse(stdout);
  assert.equal(out.results[0].status, "contract_failed");
  cleanup(c);
});

test("integration: worker write-contract-blocked -> contract_failed", async () => {
  const c = tmp();
  const { stdout } = await runDispatch([{
    id: "w4",
    model: "m",
    prompt: "work",
    cwd: c,
    role: "worker",
  }], { OPENCODE_BIN: fakeBin, FAKE_OPENCODE_MODE: "write-contract-blocked" }, c);
  const out = JSON.parse(stdout);
  assert.equal(out.results[0].status, "contract_failed");
  cleanup(c);
});

test("integration: malformed contract file -> contract_failed", async () => {
  const c = tmp();
  const { stdout } = await runDispatch([{
    id: "w5",
    model: "m",
    prompt: "work",
    cwd: c,
    role: "worker",
  }], { OPENCODE_BIN: fakeBin, FAKE_OPENCODE_MODE: "write-contract-malformed" }, c);
  const out = JSON.parse(stdout);
  assert.equal(out.results[0].status, "contract_failed");
  cleanup(c);
});

test("integration: no runId -> .dretech/runs/ad-hoc/<jobId>/", async () => {
  const c = tmp();
  const { stdout } = await runDispatch([{
    id: "adhoc",
    model: "m",
    prompt: "hi",
    cwd: c,
  }], { OPENCODE_BIN: fakeBin }, c);
  const r0 = JSON.parse(stdout).results[0];
  const rt = resolveRuntimeRoot(c);
  const ad = path.join(rt, "runs", "ad-hoc", r0.jobId, "jobs", r0.jobId);
  assert.ok(existsSync(path.join(ad, "state.json")));
  cleanup(c);
});

test("integration: preflight_failed still creates job dir (no skip)", async () => {
  const c = tmp();
  const { stdout } = await runDispatch([{
    id: "pf",
    model: "m",
    prompt: "hi",
    cwd: c,
  }], { OPENCODE_BIN: "/non/existent/bin/xyz", DRETECH_DISPATCH_SKIP_PREFLIGHT: "0" }, c);
  const out = JSON.parse(stdout);
  assert.equal(out.results[0].status, "preflight_failed");
  const rt = resolveRuntimeRoot(c);
  const jdir = path.join(rt, "runs", "ad-hoc", out.results[0].jobId, "jobs", out.results[0].jobId);
  assert.ok(existsSync(path.join(jdir, "state.json")));
  assert.ok(existsSync(path.join(jdir, "result.json")));
  const st = JSON.parse(readFileSync(path.join(jdir, "state.json"), "utf8"));
  assert.equal(st.status, "failed");
  cleanup(c);
});

test("integration: worker prompt contains absolute WORKER_RESULT_PATH", async () => {
  const c = tmp();
  const cap = path.join(c, "prompt.cap");
  const { stdout } = await runDispatch([{
    id: "wp",
    model: "m",
    prompt: "base prompt",
    cwd: c,
    role: "worker",
  }], { OPENCODE_BIN: fakeBin, DRETECH_FAKE_PROMPT_PATH: cap }, c);
  const capContent = readFileSync(cap, "utf8");
  assert.ok(capContent.includes("WORKER_RESULT_PATH="));
  assert.ok(capContent.includes(path.join(resolveRuntimeRoot(c), "runs", "ad-hoc")));
  assert.ok(capContent.includes("You MUST write worker-result.json"));
  cleanup(c);
});
