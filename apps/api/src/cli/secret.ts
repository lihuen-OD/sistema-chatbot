import { createInterface } from "node:readline";

/**
 * Lee un secreto. En una terminal no muestra lo que se escribe; si la entrada no es una terminal
 * (por ejemplo, un pipe), toma la primera línea. Nunca lo escribe en la salida.
 */
export async function readSecret(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) {
    const lines = createInterface({ input, terminal: false });
    for await (const line of lines) {
      lines.close();
      return line;
    }
    return "";
  }

  process.stderr.write(prompt);
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  try {
    return await new Promise<string>((resolve, reject) => {
      let value = "";
      const onData = (chunk: string): void => {
        for (const char of chunk) {
          if (char === "\r" || char === "\n") {
            input.off("data", onData);
            process.stderr.write("\n");
            resolve(value);
            return;
          }
          if (char === "\u0003") {
            input.off("data", onData);
            reject(new Error("Cancelado."));
            return;
          }
          value = char === "\u007f" ? Array.from(value).slice(0, -1).join("") : value + char;
        }
      };
      input.on("data", onData);
    });
  } finally {
    input.setRawMode(false);
    input.pause();
  }
}
