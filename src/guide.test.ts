import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The guide is the contract and the code is its executable half. Twice a guide sentence went on
// naming something the code had dropped -- a status, a parameter -- and only a reader who
// happened to pass by found it. This test reads every inline-code span in the guide and requires
// each identifier-like piece of it to appear somewhere in `src/`: an export, a field, a union
// member, a rule id, a failure code. It cannot tell a right identifier used wrongly; it can tell
// one that no longer exists, which is the class that slipped through.

const root = join(__dirname, "..");
const guide = readFileSync(join(root, "guide.md"), "utf8");
const sources = readdirSync(__dirname).filter(name => name.endsWith(".ts") && name !== "guide.test.ts");

// A line under `@ts-expect-error` is a shape the code refuses, so the names on it are exactly the
// ones the guide must not use; they stay out of the vocabulary.
const vocabulary = new Set<string>();
for (const name of sources) {
  const lines = readFileSync(join(__dirname, name), "utf8").split("\n");
  const text = lines.filter((line, index) => !(lines[index - 1] ?? "").includes("@ts-expect-error")).join("\n");
  for (const word of text.match(/[A-Za-z_$][A-Za-z0-9_$-]*/g) ?? []) vocabulary.add(word);
  for (const literal of text.match(/"([^"\\\n]|\\.)*"|'([^'\\\n]|\\.)*'|`([^`\\]|\\.)*`/g) ?? []) vocabulary.add(literal.slice(1, -1));
}

// The members of every exported interface and object type, so that `Type.field` in the guide is
// checked against the type and not merely against the existence of both words somewhere.
const members = new Map<string, Set<string>>();
{
  const index = readFileSync(join(__dirname, "index.ts"), "utf8");
  for (const block of index.matchAll(/^export (?:interface|type) ([A-Za-z]+)(?:<[^>]*>)?(?: =)? \{\n([\s\S]*?)^\}/gm)) {
    const fields = new Set<string>();
    for (const field of (block[2] as string).matchAll(/^\s+([A-Za-z_$][A-Za-z0-9_$]*)\??(?:[:(<]|\s*\()/gm)) fields.add(field[1] as string);
    members.set(block[1] as string, fields);
  }
}

/**
 * Backticked words the code does not own. Each group is a kind of thing the guide is entitled to
 * set in code font without the package exporting it; a new entry here needs the same
 * justification, not just a failing run.
 */
const PROSE = new Set([
  // Literals and grammar.
  "true", "false", "null", "undefined", "n", "0", "1", "[]", "{}", "enum",
  // Names from outside this contract: web APIs, OIDC, a platform's own vocabulary.
  "URLPattern", "nonce", "not-ready",
  // Example values -- attribute keys, task types, categories -- chosen to read as data.
  "Lead", "Prospect", "Dept", "Department", "Billing", "Returns",
  // Placeholders in the isolation-scheme explanation.
  "TASK_TYPE_NAME", "PROVIDER_NAME",
  // Omni's own provisioning flag and break-attempt states, which the guide narrates but the
  // package does not export: they are host state, not wire data.
  "readyOnLogin", "working", "requesting-break", "committing-break", "cancelling-break",
]);

const outsideFences = guide.replace(/```[\s\S]*?```/g, "");
const spans = [...outsideFences.matchAll(/`([^`\n]+)`/g)].map(match => match[1] as string);

const identifierLike = (span: string): boolean => /^[A-Za-z_$@.\-/()?[\]0-9]+$/.test(span) && /[A-Za-z]/.test(span);

function pieces(span: string): string[] {
  const bare = span.replace(/\(.*\)$/, "").replace(/\?$/, "");
  if (vocabulary.has(bare)) return [];
  const hop = /^([A-Z][A-Za-z]*)\.([A-Za-z_$][A-Za-z0-9_$]*)/.exec(bare);
  if (hop !== null && members.has(hop[1] as string) && !members.get(hop[1] as string)?.has(hop[2] as string)) {
    return [`${hop[1]}.${hop[2]}`];
  }
  return bare
    .split(/[.\[\]]/)
    .filter(piece => piece.length > 0 && !PROSE.has(piece) && !/^\d+$/.test(piece))
    .filter(piece => !vocabulary.has(piece));
}

describe("the guide names nothing the code lacks", () => {
  it("every inline-code identifier in guide.md exists somewhere in src/", () => {
    const missing = new Map<string, string>();
    for (const span of spans) {
      if (!identifierLike(span) || PROSE.has(span) || span.startsWith("@xema/")) continue;
      for (const piece of pieces(span)) if (!missing.has(piece)) missing.set(piece, span);
    }
    expect([...missing.entries()].map(([piece, span]) => `${piece}  (in \`${span}\`)`)).toEqual([]);
  });
});
