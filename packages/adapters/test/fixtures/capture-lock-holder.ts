// Proceso hijo de la prueba entre procesos separados (plan de P1-T5, §9.4). Construye una
// captura sobre la raíz recibida y envía el mensaje recibido con la clave recibida. Justo
// antes de publicar, con el bloqueo de la clave ya tomado, escribe "HOLDING" y espera
// "CONTINUE" por la entrada estándar; al terminar escribe "RESULT <json>" y se cierra.
// Sin red ni datos reales: solo archivos bajo la raíz de prueba.
import { createInterface } from "node:readline";
import { LocalCaptureEmailSender } from "../../src/local/capture-email-sender.js";
import { nodeFileOps } from "../../src/local/file-ops.js";
import type { OutgoingEmail } from "../../src/ports/email.js";

const [rootPath, idempotencyKey, messageJson] = process.argv.slice(2);
if (rootPath === undefined || idempotencyKey === undefined || messageJson === undefined) {
  throw new Error("Uso: capture-lock-holder.ts <raíz> <clave> <mensaje JSON>");
}
const message = JSON.parse(messageJson) as OutgoingEmail;

const lines = createInterface({ input: process.stdin });
const continueSignal = new Promise<void>((resolve) => {
  lines.on("line", (line) => {
    if (line.trim() === "CONTINUE") resolve();
  });
});

const sender = await LocalCaptureEmailSender.build({
  appEnv: "test",
  rootPath,
  fileOps: {
    ...nodeFileOps,
    rename: async (source, destination) => {
      if (source.endsWith("/staged") && destination.includes("/captures/")) {
        process.stdout.write("HOLDING\n");
        await continueSignal;
      }
      await nodeFileOps.rename(source, destination);
    },
  },
});
const result = await sender.send(idempotencyKey, message);
process.stdout.write(`RESULT ${JSON.stringify(result)}\n`);
await sender.close();
lines.close();
