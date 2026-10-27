// Evidencia del plan de P1-T5 §9.4 (bloqueo por clave de las capturas): dos directorios
// preparados NO vacíos (con owner.json), de dos "instancias", movidos a la vez con `rename`
// al mismo `locks/<id>` inexistente. La adquisición es exclusiva si en cada par exactamente
// uno da OK, el bloqueo tiene el owner.json de ese ganador y lo preparado por el otro sigue
// intacto. Llamadas reales, sin el adaptador.
//
// Uso: node scripts/evidence/capture-lock-rename-repro.mjs [directorio-base] [pares]
//   directorio-base: por defecto os.tmpdir(); crea y borra ahí un mkdtemp propio.
//   pares: por defecto 5000 (los hilos usan hasta 3000).
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

const base = process.argv[2] ?? tmpdir();
const pairs = Number(process.argv[3] ?? "5000");
const dir = mkdtempSync(join(base, "lock-rename-"));

const exists = (path) => {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};
const outcome = (promise) =>
  promise.then(
    () => "OK",
    (error) => String(error?.code ?? "?"),
  );
const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const prepare = (parent, name, owner) => {
  const path = join(parent, name);
  mkdirSync(path, { mode: 0o700 });
  writeFileSync(join(path, "owner.json"), owner, { mode: 0o600 });
  return path;
};
/** Exactamente un ganador, con su owner.json en el bloqueo, y el perdedor intacto. */
const exclusive = (results, target, preparedA, preparedB) => {
  const winner = results[0] === "OK" ? "A" : results[1] === "OK" ? "B" : null;
  if (results.filter((result) => result === "OK").length !== 1) return false;
  const owner = exists(target) ? readFileSync(join(target, "owner.json"), "utf8") : null;
  const loser = winner === "A" ? preparedB : preparedA;
  return owner === winner && exists(join(loser, "owner.json"));
};

try {
  const locks = join(dir, "locks");
  const tmpA = join(dir, "tmp", "a");
  const tmpB = join(dir, "tmp", "b");
  for (const path of [locks, tmpA, tmpB]) mkdirSync(path, { recursive: true, mode: 0o700 });
  const target = join(locks, "k");

  const promisesOutcomes = new Map();
  let promisesAnomalies = 0;
  for (let i = 0; i < pairs; i += 1) {
    const a = prepare(tmpA, `lock-${i}`, "A");
    const b = prepare(tmpB, `lock-${i}`, "B");
    const results = await Promise.all([outcome(rename(a, target)), outcome(rename(b, target))]);
    bump(promisesOutcomes, [...results].sort().join("+"));
    if (!exclusive(results, target, a, b)) promisesAnomalies += 1;
    for (const path of [target, a, b]) rmSync(path, { recursive: true, force: true });
  }

  // Dos hilos liberados por una barrera (Atomics): las dos llamadas al sistema a la vez.
  const workerSource = `
    const { parentPort, workerData } = require("node:worker_threads");
    const { renameSync } = require("node:fs");
    const shared = new Int32Array(workerData.sab);
    parentPort.on("message", ({ round, source }) => {
      Atomics.add(shared, 1, 1);
      Atomics.notify(shared, 1);
      while (Atomics.load(shared, 0) !== round) Atomics.wait(shared, 0, round - 1, 50);
      let result = "OK";
      try {
        renameSync(source, workerData.target);
      } catch (error) {
        result = String(error.code);
      }
      parentPort.postMessage(result);
    });
  `;
  const sab = new SharedArrayBuffer(8);
  const shared = new Int32Array(sab);
  const workers = [0, 1].map(
    () => new Worker(workerSource, { eval: true, workerData: { sab, target } }),
  );
  const nextMessage = (worker) => new Promise((resolve) => worker.once("message", resolve));
  const workerRounds = Math.min(pairs, 3000);
  const workerOutcomes = new Map();
  let workerAnomalies = 0;
  try {
    for (let round = 1; round <= workerRounds; round += 1) {
      const a = prepare(tmpA, `w-${round}`, "A");
      const b = prepare(tmpB, `w-${round}`, "B");
      Atomics.store(shared, 1, 0);
      const results = workers.map(nextMessage);
      workers[0].postMessage({ round, source: a });
      workers[1].postMessage({ round, source: b });
      while (Atomics.load(shared, 1) < 2) Atomics.wait(shared, 1, Atomics.load(shared, 1), 50);
      Atomics.store(shared, 0, round);
      Atomics.notify(shared, 0);
      const pair = await Promise.all(results);
      bump(workerOutcomes, [...pair].sort().join("+"));
      if (!exclusive(pair, target, a, b)) workerAnomalies += 1;
      for (const path of [target, a, b]) rmSync(path, { recursive: true, force: true });
    }
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }

  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
        base,
        fsPromises: {
          pairs,
          outcomes: Object.fromEntries(promisesOutcomes),
          anomalies: promisesAnomalies,
        },
        workersBarrier: {
          rounds: workerRounds,
          outcomes: Object.fromEntries(workerOutcomes),
          anomalies: workerAnomalies,
        },
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
