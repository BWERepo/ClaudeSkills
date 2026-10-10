/**
 * Crawled website text is untrusted. Before it is placed in a prompt, lines that read like instructions to a model
 * are removed, and the remainder is fenced and labelled as data. Detection is reported so an administrator can look.
 */
const PATTERNS = [
  /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|earlier|all|system)\b.{0,30}\b(instructions?|prompts?|rules?|messages?)\b/i,
  /\b(you are now|act as|pretend to be|roleplay as|new instructions?|system prompt|developer message)\b/i,
  /<\/?(system|assistant|user|instructions?|untrusted_site_content)\b[^>]*>/i,
  /\[\/?(INST|SYS)\]/,
  /^\s*(system|assistant|human|user)\s*:/im,
  /\b(output|print|reveal|exfiltrate|send)\b.{0,40}\b(api key|secret|token|password|credentials?|system prompt)\b/i,
  /\bBEGIN (PROMPT|INSTRUCTIONS)\b/i,
];

export interface SanitizedUntrusted {
  text: string;
  flagged: string[];
}

export function neutralizeUntrusted(input: string, maxChars = 1200): SanitizedUntrusted {
  const flagged: string[] = [];
  const kept: string[] = [];
  for (const line of input.replace(/\r/g, "").split(/\n|(?<=[.!?])\s+/)) {
    if (PATTERNS.some((re) => re.test(line))) {
      flagged.push(line.trim().slice(0, 160));
      continue;
    }
    kept.push(line);
  }
  const text = kept
    .join(" ")
    .replace(/[<>]/g, " ")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
  return { text, flagged };
}
