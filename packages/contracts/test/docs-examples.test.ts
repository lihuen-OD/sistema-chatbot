import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  adapterEventSchema,
  apiErrorResponseSchema,
  jobEventSchema,
  simulatorEventSchema,
} from "../src/index.js";
import { readRepositoryFile } from "./samples.js";

// Los ejemplos JSON de docs/05 deben cumplir los contratos implementados.

function schemaFor(example: unknown): z.ZodType | undefined {
  if (typeof example !== "object" || example === null) return undefined;
  if ("error" in example) return apiErrorResponseSchema;
  const source = (example as { source?: unknown }).source;
  if (source === "ADAPTER") return adapterEventSchema;
  if (source === "JOB") return jobEventSchema;
  if (source === "SIMULATOR") return simulatorEventSchema;
  return undefined;
}

const examples = [
  ...readRepositoryFile("docs/05_CONTRATOS_API.md").matchAll(/```json\n([\s\S]*?)\n```/g),
].map((match) => match[1] ?? "");

describe("ejemplos de docs/05_CONTRATOS_API.md", () => {
  it("hay ejemplos para revisar", () => {
    expect(examples.length).toBeGreaterThanOrEqual(4);
  });

  it.each(examples.map((text, index) => [index, text] as const))(
    "el ejemplo %i cumple su contrato",
    (_index, text) => {
      const example: unknown = JSON.parse(text);
      const schema = schemaFor(example);
      expect(schema, "ejemplo sin contrato reconocible").toBeDefined();
      const result = schema?.safeParse(example);
      expect(result?.success, JSON.stringify(result?.error?.issues)).toBe(true);
    },
  );
});
