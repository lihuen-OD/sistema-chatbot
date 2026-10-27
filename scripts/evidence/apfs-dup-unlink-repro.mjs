// Evidencia del plan de P1-T5 §8.5 (borrados concurrentes): ¿dos `unlink` concurrentes
// del mismo nombre pueden devolver éxito los dos? Llamadas reales, sin el adaptador.
//
// Uso: node scripts/evidence/apfs-dup-unlink-repro.mjs [directorio-base] [pares]
//   directorio-base: por defecto os.tmpdir(); crea y borra ahí un mkdtemp propio.
//   pares: por defecto 5000.
//
// Casos:
//   unlinkConcurrent: dos fs.promises.unlink del mismo nombre (como `delete` del adaptador);
//     también cuenta si el nombre sigue presente después del par.
//   unlinkSequential: unlink completo y después otro unlink (control: debe dar ENOENT).
//   hardLinkNlink: el par sobre un enlace duro; nlink del original después del par.
//   renameToTwoDestinations: dos rename del mismo origen a destinos distintos.
//   renameIntoPrivateDirectories: el retiro exclusivo de `delete` (§8.5, revisión del
//     27/10/2026): cada operación crea su directorio privado (en dos "instancias"
//     distintas) y mueve el mismo origen a él.
//   renameIntoPrivateDirectoriesWorkers: lo mismo con dos worker_threads liberados por una
//     barrera (Atomics), para que las dos llamadas al sistema sean simultáneas.
//   linkToSameDestination: dos link al mismo destino.
// Cada par se informa ordenado ("ENOENT+OK", "OK+OK", …). No escribe fuera del mkdtemp.
import { Buffer } from "node:buffer";
import { lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { link, mkdir, rename, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

const base = process.argv[2] ?? tmpdir();
const pairs = Number(process.argv[3] ?? "5000");
const dir = mkdtempSync(join(base, "dup-unlink-"));

const outcome = (promise) =>
  promise.then(
    () => "OK",
    (error) => String(error?.code ?? "?"),
  );
const exists = (path) => {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};
const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const pairLabel = (results) => [...results].sort().join("+");
const fresh = (path) => writeFileSync(path, Buffer.alloc(16), { mode: 0o600 });

try {
  const target = join(dir, "k");

  const unlinkConcurrent = new Map();
  let presentAfterPair = 0;
  for (let i = 0; i < pairs; i += 1) {
    fresh(target);
    bump(
      unlinkConcurrent,
      pairLabel(await Promise.all([outcome(unlink(target)), outcome(unlink(target))])),
    );
    if (exists(target)) presentAfterPair += 1;
  }

  const unlinkSequential = new Map();
  for (let i = 0; i < Math.min(pairs, 1000); i += 1) {
    fresh(target);
    const first = await outcome(unlink(target));
    const second = await outcome(unlink(target));
    bump(unlinkSequential, `${first}->${second}`);
  }

  const original = join(dir, "original");
  fresh(original);
  const hardLinkPairs = new Map();
  const nlinkAfterPair = new Map();
  for (let i = 0; i < pairs; i += 1) {
    await link(original, target);
    bump(
      hardLinkPairs,
      pairLabel(await Promise.all([outcome(unlink(target)), outcome(unlink(target))])),
    );
    bump(nlinkAfterPair, String(lstatSync(original).nlink));
  }

  const renamePairs = new Map();
  let renameNotExactlyOneName = 0;
  const [destinationA, destinationB] = [join(dir, "ra"), join(dir, "rb")];
  for (let i = 0; i < pairs; i += 1) {
    fresh(target);
    bump(
      renamePairs,
      pairLabel(
        await Promise.all([
          outcome(rename(target, destinationA)),
          outcome(rename(target, destinationB)),
        ]),
      ),
    );
    const present = [target, destinationA, destinationB].filter(exists);
    if (present.length !== 1) renameNotExactlyOneName += 1;
    for (const path of present) rmSync(path);
  }

  // Retiro exclusivo de §8.5: objects/<clave> movido a tmp/<instancia>/del-<op>/<clave>.
  const objects = join(dir, "objects");
  const instanceA = join(dir, "tmp", "a");
  const instanceB = join(dir, "tmp", "b");
  for (const path of [objects, instanceA, instanceB]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  const source = join(objects, "k");
  const privatePairs = new Map();
  let privateNotExactlyOneName = 0;
  for (let i = 0; i < pairs; i += 1) {
    fresh(source);
    const [privateA, privateB] = [join(instanceA, `del-${i}`), join(instanceB, `del-${i}`)];
    bump(
      privatePairs,
      pairLabel(
        await Promise.all([
          mkdir(privateA, { mode: 0o700 }).then(() => outcome(rename(source, join(privateA, "k")))),
          mkdir(privateB, { mode: 0o700 }).then(() => outcome(rename(source, join(privateB, "k")))),
        ]),
      ),
    );
    const present = [source, join(privateA, "k"), join(privateB, "k")].filter(exists);
    if (present.length !== 1) privateNotExactlyOneName += 1;
    rmSync(privateA, { recursive: true, force: true });
    rmSync(privateB, { recursive: true, force: true });
    rmSync(source, { force: true });
  }

  // Lo mismo con dos hilos que llaman a renameSync al mismo tiempo.
  const workerSource = `
    const { parentPort, workerData } = require("node:worker_threads");
    const { mkdirSync, renameSync } = require("node:fs");
    const { join } = require("node:path");
    const shared = new Int32Array(workerData.sab);
    parentPort.on("message", (round) => {
      const privateDirectory = join(workerData.instance, "del-w" + round);
      mkdirSync(privateDirectory, { mode: 0o700 });
      Atomics.add(shared, 1, 1);
      Atomics.notify(shared, 1);
      while (Atomics.load(shared, 0) !== round) Atomics.wait(shared, 0, round - 1, 50);
      let result = "OK";
      try {
        renameSync(workerData.source, join(privateDirectory, "k"));
      } catch (error) {
        result = String(error.code);
      }
      parentPort.postMessage(result);
    });
  `;
  const sab = new SharedArrayBuffer(8);
  const shared = new Int32Array(sab);
  const workers = [instanceA, instanceB].map(
    (instance) => new Worker(workerSource, { eval: true, workerData: { sab, source, instance } }),
  );
  const nextMessage = (worker) => new Promise((resolve) => worker.once("message", resolve));
  const workerRounds = Math.min(pairs, 3000);
  const workerPairs = new Map();
  let workerNotExactlyOneName = 0;
  try {
    for (let round = 1; round <= workerRounds; round += 1) {
      fresh(source);
      Atomics.store(shared, 1, 0);
      const results = workers.map(nextMessage);
      for (const worker of workers) worker.postMessage(round);
      while (Atomics.load(shared, 1) < 2) Atomics.wait(shared, 1, Atomics.load(shared, 1), 50);
      Atomics.store(shared, 0, round);
      Atomics.notify(shared, 0);
      bump(workerPairs, pairLabel(await Promise.all(results)));
      const moved = [instanceA, instanceB].map((instance) => join(instance, `del-w${round}`, "k"));
      if ([source, ...moved].filter(exists).length !== 1) workerNotExactlyOneName += 1;
      for (const instance of [instanceA, instanceB]) {
        rmSync(join(instance, `del-w${round}`), { recursive: true, force: true });
      }
      rmSync(source, { force: true });
    }
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }

  const linkPairs = new Map();
  const claim = join(dir, "claim");
  for (let i = 0; i < pairs; i += 1) {
    bump(
      linkPairs,
      pairLabel(
        await Promise.all([outcome(link(original, claim)), outcome(link(original, claim))]),
      ),
    );
    rmSync(claim);
  }

  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
        base,
        pairs,
        unlinkConcurrent: Object.fromEntries(unlinkConcurrent),
        unlinkConcurrentNamePresentAfterPair: presentAfterPair,
        unlinkSequential: Object.fromEntries(unlinkSequential),
        hardLinkUnlinkConcurrent: Object.fromEntries(hardLinkPairs),
        hardLinkOriginalNlinkAfterPair: Object.fromEntries(nlinkAfterPair),
        renameToTwoDestinations: Object.fromEntries(renamePairs),
        renameStatesWithoutExactlyOneName: renameNotExactlyOneName,
        renameIntoPrivateDirectories: Object.fromEntries(privatePairs),
        renameIntoPrivateDirectoriesWithoutExactlyOneName: privateNotExactlyOneName,
        renameIntoPrivateDirectoriesWorkers: {
          rounds: workerRounds,
          outcomes: Object.fromEntries(workerPairs),
          withoutExactlyOneName: workerNotExactlyOneName,
        },
        linkToSameDestination: Object.fromEntries(linkPairs),
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
