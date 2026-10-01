import type { CutDocument } from "@spil/cutcode-core";
import { validateCutDocument } from "@spil/cutcode-core";

export type { ValidationIssue, IssueCode, Severity, IssueGroup } from "@spil/cutcode-core";

/**
 * Validation lives in `@spil/cutcode-core` so the desktop app, the CLI and any
 * future backend all apply identical rules and per-vendor tolerances.
 */
export function validateDocument(doc: CutDocument) {
  return validateCutDocument(doc);
}