/**
 * Turns "the database is older than the code" into an error that says so.
 *
 * Pulling new code without running its migrations makes the first query that
 * touches a new column fail with a bare `Failed query: select …` — accurate,
 * and useless to somebody who does not know a migration was added. Postgres
 * reports these as undefined column (42703), undefined table (42P01) or an
 * undefined object such as a missing enum type (42704), so those codes are translated
 * into the one command that fixes them. Anything else is rethrown untouched.
 */
const DRIFT_CODES = new Set(["42703", "42P01", "42704"]);

export class SchemaDriftError extends Error {
  constructor(public readonly detail: string) {
    super(
      `The database schema is behind the code (${detail}). Run the pending migrations — ` +
        "`pnpm db:migrate` (or `./bela doctor` to see what is out of step) — then reload.",
    );
    this.name = "SchemaDriftError";
  }
}

export function explainSchemaDrift(error: unknown): never {
  const e = error as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = e?.code ?? e?.cause?.code;
  if (code && DRIFT_CODES.has(code)) throw new SchemaDriftError(e?.cause?.message ?? e?.message ?? code);
  throw error;
}
