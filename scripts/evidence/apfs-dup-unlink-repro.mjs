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
//   linkToSameDestination: dos link al mismo destino.
// Cada par se informa ordenado ("ENOENT+OK", "OK+OK", …). No escribe fuera del mkdtemp.
import { Buffer } from "node:buffer";
import { lstatSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { link, rename, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
        linkToSameDestination: Object.fromEntries(linkPairs),
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
