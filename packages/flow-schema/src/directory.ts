import { createIssue, type IssuePath, type ValidationIssue } from "./issues.js";
import type {
  Company,
  Contact,
  Directory,
  DocumentType,
  RecipientGroup,
} from "./schemas/directory.js";

export interface DirectoryIndex {
  readonly companies: ReadonlyMap<string, Company>;
  readonly activeCompanyIds: readonly string[];
  readonly documentTypes: ReadonlyMap<string, DocumentType>;
  readonly activeDocumentTypeIds: readonly string[];
  readonly classifications: ReadonlySet<string>;
  readonly contacts: ReadonlyMap<string, Contact>;
  readonly groups: ReadonlyMap<string, RecipientGroup>;
}

/** Índices por id. Ante ids duplicados conserva el primero; validateDirectory los informa. */
export function indexDirectory(directory: Directory): DirectoryIndex {
  const documentTypes = directory.documentCatalog.documentTypes;
  return {
    companies: firstById(directory.companies),
    activeCompanyIds: unique(directory.companies.filter((c) => c.active).map((c) => c.id)),
    documentTypes: firstById(documentTypes),
    activeDocumentTypeIds: unique(documentTypes.filter((d) => d.active).map((d) => d.id)),
    classifications: new Set(directory.classifications.map((c) => c.code)),
    contacts: firstById(directory.contacts),
    groups: firstById(directory.recipientGroups),
  };
}

/** Integridad del directorio: ids únicos, referencias existentes e identidades activas únicas. */
export function validateDirectory(directory: Directory): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const index = indexDirectory(directory);

  reportDuplicates(issues, directory.companies, ["companies"]);
  reportDuplicates(issues, directory.documentCatalog.documentTypes, [
    "documentCatalog",
    "documentTypes",
  ]);
  reportDuplicates(issues, directory.employees, ["employees"]);
  reportDuplicates(issues, directory.contacts, ["contacts"]);
  reportDuplicates(issues, directory.recipientGroups, ["recipientGroups"]);
  reportDuplicates(
    issues,
    directory.classifications.map((c) => ({ id: c.code })),
    ["classifications"],
    "code",
  );

  const reference = (path: IssuePath, kind: string, value: string): void => {
    issues.push(
      createIssue(
        "DIRECTORY_REFERENCE_INVALID",
        `La referencia a ${kind} "${value}" no existe en el directorio.`,
        path,
        { details: { kind, value } },
      ),
    );
  };

  directory.documentCatalog.documentTypes.forEach((type, i) => {
    const base = ["documentCatalog", "documentTypes", i];
    if (!index.classifications.has(type.classification)) {
      reference([...base, "classification"], "classification", type.classification);
    }
    type.companyIds?.forEach((companyId, j) => {
      if (!index.companies.has(companyId)) {
        reference([...base, "companyIds", j], "company", companyId);
      }
    });
  });

  directory.employees.forEach((employee, i) => {
    employee.companyScopes.forEach((companyId, j) => {
      if (!index.companies.has(companyId)) {
        reference(["employees", i, "companyScopes", j], "company", companyId);
      }
    });
  });

  directory.contacts.forEach((contact, i) => {
    if (!index.companies.has(contact.companyId)) {
      reference(["contacts", i, "companyId"], "company", contact.companyId);
    }
    contact.allowedClassifications.forEach((code, j) => {
      if (!index.classifications.has(code)) {
        reference(["contacts", i, "allowedClassifications", j], "classification", code);
      }
    });
  });

  directory.recipientGroups.forEach((group, i) => {
    if (!index.companies.has(group.companyId)) {
      reference(["recipientGroups", i, "companyId"], "company", group.companyId);
    }
    group.allowedClassifications.forEach((code, j) => {
      if (!index.classifications.has(code)) {
        reference(["recipientGroups", i, "allowedClassifications", j], "classification", code);
      }
    });
    group.memberContactIds.forEach((contactId, j) => {
      if (!index.contacts.has(contactId)) {
        reference(["recipientGroups", i, "memberContactIds", j], "contact", contactId);
      }
    });
  });

  // ADR-011: una identidad activa pertenece a un solo empleado; se compara dentro de su ámbito.
  const activeOwners = new Map<string, string>();
  directory.employees.forEach((employee, i) => {
    employee.identities.forEach((identity, j) => {
      if (identity.status !== "ACTIVE") return;
      const key = [
        identity.provider,
        identity.kind,
        identity.scopeType,
        identity.scopeId,
        identity.normalizedValue,
      ].join("\u0000");
      const owner = activeOwners.get(key);
      if (owner === undefined) {
        activeOwners.set(key, employee.id);
        return;
      }
      issues.push(
        createIssue(
          "IDENTITY_ACTIVE_DUPLICATE",
          "La identidad activa ya pertenece a otro empleado o está repetida.",
          ["employees", i, "identities", j],
          { details: { kind: identity.kind, scopeId: identity.scopeId, ownerEmployeeId: owner } },
        ),
      );
    });
  });

  return issues;
}

function reportDuplicates(
  issues: ValidationIssue[],
  items: readonly { readonly id: string }[],
  basePath: IssuePath,
  field = "id",
): void {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    if (seen.has(item.id)) {
      issues.push(
        createIssue("DUPLICATE_ID", `El identificador "${item.id}" está repetido.`, [
          ...basePath,
          i,
          field,
        ]),
      );
    }
    seen.add(item.id);
  });
}

function firstById<T extends { readonly id: string }>(items: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) if (!map.has(item.id)) map.set(item.id, item);
  return map;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
