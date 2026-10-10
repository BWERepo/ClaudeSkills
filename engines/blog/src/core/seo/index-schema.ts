import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../../../schemas/${name}`, import.meta.url), "utf8")) as object;

let validators: { index: ReturnType<Ajv2020["compile"]>; discovery: ReturnType<Ajv2020["compile"]> } | undefined;

function get() {
  if (!validators) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    (addFormats as unknown as (a: Ajv2020) => void)(ajv);
    validators = { index: ajv.compile(load("blog-seo-index.schema.json")), discovery: ajv.compile(load("bwe-blog-discovery.schema.json")) };
  }
  return validators;
}

const errs = (v: ReturnType<Ajv2020["compile"]>) => (v.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`);

/** Validate a Blog SEO Index against the published JSON Schema. Returns error strings (empty = valid). */
export function validateIndexDocument(doc: unknown): string[] {
  const v = get().index;
  return v(doc) ? [] : errs(v);
}

export function validateDiscoveryDocument(doc: unknown): string[] {
  const v = get().discovery;
  return v(doc) ? [] : errs(v);
}
