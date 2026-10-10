import { parseDocument } from "htmlparser2";
import { Element, isTag, isText, type AnyNode, type Document } from "domhandler";
import * as DomUtils from "domutils";
import render from "dom-serializer";

export { Element, isTag, isText, DomUtils };
export type { AnyNode, Document };

export function parseHtml(html: string): Document {
  return parseDocument(html, { decodeEntities: true, lowerCaseAttributeNames: true, lowerCaseTags: true });
}

export function serialize(node: AnyNode | AnyNode[]): string {
  return render(node, { encodeEntities: "utf8", decodeEntities: true });
}

export function attr(el: Element, name: string): string | undefined {
  const v = el.attribs?.[name];
  return v === undefined ? undefined : v;
}

export function findAll(root: AnyNode | AnyNode[], pred: (el: Element) => boolean): Element[] {
  return DomUtils.findAll(pred, Array.isArray(root) ? root : [root]);
}

export function findOne(root: AnyNode | AnyNode[], pred: (el: Element) => boolean): Element | null {
  return DomUtils.findOne(pred, Array.isArray(root) ? root : [root], true);
}

export const byTag =
  (...tags: string[]) =>
  (el: Element): boolean =>
    tags.includes(el.name);

export function text(node: AnyNode | AnyNode[]): string {
  return DomUtils.textContent(node).replace(/\s+/g, " ").trim();
}

/** Ancestors from the parent up to the document. */
export function ancestors(el: AnyNode): Element[] {
  const out: Element[] = [];
  let p = el.parent;
  while (p) {
    if (isTag(p)) out.push(p);
    p = p.parent;
  }
  return out;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function escapeAttr(s: string): string {
  return escapeHtml(s);
}
