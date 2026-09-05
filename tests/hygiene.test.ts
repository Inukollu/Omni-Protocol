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
  it("keeps the words the contract renamed out of everything committed, and finds a planted one", () => {
    // A rename that lingers in the guide or a fixture teaches the old word to the next adapter.
    const RENAMED = ["sessionId", "SessionCapabilities", "ConnectionStatus", "ConnectionRecovery", "provider-status",
      "orgTiers", "TierDeclaration", "DEFAULT_TIERS", "effectiveTiers", "task-media-ready", "TaskBrowserBase",
      "destinationPolicy", "completionAllowance", "DispositionPolicy", "BrowserAccessPolicy", "DialDestinationPolicy",
      "ProviderSummary", "provider-summary", "assertBrowserIsolationAndReuse", "reuse:",
      "accessPolicyScope", "require-agent-acceptance", "require-automatic-acceptance", "team.policy.agent", "acceptanceMode", "TaskInheritance", "task.inherited",
      "\"dialled\"", "`dialled`", "TaskConsultation", "task.consultation", "consultation?", "participant", "Participant", "attemptId",
      "consultLead", "consultControl", "executeTeamConsult", "TeamConsultCommand", "TaskLead;", "TaskLead,", "TaskLead }", "TaskLead>",
      "type: \"lead\"", "task.lead.", "\"task.lead\"", "Task.lead`", "Consulting a lead",
      "type: \"callback\"", "callback?:", "callback: true", "`callback`", "Calling back during completion"];
    // A line under @ts-expect-error, or under a "renamed away" note, is a refusal kept on purpose, not vocabulary.
    const marked = (line: string) => line.includes("@ts-expect-error") || line.includes("renamed away:");
    const refusals = (text: string) => { const lines = text.split("\n"); return lines.filter((_, index) => !marked(lines[index - 1] ?? "")).join("\n"); };
    const lingering = (text: string) => RENAMED.filter(word => refusals(text).includes(word));
    expect(lingering("the old sessionId key")).toEqual(["sessionId"]);
    const files = ["guide.md", "README.md", ...readdirSync(join(root, "src")).map(name => `src/${name}`), ...readdirSync(__dirname).filter(name => name !== "hygiene.test.ts").map(name => `tests/${name}`)];
    for (const file of files) expect(lingering(readFileSync(join(root, file), "utf8")), file).toEqual([]);
  });

  it("finds a planted internal name, and none in anything committed or published", () => {
    // The control: a scanner that cannot find a planted name proves nothing by finding none.
    expect(offending(`speaks to ${decode("SmVtYQ==")} directly`)).toHaveLength(1);
    const files = [
      "guide.md",
      "README.md",
      "package.json",
      ...readdirSync(join(root, ".github/workflows")).map(name => `.github/workflows/${name}`),
      ...readdirSync(join(root, "src")).map(name => `src/${name}`),
      ...readdirSync(__dirname).filter(name => name !== "hygiene.test.ts").map(name => `tests/${name}`),
    ];
    for (const file of files) {
      expect(offending(readFileSync(join(root, file), "utf8")), file).toEqual([]);
    }
  });
});
