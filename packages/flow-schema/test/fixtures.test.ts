import { describe, expect, it } from "vitest";
import {
  ATTACHMENTS_PER_SEND,
  parseDirectory,
  parseFlowDefinition,
  parseRuleSet,
  validateDirectory,
  validateFlowDefinition,
  validatePublication,
  validateRuleSet,
} from "../src/index.js";
import { EXAMPLE_FILES, loadFixtures, node, readExample } from "./helpers.js";

describe("fixtures de examples/", () => {
  it("los tres archivos son estructuralmente válidos", () => {
    expect(parseFlowDefinition(readExample(EXAMPLE_FILES.flow)).ok).toBe(true);
    expect(parseRuleSet(readExample(EXAMPLE_FILES.ruleSet)).ok).toBe(true);
    expect(parseDirectory(readExample(EXAMPLE_FILES.directory)).ok).toBe(true);
  });

  it("el directorio es semánticamente válido", () => {
    expect(validateDirectory(loadFixtures().directory)).toEqual([]);
  });

  it("las reglas cubren cada combinación empresa × tipo con exactamente una regla", () => {
    const { ruleSet, directory } = loadFixtures();
    const result = validateRuleSet(ruleSet, directory);

    expect(result.issues).toEqual([]);
    expect(result.coverage).toEqual({
      combinations: 4,
      entries: [
        {
          combination: { company: "company_a", documentType: "invoice" },
          outcome: "RULE",
          ruleId: "rule_company_a_accounting",
        },
        {
          combination: { company: "company_a", documentType: "medical_certificate" },
          outcome: "RULE",
          ruleId: "rule_company_a_hr",
        },
        {
          combination: { company: "company_b", documentType: "invoice" },
          outcome: "RULE",
          ruleId: "rule_company_b_accounting",
        },
        {
          combination: { company: "company_b", documentType: "medical_certificate" },
          outcome: "RULE",
          ruleId: "rule_company_b_hr",
        },
      ],
    });
  });

  it("el flujo es semánticamente válido con su directorio y sus reglas", () => {
    const { flow, ruleSet, directory } = loadFixtures();
    expect(validateFlowDefinition(flow, { directory, ruleSets: [ruleSet] })).toEqual([]);
  });

  it("la publicación completa es válida a partir de los JSON sin procesar", () => {
    const result = validatePublication({
      flow: readExample(EXAMPLE_FILES.flow),
      ruleSets: [readExample(EXAMPLE_FILES.ruleSet)],
      directory: readExample(EXAMPLE_FILES.directory),
    });
    expect(result.valid).toBe(true);
    expect(result.flow).toEqual([]);
    expect(result.directory).toEqual([]);
    expect(result.ruleSets.map((ruleSet) => ruleSet.issues)).toEqual([[]]);
  });

  it("el paso documental exige revisión y un único adjunto por envío", () => {
    const upload = node(loadFixtures().flow, "upload", "file");
    expect(upload.review).toBeDefined();
    expect([upload.minCount, upload.maxCount]).toEqual([
      ATTACHMENTS_PER_SEND,
      ATTACHMENTS_PER_SEND,
    ]);
  });
});
