/**
 * Document types, and how they are labelled.
 *
 * This is a plain module rather than a constant in `actions.ts`, and that is a
 * hard requirement rather than a preference: in a `"use server"` file *every*
 * export is turned into a server-action reference. A const array exported from
 * there arrives on the client as an opaque function, and the first thing that
 * calls `.map` on it throws at runtime while typecheck, lint and the production
 * build all pass. Constants shared between a server action and a client
 * component belong in a file with no directive at the top.
 *
 * The values mirror the `employee_document_kind` enum in the database. They are
 * duplicated rather than imported from the schema because importing the schema
 * would pull Drizzle into the client bundle for the sake of eight strings; the
 * check suite asserts the two lists stay identical.
 */
export const DOCUMENT_KINDS = [
  "contract",
  "citizenship",
  "passport",
  "pan",
  "certificate",
  "appraisal",
  "letter",
  "other",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

const KIND_LABEL: Record<string, string> = {
  contract: "Contract",
  citizenship: "Citizenship",
  passport: "Passport",
  pan: "PAN",
  certificate: "Certificate",
  appraisal: "Appraisal",
  letter: "Letter",
  other: "Other",
};

export function documentKindLabel(kind: string) {
  return KIND_LABEL[kind] ?? kind;
}
