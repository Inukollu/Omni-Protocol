import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "omni-package-"));
const run = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

try {
  // Use npm's packer because the release is published with npm. No lifecycle recursion.
  const [packed] = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json", "--cache", join(work, "npm-cache"), "--pack-destination", work], root));
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const required = new Set(["package.json", "README.md", "guide.md", "LICENSE"]);
  for (const entry of Object.values(manifest.exports)) {
    assert.equal(typeof entry.types, "string", "Every entry point must declare types");
    assert.equal(typeof entry.import, "string", "Every entry point must declare an ESM import");
    required.add(entry.types.replace(/^\.\//, ""));
    required.add(entry.import.replace(/^\.\//, ""));
  }
  const files = new Set(packed.files.map(file => file.path));
  assert.deepEqual([...files].sort(), [...required].sort(), "Package must contain exactly its public artifacts");
  for (const entry of [manifest.main, manifest.types]) {
    assert.equal(typeof entry, "string");
    assert.ok(files.has(entry.replace(/^\.\//, "")), `Missing package entry: ${entry}`);
  }

  const installed = join(work, "node_modules", manifest.name);
  mkdirSync(installed, { recursive: true });
  run("tar", ["-xzf", join(work, packed.filename), "--strip-components=1", "-C", installed], work);
  writeFileSync(join(work, "package.json"), JSON.stringify({ private: true, type: "module" }));
  const imports = Object.keys(manifest.exports).map(key => manifest.name + (key === "." ? "" : key.slice(1)));
  const consumer = imports.map((specifier, index) => `import * as entry${index} from ${JSON.stringify(specifier)};\nconsole.log(Object.keys(entry${index}));`).join("\n");
  writeFileSync(join(work, "consumer.mjs"), consumer);
  writeFileSync(join(work, "consumer.mts"), consumer);
  run(process.execPath, [join(work, "consumer.mjs")], work);
  const compiler = join(root, "node_modules", "typescript", "bin", "tsc");
  assert.ok(existsSync(compiler), `Install dependencies before checking the package: ${dirname(compiler)}`);
  run(process.execPath, [compiler, "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "--lib", "ES2022,DOM", "consumer.mts"], work);
  console.log(`Package verified: ${files.size} files; runtime imports and declarations for ${imports.join(", ")}`);
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally {
  rmSync(work, { recursive: true, force: true });
}
