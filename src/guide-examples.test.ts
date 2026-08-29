import { spawnSync } from "node:child_process";
import ts from "typescript";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The guide's examples are documentation that can be wrong in shape, not only in name: one
// declared a capability over an empty array for two releases, another satisfied an event type
// without the event's own `type` field, and both read fine. Every ```ts block is compiled against
// the package, and every type the guide declares under Shapes is compared with the package's type
// of the same name in both directions, so the mirror cannot drift from what it mirrors.
//
// A block that does not parse -- a lone property, a bare literal, a method signature -- is a
// fragment by design and is left to the identifier test. A block that parses is a complete
// example and must type-check with no error at all. Names an example uses without declaring
// (`createConnection`, `expect`) are placeholders, declared as `any` here and policed by the
// identifier test.

/** Names an example uses without declaring them: stand-ins for the adapter's own code. Kept equal to the list in guide.test.ts. */
const PLACEHOLDERS = new Set(["adapter", "context", "createAcmeAuthentication", "createConnection", "execute", "executeTeamConsult", "expect"]);

const root = join(__dirname, "..");
const guide = readFileSync(join(root, "guide.md"), "utf8");
const work = join(root, "node_modules", ".cache", "guide-examples");
const modules = { index: "index.ts", validation: "validation.ts", testing: "testing.ts" } as const;

const exported = (file: string): string[] =>
  [...new Set([...readFileSync(join(__dirname, file), "utf8").matchAll(/^export (?:type|interface|function|const|class|async function) ([A-Za-z_$][A-Za-z0-9_$]*)/gm)]
    .map(match => match[1] as string))].sort();
const exports = Object.fromEntries(Object.entries(modules).map(([key, file]) => [key, exported(file)])) as Record<keyof typeof modules, string[]>;
const source = (file: string) => `../../../src/${file.replace(/\.ts$/, ".js")}`;

interface Block { line: number; body: string; declared: Set<string>; types: { name: string; generic: boolean; defaulted: boolean }[] }

const blocks: Block[] = [...guide.matchAll(/^```ts\n([\s\S]*?)^```/gm)].map(match => {
  const body = match[1] as string;
  const declared = new Set<string>();
  const types: Block["types"] = [];
  for (const declaration of body.matchAll(/^(?:export )?(type|interface|const|let|function|class|enum|declare const|declare function) ([A-Za-z_$][A-Za-z0-9_$]*)(<[^>]*>)?/gm)) {
    declared.add(declaration[2] as string);
    if (declaration[1] === "type" || declaration[1] === "interface") {
      types.push({ name: declaration[2] as string, generic: declaration[3] !== undefined, defaulted: (declaration[3] ?? "").includes("=") });
    }
  }
  for (const imported of body.matchAll(/^import (?:type )?\{([^}]*)\} from "@xema\/omni-protocol(?:\/[a-z]+)?";/gm)) {
    for (const name of (imported[1] as string).split(",")) declared.add(name.trim().replace(/^type /, "").split(" as ").pop() as string);
  }
  return { line: guide.slice(0, match.index).split("\n").length + 1, body, declared, types };
});

/** The file compiled for one block: its own imports pointed at the source, the rest supplied, and the mirror checked. */
function fileFor(block: Block, placeholders: readonly string[]): string {
  const body = block.body.replace(/from "@xema\/omni-protocol(?:\/([a-z]+))?"/g, (_, sub: string | undefined) => `from "${source(sub === undefined ? modules.index : `${sub}.ts`)}"`);
  const preamble = Object.entries(modules).map(([key, file]) => {
    const names = exports[key as keyof typeof modules].filter(name => !block.declared.has(name));
    return names.length === 0 ? "" : `import { ${names.join(", ")} } from "${source(file)}";`;
  }).filter(line => line.length > 0);
  const real = exports.index;
  const mirror = block.types.filter(type => real.includes(type.name)).flatMap(({ name, generic, defaulted }) => {
    // Both directions, so a field added on either side is a drift; a generic type is compared at
    // each channel, and at its default where it has one.
    const pairs = generic ? [...(defaulted ? [""] : []), '<"voice">', '<"chat">', '<"email">'] : [""];
    // Assignability both ways catches a required field on either side; an optional field added
    // on one side passes it, so the key sets are compared as well.
    return pairs.flatMap((args, index) => [
      `type __${name}_${index}_a = Real.${name}${args} extends ${name}${args} ? true : never; const __${name}_${index}_a: __${name}_${index}_a = true;`,
      `type __${name}_${index}_b = ${name}${args} extends Real.${name}${args} ? true : never; const __${name}_${index}_b: __${name}_${index}_b = true;`,
      `type __${name}_${index}_c = [Exclude<__Keys<Real.${name}${args}>, __Keys<${name}${args}>>] extends [never] ? true : never; const __${name}_${index}_c: __${name}_${index}_c = true;`,
      `type __${name}_${index}_d = [Exclude<__Keys<${name}${args}>, __Keys<Real.${name}${args}>>] extends [never] ? true : never; const __${name}_${index}_d: __${name}_${index}_d = true;`,
    ]);
  });
  return [
    `import type * as Real from "${source(modules.index)}";`,
    // Distributes over a union, so a field added to one variant on either side is a drift too.
    "type __Keys<T> = T extends unknown ? keyof T : never;",
    ...preamble,
    ...placeholders.map(name => `declare const ${name}: any;`),
    "",
    body,
    "",
    ...mirror,
    "",
  ].join("\n");
}

