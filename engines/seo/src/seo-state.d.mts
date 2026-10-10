// Types for seo-state.mjs (BWESEO engine): the Node side of the state machine — evidence from disk
// plus everything seo-state-core.mjs exports. Vendored next to it.
import type { DocState, SeoEvidence, SourceState } from "./seo-state-core.mjs";

export * from "./seo-state-core.mjs";
export declare const ENGINE_VERSION: string;

export interface CollectedEvidence extends SeoEvidence {
  projectDir: string;
  today: string;
  parseErrors: string[];
}

export declare function collectEvidence(
  projectDir: string,
  opts?: { live?: boolean; fetchImpl?: typeof fetch; today?: string; timeoutMs?: number },
): Promise<CollectedEvidence>;
export declare function sourceState(
  projectDir: string,
  source: string | null | undefined,
): SourceState;
export declare function readDoc(file: string): DocState;
