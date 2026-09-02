import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// This is a public repository. Internal names -- other sessions, machines, private projects --
// belong in none of its committed text. The list is base64-encoded so this file does not itself
// carry the names it keeps out; decode an entry to learn what tripped it.

const root = join(__dirname, "..");
const decode = (entry: string): string => Buffer.from(entry, "base64").toString();
const INTERNAL = ["amVtYQ==", "ZGIgbWluaQ==", "ZGItbWluaQ==", "ZGJtaW5p", "ZGIgbWF4", "ZGJtYXg=", "bWluaTQ="].map(decode);
const offending = (text: string): string[] => INTERNAL.filter(name => text.toLowerCase().includes(name));

describe("a public repo says less", () => {
  it("finds a planted internal name, and none in anything committed or published", () => {
    // The control: a scanner that cannot find a planted name proves nothing by finding none.
    expect(offending(`speaks to ${decode("SmVtYQ==")} directly`)).toHaveLength(1);
    const files = [
      "guide.md",
      "README.md",
      "package.json",
      ...readdirSync(join(root, ".github/workflows")).map(name => `.github/workflows/${name}`),
      ...readdirSync(__dirname).filter(name => name !== "hygiene.test.ts").map(name => `src/${name}`),
    ];
    for (const file of files) {
      expect(offending(readFileSync(join(root, file), "utf8")), file).toEqual([]);
    }
  });
});