const compile = (): Map<string, { code: string; text: string; line: number }[]> => {
  const tsc = spawnSync(join(root, "node_modules", ".bin", "tsc"), ["-p", join(work, "tsconfig.json")], { encoding: "utf8", cwd: root });
  if (tsc.error !== undefined) throw tsc.error;
  const errors = new Map<string, { code: string; text: string; line: number }[]>();
  for (const line of tsc.stdout.split("\n")) {
    const match = /^(?:.*[\\/])?(L\d+)\.ts\((\d+),\d+\): error (TS\d+): (.*)$/.exec(line);
    if (match) errors.set(match[1] as string, [...(errors.get(match[1] as string) ?? []), { code: match[3] as string, text: match[4] as string, line: Number(match[2]) }]);
  }
  return errors;
};

describe("the guide's examples compile", () => {
  it("every complete ```ts block type-checks, and every declared shape mirrors the package's", () => {
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    writeFileSync(join(work, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
        noUncheckedIndexedAccess: true, noEmit: true, skipLibCheck: true, lib: ["ES2022", "DOM"],
      },
      include: ["*.ts"],
    }));
    const write = (placeholders: Map<string, string[]>) => {
      for (const block of blocks) writeFileSync(join(work, `L${block.line}.ts`), fileFor(block, placeholders.get(`L${block.line}`) ?? []));
    };

    // A fragment is a block that does not parse, and that is decided by the parser alone -- not
    // by tsc's error codes, which include import mistakes a complete example could make. tsc
    // reports no semantic error while any file in the program fails to parse, so the fragments
    // are taken out before the complete examples are checked.
    const fragments = new Set(blocks
      .filter(block => (ts.transpileModule(block.body, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022 } }).diagnostics ?? []).length > 0)
      .map(block => `L${block.line}`));
    write(new Map());
    for (const name of fragments) rmSync(join(work, `${name}.ts`));

    // A name an example uses without declaring is a placeholder; it is declared and the block
    // is checked again for everything else.
    const second = compile();
    const placeholders = new Map<string, string[]>();
    for (const [name, found] of second) {
      const missing = found.filter(error => error.code === "TS2304").map(error => /Cannot find name '([^']+)'/.exec(error.text)?.[1]).filter((n): n is string => n !== undefined);
      if (missing.length > 0) placeholders.set(name, [...new Set(missing)]);
    }
    // A placeholder is a name the guide chose, not one the code dropped: every one is on the list.
    const strangers = [...placeholders.entries()].flatMap(([name, names]) => names.filter(n => !PLACEHOLDERS.has(n)).map(n => `${n} (guide.md:${name.slice(1)})`));
    expect(strangers).toEqual([]);
    for (const block of blocks) {
      const name = `L${block.line}`;
      if (!fragments.has(name) && placeholders.has(name)) writeFileSync(join(work, `${name}.ts`), fileFor(block, placeholders.get(name) ?? []));
    }
    const third = compile();
    const wrong = [...third.entries()].map(([name, found]) => `guide.md:${name.slice(1)} — ${found.map(error => `${error.code} ${error.text} (line ${error.line})`).join("; ")}`);
    expect(wrong).toEqual([]);

    // The test is only as good as what it reaches: most blocks are complete examples and the
    // Shapes section declares dozens of mirrored types, and it says so.
    const complete = blocks.filter(block => !fragments.has(`L${block.line}`));
    // And the mirror is whole: every type the package exports is declared under Shapes, so a
    // type added to the code without a place in the guide is a failing build, not a gap found later.
    const declared = new Set(blocks.flatMap(block => block.types.map(type => type.name)));
    const exportedTypes = [...readFileSync(join(__dirname, "index.ts"), "utf8").matchAll(/^export (?:type|interface) ([A-Za-z_$][A-Za-z0-9_$]*)/gm)].map(match => match[1] as string);
    expect(exportedTypes.filter(name => !declared.has(name))).toEqual([]);
    expect(complete.length).toBeGreaterThanOrEqual(35);
    expect(complete.flatMap(block => block.types).filter(type => exports.index.includes(type.name)).length).toBeGreaterThanOrEqual(60);
  });
});
