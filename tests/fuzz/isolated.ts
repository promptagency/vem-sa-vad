// Run one exported function in a worker thread and kill it after a time limit.
// node:test's own timeout can't stop a synchronous infinite loop; a worker can be
// terminated mid-loop, so a hang becomes a failed case instead of a stuck run.
import { Worker } from "node:worker_threads";

export const TIME_LIMIT_MS = 2000;

export type Outcome = { value: unknown } | { error: string } | { timedOut: true };

const SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
import(workerData.url)
  .then((m) => parentPort.postMessage({ value: m[workerData.name](...workerData.args) }))
  .catch((e) => parentPort.postMessage({ error: String(e && e.stack || e) }));
`;

export function runIsolated(moduleUrl: URL, name: string, args: unknown[], ms = TIME_LIMIT_MS): Promise<Outcome> {
  return new Promise((resolve) => {
    const worker = new Worker(SOURCE, { eval: true, workerData: { url: moduleUrl.href, name, args } });
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve({ timedOut: true });
    }, ms);
    worker.once("message", (outcome: Outcome) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(outcome);
    });
    worker.once("error", (e) => {
      clearTimeout(timer);
      resolve({ error: String(e) });
    });
    // A worker that dies silently (process.exit) is a crash, not a hang. After a
    // message or a timeout this resolve is a no-op.
    worker.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ error: `worker exited with code ${code}` });
    });
  });
}
