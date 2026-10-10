import { EngineError } from "../errors.js";
import type { ArticleStatus } from "../types.js";

/**
 * Article lifecycle. Recommended and draft content never becomes public on its own:
 * the only edges into "published" start at "approved" (Mode A) or at a passed validation run (Mode B).
 */
const EDGES: Record<ArticleStatus, ArticleStatus[]> = {
  recommended: ["selected", "rejected"],
  selected: ["generating", "rejected", "recommended"],
  generating: ["draft", "review", "published", "error"],
  draft: ["review", "approved", "rejected", "archived", "generating"],
  review: ["approved", "draft", "rejected", "generating"],
  approved: ["published", "review", "draft"],
  published: ["archived", "draft", "review"],
  rejected: ["selected", "archived"],
  archived: ["draft"],
  error: ["selected", "generating", "rejected"],
};

export type ApprovalMode = "review-required" | "approved-selection-publishes";

export const approvalModeOf = (approvalRequired: boolean): ApprovalMode => (approvalRequired ? "review-required" : "approved-selection-publishes");

export function canTransition(from: ArticleStatus, to: ArticleStatus): boolean {
  return EDGES[from]?.includes(to) ?? false;
}

export function assertTransition(from: ArticleStatus, to: ArticleStatus, ctx: { mode: ApprovalMode; validated?: boolean }): void {
  if (!canTransition(from, to)) throw new EngineError("INVALID_TRANSITION", `cannot move an article from "${from}" to "${to}"`);
  if (to === "published") {
    if (from === "generating" && ctx.mode !== "approved-selection-publishes") throw new EngineError("INVALID_TRANSITION", "review-required mode: generated articles go to draft, never straight to published");
    if (!ctx.validated) throw new EngineError("VALIDATION_FAILED", "an article cannot be published until it passes the validation gate");
  }
}

export const PUBLIC_STATUSES: ArticleStatus[] = ["published"];
export const isPublic = (s: ArticleStatus): boolean => s === "published";
