import { describe, expect, it } from "vitest";
import { BREAK_KINDS, BROWSER_ISOLATION_SCHEMES, IDLE_CAPABILITIES, effectiveLevels } from "../src/index.js";
import {
  assertNoViolations,
  ProtocolConformanceError,
  validateAuthenticationState,
  validateAuthenticationFailure,
  validateAuthenticationResult,
  validateContact,
  validateEventEnvelope,
  validateInteractionReport,
  validateHostGuarantees,
  validateHostMute,
  validateLoginStore,
  validateCapacity,
  validateHostReport,
  validateManifest,
  validateScheduledActivity,
  validateSnapshot,
  validateTask,
  validateTaskCommand,
  validateTimeZone,
  validatePhone,
  isTimeZone,
  sameTimeZone,
  validateResult,
  validateTeamMembers,
  type ProtocolViolation,
} from "../src/validation.js";

const rules = (violations: readonly ProtocolViolation[]) => violations.map(violation => violation.rule);

describe("untrusted values in violation messages", () => {
  it("reports malformed JSON values without trying to call their conversion methods", () => {
    const bad: unknown = JSON.parse('{"toString":null}');
    for (const value of [bad, [bad]]) {
      expect(rules(validateManifest(manifest({ channel: value })))).toContain("manifest.channel");
      expect(rules(validateTask(task({ phase: value }), { channel: "voice" }))).toContain("task.phase");
      expect(rules(validateEventEnvelope(envelope({ type: value }), manifest()))).toContain("event.type");
      expect(rules(validateResult({ status: value }, "execute"))).toContain("result.status");
      expect(rules(validateAuthenticationResult({ status: value }, "start"))).toContain("authentication.result.status");
      expect(rules(validatePhone("softphone", manifest({ phones: [value] })))).toContain("context.phone.unsupported");
    }
  });

  it("keeps reporting violations when nested wire fields are replaced with malformed JSON", () => {
    const cases: [unknown, (value: unknown) => ProtocolViolation[]][] = [
      [manifest(), value => validateManifest(value)],
      [task(), value => validateTask(value, { channel: "voice" })],
      [snapshot({ tasks: [task()] }), value => validateSnapshot(value, manifest())],
      [envelope({ type: "task-updated", task: task() }), value => validateEventEnvelope(value, manifest())],
      [{ status: "authenticated", identity: { id: "A-1", displayName: "Ada", timeZone: "Asia/Kolkata" }, capabilities: {} }, value => validateAuthenticationState(value)],
      [{ status: "failed", failure: { code: "provider.busy", message: "Busy", retryable: true } }, value => validateResult(value, "execute")],
      [{ online: true, audio: { input: { status: "unavailable", reason: "no-device", failure: { code: "device.missing", message: "No microphone", retryable: false } }, output: { status: "available" } } }, value => validateHostReport(value)],
    ];
    const paths = (value: unknown, at: string[] = []): string[][] => [at, ...(
      value !== null && typeof value === "object"
        ? Object.entries(value).flatMap(([key, child]) => paths(child, [...at, key])) : []
    )];
    const bad: unknown = JSON.parse('{"toString":null,"valueOf":null}');
    for (const [valid, validate] of cases) {
      expect(validate(valid)).toEqual([]);
      for (const path of paths(valid)) {
        for (const replacement of [null, false, 17, "invalid", {}, [], bad, [bad]]) {
          let changed: unknown = structuredClone(valid);
          if (path.length === 0) changed = replacement;
          else {
            let parent = changed as Record<string, unknown>;
            for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
            parent[path[path.length - 1]!] = replacement;
          }
          const violations = validate(changed);
          expect(Array.isArray(violations), path.join(".")).toBe(true);
          for (const violation of violations) {
            expect(typeof violation.rule).toBe("string");
            expect(typeof violation.path).toBe("string");
            expect(typeof violation.message).toBe("string");
          }
        }
      }
    }
  });
});

describe("media events belong to voice", () => {
  it("rejects media transitions on chat and email providers", () => {
    for (const type of ["task-media-started", "task-media-ended"]) {
      const event = envelope({ type, taskId: "call-42", allocationId: "alloc-42" });
      expect(validateEventEnvelope(event, manifest())).toEqual([]);
      for (const channel of ["chat", "email"]) {
        expect(rules(validateEventEnvelope(event, manifest({ channel })))).toEqual(["event.media.channel"]);
      }
    }
  });
});

const manifest = (over: Record<string, unknown> = {}) => ({
  id: "acme-voice",
  displayName: "Acme Voice",
  channel: "voice",
  supportedProtocolVersions: [1],
  authenticationMethods: ["credentials"],
  completionSettleMs: 5000,
  // A voice manifest says which phones it supports; any other channel says nothing.
  ...(over.channel !== undefined && over.channel !== "voice" ? {} : { phones: ["softphone"] }),
  ...over,
});

const task = (over: Record<string, unknown> = {}) => {
  const capabilities = (over.capabilities ?? { browsers: true, hold: true }) as Record<string, unknown>;
  return {
    id: "call-42",
    title: "Customer call",
    channel: "voice",
    taskType: "Customer Support",
    capabilities,
    capabilitySource: "queue",
    allocationId: "alloc-42",
    // A task supplies browsers only under the capability that shows them.
    browsers: capabilities.browsers === true ? [{ id: "crm", name: "CRM", purpose: "Account", url: "https://crm.example.com", sharedSession: false }] : [],
    phase: "in-progress",
    completionMode: "agent-command",
    wrapAllowance: 15,
    ...over,
  };
};

const snapshot = (over: Record<string, unknown> = {}) => ({
  transport: "active",
  loginId: "session-1",
  break: { approval: "not-requested", mayAsk: true },
  tasks: [],
  taskCount: Array.isArray(over.tasks) ? over.tasks.length : 0,
  ...over,
});

const envelope = (event: unknown, over: Record<string, unknown> = {}) => ({
  id: "evt-1",
  loginId: "session-1",
  occurredAt: "2026-08-21T09:00:00Z",
  event,
  ...over,
});

describe("assertNoViolations", () => {
  it("throws only when something is wrong, and carries every violation", () => {
    expect(() => assertNoViolations([])).not.toThrow();
    const found = [{ rule: "task.id", path: "task.id", message: "needed" }];
    expect(() => assertNoViolations(found)).toThrow(ProtocolConformanceError);
    try {
      assertNoViolations(found);
    } catch (error) {
      expect((error as ProtocolConformanceError).violations).toEqual(found);
    }
  });
});

describe("timestamps", () => {
  it("rejects impossible calendar dates and hour 24 instead of normalizing them", () => {
    const at = (startsAt: string) => rules(validateScheduledActivity({ id: "a", title: "T", startsAt }));
    for (const date of ["2026-02-30", "2025-02-29", "1900-02-29", "2100-02-29", "2026-04-31", "2026-00-10", "2026-13-01", "2026-01-00"]) {
      for (const zone of ["Z", "+05:30", "-04:00"]) expect(at(`${date}T09:00:00${zone}`)).toEqual(["activity.startsAt"]);
    }
    for (const time of ["24:00:00", "24:00:00.000", "12:60:00", "12:00:61"]) {
      expect(at(`2026-09-09T${time}Z`)).toEqual(["activity.startsAt"]);
    }
    for (const date of ["2000-02-29", "2024-02-29", "2026-02-28", "2026-04-30", "2026-12-31", "0000-02-29", "0096-02-29"]) {
      for (const zone of ["Z", "+05:30", "-04:00"]) expect(at(`${date}T23:59:59.125${zone}`)).toEqual([]);
    }
    expect(at("2024-02-29t00:00:00z")).toEqual([]);
    expect(at("2026-09-09T00:00:00+24:00")).toEqual(["activity.startsAt"]);
    expect(at("2026-09-09T00:00:00+05:60")).toEqual(["activity.startsAt"]);
  });
  it("requires a zone, because a timezone-less value is a different instant on every host", () => {
    const at = (value: unknown) => rules(validateScheduledActivity({ id: "a", title: "T", startsAt: value }));
    expect(at("2026-08-21T09:00:00Z")).toEqual([]);
    expect(at("2026-08-21T09:00:00+05:30")).toEqual([]);
    expect(at("2026-08-21T09:00:00.250Z")).toEqual([]);
    // Date.parse accepts all of these and resolves them locally, which is exactly the bug.
    expect(at("2026-08-21T09:00:00")).toContain("activity.startsAt");
    expect(at("2026-08-21")).toContain("activity.startsAt");
    expect(at("just now")).toContain("activity.startsAt");
    expect(at(1_760_000_000)).toContain("activity.startsAt");
  });
});

describe("validateManifest", () => {
  it("takes the typical four levels by default, or exactly the ladder the manifest states", () => {
    expect(effectiveLevels(undefined).map(level => level.id)).toEqual(["org", "site", "team", "person"]);
    // A declared ladder is the whole ladder: what it leaves out does not exist.
    const levels = effectiveLevels([{ id: "org", label: "Your organisation" }, { id: "team", label: "Your queue group" }, { id: "person", label: "You" }]);
    expect(levels.map(level => `${level.id}=${level.label}`)).toEqual(["org=Your organisation", "team=Your queue group", "person=You"]);
    const m = (orgLevels: unknown) => rules(validateManifest(manifest({ orgLevels })));
    expect(m([{ id: "region", label: "Your region" }, { id: "person", label: "You" }])).toEqual([]);
    expect(m("region")).toEqual(["manifest.orgLevels.shape"]);
    expect(m(["region"])).toEqual(["manifest.orgLevel.shape"]);
    expect(m([{ label: "Your region" }])).toEqual(["manifest.orgLevel.id"]);
    expect(m([{ id: "region" }])).toEqual(["manifest.orgLevel.label"]);
    expect(m([{ id: "region", label: "A" }, { id: "region", label: "B" }])).toEqual(["manifest.orgLevel.unique"]);
    // The subject of every resolution cannot be declared away.
    expect(m([{ id: "org", label: "Your organisation" }, { id: "team", label: "Your team" }])).toEqual(["manifest.orgLevels.person"]);
  });

  it("accepts a conforming manifest", () => {
    expect(validateManifest(manifest())).toEqual([]);
    expect(validateManifest(manifest({ idleCapabilities: { dial: { destinations: "any-number" }, contacts: true }, dialOutcomes: ["answered", "no-answer"] }))).toEqual([]);
  });

  it.each([
    ["a missing id", manifest({ id: "" }), "manifest.id"],
    ["an unknown channel", manifest({ channel: "fax" }), "manifest.channel"],
    ["no protocol versions", manifest({ supportedProtocolVersions: [] }), "manifest.supportedProtocolVersions"],
    ["a non-integer version", manifest({ supportedProtocolVersions: [1.5] }), "manifest.supportedProtocolVersions.value"],
    ["no version this host speaks", manifest({ supportedProtocolVersions: [99] }), "manifest.supportedProtocolVersions.interoperable"],
    ["no authentication method", manifest({ authenticationMethods: [] }), "manifest.authenticationMethods"],
    ["an unknown authentication method", manifest({ authenticationMethods: ["magic-link"] }), "manifest.authenticationMethod"],
    ["an unknown phase label", manifest({ phaseLabels: { ringing: "Ringing" } }), "manifest.phaseLabels.phase"],
  ])("rejects %s", (_label, value, rule) => {
    expect(rules(validateManifest(value))).toContain(rule);
    // The control in the same test: the conforming manifest is not refused for it.
    expect(rules(validateManifest(manifest()))).not.toContain(rule);
  });

  it("lets only voice declare dial", () => {
    const chat = { ...manifest({ channel: "chat" }), idleCapabilities: { dial: { destinations: "any-number" } } };
    expect(rules(validateManifest(chat))).toContain("manifest.idleCapability.channel");
    // The control: the same capability on voice is fine, so the rejection is about the channel.
    expect(validateManifest(manifest({ idleCapabilities: { dial: { destinations: "any-number" } }, dialOutcomes: ["answered", "no-answer"] }))).toEqual([]);
  });

  it("declares presence capabilities by presence", () => {
    expect(rules(validateManifest(manifest({ idleCapabilities: { contacts: false } })))).toContain("manifest.idleCapability.value");
    expect(validateManifest(manifest({ idleCapabilities: { contacts: true } }))).toEqual([]);
  });
});

describe("validateTask", () => {
  const check = (over: Record<string, unknown> = {}, channel = "voice") => rules(validateTask(task(over), { channel }));

  it("lets each task browser say what the agent sees of its URL, in one of three words", () => {
    const browser = (extra: Record<string, unknown>) => rules(validateTask(task({ capabilities: { browsers: true }, browsers: [{ id: "crm", name: "CRM", purpose: "Customer record", url: "https://crm.example.com/42", sharedSession: false, ...extra }] }), { channel: "voice" }));
    expect(browser({})).toEqual([]);
    expect(browser({ urlVisibility: "hidden" })).toEqual([]);
    expect(browser({ urlVisibility: "domain" })).toEqual([]);
    expect(browser({ urlVisibility: "full" })).toEqual([]);
    expect(browser({ urlVisibility: "partial" })).toEqual(["task.browser.urlVisibility"]);
  });
  it("carries the task's media state on voice alone, in one of two words", () => {
    const media = (value: unknown, channel = "voice") => rules(validateTask(task({ channel, media: value }), { channel }));
    expect(media("started")).toEqual([]);
    expect(media("ended")).toEqual([]);
    expect(media(undefined)).toEqual([]);
    expect(media("live")).toEqual(["task.media"]);
    // Media names a task whose work has begun: on an offer it would open the microphone on nobody's call.
    for (const phase of ["pending", "confirmed", "preview"]) {
      expect(rules(validateTask(task({ phase, media: "started", ...(phase === "pending" ? { acceptance: "consent" } : {}) }), { channel: "voice", dialOutcomesDeclared: true })), phase).toEqual(["task.media.beforeWork"]);
    }
    expect(rules(validateTask(task({ phase: "paused", media: "started" }), { channel: "voice" }))).toEqual([]);
    // Real-time media is a voice affair; another channel carries no state for it.
    expect(media("ready", "chat")).toEqual(["task.media.channel"]);
  });
  it("lets a control stand locked in its place, naming the level, and never a queue's own content", () => {
    const caps = (capabilities: unknown) => rules(validateTask(task({ capabilities }), { channel: "voice" }));
    expect(caps({ hold: true, recording: { lockedBy: "team", reason: "Nobody on this team records" }, endCall: { lockedBy: "site" } })).toEqual([]);
    expect(caps({ coldTransfer: { lockedBy: "org" } })).toEqual([]);
    expect(caps({ recording: { lockedBy: "person" } })).toEqual(["task.capability.locked.lockedBy.person"]);
    // A level is one of the four defaults when the manifest declares no ladder.
    expect(caps({ recording: { lockedBy: "org" } })).toEqual([]);
    expect(caps({ recording: { lockedBy: "region" } })).toEqual(["task.capability.locked.lockedBy.unknown"]);
    // The control: a manifest that declares no ladder has all four defaults in force.
    expect(rules(validateSnapshot(snapshot({ tasks: [task({ capabilities: { recording: { lockedBy: "site" } } })] }), manifest()))).toEqual([]);
    const regional = manifest({ orgLevels: [{ id: "org", label: "Your organisation" }, { id: "region", label: "Your region" }, { id: "team", label: "Your team" }, { id: "person", label: "You" }] });
    expect(rules(validateSnapshot(snapshot({ tasks: [task({ capabilities: { recording: { lockedBy: "region" } } })] }), regional))).toEqual([]);
    // The ladder is the whole ladder: a default the manifest left out is not in force.
    expect(rules(validateSnapshot(snapshot({ tasks: [task({ capabilities: { recording: { lockedBy: "site" } } })] }), regional))).toEqual(["task.capability.locked.lockedBy.unknown"]);
    expect(rules(validateSnapshot(snapshot({ tasks: [task({ capabilities: { recording: { lockedBy: "district" } } })] }), regional))).toEqual(["task.capability.locked.lockedBy.unknown"]);
    expect(caps({ recording: { lockedBy: "team", reason: "" } })).toEqual(["task.capability.locked.reason"]);
    expect(caps({ browsers: { lockedBy: "team" } })).toEqual(["task.capability.locked.unexpected"]);
    // lockedBy is the discriminant: a directory carrying it would read as a lock, so it may not.
    expect(caps({ coldTransfer: { destinations: [{ id: "t2", label: "Tier 2" }] } })).toEqual([]);
    expect(caps({ coldTransfer: { lockedBy: "org" } })).toEqual([]);
    // A chat task has no recording to lock; the channel rule speaks first.
    expect(rules(validateTask(task({ channel: "chat", capabilities: { recording: { lockedBy: "team" } } }), { channel: "chat" }))).toEqual(["task.capability.channel"]);
  });
  it("withholds a number by locking it in place, never by a flag", () => {
    const contact = (value: unknown) => rules(validateTask(task({ party: value }), { channel: "voice" }));
    expect(contact({ name: "Asha", number: "+14155550111" })).toEqual([]);
    expect(contact({ name: "Asha", number: { lockedBy: "org" } })).toEqual([]);
    expect(contact({ name: "Asha", number: { lockedBy: "person" } })).toEqual(["contact.number.locked.lockedBy.person"]);
    // Email identifies a person as a number does, and is locked the same way; a name is not.
    expect(contact({ name: "Asha", email: { lockedBy: "site" } })).toEqual([]);
    expect(contact({ name: "Asha", email: { lockedBy: "person" } })).toEqual(["contact.email.locked.lockedBy.person"]);
    expect(contact({ name: { lockedBy: "org" } })).toEqual(["contact.name"]);
    expect(contact({ name: "Asha", number: "" })).toEqual(["contact.number"]);
  });
  it("lets a custom action ask for what it needs and say where it renders", () => {
    const custom = (over: Record<string, unknown>) => rules(validateTask(task({ capabilities: { custom: [{ id: "transfer-out", ui: { control: "button", label: "Transfer out", placement: "secondary", render: "inline" }, ...over }] } }), { channel: "voice" }));
    const destination = { name: "destination", label: "Number", type: "text" };
    expect(custom({})).toEqual([]);
    expect(custom({ prompt: { fields: [destination] } })).toEqual([]);
    expect(custom({ ui: { control: "button", label: "Transfer out", placement: "secondary", render: "page" } })).toEqual([]);
    expect(custom({ ui: { control: "button", label: "Transfer out", placement: "secondary", render: "popup" } })).toEqual(["task.custom.ui.render"]);
    expect(custom({ prompt: { fields: [] } })).toEqual(["task.custom.prompt.fields"]);
    expect(custom({ prompt: "destination" })).toEqual(["task.custom.prompt.shape"]);
    expect(custom({ prompt: { fields: ["destination"] } })).toEqual(["task.custom.prompt.field.shape"]);
    expect(custom({ prompt: { fields: [{ label: "Number", type: "text" }] } })).toEqual(["task.custom.prompt.field.name"]);
    expect(custom({ prompt: { fields: [{ name: "destination", type: "text" }] } })).toEqual(["task.custom.prompt.field.label"]);
    expect(custom({ prompt: { fields: [{ ...destination, type: "number" }] } })).toEqual(["task.custom.prompt.field.type"]);
    expect(custom({ prompt: { fields: [{ ...destination, required: "yes" }] } })).toEqual(["task.custom.prompt.field.required"]);
    expect(custom({ prompt: { fields: [{ ...destination, autocomplete: 1 }] } })).toEqual(["task.custom.prompt.field.autocomplete"]);
    expect(custom({ prompt: { fields: [{ ...destination, required: false, autocomplete: "tel" }] } })).toEqual([]);
  });
  it("states what the record adds up to before this agent, each total present when known", () => {
    const record = (over: Record<string, unknown>) => rules(validateTask(task({ interactionHistory: { steps: [{ step: "answered", at: "2026-08-21T00:59:41Z", by: "a-17" }], ...over } }), { channel: "voice" }));
    expect(record({ interactionSeconds: 312, holdSeconds: 95, queueSeconds: 41, transfers: 2 })).toEqual([]);
    expect(record({ interactionSeconds: 0, holdSeconds: 0, transfers: 0 })).toEqual([]);
    // Each total is present when the provider knows it: the rest are absent, never a plausible nought.
    expect(record({ transfers: 2 })).toEqual([]);
    expect(record({})).toEqual([]);
    expect(record({ holdSeconds: -5 })).toEqual(["task.interactionHistory.holdSeconds"]);
    expect(record({ queueSeconds: 1.5 })).toEqual(["task.interactionHistory.queueSeconds"]);
    expect(record({ interactionSeconds: "312" })).toEqual(["task.interactionHistory.interactionSeconds"]);
    expect(record({ transfers: -1 })).toEqual(["task.interactionHistory.transfers"]);
    expect(rules(validateTask(task({ interactionHistory: { transfers: 2 } }), { channel: "voice" }))).toEqual(["task.interactionHistory.steps.shape"]);
    expect(rules(validateTask(task({ interactionHistory: [] }), { channel: "voice" }))).toEqual(["task.interactionHistory.shape"]);
    // The entries moved under steps, and a violation says where it found them.
    const misstep = validateTask(task({ interactionHistory: { steps: [{ step: "ringing", at: "2026-08-21T09:00:00Z" }] } }), { channel: "voice" });
    expect(misstep.map(v => `${v.rule} @ ${v.path}`)).toEqual(["task.interactionHistory.step @ task.interactionHistory.steps[0].step"]);
  });

  it("records each hold as its own entry, oldest first", () => {
    const history = (steps: unknown) => rules(validateTask(task({ interactionHistory: { steps } }), { channel: "voice" }));
    const answered = { step: "answered", at: "2026-08-21T00:59:41Z", by: "a-17" };
    // Two holds are two entries; the running one omits its seconds, and runs only while the task is paused.
    const paused = (steps: unknown) => rules(validateTask(task({ phase: "paused", interactionHistory: { steps } }), { channel: "voice" }));
    expect(paused([answered, { step: "held", at: "2026-08-21T01:02:10Z", by: "a-17" }])).toEqual([]);
    expect(history([answered, { step: "held", at: "2026-08-21T01:02:10Z", by: "a-17" }])).toEqual(["task.interactionHistory.held.open"]);
    expect(history([answered, { step: "held", at: "2026-08-21T01:02:10Z", seconds: 35, by: "a-17" }])).toEqual([]);
    // A mute runs only while the media is up: an open one on a call that is over is a leg nobody closed.
    const over = (steps: unknown, over: Record<string, unknown>) => rules(validateTask(task({ ...over, interactionHistory: { steps } }), { channel: "voice" }));
    const openMute = { step: "muted", at: "2026-08-21T01:00:00Z", by: "a-17", mutedBy: "host" };
    expect(over([answered, openMute], { media: "started" })).toEqual([]);
    expect(over([answered, openMute], { media: "ended" })).toEqual(["task.interactionHistory.muted.open"]);
    expect(over([answered, openMute], { phase: "completing", onCall: [] })).toEqual(["task.interactionHistory.muted.open"]);
    // A completing task's audio has ended or never started: stated as started, it is a call that never ended.
    expect(rules(validateTask(task({ phase: "completing", onCall: [], media: "ended" }), { channel: "voice" }))).toEqual([]);
    expect(rules(validateTask(task({ phase: "completing", onCall: [] }), { channel: "voice" }))).toEqual([]);
    expect(rules(validateTask(task({ phase: "completing", onCall: [], media: "started" }), { channel: "voice" }))).toEqual(["task.media.completing"]);
    expect(rules(validateTask(task({ phase: "in-progress", media: "started" }), { channel: "voice" }))).toEqual([]);
    expect(over([answered, { ...openMute, seconds: 4 }], { media: "ended" })).toEqual([]);
    expect(paused([answered, { step: "held", at: "2026-08-21T01:02:10Z", seconds: 35, by: "a-17" }, { step: "held", at: "2026-08-21T01:06:48Z", by: "a-17" }])).toEqual([]);
    expect(history([answered, { step: "muted", at: "2026-08-21T01:00:00Z", seconds: 4, by: "a-17", mutedBy: "host" }, { step: "muted", at: "2026-08-21T01:01:00Z", seconds: 9, by: "a-17", mutedBy: "station" }])).toEqual([]);
    // A muted leg names the agent: the host has one, the provider knows who. A held leg may honestly not.
    expect(history([answered, { step: "muted", at: "2026-08-21T01:00:00Z", seconds: 4, mutedBy: "host" }])).toEqual(["task.interactionHistory.muted.by"]);
    expect(history([answered, { step: "held", at: "2026-08-21T01:00:00Z", seconds: 4 }])).toEqual([]);
    // A call that joined two queues is two queued entries, one per join, and the offer follows the last of them.
    expect(history([{ step: "queued", at: "2026-08-21T00:55:00Z", seconds: 240 }, { step: "queued", at: "2026-08-21T00:59:00Z", seconds: 30 }, { step: "offered", at: "2026-08-21T00:59:30Z", by: "a-17" }, answered])).toEqual([]);
    // A muted entry says whose the silence was, as the host reported it; no other step has anyone to name.
    expect(history([answered, { step: "muted", at: "2026-08-21T01:00:00Z", seconds: 4, by: "a-17" }])).toEqual(["task.interactionHistory.mutedBy"]);
    expect(history([answered, { step: "muted", at: "2026-08-21T01:00:00Z", seconds: 4, by: "a-17", mutedBy: "headset" }])).toEqual(["task.interactionHistory.mutedBy"]);
    expect(history([answered, { step: "held", at: "2026-08-21T01:00:00Z", seconds: 4, mutedBy: "host" }])).toEqual(["task.interactionHistory.mutedBy.unexpected"]);
    // Oldest first: a hold filed before the answer it followed is out of its turn.
    expect(history([{ step: "held", at: "2026-08-21T01:02:10Z", seconds: 35, by: "a-17" }, answered])).toEqual(["task.interactionHistory.order"]);
    expect(paused([answered, { step: "held", at: "2026-08-21T00:59:41Z", by: "a-17" }])).toEqual([]);
    // A malformed instant is its own violation and takes no part in the ordering.
    expect(paused([answered, { step: "held", at: "soon", by: "a-17" }, { step: "held", at: "2026-08-21T01:06:48Z", by: "a-17" }])).toEqual(["task.interactionHistory.at"]);
  });

  it("gives a task whose party the host is dialling its audio from dialling, and no other task not at work", () => {
    const ringing = { onCall: [{ role: "party", dialId: "dial-3", stage: "ringing", since: "2026-08-21T09:00:00Z" }] };
    const voice = { channel: "voice", dialOutcomesDeclared: true };
    expect(rules(validateTask(task({ phase: "pending", acceptance: "automatic", media: "started", ...ringing }), voice))).toEqual([]);
    expect(rules(validateTask(task({ phase: "preview", capabilities: {}, media: "started", ...ringing }), voice))).toEqual([]);
    // The controls: nobody ringing, and a platform's own callback without the host's dial, have no audio before the work begins.
    expect(rules(validateTask(task({ phase: "pending", media: "started" }), voice))).toEqual(["task.media.beforeWork"]);
    expect(rules(validateTask(task({ phase: "preview", capabilities: {}, media: "started", onCall: [{ role: "party", stage: "ringing", since: "2026-08-21T09:00:00Z" }] }), voice))).toEqual(["task.media.beforeWork"]);
  });

  it("holds a task whose party is locked to carrying the locked value nowhere else, given the values", () => {
    const locked = ["+91 98765 43210", "Asha.Rao@example.com"];
    const withLocked = (over: Record<string, unknown>) =>
      rules(validateTask(task({ party: { name: "Asha", number: { lockedBy: "team" }, email: { lockedBy: "team" } }, ...over }), { channel: "voice", locked }));
    // The digits leak whatever the formatting; the address leaks whatever the case; a hidden browser URL may carry it.
    expect(withLocked({ title: "Customer call" })).toEqual([]);
    expect(withLocked({ title: "Call from +91-98765-43210" })).toEqual(["task.locked.leak"]);
    expect(withLocked({ reference: "asha.rao@EXAMPLE.com" })).toEqual(["task.locked.leak"]);
    expect(withLocked({ attributes: [{ key: "cli", type: "text", value: "919876543210" }] })).toEqual(["task.locked.leak"]);
    expect(withLocked({ attributes: [{ key: "cli", type: "text", value: "last four 3210" }] })).toEqual([]);
    const crm = { id: "crm", name: "CRM", purpose: "Customer record", url: "https://crm.example.com/?ani=919876543210", sharedSession: false };
    expect(withLocked({ browsers: [crm] })).toEqual(["task.locked.leak"]);
    expect(withLocked({ browsers: [{ ...crm, urlVisibility: "hidden" }] })).toEqual([]);
    // Nothing locked, nothing held: the same title on a task whose number the agent may see is content. And a caller
    // without the values -- a host -- does not ask.
    expect(rules(validateTask(task({ party: { name: "Asha", number: "+919876543210" }, title: "Call from +91 98765 43210" }), { channel: "voice", locked }))).toEqual([]);
    expect(rules(validateTask(task({ party: { name: "Asha", number: { lockedBy: "team" } }, title: "Call from +91 98765 43210" }), { channel: "voice" }))).toEqual([]);
  });

  it("refuses the task words the contract renamed, beside the words that replaced them", () => {
    // A rename is a refusal, not an alias: an adapter still speaking the old word is told so.
    const media = (value: unknown) => rules(validateTask(task({ media: value }), { channel: "voice" }));
    expect(media("started")).toEqual([]);
    expect(media("ready")).toEqual(["task.media"]);
    const tab = (browser: Record<string, unknown>) => rules(validateTask(task({ capabilities: { browsers: true }, browsers: [{ id: "crm", name: "CRM", purpose: "Customer record", url: "https://crm.example.com/", ...browser }] }), { channel: "voice" }));
    expect(tab({ sharedSession: false })).toEqual([]);
    // renamed away: a browser still saying reuse has not said whether its session is shared.
    expect(tab({ reuse: false })).toEqual(["task.browser.sharedSession"]);
    const notes = (value: string) => rules(validateTask(task({ capabilities: { outcomes: { required: true, notes: value, codes: [{ id: "resolved", label: "Resolved" }] } } }), { channel: "voice" }));
    expect(notes("none")).toEqual([]);
    // renamed away: no notes field is none; hidden is what a URL can be.
    expect(notes("hidden")).toEqual(["task.outcomes.notes"]);
    const offer = (acceptance: string) => rules(validateTask(task({ phase: "pending", acceptance }), { channel: "voice" }));
    expect(offer("consent")).toEqual([]);
    // renamed away: acceptance is by consent or automatic.
    expect([offer("require-agent-acceptance"), offer("manual")]).toEqual([["task.acceptance"], ["task.acceptance"]]);
  });

  it("accepts a conforming task", () => {
    expect(check()).toEqual([]);
  });

  it.each([
    ["an unknown phase", { phase: "ringing" }, "task.phase"],
    ["an unknown completion mode", { completionMode: "whenever" }, "task.completionMode"],
    ["a fractional allowance", { wrapAllowance: 1.5 }, "task.wrapAllowance"],
    ["a negative allowance", { wrapAllowance: -1 }, "task.wrapAllowance"],
    ["an empty id", { id: "  " }, "task.id"],
    ["no title", { title: "" }, "task.title"],
  ])("rejects %s", (_label, over, rule) => {
    expect(check(over)).toContain(rule);
    expect(check()).not.toContain(rule);
  });

  it("requires the task to agree with the provider's channel", () => {
    expect(check({ channel: "chat" })).toContain("task.channel");
    // Control: the same task on a chat provider is fine.
    expect(rules(validateTask(task({ channel: "chat", capabilities: { hold: true } }), { channel: "chat" }))).toEqual([]);
  });

  it("requires a task to name this life of itself, the allocation minted per offer", () => {
    expect(rules(validateTask(task(), { channel: "voice" }))).toEqual([]);
    expect(rules(validateTask(task({ allocationId: undefined }), { channel: "voice" }))).toEqual(["task.allocationId"]);
    expect(rules(validateTask(task({ allocationId: "" }), { channel: "voice" }))).toEqual(["task.allocationId"]);
  });

  it("requires the words a task and a manifest are shown by, and refuses a repeated browser id", () => {
    // Each of these was deletable with the suite green: asserted here with its control.
    expect(rules(validateTask(task({ taskType: "" }), { channel: "voice" }))).toEqual(["task.taskType"]);
    expect(rules(validateTask(task({ reference: "" }), { channel: "voice" }))).toEqual(["task.reference"]);
    expect(rules(validateTask(task({ reference: "ORD-7" }), { channel: "voice" }))).toEqual([]);
    const browser = { id: "crm", name: "CRM", purpose: "Account", url: "https://crm.example.com", sharedSession: false };
    expect(rules(validateTask(task({ capabilities: { browsers: true }, browsers: [browser, { ...browser, name: "CRM 2" }] }), { channel: "voice" }))).toEqual(["task.browser.unique"]);
    expect(rules(validateTask(task({ capabilities: { browsers: true }, browsers: [browser, { ...browser, id: "kb", name: "KB" }] }), { channel: "voice" }))).toEqual([]);
    expect(rules(validateManifest(manifest({ displayName: "" })))).toEqual(["manifest.displayName"]);
    expect(rules(validateManifest(manifest()))).toEqual([]);
    expect(rules(validateEventEnvelope({ id: "e1", loginId: "session-1", occurredAt: "2026-08-21T09:00:00Z", event: { type: "transport-status", status: "flaky" } }, manifest()))).toEqual(["event.transportStatus.status"]);
    expect(rules(validateEventEnvelope({ id: "e1", loginId: "session-1", occurredAt: "2026-08-21T09:00:00Z", event: { type: "transport-status", status: "active" } }, manifest()))).toEqual([]);
  });

  it("gates capabilities by channel", () => {
    // hold is a voice control; an email task declaring one would render a button that
    // cannot work.
    expect(rules(validateTask(task({ channel: "email", capabilities: { hold: true } }), { channel: "email" })))
      .toContain("task.capability.channel");
    // Mute is the host's: the microphone belongs to the station, so no channel's provider declares it.
    // The control beside it: the same task with a capability the provider does own is clean.
    expect(rules(validateTask(task({ capabilities: { mute: true } }), { channel: "voice" }))).toEqual(["task.capability.unknown"]);
    expect(rules(validateTask(task({ capabilities: { mute: { lockedBy: "team" } } }), { channel: "voice" }))).toEqual(["task.capability.unknown"]);
    expect(rules(validateTask(task({ capabilities: { hold: true } }), { channel: "voice" }))).toEqual([]);
    // A name another channel owns is a channel error; one no channel owns is not a capability at all.
    expect(rules(validateTask(task({ capabilities: { zap: true } }), { channel: "voice" }))).toEqual(["task.capability.unknown"]);
    expect(rules(validateTask(task({ channel: "email", capabilities: { decline: true } }), { channel: "email" }))).toEqual([]);
  });

  it("ties browser reuse to an isolation scheme in both directions", () => {
    const browser = (over: Record<string, unknown>) =>
      check({ browsers: [{ id: "b", name: "B", purpose: "P", url: "https://x.example.com", ...over }] });
    // The guide names the rule for a reusing browser that declares no scheme.
    expect(browser({ sharedSession: true })).toContain("task.browser.isolationScheme.required");
    expect(browser({ sharedSession: true })).not.toContain("task.browser.isolationScheme");
    expect(browser({ sharedSession: true, isolationScheme: "Nonsense" })).toContain("task.browser.isolationScheme");
    expect(browser({ sharedSession: false, isolationScheme: "TabName" })).toContain("task.browser.isolationScheme.unexpected");
    expect(browser({})).toContain("task.browser.sharedSession");
    // Controls: both legal shapes pass.
    expect(browser({ sharedSession: true, isolationScheme: "TabName" })).toEqual([]);
    expect(browser({ sharedSession: false })).toEqual([]);
  });

  it("allows only http and https for a browser url", () => {
    const url = (value: string) => check({ browsers: [{ id: "b", name: "B", purpose: "P", url: value, sharedSession: false }] });
    expect(url("file:///etc/passwd")).toContain("task.browser.url.scheme");
    expect(url("javascript:alert(1)")).toContain("task.browser.url.scheme");
    expect(url("https://ok.example.com")).toEqual([]);
    expect(url("http://ok.example.com")).toEqual([]);
  });

  it("omits an unfinished duration rather than reporting nought", () => {
    const history = (over: Record<string, unknown>) =>
      check({ interactionHistory: { steps: [{ step: "answered", at: "2026-08-21T09:00:00Z", ...over }] } });
    expect(history({ seconds: 0 })).toContain("task.interactionHistory.seconds");
    expect(history({ seconds: -5 })).toContain("task.interactionHistory.seconds");
    expect(history({ seconds: 22 })).toEqual([]);
    expect(history({})).toEqual([]);
  });

  it("takes a interaction step without a person, and rejects an empty one", () => {
    const history = (over: Record<string, unknown>) =>
      check({ interactionHistory: { steps: [{ step: "answered", at: "2026-08-21T09:00:00Z", ...over }] } });
    // Absent means the provider could not attribute it, which is a legitimate report.
    expect(history({})).toEqual([]);
    expect(history({ by: "" })).toContain("task.interactionHistory.by");
    expect(history({ by: "agent-17" })).toEqual([]);
    expect(check({ interactionHistory: { steps: [{ step: "ringing", at: "2026-08-21T09:00:00Z" }] } })).toContain("task.interactionHistory.step");
  });

  it("validates each kind of task attribute", () => {
    const attribute = (value: unknown) => check({ attributes: [value] });
    expect(attribute({ key: "order", type: "text", value: "A-1" })).toEqual([]);
    expect(attribute({ key: "caller", type: "contact", party: { name: "Maya" } })).toEqual([]);
    // The field is party, as the type says; the old key carried nothing the validator read.
    expect(attribute({ key: "caller", type: "contact", contact: { name: "Maya" } })).toEqual(["contact.shape"]);
    // The manifest's ladder reaches the attribute's contact, as it reaches the task's party.
    expect(attribute({ key: "caller", type: "contact", party: { number: { lockedBy: "region" } } })).toEqual(["contact.number.locked.lockedBy.unknown"]);
    const regional = manifest({ orgLevels: [{ id: "org", label: "Org" }, { id: "region", label: "Region" }, { id: "team", label: "Team" }, { id: "person", label: "You" }] });
    expect(rules(validateSnapshot(snapshot({ tasks: [task({ attributes: [{ key: "caller", type: "contact", party: { number: { lockedBy: "region" } } }] })] }), regional))).toEqual([]);
    const directory = (m: unknown) => rules(validateSnapshot(snapshot({ contacts: [{ name: "Maya", number: { lockedBy: "region" } }] }), { ...(m as object), idleCapabilities: { contacts: true } }));
    expect(directory(regional)).toEqual([]);
    expect(directory(manifest())).toEqual(["contact.number.locked.lockedBy.unknown"]);
    expect(attribute({ key: "due", type: "timestamp", at: "2026-08-21T09:00:00Z" })).toEqual([]);
    expect(attribute({ key: "order", type: "text" })).toContain("task.attribute.text");
    expect(attribute({ key: "due", type: "timestamp", at: "soon" })).toContain("task.attribute.timestamp");
    expect(attribute({ key: "x", type: "colour", value: "red" })).toContain("task.attribute.type");
    expect(attribute({ type: "text", value: "A-1" })).toContain("task.attribute.key");
  });
});

describe("break state", () => {
  const check = (over: Record<string, unknown>) =>
    rules(validateSnapshot(snapshot({ break: { approval: "not-requested", mayAsk: true, ...over } }), manifest()));

  it("refuses accepting beside mayAsk, which replaced it", () => {
    // A rename is a refusal, not an alias: an adapter still speaking the old word is told so.
    const brk = (state: Record<string, unknown>) => rules(validateSnapshot(snapshot({ break: { approval: "not-requested", ...state } }), manifest()));
    expect(brk({ mayAsk: true })).toEqual([]);
    expect(brk({ accepting: true })).toEqual(["break.mayAsk"]);
    expect(brk({ mayAsk: "yes" })).toEqual(["break.mayAsk"]);
  });

  it("accepts each approval and rejects one the contract dropped", () => {
    for (const approval of ["not-requested", "awaiting-decision", "granted", "in-effect"]) {
      expect(check({ approval })).toEqual([]);
    }
    // A break starting after the task waits on a task: beside one it stands, beside none it is refused, since with
    // nothing outstanding the break is in effect.
    expect(rules(validateSnapshot(snapshot({ break: { approval: "starting-after-task", mayAsk: true }, tasks: [task()] }), manifest()))).toEqual([]);
    expect(check({ approval: "starting-after-task" })).toEqual(["break.starting-after-task.tasks"]);
    {
    }
    // "approved" and "denied" were the previous vocabulary. Accepting them would let two
    // providers mean different things by the same state.
    expect(check({ approval: "approved" })).toContain("break.approval");
    expect(check({ approval: "denied" })).toContain("break.approval");
  });

  it("refuses a break in effect beside a task, and accepts one that is waiting for it to end", () => {
    // A break begins when the work ends. Until then the state is starting-after-task, which may
    // stand beside any task; in-effect beside one is a report of a state the agent cannot be in.
    const withTask = (approval: string) =>
      rules(validateSnapshot(snapshot({ tasks: [task()], break: { approval, mayAsk: true } }), manifest()));
    expect(withTask("starting-after-task")).toEqual([]);
    expect(withTask("granted")).toEqual([]);
    expect(withTask("in-effect")).toEqual(["break.in-effect.tasks"]);
    expect(check({ approval: "in-effect" })).toEqual([]);
  });

  it("reports an active reason only when a break is happening", () => {
    expect(check({ approval: "not-requested", activeReasonId: "lunch" })).toContain("break.activeReasonId.approval");
    expect(check({ approval: "in-effect", activeReasonId: "lunch" })).toEqual([]);
    expect(check({ approval: "in-effect", activeReasonId: "" })).toContain("break.activeReasonId");
  });

  it("validates break reasons and their kinds", () => {
    const reasons = (value: unknown) => check({ reasons: value });
    expect(reasons([{ id: "lunch", label: "Lunch", kind: "meal" }])).toEqual([]);
    expect(reasons([{ id: "lunch", label: "Lunch", kind: "luncheon" }])).toContain("break.reason.kind");
    expect(reasons([{ id: "lunch", label: "" }])).toContain("break.reason.label");
    expect(reasons([{ id: "a", label: "A" }, { id: "a", label: "Again" }])).toContain("break.reason.unique");
    expect(reasons([{ id: "rest", label: "Rest", alwaysAvailable: false }])).toContain("break.reason.alwaysAvailable");
    expect(reasons([{ id: "rest", label: "Rest", alwaysAvailable: true }])).toEqual([]);
  });

  it("lets an imposed break travel with in-effect or starting-after-task, and nothing else", () => {
    const placed = { by: "lead-3", endsAutomatically: false };
    expect(check({ approval: "in-effect", imposed: placed })).toEqual([]);
    expect(rules(validateSnapshot(snapshot({ break: { approval: "starting-after-task", mayAsk: false, imposed: placed }, tasks: [task()] }), manifest()))).toEqual([]);
    // Beside granted or awaiting-decision the host would commit a break nobody asked for.
    expect(check({ approval: "granted", imposed: placed })).toEqual(["break.imposed.approval"]);
    expect(check({ approval: "awaiting-decision", imposed: placed })).toEqual(["break.imposed.approval"]);
    expect(check({ approval: "not-requested", imposed: placed })).toEqual(["break.imposed.approval"]);
  });

  it("requires a break in effect on a provider that publishes reasons to name the one it is on, an imposed one included", () => {
    const reasons = [{ id: "meal", label: "Meal", kind: "meal" }, { id: "coach", label: "Coaching", kind: "coaching" }];
    expect(check({ approval: "in-effect", reasons, activeReasonId: "meal" })).toEqual([]);
    expect(check({ approval: "in-effect", reasons })).toEqual(["break.activeReasonId.required"]);
    expect(check({ approval: "in-effect", reasons, imposed: { by: "lead-3", endsAutomatically: false } })).toEqual(["break.activeReasonId.required"]);
    // No reasons published, nothing to name; not in effect, nothing to name yet.
    expect(check({ approval: "in-effect" })).toEqual([]);
    expect(check({ approval: "granted", reasons })).toEqual([]);
  });

  it("keeps who placed an imposed break whether or not it ends on a clock", () => {
    const imposed = (value: unknown) => check({ approval: "in-effect", imposed: value });
    // Both arms are legal. The origin is required in both, because an imposed break with no
    // origin is a state the agent cannot reason about.
    expect(imposed({ by: "lead-3", endsAutomatically: true, endsAt: "2026-08-21T10:00:00Z" })).toEqual([]);
    expect(imposed({ by: "lead-3", endsAutomatically: false })).toEqual([]);

    expect(imposed({ endsAutomatically: false })).toContain("break.imposed.by");
    expect(imposed({ by: "", endsAutomatically: false })).toContain("break.imposed.by");
    expect(imposed({ by: "lead-3" })).toContain("break.imposed.endsAutomatically");
    expect(imposed({ by: "lead-3", endsAutomatically: true })).toContain("break.imposed.endsAt");
    expect(imposed({ by: "lead-3", endsAutomatically: true, endsAt: "soon" })).toContain("break.imposed.endsAt");
    // A break that does not end automatically must not claim an end.
    expect(imposed({ by: "lead-3", endsAutomatically: false, endsAt: "2026-08-21T10:00:00Z" }))
      .toContain("break.imposed.endsAt.unexpected");
  });
});

describe("validateTeamMembers", () => {
  const teamMembers = (over: Record<string, unknown> = {}) => ({
    members: [{ id: "A-2", availability: "ready" }],
    ...over,
  });

  it("carries the team's policies on the team member list, as the lead sees them", () => {
    const may = { capabilities: { team: { policyControl: true as const } } };
    const policies = (value: unknown) => rules(validateTeamMembers({ members: [], policies: value }, "team", may));
    expect(policies({ endCall: { setting: "off", setBy: "team" }, hold: { setting: "person", setBy: "team" }, recording: { setting: "on", setBy: "site", lockedBy: "site", reason: "Compliance" }, dial: { setting: "on", setBy: "provider" }, "skill:billing": { setting: "person", setBy: "org" } })).toEqual([]);
    expect(policies({ telepathy: { setting: "on", setBy: "team" } })).toEqual(["team.policy.key"]);
    // Mute is the host's: no team sets a policy on the station's microphone. The control beside it stands two lines up.
    expect(policies({ mute: { setting: "off", setBy: "team" } })).toEqual(["team.policy.key"]);
    expect(policies({ hold: "off" })).toEqual(["team.policy.shape"]);
    expect(policies({ hold: { setting: "maybe", setBy: "team" } })).toEqual(["team.policy.setting"]);
    expect(policies({ connectBack: { setting: "person", setBy: "team" } })).toEqual(["team.policy.person"]);
    expect(policies({ dial: { setting: "person", setBy: "team" } })).toEqual(["team.policy.person"]);
    expect(policies({ hold: { setting: "off" } })).toEqual(["team.policy.setBy"]);
    expect(policies({ hold: { setting: "off", setBy: "person" } })).toEqual(["team.policy.setBy"]);
    expect(policies("off")).toEqual(["team.policies.shape"]);
    // Present exactly when the login may set them.
    expect(rules(validateTeamMembers({ members: [] }, "team", may))).toEqual(["team.policies.required"]);
    expect(rules(validateTeamMembers({ members: [], policies: {} }, "team", { capabilities: { team: {} } }))).toEqual(["team.policies.capability"]);
    expect(rules(validateTeamMembers({ members: [], policies: {} }))).toEqual([]);
  });
  it("refuses agent as a policy setting beside person, which replaced it", () => {
    // A rename is a refusal, not an alias: an adapter still speaking the old word is told so.
    const lead = { capabilities: { team: { policyControl: true as const } } };
    const setting = (value: string) => rules(validateTeamMembers({ members: [], policies: { hold: { setting: value, setBy: "team" } } }, "team", lead));
    expect(setting("person")).toEqual([]);
    // renamed away: what the team leaves to the individual is the person's, in the level's own word.
    expect(setting("agent")).toEqual(["team.policy.setting"]);
  });

  it("accepts a conforming team member list", () => {
    expect(validateTeamMembers(teamMembers())).toEqual([]);
    expect(validateTeamMembers({ members: [{ id: "A-2", availability: "on-task", since: "2026-08-21T09:00:00Z", break: "starting-after-task" }] })).toEqual([]);
    // Host-stopped is a stated availability of its own: signed in here, capacity held by the host for elsewhere.
    expect(validateTeamMembers({ members: [{ id: "A-2", availability: "reserved", since: "2026-08-21T09:00:00Z" }] })).toEqual([]);
  });

  it.each([
    ["a member with no id", { members: [{ availability: "ready" }] }, "team.member.id"],
    ["an availability the contract dropped", { members: [{ id: "A-2", availability: "available" }] }, "team.member.availability"],
    ["a duplicate member", { members: [{ id: "A-2", availability: "ready" }, { id: "A-2", availability: "on-task" }] }, "team.member.unique"],
    ["a since without a zone", { members: [{ id: "A-2", availability: "ready", since: "2026-08-21T09:00:00" }] }, "team.member.since"],
    ["no members array", {}, "team.members.shape"],
  ])("rejects %s", (_label, value, rule) => {
    expect(rules(validateTeamMembers(value))).toContain(rule);
    expect(rules(validateTeamMembers({ members: [{ id: "A-2", availability: "ready" }] }))).not.toContain(rule);
  });

  it("rejects the agent it is published to, in members and in requests, once told who that is", () => {
    // A lead does not report to themself. The team member list below carries a colleague and the reader in
    // both places, so the check has to pick the reader out rather than object to either list.
    const published = {
      members: [{ id: "A-2", availability: "ready" }, { id: "1042", availability: "on-task" }],
      requests: [
        { id: "req-1", memberId: "A-2", taskId: "call-7", allocationId: "call-7-a", since: "2026-08-21T09:00:00Z" },
        { id: "req-2", memberId: "1042", taskId: "call-9", allocationId: "call-9-a", since: "2026-08-21T09:01:00Z" },
      ],
    };
    const found = (self: string) =>
      validateTeamMembers(published, "team", { self }).map(violation => `${violation.rule} at ${violation.path}`).sort();
    expect(found("1042")).toEqual(["team.member.self at team.members[1].id", "team.request.self at team.requests[1].memberId"]);
    // A colleague is not the reader, and without a reader there is nothing to compare against.
    expect(found("A-9")).toEqual([]);
    expect(validateTeamMembers(published)).toEqual([]);
  });
});

describe("validateSnapshot", () => {
  it("points a transport violation at the transport field", () => {
    expect(validateSnapshot(snapshot({ transport: "flaky" }), manifest(), "login.snapshot")).toEqual([
      expect.objectContaining({ rule: "snapshot.transport", path: "login.snapshot.transport" }),
    ]);
    expect(validateSnapshot(snapshot(), manifest(), "login.snapshot")).toEqual([]);
  });
  it("requires a snapshot to state its task count, reconciled with the tasks it carries", () => {
    const count = (over: Record<string, unknown> = {}) => rules(validateSnapshot(snapshot(over), manifest()));
    // The helper computes a matching count; both directions on the explicit field.
    expect(count()).toEqual([]);
    expect(count({ tasks: [task()], taskCount: 1 })).toEqual([]);
    expect(count({ taskCount: undefined })).toEqual(["snapshot.taskCount"]);
    // A count that does not reconcile is an answer nobody gave.
    expect(count({ taskCount: 3 })).toEqual(["snapshot.taskCount.mismatch"]);
    expect(count({ tasks: [task()], taskCount: 0 })).toEqual(["snapshot.taskCount.mismatch"]);
    expect(count({ taskCount: -1 })).toEqual(["snapshot.taskCount"]);
    expect(count({ taskCount: 0.5 })).toEqual(["snapshot.taskCount"]);
    expect(count({ taskCount: "0" })).toEqual(["snapshot.taskCount"]);
  });

  it("accepts a conforming snapshot", () => {
    expect(validateSnapshot(snapshot(), manifest())).toEqual([]);
    expect(validateSnapshot(snapshot({ tasks: [task()] }), manifest())).toEqual([]);
  });

  it.each([
    ["a transport the contract dropped", snapshot({ transport: "inactive" }), "snapshot.transport"],
    ["no login id", snapshot({ loginId: "" }), "snapshot.loginId"],
    ["two tasks with one id", snapshot({ tasks: [task(), task()] }), "task.id.unique"],
  ])("rejects %s", (_label, value, rule) => {
    expect(rules(validateSnapshot(value, manifest()))).toContain(rule);
    expect(rules(validateSnapshot(snapshot(), manifest()))).not.toContain(rule);
  });

  it("requires each contribution the manifest declares, [] included, and refuses one it does not", () => {
    const declaring = manifest({ idleCapabilities: { contacts: true, calendar: true } });
    expect(rules(validateSnapshot(snapshot({ contacts: [], scheduledActivities: [] }), declaring))).toEqual([]);
    expect(rules(validateSnapshot(snapshot(), declaring)).sort()).toEqual(["snapshot.calendar.required", "snapshot.contacts.required"]);
    expect(rules(validateSnapshot(snapshot(), manifest()))).toEqual([]);
    expect(rules(validateSnapshot(snapshot({ contacts: [], scheduledActivities: [] }), manifest())).sort()).toEqual(["snapshot.calendar.capability", "snapshot.contacts.capability"]);
  });

  it("carries the reader into the team member list", () => {
    const team = { members: [{ id: "A-2", availability: "ready" }, { id: "1042", availability: "ready" }] };
    expect(rules(validateSnapshot(snapshot({ team }), manifest(), "snapshot", { self: "1042" }))).toEqual(["team.member.self"]);
    expect(rules(validateSnapshot(snapshot({ team }), manifest(), "snapshot", { self: "A-9" }))).toEqual([]);
  });

  it("holds the team member list to the login once told what it declares", () => {
    // The login is the permission, and it cuts both ways: a lead's snapshot must carry a team member list
    // and nobody else's may. Both agreeing cases pass, so each refusal is about the disagreement.
    const team = { members: [{ id: "A-2", availability: "ready" }] };
    const lead = { capabilities: { team: {} } };
    const agent = { capabilities: {} };
    expect(rules(validateSnapshot(snapshot({ team }), manifest(), "snapshot", lead))).toEqual([]);
    expect(rules(validateSnapshot(snapshot(), manifest(), "snapshot", agent))).toEqual([]);
    expect(rules(validateSnapshot(snapshot(), manifest(), "snapshot", lead))).toEqual(["team.required"]);
    expect(rules(validateSnapshot(snapshot({ team }), manifest(), "snapshot", agent))).toEqual(["team.unentitled"]);
    // The team member list validator carries the same refusal on its own, for a caller holding just the team member list.
    expect(rules(validateTeamMembers(team, "team", lead))).toEqual([]);
    expect(rules(validateTeamMembers(team, "team", agent))).toEqual(["team.unentitled"]);
    // Without the login in hand, neither direction can be checked.
    expect(rules(validateSnapshot(snapshot(), manifest()))).toEqual([]);
    expect(rules(validateSnapshot(snapshot({ team }), manifest()))).toEqual([]);
  });

  it("refuses data the manifest never declared a capability for", () => {
    // Presence is the permission, both ways: contacts Omni would show against a control the
    // agent does not have.
    expect(rules(validateSnapshot(snapshot({ contacts: [{ name: "Asha" }] }), manifest())))
      .toContain("snapshot.contacts.capability");
    expect(rules(validateSnapshot(snapshot({ scheduledActivities: [] }), manifest())))
      .toContain("snapshot.calendar.capability");
    // Controls: with the capability declared, the same data is fine -- and only that capability,
    // since a declared contribution the snapshot lacks is refused the other way round.
    expect(validateSnapshot(snapshot({ contacts: [{ name: "Asha" }] }), manifest({ idleCapabilities: { contacts: true } }))).toEqual([]);
    expect(validateSnapshot(snapshot({ scheduledActivities: [] }), manifest({ idleCapabilities: { calendar: true } }))).toEqual([]);
  });
});

describe("validateEventEnvelope", () => {
  const check = (event: unknown, over: Record<string, unknown> = {}) =>
    rules(validateEventEnvelope(envelope(event, over), manifest()));

  it("refuses the event names the contract renamed, beside the names that replaced them", () => {
    // A rename is a refusal, not an alias: an adapter still speaking the old word is told so.
    const event = (type: string) => rules(validateEventEnvelope(envelope({ type, taskId: "call-42", allocationId: "alloc-42", status: "active" }), manifest()));
    expect(event("task-media-started")).toEqual([]);
    expect(event("transport-status")).toEqual([]);
    // renamed away: the old event names must be refused, not aliased.
    expect([event("task-media-ready"), event("provider-status"), event("provider-summary")]).toEqual([["event.type"], ["event.type"], ["event.type"]]);
    // renamed away: the word moved from the offer to the task; an offer still carrying it has a task saying nothing.
    expect(rules(validateEventEnvelope(envelope({ type: "task-offered", task: task({ phase: "pending" }), acceptanceMode: "consent" }), manifest(), "event", { autoAcceptTasks: true }))).toEqual(["task.acceptance.required"]);
  });

  it("requires the envelope to name its session", () => {
    // A login is identified by its login id, and an event that does not name one cannot be
    // attributed to the login it belongs to.
    expect(check({ type: "transport-status", status: "active" }, { loginId: "" })).toContain("event.loginId");
    expect(check({ type: "transport-status", status: "active" })).toEqual([]);
  });

  it("carries a diagnostic as two sentences and, where there is one, a task", () => {
    const diagnostic = { type: "diagnostic", expected: "a state read answers with the agent's tasks or with nothing", observed: "GetMyState answered null one second after a live call was answered" };
    expect(check(diagnostic)).toEqual([]);
    expect(check({ ...diagnostic, taskId: "call-77", allocationId: "alloc-77" })).toEqual([]);
    // A task is named with its allocation, and an allocation never alone.
    expect(check({ ...diagnostic, taskId: "call-77" })).toEqual(["event.diagnostic.allocationId"]);
    expect(check({ ...diagnostic, allocationId: "alloc-77" })).toEqual(["event.diagnostic.allocationId.unexpected"]);
    expect(check({ ...diagnostic, expected: "" })).toEqual(["event.diagnostic.expected"]);
    expect(check({ ...diagnostic, observed: undefined })).toEqual(["event.diagnostic.observed"]);
    expect(check({ ...diagnostic, taskId: "", allocationId: "alloc-77" })).toEqual(["event.diagnostic.taskId"]);
  });

  it("requires an error to name its recovery, and nothing else to carry one", () => {
    expect(check({ type: "transport-status", status: "error", recovery: "reconnect", message: "session gone" })).toEqual([]);
    expect(check({ type: "transport-status", status: "error", recovery: "reauthenticate" })).toEqual([]);
    expect(check({ type: "transport-status", status: "error" })).toEqual(["event.transportStatus.recovery.required"]);
    expect(check({ type: "transport-status", status: "error", recovery: "retry" })).toEqual(["event.transportStatus.recovery"]);
    // Both directions: a status with nothing to revive carries no recovery.
    expect(check({ type: "transport-status", status: "connecting", recovery: "reconnect" })).toEqual(["event.transportStatus.recovery.unexpected"]);
    expect(check({ type: "transport-status", status: "active" })).toEqual([]);
  });

  it("carries the reader into a team-updated and into a reconnect snapshot", () => {
    const team = { members: [{ id: "A-2", availability: "ready" }, { id: "1042", availability: "ready" }] };
    const withReader = (event: unknown, self: string) =>
      rules(validateEventEnvelope(envelope(event), manifest(), "event", { self }));
    expect(withReader({ type: "team-updated", team }, "1042")).toEqual(["team.member.self"]);
    expect(withReader({ type: "team-updated", team }, "A-9")).toEqual([]);
    expect(withReader({ type: "snapshot", reason: "reconnected", snapshot: snapshot({ team }) }, "1042")).toEqual(["team.member.self"]);
    expect(withReader({ type: "snapshot", reason: "reconnected", snapshot: snapshot({ team }) }, "A-9")).toEqual([]);
  });

  it("holds a reconnect snapshot to the login as it holds the first one", () => {
    // "On every snapshot" includes the one a reconnect carries.
    const team = { members: [{ id: "A-2", availability: "ready" }] };
    const reconnect = (snap: unknown, capabilities: unknown) =>
      rules(validateEventEnvelope(envelope({ type: "snapshot", reason: "reconnected", snapshot: snap }), manifest(), "event", { capabilities } as never));
    expect(reconnect(snapshot({ team }), { team: {} })).toEqual([]);
    expect(reconnect(snapshot(), {})).toEqual([]);
    expect(reconnect(snapshot(), { team: {} })).toEqual(["team.required"]);
    expect(reconnect(snapshot({ team }), {})).toEqual(["team.unentitled"]);
  });

  it("refuses a team-updated to a login that does not lead", () => {
    const team = { members: [{ id: "A-2", availability: "ready" }] };
    const to = (capabilities: unknown) => rules(validateEventEnvelope(envelope({ type: "team-updated", team }), manifest(), "event", { capabilities } as never));
    expect(to({ team: {} })).toEqual([]);
    expect(to({})).toEqual(["team.unentitled"]);
    expect(check({ type: "team-updated", team })).toEqual([]);
  });

  it("validates each event type", () => {
    expect(check({ type: "snapshot", reason: "reconnected", snapshot: snapshot() })).toEqual([]);
    expect(check({ type: "snapshot", reason: "because", snapshot: snapshot() })).toContain("event.snapshot.reason");
    expect(check({ type: "break-state", break: { approval: "in-effect", mayAsk: false } })).toEqual([]);
    expect(check({ type: "task-offered", task: task({ phase: "pending", acceptance: "consent" }) })).toEqual([]);
    expect(check({ type: "task-offered", task: task({ phase: "pending", acceptance: "whenever" }) })).toContain("task.acceptance");
    expect(check({ type: "task-media-ended", taskId: "call-42", allocationId: "alloc-42" })).toEqual([]);
    expect(check({ type: "task-media-ended", taskId: "", allocationId: "alloc-42" })).toContain("event.taskMediaEnded.taskId");
    expect(check({ type: "task-media-started", taskId: "call-42", allocationId: "alloc-42" })).toEqual([]);
    expect(check({ type: "task-media-started", taskId: "", allocationId: "alloc-42" })).toContain("event.taskMediaStarted.taskId");
    expect(check({ type: "announcement", text: "Hello", announcedAt: "2026-08-21T09:00:00Z" })).toEqual([]);
    expect(check({ type: "announcement", text: "", announcedAt: "2026-08-21T09:00:00Z" })).toContain("event.announcement.text");
    expect(check({ type: "team-updated", team: { members: [] } })).toEqual([]);
    expect(rules(validateEventEnvelope(envelope({ type: "contacts-updated", contacts: [{ name: "Asha" }] }), manifest({ idleCapabilities: { contacts: true } })))).toEqual([]);
    expect(check({ type: "contacts-updated", contacts: "Asha" })).toContain("event.contacts.shape");
    expect(check({ type: "smoke-signal" })).toContain("event.type");
  });

  it("validates every task outcome", () => {
    const ended = (outcome: unknown) => check({ type: "task-ended", taskId: "call-42", allocationId: "alloc-42", outcome });
    expect(ended({ type: "completed", by: "agent" })).toEqual([]);
    expect(ended({ type: "completed", by: "somebody" })).toContain("event.taskEnded.outcome.completed");
    expect(ended({ type: "transferred", destinationId: "tier2" })).toEqual([]);
    expect(ended({ type: "cancelled", by: "provider" })).toEqual([]);
    expect(ended({ type: "cancelled" })).toEqual(["event.taskEnded.outcome.cancelled.by"]);
    // Only the phases in which somebody is still being waited on can expire.
    expect(ended({ type: "expired", phase: "pending" })).toEqual([]);
    expect(ended({ type: "expired", phase: "in-progress" })).toContain("event.taskEnded.outcome.expired");
    expect(ended({ type: "failed", failure: { code: "x", message: "y", retryable: false } })).toEqual([]);
    expect(ended({ type: "failed" })).toContain("event.taskEnded.outcome.failed");
    expect(ended({ type: "vanished" })).toContain("event.taskEnded.outcome.type");
  });

  it("validates a provider summary", () => {
    const summary = (value: unknown) => check({ type: "queue-summary", summary: value });
    expect(summary({ title: "Queue", waitingCount: 3, updatedAt: "2026-08-21T09:00:00Z" })).toEqual([]);
    expect(summary({ title: "Queue", waitingCount: -1, updatedAt: "2026-08-21T09:00:00Z" })).toContain("event.summary.waitingCount");
    expect(summary({ title: "", waitingCount: 0, updatedAt: "2026-08-21T09:00:00Z" })).toContain("event.summary.title");
    expect(summary({ title: "Q", waitingCount: 0, updatedAt: "2026-08-21T09:00:00Z", metrics: [{ id: "a", label: "A", value: 7 }] }))
      .toContain("event.summary.metric.value");
  });
});

describe("validateCapacity", () => {
  it("is a whole number of zero or more, zero being host-stopped", () => {
    expect(rules(validateCapacity({ count: 1 }))).toEqual([]);
    expect(rules(validateCapacity({ count: 0 }))).toEqual([]);
    expect(rules(validateCapacity({ count: 3 }))).toEqual([]);
    expect(rules(validateCapacity({ count: -1 }))).toEqual(["capacity.count"]);
    expect(rules(validateCapacity({ count: 1.5 }))).toEqual(["capacity.count"]);
    expect(rules(validateCapacity({ count: "1" }))).toEqual(["capacity.count"]);
    expect(rules(validateCapacity(1))).toEqual(["capacity.shape"]);
  });
});

describe("validateLoginStore", () => {
  it("is an object with get, set and delete, and nothing else is a store", () => {
    const store = { get: async () => undefined, set: async () => undefined, delete: async () => undefined };
    expect(rules(validateLoginStore(store))).toEqual([]);
    expect(rules(validateLoginStore({ ...store, delete: undefined }))).toEqual(["store.delete"]);
    expect(rules(validateLoginStore({ get: store.get }))).toEqual(["store.set", "store.delete"]);
    expect(rules(validateLoginStore(undefined))).toEqual(["store.shape"]);
    expect(rules(validateLoginStore("localStorage"))).toEqual(["store.shape"]);
  });
});

describe("validateHostMute", () => {
  it("is stated where the host holds a microphone, in one of two words, and nowhere else", () => {
    expect(rules(validateHostMute("stream", true))).toEqual([]);
    expect(rules(validateHostMute("station", true))).toEqual([]);
    expect(rules(validateHostMute(undefined, false))).toEqual([]);
    // Neither the value nor its absence is inferred from what the host is.
    expect(rules(validateHostMute(undefined, true))).toEqual(["host.mute.required"]);
    expect(rules(validateHostMute("stream", false))).toEqual(["host.mute.unexpected"]);
    expect(rules(validateHostMute("soft", true))).toEqual(["host.mute"]);
  });
});

describe("validateInteractionReport", () => {
  it("takes a leg the host performed as it begins, runs, and ends", () => {
    const report = (over: Record<string, unknown> = {}) => rules(validateInteractionReport({ taskId: "call-42", allocationId: "alloc-42", step: "muted", at: "2026-08-21T09:00:00Z", mutedBy: "host", ...over }));
    expect(report()).toEqual([]);
    // A muted leg says whose the silence was; no other leg has anyone to name for it.
    expect(report({ mutedBy: "station" })).toEqual([]);
    expect(report({ mutedBy: undefined })).toEqual(["interactionReport.mutedBy"]);
    expect(report({ mutedBy: "headset" })).toEqual(["interactionReport.mutedBy"]);
    expect(report({ step: "held", mutedBy: undefined })).toEqual([]);
    expect(report({ step: "held" })).toEqual(["interactionReport.mutedBy.unexpected"]);
    expect(report({ seconds: 15 })).toEqual([]);
    expect(report({ seconds: 42, ended: true })).toEqual([]);
    // The end is stated, never inferred, and it carries the final duration.
    expect(report({ ended: true })).toEqual(["interactionReport.ended.seconds"]);
    expect(report({ ended: false })).toEqual(["interactionReport.ended"]);
    expect(report({ seconds: 0 })).toEqual(["interactionReport.seconds"]);
    expect(report({ taskId: "" })).toEqual(["interactionReport.taskId"]);
    expect(report({ step: "whispered" })).toEqual(["interactionReport.step"]);
    expect(report({ at: "now" })).toEqual(["interactionReport.at"]);
    expect(rules(validateInteractionReport("muted"))).toEqual(["interactionReport.shape"]);
    // What a provider never asked for never crosses: a running report reaches only a manifest that declares it.
    const running = { taskId: "call-42", allocationId: "alloc-42", step: "muted", at: "2026-08-21T09:00:00Z", mutedBy: "host", seconds: 15 };
    expect(rules(validateInteractionReport(running, "report", manifest({ runningStepReports: true })))).toEqual([]);
    expect(rules(validateInteractionReport(running, "report", manifest()))).toEqual(["interactionReport.running.unexpected"]);
    expect(rules(validateInteractionReport({ ...running, seconds: 42, ended: true }, "report", manifest()))).toEqual([]);
    expect(rules(validateInteractionReport({ taskId: "call-42", allocationId: "alloc-42", step: "muted", at: "2026-08-21T09:00:00Z", mutedBy: "host" }, "report", manifest()))).toEqual([]);
    expect(rules(validateManifest(manifest({ runningStepReports: true })))).toEqual([]);
    expect(rules(validateManifest(manifest({ runningStepReports: false })))).toEqual(["manifest.runningStepReports"]);
    // The completion bound is stated by every provider, as a positive whole number of milliseconds.
    expect(rules(validateManifest(manifest({ completionSettleMs: 5000 })))).toEqual([]);
    expect(rules(validateManifest(manifest({ completionSettleMs: 0 })))).toEqual(["manifest.completionSettleMs"]);
    expect(rules(validateManifest(manifest({ completionSettleMs: 1.5 })))).toEqual(["manifest.completionSettleMs"]);
    expect(rules(validateManifest({ ...manifest(), completionSettleMs: undefined }))).toEqual(["manifest.completionSettleMs"]);
    expect(rules(validateResult({ status: "recorded", at: "2026-09-11T00:00:00Z" }, "recordStep"))).toEqual([]);
    expect(rules(validateResult({ status: "recorded" }, "recordStep"))).toEqual(["result.recordStep.at"]);
    expect(rules(validateResult({ status: "applied" }, "recordStep"))).toEqual(["result.status"]);
  });
});

describe("validateHostGuarantees", () => {
  it("names only the guarantees the contract lists, each by presence and never false", () => {
    expect(rules(validateHostGuarantees({}))).toEqual([]);
    expect(rules(validateHostGuarantees({ browserUrlVisibility: true }))).toEqual([]);
    expect(rules(validateHostGuarantees({ browserUrlVisibility: true, personConsent: true }))).toEqual([]);
    // A promise withheld is an absent key: false is a host saying two things at once.
    expect(rules(validateHostGuarantees({ personConsent: false }))).toEqual(["host.guarantee.value"]);
    expect(rules(validateHostGuarantees({ hidesUrls: true }))).toEqual(["host.guarantee.unknown"]);
    expect(rules(validateHostGuarantees("yes"))).toEqual(["host.guarantees.shape"]);
  });
});

describe("validateHostReport", () => {
  const microphone = { id: "mic" };
  const failure = { code: "host.permission-denied", message: "Microphone access was refused", retryable: true };
  const ready = { status: "available", localAudio: microphone, flowing: true };
  const denied = { status: "unavailable", reason: "denied", failure };
  const audio = (input: unknown, output: unknown = { status: "available" }) => rules(validateHostReport({ online: true, audio: { input, output } }));

  it("refuses ready as an audio status beside available, which replaced it", () => {
    // A rename is a refusal, not an alias: an adapter still speaking the old word is told so.
    const input = (status: string) => rules(validateHostReport({ online: true, audio: { input: { status, localAudio: {}, flowing: true }, output: { status: "available" } } }));
    expect(input("available")).toEqual([]);
    // renamed away: a microphone is available or unavailable; ready is a team member's word.
    expect(input("ready")).toEqual(["host.audio.input.status"]);
  });

  it("accepts a report with and without audio, and holds each part to its shape", () => {
    expect(rules(validateHostReport({ online: true }))).toEqual([]);
    expect(rules(validateHostReport({ online: false }))).toEqual([]);
    expect(rules(validateHostReport({}))).toEqual(["host.online"]);
    expect(rules(validateHostReport("online"))).toEqual(["host.shape"]);
    expect(rules(validateHostReport({ online: true, audio: "ready" }))).toEqual(["host.audio.shape"]);
    expect(audio(ready)).toEqual([]);
    expect(audio({ ...ready, flowing: false, mutedBy: "station" })).toEqual([]);
    expect(audio({ ...ready, flowing: false, mutedBy: "host" })).toEqual([]);
    expect(audio(denied)).toEqual([]);
    // The speaker says whether it is flowing only where the host can know; silenced, it says by whom.
    expect(audio(ready, { status: "available", flowing: true })).toEqual([]);
    expect(audio(ready, { status: "available", flowing: false, mutedBy: "station" })).toEqual([]);
    expect(audio(ready, { status: "unavailable", reason: "no-device", failure })).toEqual([]);
    for (const reason of ["no-device", "denied", "not-asked", "in-use", "lost"]) expect(audio({ ...denied, reason })).toEqual([]);
  });

  it("refuses an input or output that carries the wrong things", () => {
    expect(audio({ status: "available", flowing: true })).toEqual(["host.audio.input.localAudio"]);
    expect(audio({ status: "available", localAudio: microphone })).toEqual(["host.audio.input.flowing"]);
    expect(audio({ ...ready, failure })).toEqual(["host.audio.input.failure.unexpected"]);
    expect(audio({ ...ready, reason: "lost" })).toEqual(["host.audio.input.reason.unexpected"]);
    expect(audio({ ...denied, flowing: true })).toEqual(["host.audio.input.flowing.unexpected"]);
    expect(audio(ready, { status: "available", reason: "no-device" })).toEqual(["host.audio.output.reason.unexpected"]);
    expect(audio({ status: "unavailable", failure })).toEqual(["host.audio.input.reason"]);
    expect(audio({ status: "unavailable", reason: "broken", failure })).toEqual(["host.audio.input.reason"]);
    expect(audio({ status: "unavailable", reason: "lost" })).toEqual(["host.audio.input.failure.required"]);
    expect(audio({ ...denied, failure: { code: "x" } })).toEqual(["failure.message", "failure.retryable"]);
    expect(audio({ ...denied, localAudio: microphone })).toEqual(["host.audio.input.localAudio.unexpected"]);
    expect(audio({ status: "muted" })).toEqual(["host.audio.input.status"]);
    // A silenced device names who silenced it, in one of two words; a flowing or absent one names nobody.
    expect(audio({ ...ready, flowing: false })).toEqual(["host.audio.input.mutedBy"]);
    expect(audio({ ...ready, flowing: false, mutedBy: "headset" })).toEqual(["host.audio.input.mutedBy"]);
    expect(audio({ ...ready, mutedBy: "host" })).toEqual(["host.audio.input.mutedBy.unexpected"]);
    expect(audio({ ...denied, mutedBy: "station" })).toEqual(["host.audio.input.mutedBy.unexpected"]);
    expect(audio(ready, { status: "available", flowing: false })).toEqual(["host.audio.output.mutedBy"]);
    expect(audio(ready, { status: "available", mutedBy: "station" })).toEqual(["host.audio.output.mutedBy.unexpected"]);
    expect(audio(ready, { status: "available", flowing: "yes" })).toEqual(["host.audio.output.flowing"]);
    expect(audio(ready, { status: "unavailable", reason: "lost", failure, flowing: false, mutedBy: "station" }))
      .toEqual(["host.audio.output.flowing.unexpected", "host.audio.output.mutedBy.unexpected"]);
    expect(audio(undefined)).toEqual(["host.audio.input.shape"]);
    expect(audio(ready, { status: "available", failure })).toEqual(["host.audio.output.failure.unexpected"]);
    expect(audio(ready, { status: "unavailable", reason: "no-device" })).toEqual(["host.audio.output.failure.required"]);
    expect(audio(ready, { status: "unavailable", failure })).toEqual(["host.audio.output.reason"]);
    expect(audio(ready, { status: "unavailable", reason: "denied", failure })).toEqual(["host.audio.output.reason"]);
    expect(audio(ready, { status: "silent" })).toEqual(["host.audio.output.status"]);
    expect(rules(validateHostReport({ online: true, audio: { input: ready } }))).toEqual(["host.audio.output.shape"]);
  });
});

describe("validateResult", () => {
  const failure = { code: "provider.busy", message: "Try later", retryable: true, retryAfterMs: 500 };

  it("validates a preference or policy result like any other", () => {
    expect(rules(validateResult({ status: "applied" }, "setPreference"))).toEqual([]);
    expect(rules(validateResult({ status: "applied" }, "executeTeamPolicy"))).toEqual([]);
    expect(rules(validateResult({ status: "failed", failure: { code: "omni.capability-not-enabled", message: "Not yours to set", retryable: false } }, "setPreference"))).toEqual([]);
    expect(rules(validateResult({ status: "set" }, "executeTeamPolicy"))).toEqual(["result.status"]);
  });
  it("refuses accepted as a capacity result beside applied, which replaced it", () => {
    // A rename is a refusal, not an alias: an adapter still speaking the old word is told so.
    expect(rules(validateResult({ status: "applied" }, "setCapacity"))).toEqual([]);
    // renamed away: a capacity is applied, as every other setting is; accept is the offer's word.
    expect(rules(validateResult({ status: "accepted" }, "setCapacity"))).toEqual(["result.status"]);
  });

  it("accepts each method's own answers and refuses a status it does not give", () => {
    // Every method's success status beside the same status on a method that does not answer it.
    const pairs = [
      ["execute", "applied"], ["setCapacity", "applied"], ["requestBreak", "requested"],
      ["commitBreak", "committed"], ["cancelBreak", "cancelled"], ["endBreak", "ended"],
      ["executeTeamBreak", "applied"], ["executeTeamLeadAssist", "applied"],
    ] as const;
    for (const [method, status] of pairs) {
      expect(rules(validateResult({ status }, method))).toEqual([]);
      // A capacity is taken, never refused: setCapacity has no failure status, and failed is a status it does not give.
      expect(rules(validateResult({ status: "failed", failure }, method))).toEqual(method === "setCapacity" ? ["result.status"] : []);
    }
    expect(rules(validateResult({ status: "applied" }, "dial"))).toEqual(["result.status"]);
    // renamed away: dialled overstated what happened; a dial is accepted and being placed, and its outcome comes later.
    expect(rules(validateResult({ status: "dialled", dialId: "dial-1" }, "dial"))).toEqual(["result.status"]);
    expect(rules(validateResult({ status: "ok" }, "execute"))).toEqual(["result.status"]);
    expect(rules(validateResult({ status: "opened", session: { remoteAudio: {}, setMuted: () => undefined, close: () => undefined } }, "openMedia"))).toEqual([]);
    expect(rules(validateResult({ status: "unavailable", failure }, "openMedia"))).toEqual([]);
    expect(rules(validateResult({ status: "failed", failure }, "openMedia"))).toEqual(["result.status"]);
    expect(rules(validateResult({ status: "opened" }, "openMedia"))).toEqual(["result.session"]);
    expect(rules(validateResult("applied", "execute"))).toEqual(["result.shape"]);
  });

  it("holds a failure to its shape, and a success to carrying none", () => {
    expect(rules(validateResult({ status: "failed" }, "execute"))).toEqual(["result.failure.required"]);
    expect(rules(validateResult({ status: "failed", failure: "busy" }, "execute"))).toEqual(["failure.shape"]);
    expect(rules(validateResult({ status: "failed", failure: { message: "x", retryable: false } }, "execute"))).toEqual(["failure.code"]);
    expect(rules(validateResult({ status: "failed", failure: { code: "x", retryable: false } }, "execute"))).toEqual(["failure.message"]);
    expect(rules(validateResult({ status: "failed", failure: { code: "x", message: "x" } }, "execute"))).toEqual(["failure.retryable"]);
    expect(rules(validateResult({ status: "failed", failure: { ...failure, retryAfterMs: -1 } }, "execute"))).toEqual(["failure.retryAfterMs"]);
    expect(rules(validateResult({ status: "applied", failure }, "execute"))).toEqual(["result.failure.unexpected"]);
  });

  it("requires the audio and controls promised by an opened media session", () => {
    const session = { remoteAudio: {}, setMuted: () => undefined, close: () => undefined };
    expect(validateResult({ status: "opened", session }, "openMedia")).toEqual([]);
    for (const key of ["remoteAudio", "setMuted", "close"] as const) {
      for (const value of [undefined, null, false, "invalid", []]) {
        expect(rules(validateResult({ status: "opened", session: { ...session, [key]: value } }, "openMedia"))).toEqual([`result.session.${key}`]);
      }
    }
    expect(rules(validateResult({ status: "opened", session: {} }, "openMedia"))).toEqual([
      "result.session.remoteAudio", "result.session.setMuted", "result.session.close",
    ]);
    expect(rules(validateResult({ status: "unavailable", failure, session }, "openMedia"))).toEqual(["result.session.unexpected"]);
  });

  it("lets a provider name its own codes and holds the omni namespace to the contract", () => {
    expect(rules(validateResult({ status: "failed", failure: { ...failure, code: "omni.unavailable" } }, "execute"))).toEqual([]);
    expect(rules(validateResult({ status: "failed", failure: { ...failure, code: "acme.circuit-open" } }, "execute"))).toEqual([]);
    expect(rules(validateResult({ status: "failed", failure: { ...failure, code: "omni.retry-later" } }, "execute"))).toEqual(["failure.code.unknown"]);
    // The same failure shape on a task's failed outcome.
    const ended = (failure: unknown) => rules(validateEventEnvelope(envelope({ type: "task-ended", taskId: "call-42", allocationId: "alloc-42", outcome: { type: "failed", failure } }), manifest()));
    expect(ended(failure)).toEqual([]);
    expect(ended({ ...failure, code: "omni.retry-later" })).toEqual(["failure.code.unknown"]);
  });
});

describe("the other direction, everywhere", () => {
  const voice = { channel: "voice" };
  const declaring = () => manifest({ idleCapabilities: { contacts: true, calendar: true } });

  it("refuses a duplicate authentication method", () => {
    expect(rules(validateManifest(manifest({ authenticationMethods: ["credentials", "browser-sso"] })))).toEqual([]);
    expect(rules(validateManifest(manifest({ authenticationMethods: ["credentials", "credentials"] })))).toEqual(["manifest.authenticationMethod.unique"]);
  });

  it("gives a directory something to offer, and keeps its ids unique", () => {
    const directory = (over: unknown) => rules(validateTask(task({ capabilities: { coldTransfer: over } }), voice));
    const tier2 = { id: "t2", label: "Tier 2" };
    expect(directory({ destinations: [tier2] })).toEqual([]);
    expect(directory({ destinations: [tier2, { id: "ivr", label: "Main menu" }] })).toEqual([]);
    // Nothing is typed, so an empty directory is a control with nothing to offer.
    expect(directory({ destinations: [] })).toEqual(["task.destinations.offer"]);
    expect(directory({})).toEqual(["task.destinations.list"]);
    // renamed away: a control carries its directory; bare true offered nothing once typing went.
    expect(directory(true)).toEqual(["task.destinations.shape"]);
    expect(directory({ destinations: [tier2, tier2] })).toEqual(["task.destination.unique"]);
    expect(directory({ destinations: [{ id: "t2", label: "" }] })).toEqual(["task.destination.label"]);
    // The item says nothing about what it does: any extra description is ignored, never required.
    expect(directory({ destinations: [{ ...tier2, kind: "queue" }] })).toEqual([]);
  });

  it("gives a required outcome policy a code to collect", () => {
    const policy = (over: Record<string, unknown>) => rules(validateTask(task({ capabilities: { outcomes: over } }), voice));
    expect(policy({ required: true, codes: [{ id: "resolved", label: "Resolved" }] })).toEqual([]);
    expect(policy({ required: false })).toEqual([]);
    expect(policy({ required: true })).toEqual(["task.outcomes.required.codes"]);
    expect(policy({ required: true, codes: [] })).toEqual(["task.outcomes.required.codes"]);
  });

  it("keeps browser names and attribute keys unique within a task", () => {
    const crm = { id: "crm", name: "CRM", purpose: "Account", url: "https://crm.example.com", sharedSession: false };
    expect(rules(validateTask(task({ browsers: [crm, { ...crm, id: "kb", name: "Knowledge" }] }), voice))).toEqual([]);
    expect(rules(validateTask(task({ browsers: [crm, { ...crm, id: "kb" }] }), voice))).toEqual(["task.browser.name.unique"]);
    const order = { type: "text", key: "order", value: "42" };
    expect(rules(validateTask(task({ attributes: [order, { ...order, key: "region" }] }), voice))).toEqual([]);
    expect(rules(validateTask(task({ attributes: [order, order] }), voice))).toEqual(["task.attribute.unique"]);
  });

  it("names nobody on a queued step", () => {
    const step = (entry: Record<string, unknown>) => rules(validateTask(task({ interactionHistory: { steps: [{ at: "2026-08-21T09:00:00Z", ...entry }] } }), voice));
    expect(step({ step: "answered", by: "A-1" })).toEqual([]);
    expect(step({ step: "queued" })).toEqual([]);
    expect(step({ step: "queued", by: "A-1" })).toEqual(["task.interactionHistory.by.unexpected"]);
  });

  it("declares the capability that shows a task's browsers", () => {
    const crm = { id: "crm", name: "CRM", purpose: "Account", url: "https://crm.example.com", sharedSession: false };
    expect(rules(validateTask(task({ capabilities: { browsers: true }, browsers: [crm] }), voice))).toEqual([]);
    expect(rules(validateTask(task({ capabilities: {}, browsers: [] }), voice))).toEqual([]);
    expect(rules(validateTask(task({ capabilities: {}, browsers: [crm] }), voice))).toEqual(["task.browsers.capability"]);
    // And the other way: the capability puts a panel in the workspace, so there is something in it.
    expect(rules(validateTask(task({ capabilities: { browsers: true }, browsers: [] }), voice))).toEqual(["task.browsers.required"]);
  });

  it("holds the break state's parts to its approval", () => {
    const check = (over: Record<string, unknown>) =>
      rules(validateSnapshot(snapshot({ break: { approval: "not-requested", mayAsk: true, ...over } }), manifest()));
    expect(check({ mayAsk: false, refusedReason: "Busy hours" })).toEqual([]);
    expect(check({ mayAsk: true, refusedReason: "Busy hours" })).toEqual(["break.refusedReason.mayAsk"]);
    const placed = { by: "M-1", endsAutomatically: false };
    expect(check({ approval: "in-effect", imposed: placed })).toEqual([]);
    expect(check({ approval: "not-requested", imposed: placed })).toEqual(["break.imposed.approval"]);
    const reasons = [{ id: "lunch", label: "Lunch" }];
    expect(check({ approval: "in-effect", reasons, activeReasonId: "lunch" })).toEqual([]);
    expect(check({ approval: "in-effect", activeReasonId: "lunch" })).toEqual([]);
    expect(check({ approval: "in-effect", reasons, activeReasonId: "tea" })).toEqual(["break.activeReasonId.known"]);
    // A provider with no reasons omits the field; the empty list is a second spelling of that.
    expect(check({ reasons })).toEqual([]);
    expect(check({})).toEqual([]);
    expect(check({ reasons: [] })).toEqual(["break.reasons.empty"]);
  });

  it("lets only an outstanding request appear on a team member", () => {
    const member = (over: Record<string, unknown>) => rules(validateTeamMembers({ members: [{ id: "A-2", availability: "on-task", ...over }] }));
    for (const approval of ["awaiting-decision", "granted", "starting-after-task"]) expect(member({ break: approval })).toEqual([]);
    expect(member({ availability: "on-break" })).toEqual([]);
    expect(member({ break: "in-effect" })).toEqual(["team.member.break"]);
    expect(member({ break: "not-requested" })).toEqual(["team.member.break"]);
    expect(member({ availability: "signed-out", break: "granted" })).toEqual(["team.member.break.availability"]);
    expect(member({ availability: "on-break", break: "granted" })).toEqual(["team.member.break.availability"]);
  });

  it("holds a snapshot and an event to the login's session, once told it", () => {
    const login = { loginId: "session-1" };
    expect(rules(validateSnapshot(snapshot(), manifest(), "snapshot", login))).toEqual([]);
    expect(rules(validateSnapshot(snapshot({ loginId: "session-0" }), manifest(), "snapshot", login))).toEqual(["snapshot.loginId.mismatch"]);
    expect(rules(validateSnapshot(snapshot({ loginId: "session-0" }), manifest()))).toEqual([]);
    const status = { type: "transport-status", status: "active" };
    expect(rules(validateEventEnvelope(envelope(status), manifest(), "event", login))).toEqual([]);
    expect(rules(validateEventEnvelope(envelope(status, { loginId: "session-0" }), manifest(), "event", login))).toEqual(["event.loginId.mismatch"]);
  });

  it("lets a lead assist one call at a time", () => {
    const assisting = (id: string) => task({ id, capabilities: {}, assisting: { memberId: "A-1", since: "2026-08-21T09:05:00Z" } });
    expect(rules(validateSnapshot(snapshot({ tasks: [assisting("call-1"), task({ id: "call-2" })] }), manifest()))).toEqual([]);
    expect(rules(validateSnapshot(snapshot({ tasks: [assisting("call-1"), assisting("call-2")] }), manifest()))).toEqual(["snapshot.assisting.single"]);
  });

  it("emits a contribution only under its capability, on the event path as on the snapshot", () => {
    const activity = { id: "cb-1", title: "Callback", startsAt: "2026-08-21T10:00:00Z" };
    const on = (event: unknown, m: unknown) => rules(validateEventEnvelope(envelope(event), m));
    expect(on({ type: "contacts-updated", contacts: [] }, declaring())).toEqual([]);
    expect(on({ type: "contacts-updated", contacts: [] }, manifest())).toEqual(["event.contacts.capability"]);
    expect(on({ type: "calendar-updated", scheduledActivities: [activity] }, declaring())).toEqual([]);
    expect(on({ type: "calendar-updated", scheduledActivities: [activity] }, manifest())).toEqual(["event.calendar.capability"]);
    expect(on({ type: "calendar-updated", scheduledActivities: [activity, activity] }, declaring())).toEqual(["activity.id.unique"]);
  });

  it("offers a task only before it is under way, with the acceptance the login asked for on the task", () => {
    const offer = (over: Record<string, unknown>, context: Record<string, unknown> = {}) =>
      rules(validateEventEnvelope(envelope({ type: "task-offered", task: task({ phase: "pending", acceptance: "consent", ...over }) }), manifest(), "event", context));
    expect(offer({})).toEqual([]);
    // An offer introduces work nobody has accepted: pending is the only phase it introduces.
    expect(offer({ phase: "confirmed", acceptance: undefined })).toEqual(["event.taskOffered.phase"]);
    // A preview record is offered pending and moved to preview once accepted: offered at preview, it skipped acceptance.
    expect(rules(validateEventEnvelope(envelope({ type: "task-offered", task: task({ capabilities: {}, phase: "preview" }) }), manifest({ dialOutcomes: ["answered", "no-answer"] })))).toEqual(["event.taskOffered.phase"]);
    for (const phase of ["in-progress", "paused", "completing"]) expect(offer({ phase, acceptance: undefined })).toEqual(["event.taskOffered.phase"]);
    expect(offer({}, { autoAcceptTasks: true })).toEqual([]);
    expect(offer({ acceptance: undefined }, { autoAcceptTasks: true })).toEqual(["task.acceptance.required"]);
    expect(offer({ acceptance: undefined }, { autoAcceptTasks: false })).toEqual([]);
    expect(offer({}, { autoAcceptTasks: false })).toEqual(["task.acceptance.unexpected"]);
    expect(offer({ acceptance: undefined })).toEqual([]);
    // Past pending the task has been accepted; the word has nothing left to say.
    expect(offer({ phase: "confirmed" })).toEqual(["task.acceptance.unexpected", "event.taskOffered.phase"]);
    // The same rule on a snapshot, where a reconnect carries a pending task the host was never offered.
    expect(rules(validateSnapshot(snapshot({ tasks: [task({ phase: "pending" })] }), manifest(), "snapshot", { autoAcceptTasks: true }))).toEqual(["task.acceptance.required"]);
    expect(rules(validateSnapshot(snapshot({ tasks: [task({ phase: "pending", acceptance: "consent" })] }), manifest(), "snapshot", { autoAcceptTasks: true }))).toEqual([]);
  });

  it("holds work the agent originated to acceptance: automatic, whatever the provisioning says", () => {
    const at = "2026-08-21T09:00:00Z";
    const dialled = { onCall: [{ role: "party", dialId: "dial-3", stage: "ringing", since: at }] };
    const originated = (over: Record<string, unknown>, autoAcceptTasks?: boolean) =>
      rules(validateTask(task({ phase: "pending", ...over }), { channel: "voice", dialOutcomesDeclared: true, ...(autoAcceptTasks === undefined ? {} : { autoAcceptTasks }) }));
    // The agent's own dial: automatic under either provisioning and with none stated; anything else, or nothing, is refused.
    expect(originated({ ...dialled, acceptance: "automatic" }, false)).toEqual([]);
    expect(originated({ ...dialled, acceptance: "automatic" }, true)).toEqual([]);
    expect(originated({ ...dialled, acceptance: "automatic" })).toEqual([]);
    expect(originated({ ...dialled, acceptance: "consent" }, false)).toEqual(["task.acceptance.originated"]);
    expect(originated({ ...dialled }, false)).toEqual(["task.acceptance.originated"]);
    expect(originated({ ...dialled }, true)).toEqual(["task.acceptance.originated"]);
    // A lead's join and a lead's listen are the agent's doing too.
    expect(originated({ capabilities: {}, assisting: { memberId: "A-1", since: at }, acceptance: "automatic" }, false)).toEqual([]);
    expect(originated({ capabilities: {}, assisting: { memberId: "A-1", since: at } }, false)).toEqual(["task.acceptance.originated"]);
    expect(originated({ capabilities: {}, listening: { memberId: "A-1", taskId: "call-9", allocationId: "alloc-9", mode: "listen", since: at }, acceptance: "automatic" }, false)).toEqual([]);
    // The control: work the queue routes keeps the provisioning's rule, on the same task without the dial.
    expect(originated({ acceptance: "automatic" }, false)).toEqual(["task.acceptance.unexpected"]);
    expect(originated({}, false)).toEqual([]);
    // Past pending the word has nothing to say of a dialled task either.
    expect(originated({ ...dialled, phase: "in-progress" }, false)).toEqual([]);
  });

  it("keeps summary metric ids unique", () => {
    const summary = (metrics: unknown[]) => rules(validateEventEnvelope(envelope({ type: "queue-summary", summary: { title: "Voice", waitingCount: 0, updatedAt: "2026-08-21T09:00:00Z", metrics } }), manifest()));
    const waiting = { id: "waiting", label: "Waiting", value: "3" };
    expect(summary([waiting, { ...waiting, id: "longest" }])).toEqual([]);
    expect(summary([waiting, waiting])).toEqual(["event.summary.metric.unique"]);
  });

  it("carries a failure only on an expired state", () => {
    const user = { id: "agent-1", displayName: "Ada", timeZone: "Asia/Kolkata" };
    const failure = { code: "expired", message: "Sign in again", retryable: true };
    expect(rules(validateAuthenticationState({ status: "expired", identity: user, failure }))).toEqual([]);
    expect(rules(validateAuthenticationState({ status: "signed-out", failure }))).toEqual(["authentication.failure.unexpected"]);
    expect(rules(validateAuthenticationState({ status: "authenticated", identity: user, capabilities: {}, failure }))).toEqual(["authentication.failure.unexpected"]);
  });
});

describe("rules that had no test", () => {
  // Each refusal beside the shape it accepts; a rule nobody exercises is a rule nobody can trust.
  const voice = { channel: "voice" };

  it("manifest presentation, labels, dial, and personal browser", () => {
    const m = (over: Record<string, unknown>) => rules(validateManifest(manifest(over)));
    expect(m({ taskTypePresentation: { Support: { singular: "Support call", plural: "Support calls", referenceLabel: "Case" } } })).toEqual([]);
    expect(m({ taskTypePresentation: "Support" })).toEqual(["manifest.taskTypePresentation.shape"]);
    expect(m({ taskTypePresentation: { Support: "call" } })).toEqual(["manifest.taskTypePresentation.entry"]);
    expect(m({ taskTypePresentation: { Support: { plural: "Support calls" } } })).toEqual(["manifest.taskTypePresentation.singular"]);
    expect(m({ taskTypePresentation: { Support: { singular: "Support call" } } })).toEqual(["manifest.taskTypePresentation.plural"]);
    expect(m({ taskTypePresentation: { Support: { singular: "Support call", plural: "Support calls", referenceLabel: "" } } })).toEqual(["manifest.taskTypePresentation.referenceLabel"]);
    expect(m({ phaseLabels: { pending: "Ringing" } })).toEqual([]);
    expect(m({ phaseLabels: { pending: "" } })).toEqual(["manifest.phaseLabels.label"]);
    expect(m({ idleCapabilities: { dial: { destinations: "any-number" } }, dialOutcomes: ["answered", "no-answer"] })).toEqual([]);
    expect(m({ idleCapabilities: { dial: {} }, dialOutcomes: ["answered", "no-answer"] })).toEqual(["manifest.dial.destinations"]);
    // Stated, never defaulted: which navigations the access applies to is required.
    expect(m({ idleCapabilities: { personalBrowser: { access: { mode: "block-all", allowList: [], blockList: [] }, accessAppliesTo: "initial-url" } } })).toEqual([]);
    expect(m({ idleCapabilities: { personalBrowser: { access: { mode: "block-all", allowList: [], blockList: [] } } } })).toEqual(["manifest.personalBrowser.accessAppliesTo"]);
    expect(m({ idleCapabilities: { personalBrowser: { access: "block-all" } } })).toEqual(["manifest.personalBrowser.access.shape", "manifest.personalBrowser.accessAppliesTo"]);
  });

  it("outcome policies and codes", () => {
    const policy = (over: unknown) => rules(validateTask(task({ capabilities: { outcomes: over } }), voice));
    const resolved = { id: "resolved", label: "Resolved" };
    expect(policy({ required: false, notes: "optional", codes: [resolved] })).toEqual([]);
    expect(policy({ required: "yes" })).toEqual(["task.outcomes.required"]);
    expect(policy({ notes: "sometimes" })).toEqual(["task.outcomes.notes"]);
    expect(policy({ codes: "resolved" })).toEqual(["task.outcomes.codes"]);
    expect(policy({ codes: [{ label: "Resolved" }] })).toEqual(["task.outcome.id"]);
    expect(policy({ codes: [{ id: "resolved" }] })).toEqual(["task.outcome.label"]);
    expect(policy({ codes: [resolved, resolved] })).toEqual(["task.outcome.unique"]);
  });

  it("custom controls", () => {
    const custom = (over: unknown) => rules(validateTask(task({ capabilities: { custom: over } }), voice));
    const control = { id: "supervisor", ui: { control: "button", label: "Request supervisor", placement: "secondary", render: "inline" } };
    expect(custom([control])).toEqual([]);
    // Where the control's work renders is stated on every control, never defaulted.
    expect(custom([{ ...control, ui: { control: "button", label: "Request supervisor", placement: "secondary" } }])).toEqual(["task.custom.ui.render"]);
    expect(custom("supervisor")).toEqual(["task.custom.shape"]);
    expect(custom(["supervisor"])).toEqual(["task.custom.entry"]);
    expect(custom([{ ui: control.ui }])).toEqual(["task.custom.id"]);
    expect(custom([control, control])).toEqual(["task.custom.unique"]);
    expect(custom([{ id: "supervisor" }])).toEqual(["task.custom.ui"]);
    expect(custom([{ ...control, ui: { ...control.ui, control: "dial" } }])).toEqual(["task.custom.ui.control"]);
    expect(custom([{ ...control, ui: { ...control.ui, label: "" } }])).toEqual(["task.custom.ui.label"]);
    expect(custom([{ ...control, ui: { ...control.ui, placement: "footer" } }])).toEqual(["task.custom.ui.placement"]);
  });

  it("scheduled activities on the snapshot", () => {
    const calendar = (activities: unknown[]) => rules(validateSnapshot(snapshot({ scheduledActivities: activities }), manifest({ idleCapabilities: { calendar: true } })));
    const activity = { id: "cb-1", title: "Callback", startsAt: "2026-08-21T10:00:00Z", endsAt: "2026-08-21T10:15:00Z" };
    expect(calendar([activity])).toEqual([]);
    expect(calendar([{ ...activity, endsAt: "2026-08-21T09:00:00Z" }])).toEqual(["activity.endsAt.order"]);
    expect(calendar([activity, activity])).toEqual(["activity.id.unique"]);
  });

  it("an expired state's failure", () => {
    const expired = (failure: unknown) => rules(validateAuthenticationState({ status: "expired", failure }));
    expect(expired({ code: "expired", message: "Sign in again", retryable: true })).toEqual([]);
    expect(expired("expired")).toEqual(["authentication.failure.shape"]);
    expect(expired({ message: "Sign in again", retryable: true })).toEqual(["authentication.failure.code"]);
    expect(expired({ code: "expired", retryable: true })).toEqual(["authentication.failure.message"]);
    expect(expired({ code: "expired", message: "Sign in again" })).toEqual(["authentication.failure.retryable"]);
  });

  it("event timestamps, outcomes, and status messages", () => {
    const check = (event: unknown) => rules(validateEventEnvelope(envelope(event), manifest()));
    const offer = { type: "task-offered", task: task({ phase: "pending", acceptance: "consent" }) };
    expect(check({ ...offer, allocationExpiresAt: "2026-08-21T09:01:00Z" })).toEqual([]);
    expect(check({ ...offer, allocationExpiresAt: "soon" })).toEqual(["event.taskOffered.allocationExpiresAt"]);
    const ended = (outcome: unknown) => check({ type: "task-ended", taskId: "call-42", allocationId: "alloc-42", outcome });
    expect(ended({ type: "transferred", destinationId: "tier2" })).toEqual([]);
    expect(ended({ type: "transferred", destinationId: "" })).toEqual(["event.taskEnded.outcome.transferred"]);
    // A take-over names the lead who took the call, by user id: a lead is not a directory item.
    expect(ended({ type: "taken-over", leadId: "L-9" })).toEqual([]);
    expect(ended({ type: "taken-over" })).toEqual(["event.taskEnded.outcome.takenOver"]);
    // cancelled says who called the work off, as completed does: the agent, the provider, the party; nobody else, and never nobody.
    expect(ended({ type: "cancelled", by: "party", reason: "Caller hung up" })).toEqual([]);
    expect(ended({ type: "cancelled", by: "agent" })).toEqual([]);
    expect(ended({ type: "cancelled", by: "provider" })).toEqual([]);
    expect(ended({ type: "cancelled", reason: "Caller hung up" })).toEqual(["event.taskEnded.outcome.cancelled.by"]);
    expect(ended({ type: "cancelled", by: "system" })).toEqual(["event.taskEnded.outcome.cancelled.by"]);
    expect(ended({ type: "cancelled", by: "party", reason: "" })).toEqual(["event.taskEnded.outcome.cancelled"]);
    // An offer that lapsed at its allocation deadline was cancelled by nobody: it expired, pending.
    expect(ended({ type: "expired", phase: "pending" })).toEqual([]);
    expect(check({ type: "transport-status", status: "error", recovery: "reconnect", message: "Upstream down" })).toEqual([]);
    expect(check({ type: "transport-status", status: "error", recovery: "reconnect", message: "" })).toEqual(["event.transportStatus.message"]);
  });
});

describe("validateAuthenticationState", () => {
  const user = { id: "agent-1", displayName: "Ada", timeZone: "Asia/Kolkata" };

  it("declares what the team left to the person on the login, with who set it", () => {
    const user = { id: "agent-1", displayName: "Ada", timeZone: "Asia/Kolkata" };
    const prefs = (value: unknown) => rules(validateAuthenticationState({ status: "authenticated", identity: user, capabilities: { preferences: value } }));
    const hold = { id: "hold", label: "Hold", enabled: true, setBy: "team" };
    expect(prefs([hold, { id: "skill:tier2", label: "Tier 2", enabled: false, setBy: "person" }, { id: "skill:billing", label: "Billing", enabled: true, setBy: "provider" }])).toEqual([]);
    // Nothing is hidden: a preference a level above has since locked is listed, locked.
    expect(prefs([{ ...hold, lockedBy: "site", reason: "No hold at this site" }])).toEqual([]);
    expect(prefs(undefined)).toEqual([]);
    expect(prefs([])).toEqual(["authentication.capability.preferences.empty"]);
    expect(prefs([{ ...hold, id: "connectBack" }])).toEqual(["preference.id"]);
    // Mute is the host's: not a preference the provider keeps, whatever level would set it.
    expect(prefs([{ ...hold, id: "mute" }])).toEqual(["preference.id"]);
    expect(prefs([{ ...hold, id: "skill:" }])).toEqual(["preference.id"]);
    expect(prefs([hold, hold])).toEqual(["preference.unique"]);
    expect(prefs([{ id: "hold", enabled: true, setBy: "team" }])).toEqual(["preference.label"]);
    expect(prefs([{ id: "hold", label: "Hold", setBy: "team" }])).toEqual(["preference.enabled"]);
    expect(prefs([{ id: "hold", label: "Hold", enabled: true }])).toEqual(["preference.setBy"]);
    expect(prefs([{ ...hold, setBy: "queue" }])).toEqual(["preference.setBy.unknown"]);
    expect(prefs([{ ...hold, lockedBy: "person" }])).toEqual(["preference.lockedBy.person"]);
    // Given the manifest's levels, a declared one is accepted and an undeclared one is not.
    const declared = { levels: ["org", "region", "team", "person"] };
    expect(rules(validateAuthenticationState({ status: "authenticated", identity: user, capabilities: { preferences: [{ ...hold, setBy: "region" }] } }, "authentication", declared))).toEqual([]);
    expect(rules(validateAuthenticationState({ status: "authenticated", identity: user, capabilities: { preferences: [{ ...hold, setBy: "site" }] } }, "authentication", declared))).toEqual(["preference.setBy.unknown"]);
    expect(prefs([{ ...hold, reason: "Because" }])).toEqual(["preference.reason.unexpected"]);
    expect(prefs(["hold"])).toEqual(["preference.shape"]);
    expect(prefs("hold")).toEqual(["preferences.shape"]);
  });
  it("refuses provisioning as a setBy beside provider, which replaced it", () => {
    // A rename is a refusal, not an alias: an adapter still speaking the old word is told so.
    const user = { id: "agent-1", displayName: "Ada", timeZone: "Asia/Kolkata" };
    const prefs = (setBy: string) => rules(validateAuthenticationState({ status: "authenticated", identity: user, capabilities: { preferences: [{ id: "hold", label: "Hold", enabled: true, setBy }] } }));
    expect(prefs("provider")).toEqual([]);
    expect(prefs("provisioning")).toEqual(["preference.setBy.unknown"]);
  });

  it("declares what the login may do by presence, on the login and nowhere else", () => {
    // Each refusal beside the shape it must accept, in one place.
    const login = (capabilities: unknown, status = "authenticated") => rules(validateAuthenticationState({ status, identity: user, capabilities }));
    expect(login({})).toEqual([]);
    expect(login(undefined)).toEqual(["authentication.capabilities.shape"]);
    expect(login({ breaks: true })).toEqual([]);
    expect(login({ breaks: false })).toEqual(["authentication.capability.value"]);
    expect(login({ team: {} })).toEqual([]);
    expect(login({ team: true })).toEqual(["authentication.capability.team.shape"]);
    expect(login({ team: { breakControl: true } })).toEqual([]);
    expect(login({ team: { breakControl: false } })).toEqual(["authentication.capability.value"]);
    expect(login({ team: { placeControl: true } })).toEqual(["authentication.capability.team.unknown"]);
    expect(login({ telepathy: true })).toEqual(["authentication.capability.unknown"]);
    expect(login({}, "refreshing")).toEqual([]);
    expect(login({}, "expired")).toEqual(["authentication.capabilities.unexpected"]);
    expect(rules(validateAuthenticationState({ status: "expired", identity: user }))).toEqual([]);
  });

  it("accepts each state with what it must carry", () => {
    expect(validateAuthenticationState({ status: "signed-out" })).toEqual([]);
    expect(validateAuthenticationState({ status: "authenticating" })).toEqual([]);
    expect(validateAuthenticationState({ status: "authenticated", identity: user, capabilities: {} })).toEqual([]);
    expect(validateAuthenticationState({ status: "authenticated", identity: user, capabilities: {}, expiresAt: "2026-08-21T10:00:00Z" })).toEqual([]);
    expect(validateAuthenticationState({ status: "refreshing", identity: user, capabilities: {} })).toEqual([]);
    expect(validateAuthenticationState({ status: "authenticated", identity: user, capabilities: { breaks: true, team: {} } })).toEqual([]);
    expect(validateAuthenticationState({ status: "authenticated", identity: user, capabilities: { breaks: true, team: { breakControl: true, leadAssistControl: true } } })).toEqual([]);
    expect(validateAuthenticationState({ status: "expired" })).toEqual([]);
    expect(validateAuthenticationState({ status: "expired", identity: user })).toEqual([]);
  });

  it.each([
    ["a status the contract dropped", { status: "connected" }, "authentication.status"],
    ["authenticated with no identity", { status: "authenticated" }, "authentication.identity"],
    ["refreshing with no identity", { status: "refreshing" }, "authentication.identity"],
    ["an identity with no id", { status: "authenticated", identity: { displayName: "Ada", timeZone: "Asia/Kolkata" } }, "authentication.identity.id"],
    ["an identity on a signed-out state", { status: "signed-out", identity: user }, "authentication.identity.unexpected"],
    // A usable login says what it may do, {} included; a state that is not usable has nothing to say.
    ["authenticated with no capabilities", { status: "authenticated", identity: user }, "authentication.capabilities.shape"],
    ["refreshing with no capabilities", { status: "refreshing", identity: user }, "authentication.capabilities.shape"],
    ["a capability the contract lacks", { status: "authenticated", identity: user, capabilities: { telepathy: true } }, "authentication.capability.unknown"],
    ["a capability declared false", { status: "authenticated", identity: user, capabilities: { breaks: false } }, "authentication.capability.value"],
    ["team declared as a flag", { status: "authenticated", identity: user, capabilities: { team: true } }, "authentication.capability.team.shape"],
    ["a team control the contract lacks", { status: "authenticated", identity: user, capabilities: { team: { placeControl: true } } }, "authentication.capability.team.unknown"],
    ["a team control declared false", { status: "authenticated", identity: user, capabilities: { team: { breakControl: false } } }, "authentication.capability.value"],
    ["capabilities as a flag", { status: "authenticated", identity: user, capabilities: true }, "authentication.capabilities.shape"],
    ["capabilities on an expired state", { status: "expired", identity: user, capabilities: {} }, "authentication.capabilities.unexpected"],
    // Only an authenticated session has something to expire.
    ["an expiry on a refreshing state", { status: "refreshing", identity: user, expiresAt: "2026-08-21T10:00:00Z" }, "authentication.expiresAt.unexpected"],
    ["an expiry with no zone", { status: "authenticated", identity: user, expiresAt: "2026-08-21T10:00:00" }, "authentication.expiresAt"],
  ])("rejects %s", (_label, value, rule) => {
    expect(rules(validateAuthenticationState(value))).toContain(rule);
    expect(rules(validateAuthenticationState({ status: "authenticated", identity: user, capabilities: {} }))).not.toContain(rule);
  });
});

describe("validateContact", () => {
  it("checks what is present rather than what is missing", () => {
    // Every field is optional, so an empty contact is legal.
    expect(validateContact({})).toEqual([]);
    expect(validateContact({ name: "Asha", number: "+91", email: "a@example.com" })).toEqual([]);
    expect(rules(validateContact({ name: "  " }))).toContain("contact.name");
    expect(rules(validateContact({ attributes: [{ key: "", value: "x" }] }))).toContain("attribute.key");
    expect(rules(validateContact("Asha"))).toContain("contact.shape");
  });
});

describe("the validators accept exactly what the contract publishes", () => {
  // The runtime lists are pinned to the declarations at compile time; these prove the pin holds
  // at runtime from both sides, because a validator that accepted everything would pass a
  // suite that only ever fed it published values.
  it("every published isolation scheme, and no unpublished one", () => {
    const reusing = (isolationScheme: unknown) =>
      task({ browsers: [{ id: "crm", name: "CRM", purpose: "Account", url: "https://crm.example.com", sharedSession: true, isolationScheme }] });
    for (const scheme of Object.values(BROWSER_ISOLATION_SCHEMES)) {
      expect(rules(validateTask(reusing(scheme), { channel: "voice" }))).toEqual([]);
    }
    expect(rules(validateTask(reusing("ProviderName.Whatever"), { channel: "voice" }))).toContain("task.browser.isolationScheme");
  });

  it("every published break kind, and no unpublished one", () => {
    const withKind = (kind: unknown) => snapshot({ break: { approval: "not-requested", mayAsk: true, reasons: [{ id: "r1", label: "Rest", kind }] } });
    for (const kind of BREAK_KINDS) {
      expect(rules(validateSnapshot(withKind(kind), manifest()))).toEqual([]);
    }
    expect(rules(validateSnapshot(withKind("nap"), manifest()))).toContain("break.reason.kind");
  });

  it("every published idle capability on voice, and dial on nothing else", () => {
    const declaring = (name: string, channel: string) => {
      const value = name === "dial" ? { destinations: "any-number" }
        : name === "personalBrowser" ? { access: { mode: "allow-all" }, accessAppliesTo: "all-navigation" }
        : true;
      // A dialpad dials, so declaring it declares how a dial ends; off voice, dial is the only violation looked for.
      return manifest({ channel, idleCapabilities: { [name]: value }, ...(name === "dial" && channel === "voice" ? { dialOutcomes: ["answered", "no-answer"] } : {}) });
    };
    for (const name of IDLE_CAPABILITIES) {
      expect(rules(validateManifest(declaring(name, "voice")))).toEqual([]);
      const onChat = rules(validateManifest(declaring(name, "chat")));
      if (name === "dial") expect(onChat).toContain("manifest.idleCapability.channel");
      else expect(onChat).toEqual([]);
    }
    expect(rules(validateManifest(manifest({ idleCapabilities: { media: true } })))).toContain("manifest.idleCapability.channel");
  });
});

describe("the wrap allowance follows the completion mode", () => {
  const voice = { channel: "voice" };
  it("may be omitted only where the provider will not act on it", () => {
    // A provider waiting for `complete` may leave the deadline open...
    expect(rules(validateTask(task({ completionMode: "agent-command", wrapAllowance: undefined }), voice))).toEqual([]);
    // ...and one that completes the task itself must say when.
    expect(rules(validateTask(task({ completionMode: "provider-automatic", wrapAllowance: undefined }), voice)))
      .toContain("task.wrapAllowance.required");
    // The controls: stated, either mode is fine, and zero is a deadline of now, not an absence.
    expect(rules(validateTask(task({ completionMode: "provider-automatic", wrapAllowance: 0 }), voice))).toEqual([]);
    expect(rules(validateTask(task({ completionMode: "agent-command", wrapAllowance: 0 }), voice))).toEqual([]);
  });

  it("is still a duration when present, whatever the mode", () => {
    expect(rules(validateTask(task({ completionMode: "agent-command", wrapAllowance: 1.5 }), voice))).toContain("task.wrapAllowance");
    expect(rules(validateTask(task({ completionMode: "agent-command", wrapAllowance: "60" }), voice))).toContain("task.wrapAllowance");
  });
});

describe("connectBack is a voice capability", () => {
  it("is accepted on voice and refused on every other channel, like the rest of the voice arm", () => {
    expect(rules(validateTask(task({ capabilities: { connectBack: true } }), { channel: "voice" }))).toEqual([]);
    for (const channel of ["chat", "email"]) {
      expect(rules(validateTask(task({ channel, capabilities: { connectBack: true } }), { channel }))).toContain("task.capability.channel");
    }
    // Presence is the permission: the flag carries no payload.
    expect(rules(validateTask(task({ capabilities: { connectBack: false } }), { channel: "voice" }))).toContain("task.capability.value");
  });
});

describe("warm transfer", () => {
  const voice = { channel: "voice" };
  it("is its own capability, declared like the other directories, and voice only", () => {
    expect(rules(validateTask(task({ capabilities: { warmTransfer: { destinations: [{ id: "tier2", label: "Tier 2" }] } } }), voice))).toEqual([]);
    expect(rules(validateTask(task({ capabilities: { warmTransfer: { destinations: [{ id: "t2", label: "Tier 2" }] } } }), voice))).toEqual([]);
    // The same directory rules as coldTransfer: the control carries at least one item to pick.
    expect(rules(validateTask(task({ capabilities: { warmTransfer: { destinations: [] } } }), voice))).toEqual(["task.destinations.offer"]);
    expect(rules(validateTask(task({ capabilities: { warmTransfer: true } }), voice))).toEqual(["task.destinations.shape"]);
    for (const channel of ["chat", "email"]) {
      expect(rules(validateTask(task({ channel, capabilities: { warmTransfer: { destinations: [{ id: "tier2", label: "Tier 2" }] } } }), { channel }))).toContain("task.capability.channel");
    }
  });

  it("carries the consulted destination on the call, on voice and nowhere else", () => {
    const consulted = { role: "consulted", destinationId: "tier2", label: "Tier 2", dialId: "dial-3", stage: "ringing", since: "2026-08-21T09:05:00Z" };
    expect(rules(validateTask(task({ onCall: [consulted] }), voice))).toEqual([]);
    expect(rules(validateTask(task({ onCall: [{ role: "consulted", destinationId: "tier2", stage: "joined", since: "2026-08-21T09:05:00Z" }] }), voice))).toEqual([]);
    expect(rules(validateTask(task({ onCall: [{ ...consulted, destinationId: "" }] }), voice))).toEqual(["task.onCall.destinationId"]);
    expect(rules(validateTask(task({ onCall: [{ ...consulted, since: "yesterday" }] }), voice))).toEqual(["task.onCall.since"]);
    expect(rules(validateTask(task({ onCall: consulted }), voice))).toEqual(["task.onCall.shape"]);
    expect(rules(validateTask(task({ channel: "email", capabilities: {}, onCall: [consulted] }), { channel: "email" }))).toEqual(["task.onCall.channel"]);
    // One at a time: complete and cancel name no destination because there is exactly one.
    expect(rules(validateTask(task({ onCall: [consulted, { ...consulted, destinationId: "tier3" }] }), voice))).toEqual(["task.onCall.consulted.single"]);
    // renamed away: the consultation folded into who is on the call; the old field is refused as unknown, not read.
    expect(rules(validateTask(task({ consultation: { destinationId: "tier2" } }), voice))).toEqual([]);
  });
});

describe("who is on the call", () => {
  const voice = { channel: "voice" };
  const since = "2026-08-21T09:05:00Z";
  const onCall = (entries: unknown) => rules(validateTask(task({ onCall: entries }), voice));
  const party = { role: "party", since };
  const agent = { role: "agent", userId: "A-1", since };
  const conferenced = { role: "conferenced", destinationId: "tier2", dialId: "dial-7f2", label: "Tier 2", stage: "joined", since };

  it("empties once the call has ended, even while the task goes on", () => {
    // The last word about a call must not stay true for ever: a completing task, or one whose media
    // ended, carries nobody on the call. Empty and absent both say so.
    const live = [party, agent];
    expect(rules(validateTask(task({ onCall: live }), voice))).toEqual([]);
    expect(rules(validateTask(task({ phase: "completing", onCall: live }), voice))).toEqual(["task.onCall.ended"]);
    expect(rules(validateTask(task({ media: "ended", onCall: live }), voice))).toEqual(["task.onCall.ended"]);
    expect(rules(validateTask(task({ phase: "completing", onCall: [] }), voice))).toEqual([]);
    expect(rules(validateTask(task({ phase: "completing" }), voice))).toEqual([]);
    expect(rules(validateTask(task({ media: "started", onCall: live }), voice))).toEqual([]);
  });

  it("states each role with what that role needs, and refuses what another role would carry", () => {
    expect(onCall([party, agent, conferenced])).toEqual([]);
    expect(onCall([{ ...party, held: true }, { ...conferenced, held: true }])).toEqual([]);
    expect(onCall([])).toEqual([]);
    expect(onCall([{ role: "caller", since }])).toEqual(["task.onCall.role"]);
    expect(onCall(["A-1"])).toEqual(["task.onCall.entry"]);
    expect(onCall([{ ...party, held: false }])).toEqual(["task.onCall.held"]);
    expect(onCall([{ role: "agent", since }])).toEqual(["task.onCall.userId"]);
    expect(onCall([{ ...party, userId: "A-1" }])).toEqual(["task.onCall.userId.unexpected"]);
    expect(onCall([{ ...conferenced, userId: "A-1" }])).toEqual(["task.onCall.userId.unexpected"]);
    // A party or an agent was dialled from nowhere.
    expect(onCall([{ ...party, destinationId: "tier2" }])).toEqual(["task.onCall.destinationId.unexpected"]);
    expect(onCall([{ ...agent, dialId: "dial-1" }])).toEqual(["task.onCall.dialId.unexpected"]);
    expect(onCall([{ ...party, label: "Maya" }])).toEqual(["task.onCall.label.unexpected"]);
    expect(onCall([{ ...conferenced, dialId: "" }])).toEqual(["task.onCall.dialId"]);
    expect(onCall([{ ...conferenced, label: "" }])).toEqual(["task.onCall.label"]);
    expect(onCall([party, party])).toEqual(["task.onCall.party.single"]);
    // A dialled entry says where it stands, and nobody ringing is held.
    expect(onCall([{ ...conferenced, stage: "ringing" }])).toEqual([]);
    expect(onCall([{ ...conferenced, stage: undefined }])).toEqual(["task.onCall.stage"]);
    expect(onCall([{ ...conferenced, stage: "answered" }])).toEqual(["task.onCall.stage"]);
    expect(onCall([{ ...conferenced, stage: "ringing", held: true }])).toEqual(["task.onCall.held.ringing"]);
    expect(onCall([{ ...conferenced, stage: "joined", held: true }])).toEqual([]);
    // The party carries a dial and a stage on a connect-back alone, and together: the one person a connect-back dials.
    expect(onCall([{ ...party, dialId: "dial-9", stage: "ringing" }])).toEqual([]);
    expect(onCall([{ ...party, dialId: "dial-9", stage: "joined" }, agent])).toEqual([]);
    // A callback the platform places carries the stage and no host dial; a dial with no stage is half a claim.
    expect(onCall([{ ...party, stage: "ringing" }])).toEqual([]);
    expect(onCall([{ ...party, stage: "joined" }])).toEqual([]);
    expect(onCall([{ ...party, dialId: "dial-9" }])).toEqual(["task.onCall.party.dial"]);
    expect(onCall([{ ...party, dialId: "dial-9", stage: "ringing", held: true }])).toEqual(["task.onCall.held.ringing"]);
    expect(onCall([{ ...party, dialId: "dial-9", stage: "parked" }])).toEqual(["task.onCall.stage"]);
    expect(onCall([{ ...party, dialId: "dial-9", stage: "ringing", label: "Maya" }])).toEqual(["task.onCall.label.unexpected"]);
    expect(onCall([{ ...agent, stage: "ringing" }])).toEqual(["task.onCall.stage.unexpected"]);
    // Two conferenced people are ordinary; the singular rules are party and consulted.
    expect(onCall([conferenced, { ...conferenced, destinationId: "tier3", dialId: "dial-3c9" }])).toEqual([]);
  });
});

describe("every dial has an outcome", () => {
  const voice = { channel: "voice" };
  const dialling = (over: Record<string, unknown> = {}) => manifest({ dialOutcomes: ["answered", "no-answer"], ...over });

  it("takes a manifest's word for which outcomes it distinguishes, both ways", () => {
    const m = (over: Record<string, unknown>) => rules(validateManifest(manifest(over)));
    expect(m({ dialOutcomes: ["answered", "busy", "no-answer", "unreachable", "rejected", "cancelled", "unexplained"] })).toEqual([]);
    // "The switch gave no cause" is a claim only a provider that reports causes can make.
    expect(m({ dialOutcomes: ["answered", "no-answer", "unexplained"] })).toEqual([]);
    expect(m({ dialOutcomes: ["answered", "unexplained"] })).toEqual(["manifest.dialOutcomes.unexplained.alone"]);
    expect(m({ dialOutcomes: ["answered", "no-answer"] })).toEqual([]);
    expect(m({ dialOutcomes: [] })).toEqual(["manifest.dialOutcomes.shape"]);
    expect(m({ dialOutcomes: "answered" })).toEqual(["manifest.dialOutcomes.shape"]);
    expect(m({ dialOutcomes: ["answered", "ringing"] })).toEqual(["manifest.dialOutcome"]);
    expect(m({ dialOutcomes: ["answered", "busy", "busy"] })).toEqual(["manifest.dialOutcome.unique"]);
    // Both branches: a success the provider cannot state, or a failure it cannot, leaves the desk guessing.
    expect(m({ dialOutcomes: ["busy", "no-answer"] })).toEqual(["manifest.dialOutcomes.answered"]);
    expect(m({ dialOutcomes: ["answered"] })).toEqual(["manifest.dialOutcomes.failure"]);
    expect(m({ channel: "chat", dialOutcomes: ["answered", "no-answer"] })).toEqual(["manifest.dialOutcomes.channel"]);
    // A dialpad dials.
    expect(m({ idleCapabilities: { dial: { destinations: "any-number" } } })).toEqual(["manifest.dialOutcomes.required"]);
    expect(m({ idleCapabilities: { contacts: true } })).toEqual([]);
  });

  it("requires a task that may dial to come from a manifest that says how a dial ends", () => {
    for (const name of ["connectBack", "coldTransfer", "warmTransfer", "conference"]) {
      const dials = task({ capabilities: { [name]: name === "connectBack" ? true : { destinations: [{ id: "tier2", label: "Tier 2" }] } } });
      expect(rules(validateSnapshot(snapshot({ tasks: [dials] }), dialling()))).toEqual([]);
      expect(rules(validateSnapshot(snapshot({ tasks: [dials] }), manifest()))).toEqual(["task.capability.dialOutcomes.required"]);
      expect(rules(validateEventEnvelope(envelope({ type: "task-updated", task: dials }), manifest()))).toEqual(["task.capability.dialOutcomes.required"]);
    }
    // A locked control is still a declared one; the queue could unlock it without a manifest change.
    expect(rules(validateSnapshot(snapshot({ tasks: [task({ capabilities: { conference: { lockedBy: "team" } } })] }), manifest()))).toEqual(["task.capability.dialOutcomes.required"]);
    expect(rules(validateSnapshot(snapshot({ tasks: [task({ capabilities: { hold: true } })] }), manifest()))).toEqual([]);
    // Without a manifest to ask, the question is not asked.
    expect(rules(validateTask(task({ capabilities: { conference: { destinations: [{ id: "tier2", label: "Tier 2" }] } } }), voice))).toEqual([]);
  });

  it("carries the outcome once the manifest declared it, against a task or none, with the switch's words", () => {
    const check = (event: unknown, m = dialling()) => rules(validateEventEnvelope(envelope(event), m));
    const answered = { type: "dial-outcome", dialId: "dial-7f2", outcome: "answered" };
    expect(check(answered)).toEqual([]);
    expect(check({ ...answered, taskId: "call-91", allocationId: "alloc-91", destinationId: "tier2" })).toEqual([]);
    // The outcome names the task by its allocation too, so a late one lands on the life it names; an allocation alone names nothing.
    expect(check({ ...answered, taskId: "call-91" })).toEqual(["event.dialOutcome.allocationId"]);
    expect(check({ ...answered, allocationId: "alloc-91" })).toEqual(["event.dialOutcome.allocationId.unexpected"]);
    expect(check({ ...answered, outcome: "no-answer", reason: "No route to destination" })).toEqual([]);
    // A dial called off before anyone answered is its own outcome, not a no-answer the destination never gave.
    expect(check({ ...answered, outcome: "cancelled" }, manifest({ dialOutcomes: ["answered", "cancelled"] }))).toEqual([]);
    expect(check({ ...answered, outcome: "unexplained", reason: "Cause 0" }, manifest({ dialOutcomes: ["answered", "busy", "unexplained"] }))).toEqual([]);
    expect(check({ ...answered, dialId: "" })).toEqual(["event.dialOutcome.dialId"]);
    expect(check({ ...answered, outcome: "ringing" })).toEqual(["event.dialOutcome.outcome"]);
    // A distinction the manifest did not declare is a guess dressed as a code.
    expect(check({ ...answered, outcome: "busy" })).toEqual(["event.dialOutcome.undeclared"]);
    expect(check(answered, manifest())).toEqual(["event.dialOutcome.undeclared"]);
    expect(check({ ...answered, taskId: "", allocationId: "alloc-91" })).toEqual(["event.dialOutcome.taskId"]);
    expect(check({ ...answered, destinationId: "" })).toEqual(["event.dialOutcome.destinationId"]);
    expect(check({ ...answered, reason: "" })).toEqual(["event.dialOutcome.reason"]);
  });

  it("answers dialling with the host's dialId restated, and applied names no dial", () => {
    expect(rules(validateResult({ status: "dialling", dialId: "dial-7f2" }, "dial", "result", "dial-7f2"))).toEqual([]);
    expect(rules(validateResult({ status: "dialling", dialId: "dial-7f2" }, "dial"))).toEqual([]);
    expect(rules(validateResult({ status: "dialling" }, "dial"))).toEqual(["result.dialId"]);
    // The host compares and confirms: an answer for another dial is an answer to nothing it asked.
    expect(rules(validateResult({ status: "dialling", dialId: "dial-000" }, "dial", "result", "dial-7f2"))).toEqual(["result.dialId.mismatch"]);
    // execute dials when its command did, and then answers dialling rather than applied.
    expect(rules(validateResult({ status: "dialling", dialId: "dial-7f2" }, "execute", "result", "dial-7f2"))).toEqual([]);
    expect(rules(validateResult({ status: "applied" }, "execute", "result", "dial-7f2"))).toEqual(["result.status"]);
    expect(rules(validateResult({ status: "dialling", dialId: "dial-7f2" }, "execute"))).toEqual(["result.status"]);
    expect(rules(validateResult({ status: "applied", dialId: "dial-7f2" }, "execute"))).toEqual(["result.dialId.unexpected"]);
    expect(rules(validateResult({ status: "failed", failure: { code: "omni.destination-not-permitted", message: "Not in contacts", retryable: false } }, "execute", "result", "dial-7f2"))).toEqual([]);
    // A phone the platform does not permit for the agent is refused by name, and the name is the contract's.
    expect(rules(validateResult({ status: "failed", failure: { code: "omni.phone-not-permitted", message: "This agent is configured for a desk phone", retryable: false } }, "execute"))).toEqual([]);
    expect(rules(validateResult({ status: "failed", failure: { code: "omni.station-mismatch", message: "x", retryable: false } }, "execute"))).toEqual(["failure.code.unknown"]);
  });

  it("lets a step that dialled say which dial and where, and no other step", () => {
    const step = (entry: Record<string, unknown>) => rules(validateTask(task({ interactionHistory: { steps: [{ at: "2026-08-21T09:00:00Z", by: "A-1", ...entry }] } }), voice));
    for (const dialled of ["transferred", "conferenced", "unanswered"]) {
      expect(step({ step: dialled, dialId: "dial-7f2", destinationId: "tier2" })).toEqual([]);
      expect(step({ step: dialled, destinationId: "tier2" })).toEqual([]);
    }
    expect(step({ step: "transferred", dialId: "" })).toEqual(["task.interactionHistory.dialId"]);
    expect(step({ step: "transferred", destinationId: "" })).toEqual(["task.interactionHistory.destinationId"]);
    expect(step({ step: "held", seconds: 12, dialId: "dial-7f2" })).toEqual(["task.interactionHistory.dialId.unexpected"]);
    expect(step({ step: "answered", destinationId: "tier2" })).toEqual(["task.interactionHistory.destinationId.unexpected"]);
  });
});

describe("consulting a lead", () => {
  const voice = { channel: "voice" };
  it("is its own voice capability", () => {
    expect(rules(validateTask(task({ capabilities: { leadAssist: true } }), voice))).toEqual([]);
    expect(rules(validateTask(task({ capabilities: { leadAssist: false } }), voice))).toContain("task.capability.value");
    for (const channel of ["chat", "email"]) {
      expect(rules(validateTask(task({ channel, capabilities: { leadAssist: true } }), { channel }))).toContain("task.capability.channel");
    }
  });

  it("carries the request on the agent's task: requested names nobody, joined names the lead", () => {
    const since = "2026-08-21T09:04:00Z";
    expect(rules(validateTask(task({ leadAssist: { stage: "requested", note: "Refund dispute", since } }), voice))).toEqual([]);
    expect(rules(validateTask(task({ leadAssist: { stage: "joined", leadId: "L-9", since } }), voice))).toEqual([]);
    expect(rules(validateTask(task({ leadAssist: { stage: "joined", since } }), voice))).toContain("task.leadAssist.leadId");
    expect(rules(validateTask(task({ leadAssist: { stage: "requested", leadId: "L-9", since } }), voice))).toContain("task.leadAssist.leadId.unexpected");
    expect(rules(validateTask(task({ leadAssist: { stage: "declined", since } }), voice))).toContain("task.leadAssist.stage");
    expect(rules(validateTask(task({ leadAssist: { stage: "requested" } }), voice))).toContain("task.leadAssist.since");
    expect(rules(validateTask(task({ channel: "chat", capabilities: {}, leadAssist: { stage: "requested", since } }), { channel: "chat" })))
      .toContain("task.leadAssist.channel");
  });

  it("carries the joined call on the lead's task", () => {
    const since = "2026-08-21T09:05:00Z";
    expect(rules(validateTask(task({ assisting: { memberId: "A-1", note: "Refund dispute", since } }), voice))).toEqual([]);
    expect(rules(validateTask(task({ assisting: { note: "Refund dispute", since } }), voice))).toContain("task.assisting.memberId");
    expect(rules(validateTask(task({ assisting: { memberId: "A-1" } }), voice))).toContain("task.assisting.since");
    expect(rules(validateTask(task({ channel: "email", capabilities: {}, assisting: { memberId: "A-1", since } }), { channel: "email" })))
      .toContain("task.assisting.channel");
  });

  it("puts requests on the team member list only where the login may act on them", () => {
    const request = { id: "req-7", memberId: "A-1", taskId: "call-42", allocationId: "alloc-42", note: "Refund dispute", since: "2026-08-21T09:04:00Z" };
    const members = [{ id: "A-1", availability: "on-task" }];
    const may = { capabilities: { team: { leadAssistControl: true as const } } };
    const mayNot = { capabilities: { team: {} } };
    expect(rules(validateTeamMembers({ members, requests: [request] }, "team", may))).toEqual([]);
    expect(rules(validateTeamMembers({ members, requests: [] }, "team", may))).toEqual([]);
    expect(rules(validateTeamMembers({ members, requests: [request] }, "team", mayNot))).toContain("team.requests.capability");
    // And the other way: a login that may be asked always carries the list, `[]` included.
    expect(rules(validateTeamMembers({ members }, "team", may))).toEqual(["team.requests.required"]);
    expect(rules(validateTeamMembers({ members }, "team", mayNot))).toEqual([]);
    // The permission is on the login, so without the login in hand neither rule is checked.
    expect(rules(validateTeamMembers({ members, requests: [request] }))).toEqual([]);
    expect(rules(validateTeamMembers({ members }))).toEqual([]);
    // Through the snapshot, the path adapters actually take.
    expect(rules(validateSnapshot(snapshot({ team: { members, requests: [request] } }), manifest(), "snapshot", mayNot))).toEqual(["team.requests.capability"]);
    expect(rules(validateSnapshot(snapshot({ team: { members, requests: [request] } }), manifest(), "snapshot", may))).toEqual([]);
    expect(rules(validateTeamMembers({ members, requests: [request, request] }, "team", may))).toContain("team.request.unique");
    expect(rules(validateTeamMembers({ members, requests: [{ ...request, taskId: "" }] }, "team", may))).toContain("team.request.taskId");
    expect(rules(validateTeamMembers({ members, requests: [{ ...request, since: "now" }] }, "team", may))).toContain("team.request.since");
  });

  it("accepts the left outcome, and still refuses one the contract lacks", () => {
    const ended = (outcome: unknown) => envelope({ type: "task-ended", taskId: "call-42", allocationId: "alloc-42", outcome });
    expect(rules(validateEventEnvelope(ended({ type: "left" }), manifest()))).toEqual([]);
    expect(rules(validateEventEnvelope(ended({ type: "vanished" }), manifest()))).toContain("event.taskEnded.outcome.type");
  });
});

describe("validateTaskCommand", () => {
  const voice = task({ capabilities: { hold: true, endCall: true, recording: { provider: { start: true } }, conference: { destinations: [{ id: "tier2", label: "Tier 2" }] }, warmTransfer: { destinations: [{ id: "tier2", label: "Tier 2" }] } } });
  const since = "2026-08-21T09:05:00Z";
  const cmd = (command: unknown, on: unknown = voice) => rules(validateTaskCommand(command, on));

  it("checks a command's own shape with or without a task", () => {
    expect(rules(validateTaskCommand({ type: "hold" }))).toEqual([]);
    expect(rules(validateTaskCommand("hold"))).toEqual(["command.shape"]);
    expect(rules(validateTaskCommand({ type: "hang-up" }))).toEqual(["command.type"]);
    expect(rules(validateTaskCommand({ type: "custom", name: "request-supervisor" }))).toEqual([]);
    expect(rules(validateTaskCommand({ type: "custom", name: "" }))).toEqual(["command.custom.name"]);
    // The microphone is the host's: there is no mute command for a provider, on any channel.
    expect(rules(validateTaskCommand({ type: "mute", muted: true }))).toEqual(["command.type"]);
    expect(rules(validateTaskCommand({ type: "mute", muted: true }, voice))).toEqual(["command.type"]);
    expect(rules(validateTaskCommand({ type: "call", dialId: "dial-1" }))).toEqual([]);
    expect(rules(validateTaskCommand({ type: "call" }))).toEqual(["command.call.dialId"]);
    expect(rules(validateTaskCommand({ type: "connect-back" }))).toEqual(["command.connectBack.dialId"]);
    expect(rules(validateTaskCommand({ type: "transfer", action: "cold", dialId: "dial-2", destinationId: "tier2" }))).toEqual([]);
    expect(rules(validateTaskCommand({ type: "transfer", action: "blind", dialId: "dial-2", destinationId: "tier2" }))).toContain("command.transfer.action");
    expect(rules(validateTaskCommand({ type: "transfer", action: "warm", destinationId: "tier2" }))).toEqual(["command.transfer.dialId"]);
    expect(rules(validateTaskCommand({ type: "transfer", action: "warm", dialId: "dial-2" }))).toEqual(["command.transfer.destinationId"]);
    expect(rules(validateTaskCommand({ type: "transfer", action: "complete", destinationId: "tier2" }))).toEqual(["command.field", "command.transfer.unexpected"]);
    expect(rules(validateTaskCommand({ type: "conference", action: "add", dialId: "dial-4", destinationId: "tier2" }))).toEqual([]);
    expect(rules(validateTaskCommand({ type: "conference", action: "add", destinationId: "tier2" }))).toEqual(["command.conference.dialId"]);
    expect(rules(validateTaskCommand({ type: "conference", action: "remove", party: true }))).toEqual([]);
    expect(rules(validateTaskCommand({ type: "conference", action: "remove", destinationId: "tier2" }))).toEqual([]);
    expect(rules(validateTaskCommand({ type: "conference", action: "remove" }))).toEqual(["command.conference.remove.target"]);
    expect(rules(validateTaskCommand({ type: "conference", action: "remove", party: true, destinationId: "tier2" }))).toEqual(["command.conference.remove.target"]);
    expect(rules(validateTaskCommand({ type: "recording", source: "provider", requestId: "q", observationId: "o", recordingId: "r", action: "rewind" }))).toEqual(["recording.command.action"]);
    expect(rules(validateTaskCommand({ type: "lead-assist", action: "join" }))).toEqual(["command.leadAssist.action"]);
    expect(rules(validateTaskCommand({ type: "complete", outcome: "" }))).toEqual(["command.complete.outcome"]);
  });

  it("holds a command only to a task the wire published, and names a mapped one", () => {
    // A host that kept only its own mapping of the task has nothing honest to pass: the validator
    // says so rather than check the command against a task nobody has.
    expect(cmd({ type: "hold" }, { id: "call-42", phase: "in-progress", hasHold: true })).toEqual(["command.task"]);
    expect(cmd({ type: "hold" }, { ...voice, capabilities: { hold: "yes" } })).toEqual(["command.task"]);
    // The control: the published task is checked as before.
    expect(cmd({ type: "hold" })).toEqual([]);
    expect(cmd({ type: "hold" }, task({ capabilities: {} }))).toEqual(["command.capability.hold"]);
  });

  it("holds complete to the outcomes the task published, both ways", () => {
    const wrapping = (outcomes: unknown) => task({ phase: "completing", capabilities: outcomes === undefined ? {} : { outcomes } });
    const codes = { codes: [{ id: "resolved", label: "Resolved" }, { id: "callback", label: "Callback" }] };
    expect(cmd({ type: "complete", outcome: "resolved" }, wrapping(codes))).toEqual([]);
    expect(cmd({ type: "complete", outcome: "escalated" }, wrapping(codes))).toEqual(["command.complete.outcome.unknown"]);
    expect(cmd({ type: "complete" }, wrapping({ ...codes, required: true }))).toEqual(["command.complete.outcome.required"]);
    expect(cmd({ type: "complete", outcome: "resolved" }, wrapping({ ...codes, required: true }))).toEqual([]);
    expect(cmd({ type: "complete", outcome: "resolved", notes: "Called back" }, wrapping({ ...codes, notes: "optional" }))).toEqual([]);
    expect(cmd({ type: "complete", outcome: "resolved", notes: "Called back" }, wrapping({ ...codes, notes: "none" }))).toEqual(["command.complete.notes.unexpected"]);
    expect(cmd({ type: "complete", outcome: "resolved" }, wrapping({ ...codes, notes: "required" }))).toEqual(["command.complete.notes.required"]);
    // A bare control publishes no code to choose, so complete carries none.
    expect(cmd({ type: "complete" }, wrapping(undefined))).toEqual([]);
    expect(cmd({ type: "complete", outcome: "resolved" }, wrapping(undefined))).toEqual(["command.complete.outcome.unexpected"]);
    expect(cmd({ type: "complete" }, wrapping(true))).toEqual([]);
    expect(cmd({ type: "complete", outcome: "whatever the agent typed" }, wrapping(true))).toEqual(["command.complete.outcome.unexpected"]);
  });

  it("holds a custom command to a control the task published, with what the control asked for", () => {
    const control = { id: "request-supervisor", ui: { control: "button", label: "Request supervisor", placement: "secondary", render: "inline" } };
    const asking = { ...control, id: "escalate", prompt: { fields: [{ name: "reason", label: "Reason", type: "text", required: true }] } };
    const withControls = task({ capabilities: { custom: [control, asking] } });
    expect(cmd({ type: "custom", name: "request-supervisor" }, withControls)).toEqual([]);
    expect(cmd({ type: "custom", name: "escalate", reason: "Billing dispute" }, withControls)).toEqual([]);
    expect(cmd({ type: "custom", name: "escalate" }, withControls)).toEqual(["command.custom.prompt"]);
    expect(cmd({ type: "custom", name: "refund" }, withControls)).toEqual(["command.capability.custom"]);
    expect(cmd({ type: "custom", name: "request-supervisor" }, task({ capabilities: {} }))).toEqual(["command.capability.custom"]);
    // Without a task only the shape is checked, as for every command.
    expect(rules(validateTaskCommand({ type: "custom", name: "refund" }))).toEqual([]);
  });

  it("checks the published task before permitting a custom control", () => {
    const custom = [{ id: "flag", ui: { control: "button", label: "Flag", placement: "primary", render: "inline" } }];
    const published = task({ capabilities: { custom } });
    expect(cmd({ type: "custom", name: "flag" }, published)).toEqual([]);
    expect(cmd({ type: "custom", name: "flag" }, { capabilities: { custom } })).toEqual(["command.task"]);
    expect(rules(validateTaskCommand({ type: "custom", name: "flag" }, null))).toEqual(["command.task"]);
    expect(rules(validateTaskCommand({ type: "hold" }, null))).toEqual(["command.task"]);
  });

  it("requires a custom toggle's target state and only requires declared mandatory fields", () => {
    const control = { id: "flag", ui: { control: "toggle", label: "Flag", placement: "primary", render: "inline" },
      prompt: { fields: [{ name: "note", label: "Note", type: "text", required: false }] } };
    const published = task({ capabilities: { custom: [control] } });
    for (const on of [true, false]) {
      expect(cmd({ type: "custom", name: "flag", on }, published)).toEqual([]);
      expect(cmd({ type: "custom", name: "flag", on, note: "" }, published)).toEqual([]);
      expect(cmd({ type: "custom", name: "flag", on, note: "For review" }, published)).toEqual([]);
    }
    for (const on of [undefined, null, "yes", 1]) {
      expect(cmd({ type: "custom", name: "flag", on }, published)).toEqual(["command.custom.on"]);
    }
    expect(cmd({ type: "custom", name: "flag", on: true, note: 1 }, published)).toEqual(["command.custom.prompt"]);
    const optional = task({ capabilities: { custom: [{ ...control, prompt: { fields: [{ name: "note", label: "Note", type: "text" }] } }] } });
    expect(cmd({ type: "custom", name: "flag", on: true }, optional)).toEqual([]);
  });

  it("holds a destination to the directory the task offered", () => {
    expect(cmd({ type: "transfer", action: "warm", dialId: "dial-2", destinationId: "tier2" })).toEqual([]);
    expect(cmd({ type: "transfer", action: "warm", dialId: "dial-2", destinationId: "tier9" })).toEqual(["command.destination.unknown"]);
    expect(cmd({ type: "conference", action: "add", dialId: "dial-4", destinationId: "tier2" })).toEqual([]);
    expect(cmd({ type: "conference", action: "add", dialId: "dial-4", destinationId: "tier9" })).toEqual(["command.destination.unknown"]);
    const cold = task({ capabilities: { coldTransfer: { destinations: [{ id: "billing", label: "Billing" }] } } });
    expect(cmd({ type: "transfer", action: "cold", dialId: "dial-2", destinationId: "billing" }, cold)).toEqual([]);
    expect(cmd({ type: "transfer", action: "cold", dialId: "dial-2", destinationId: "tier2" }, cold)).toEqual(["command.destination.unknown"]);
  });

  it("holds a control on the contact to a contact being handled: in-progress or paused", () => {
    // Every control that acts on the call or the conversation, on a task that offers it, in every phase.
    const consulting = { onCall: [{ role: "party", since }, { role: "consulted", destinationId: "tier2", stage: "joined", since }] };
    const controls: [unknown, Record<string, unknown>][] = [
      [{ type: "hold" }, {}],
      [{ type: "resume" }, {}],
      [{ type: "end-call" }, {}],
      [{ type: "transfer", action: "warm", dialId: "dial-2", destinationId: "tier2" }, {}],
      [{ type: "transfer", action: "cold", dialId: "dial-2", destinationId: "tier2" }, { capabilities: { coldTransfer: { destinations: [{ id: "tier2", label: "Tier 2" }] } } }],
      [{ type: "transfer", action: "complete" }, consulting],
      [{ type: "transfer", action: "cancel" }, consulting],
      [{ type: "conference", action: "add", dialId: "dial-4", destinationId: "tier2" }, {}],
      [{ type: "conference", action: "remove", party: true }, { onCall: [{ role: "party", since }, { role: "conferenced", destinationId: "tier2", stage: "joined", since }] }],
      [{ type: "lead-assist", action: "request", note: "Angry customer" }, { capabilities: { leadAssist: true } }],
      [{ type: "lead-assist", action: "cancel" }, { capabilities: { leadAssist: true }, leadAssist: { stage: "requested", since } }],
      [{ type: "lead-assist", action: "take-over" }, { assisting: { memberId: "a-17", note: "Angry customer", since } }],
      [{ type: "lead-assist", action: "leave" }, { assisting: { memberId: "a-17", note: "Angry customer", since } }],
    ];
    for (const [command, state] of controls) {
      // A lead's join is the lead's own doing, and pending says so.
      const on = (phase: string) => task({ ...voice, ...state, phase, ...(phase === "completing" ? { onCall: [] } : {}), ...(phase === "pending" && state.assisting !== undefined ? { acceptance: "automatic" } : {}) });
      expect(cmd(command, on("in-progress")), `${JSON.stringify(command)} in-progress`).toEqual([]);
      expect(cmd(command, on("paused")), `${JSON.stringify(command)} paused`).toEqual([]);
      // Once the call is over, what a warm step put on it is gone too: the phase names the gap first.
      for (const phase of ["pending", "confirmed", "preview", "completing"]) {
        expect(cmd(command, on(phase)), `${JSON.stringify(command)} ${phase}`).toContain("command.phase.interaction");
      }
    }
    // A wrap-up that still offers a transfer offers it for nothing: the capability stands, the phase refuses.
    expect(cmd({ type: "transfer", action: "warm", dialId: "dial-2", destinationId: "tier2" }, task({ ...voice, phase: "completing" }))).toEqual(["command.phase.interaction"]);
    // The same word on a conversation: a paused chat resumes, a completing one has nothing to pause.
    const chat = (phase: string) => task({ channel: "chat", capabilities: { hold: true }, phase });
    expect(cmd({ type: "pause" }, chat("in-progress"))).toEqual([]);
    expect(cmd({ type: "resume" }, chat("paused"))).toEqual([]);
    expect(cmd({ type: "pause" }, chat("completing"))).toEqual(["command.phase.interaction"]);
    expect(cmd({ type: "pause" }, chat("pending"))).toEqual(["command.phase.interaction"]);
    // The phases with their own commands are untouched by it.
    expect(cmd({ type: "answer" }, task({ phase: "pending" }))).toEqual([]);
    expect(cmd({ type: "connect-back", dialId: "dial-1" }, task({ phase: "completing", capabilities: { connectBack: true } }))).toEqual([]);
    expect(cmd({ type: "complete", outcome: "resolved" }, task({ phase: "completing", capabilities: { outcomes: { codes: [{ id: "resolved", label: "Resolved" }] } } }))).toEqual([]);
  });

  it("holds a command to the task's channel, capabilities, phase and state", () => {
    expect(cmd({ type: "end-call" })).toEqual([]);
    expect(cmd({ type: "end-call" }, task({ capabilities: { hold: true } }))).toEqual(["command.capability.endCall"]);
    expect(cmd({ type: "end-call" }, task({ capabilities: { endCall: { lockedBy: "team" } } }))).toEqual(["command.capability.locked"]);
    expect(cmd({ type: "end-call" }, task({ channel: "chat", capabilities: {} }))).toEqual(["command.type"]);
    expect(cmd({ type: "pause" }, task({ channel: "chat", capabilities: { hold: true } }))).toEqual([]);
    expect(cmd({ type: "answer" }, task({ phase: "pending" }))).toEqual([]);
    expect(cmd({ type: "answer" })).toEqual(["command.phase.pending"]);
    expect(cmd({ type: "call", dialId: "dial-1" }, task({ phase: "preview", capabilities: {} }))).toEqual([]);
    expect(cmd({ type: "call", dialId: "dial-1" })).toEqual(["command.phase.preview"]);
    expect(cmd({ type: "connect-back", dialId: "dial-1" }, task({ phase: "completing", capabilities: { connectBack: true } }))).toEqual([]);
    expect(cmd({ type: "connect-back", dialId: "dial-1" }, task({ phase: "completing", capabilities: {} }))).toEqual(["command.capability.connectBack"]);
    expect(cmd({ type: "connect-back", dialId: "dial-1" }, task({ capabilities: { connectBack: true } }))).toEqual(["command.phase.completing"]);
    // A warm transfer's finishing steps need the consulted entry the warm step put on the call.
    const consulting = task({ capabilities: {}, onCall: [{ role: "party", since }, { role: "consulted", destinationId: "tier2", stage: "joined", since }] });
    expect(cmd({ type: "transfer", action: "complete" }, consulting)).toEqual([]);
    expect(cmd({ type: "transfer", action: "cancel" }, task({ capabilities: {} }))).toEqual(["command.transfer.consulted"]);
    expect(cmd({ type: "transfer", action: "warm", dialId: "dial-2", destinationId: "tier2" })).toEqual([]);
    expect(cmd({ type: "transfer", action: "cold", dialId: "dial-2", destinationId: "tier2" })).toEqual(["command.capability.coldTransfer"]);
    // Lead assist: the agent's asks need the capability, the lead's acts need the joined call.
    expect(cmd({ type: "lead-assist", action: "request", note: "Refund" }, task({ capabilities: { leadAssist: true } }))).toEqual([]);
    expect(cmd({ type: "lead-assist", action: "cancel" }, task({ capabilities: { leadAssist: true } }))).toEqual(["command.leadAssist.requested"]);
    expect(cmd({ type: "lead-assist", action: "cancel" }, task({ capabilities: { leadAssist: true }, leadAssist: { stage: "requested", since } }))).toEqual([]);
    expect(cmd({ type: "lead-assist", action: "leave" }, task({ capabilities: {} }))).toEqual(["command.leadAssist.assisting"]);
    expect(cmd({ type: "lead-assist", action: "take-over" }, task({ capabilities: {}, assisting: { memberId: "A-1", since } }))).toEqual([]);
    expect(cmd({ type: "complete" })).toEqual([]);
    expect(cmd({ type: "complete" }, task({ completionMode: "provider-automatic", wrapAllowance: 10 }))).toEqual(["command.complete.mode"]);
  });

  it("lets a remove take one person off a call with somebody else still on it, never the last", () => {
    const party = { role: "party", since };
    const colleague = { role: "conferenced", destinationId: "tier2", stage: "joined", since };
    const agent = { role: "agent", userId: "A-1", since };
    const room = (...entries: unknown[]) => ({ ...voice, onCall: entries });
    expect(cmd({ type: "conference", action: "remove", party: true }, room(party, agent, colleague))).toEqual([]);
    expect(cmd({ type: "conference", action: "remove", destinationId: "tier2" }, room(party, agent, colleague))).toEqual([]);
    // The agent would be alone: that is end-call.
    expect(cmd({ type: "conference", action: "remove", party: true }, room(party, agent))).toEqual(["command.conference.remove.alone"]);
    expect(cmd({ type: "conference", action: "remove", destinationId: "tier2" }, room(agent, colleague))).toEqual(["command.conference.remove.alone"]);
    expect(cmd({ type: "conference", action: "remove", destinationId: "tier9" }, room(party, agent, colleague))).toEqual(["command.conference.remove.unknown"]);
    expect(cmd({ type: "conference", action: "remove", party: true }, { ...task({ capabilities: {} }), onCall: [party, agent, colleague] })).toEqual(["command.capability.conference"]);
  });
});

describe("an authentication refusal", () => {
  const refusal = { code: "omni.phone-not-permitted", message: "This agent is configured for a desk phone", retryable: false };
  it("validates the challenge a host must render", () => {
    const field = { name: "username", label: "Username", type: "text", required: true, autocomplete: "username" };
    const credentials = { flowId: "flow-1", method: "credentials", fields: [field] };
    const sso = { flowId: "flow-2", method: "browser-sso", authorizationUrl: "https://identity.example.com/authorize", browser: "system" };
    const check = (challenge: unknown) => rules(validateAuthenticationResult({ status: "interaction-required", challenge }, "start"));
    expect(check(credentials)).toEqual([]);
    expect(check(sso)).toEqual([]);
    expect(check({ ...sso, browser: "omni" })).toEqual([]);
    expect(check({ ...credentials, fields: [] })).toEqual([]);
    expect(check({})).toEqual(["authentication.challenge.flowId", "authentication.challenge.method"]);
    expect(check({ ...credentials, flowId: " " })).toEqual(["authentication.challenge.flowId"]);
    expect(check({ ...credentials, fields: null })).toEqual(["authentication.challenge.fields"]);
    expect(check({ ...credentials, fields: [null] })).toEqual(["authentication.challenge.field.shape"]);
    for (const [key, value] of [["name", ""], ["label", ""], ["type", "number"], ["required", "yes"], ["autocomplete", 1]] as const) {
      expect(check({ ...credentials, fields: [{ ...field, [key]: value }] })).toEqual([`authentication.challenge.field.${key}`]);
    }
    expect(check({ ...credentials, fields: [field, field] })).toEqual(["authentication.challenge.field.unique"]);
    expect(check({ ...sso, authorizationUrl: "" })).toEqual(["authentication.challenge.authorizationUrl"]);
    expect(check({ ...sso, browser: "external" })).toEqual(["authentication.challenge.browser"]);
    expect(rules(validateAuthenticationResult({ status: "interaction-required", challenge: credentials, failure: refusal }, "start"))).toEqual(["authentication.failure.unexpected"]);
    expect(rules(validateAuthenticationResult({ status: "rejected", failure: refusal, challenge: credentials }, "start"))).toEqual(["authentication.challenge.unexpected"]);
    const violations = validateAuthenticationResult({ status: "interaction-required", challenge: { ...credentials, fields: [{ ...field, type: false }] } }, "start", "login.start");
    expect(violations[0]?.path).toBe("login.start.challenge.fields[0].type");
  });
  it("requires a finite non-negative retry delay", () => {
    for (const retryAfterMs of [0, 30000]) {
      expect(rules(validateAuthenticationFailure({ ...refusal, retryAfterMs }))).toEqual([]);
    }
    for (const retryAfterMs of [Infinity, -Infinity, NaN, -1, "500", null]) {
      expect(rules(validateAuthenticationFailure({ ...refusal, retryAfterMs }))).toEqual(["authentication.failure.retryAfterMs"]);
    }
  });
  it("names the phone the platform does not permit with the contract's code, never retryable", () => {
    expect(rules(validateAuthenticationFailure(refusal))).toEqual([]);
    expect(rules(validateAuthenticationFailure({ ...refusal, retryable: true }))).toEqual(["authentication.failure.phone.retryable"]);
    // The omni namespace is the contract's: an invented code there is refused, a provider's own is not.
    expect(rules(validateAuthenticationFailure({ ...refusal, code: "omni.station-mismatch" }))).toEqual(["failure.code.unknown"]);
    expect(rules(validateAuthenticationFailure({ code: "acme.locked-out", message: "Locked", retryable: true, retryAfterMs: 30000 }))).toEqual([]);
    expect(rules(validateAuthenticationFailure({ code: "acme.locked-out", message: "Locked", retryable: true, retryAfterMs: -1 }))).toEqual(["authentication.failure.retryAfterMs"]);
    expect(rules(validateAuthenticationFailure({ code: "", message: "Locked", retryable: true }))).toEqual(["authentication.failure.code"]);
    expect(rules(validateAuthenticationFailure("locked"))).toEqual(["authentication.failure.shape"]);
  });

  it("holds start and complete to their answers", () => {
    expect(rules(validateAuthenticationResult({ status: "rejected", failure: refusal }, "start"))).toEqual([]);
    expect(rules(validateAuthenticationResult({ status: "rejected", failure: refusal }, "complete"))).toEqual([]);
    expect(rules(validateAuthenticationResult({ status: "rejected", failure: { ...refusal, retryable: true } }, "start"))).toEqual(["authentication.failure.phone.retryable"]);
    expect(rules(validateAuthenticationResult({ status: "interaction-required", challenge: { flowId: "f1", method: "credentials", fields: [] } }, "start"))).toEqual([]);
    expect(rules(validateAuthenticationResult({ status: "interaction-required" }, "start"))).toEqual(["authentication.result.challenge"]);
    expect(rules(validateAuthenticationResult({ status: "authenticated", identity: { id: "1042", displayName: "Asha Rao", timeZone: "Asia/Kolkata" }, capabilities: {} }, "complete"))).toEqual([]);
    expect(rules(validateAuthenticationResult({ status: "authenticated", identity: { id: "1042", displayName: "Asha Rao" }, capabilities: {} }, "complete"))).toEqual(["authentication.identity.timeZone"]);
    expect(rules(validateAuthenticationResult({ status: "authenticated", identity: { id: "1042", displayName: "Asha Rao", timeZone: "Asia/Kolkata" }, capabilities: {} }, "start"))).toEqual(["authentication.result.status"]);
    expect(rules(validateAuthenticationResult("ok", "start"))).toEqual(["authentication.result.shape"]);
  });
});

describe("how the agent hears the call", () => {
  it("has a voice manifest list its phones, and no other channel list any", () => {
    const m = (over: Record<string, unknown>) => rules(validateManifest(manifest(over)));
    expect(m({ phones: ["softphone"] })).toEqual([]);
    expect(m({ phones: ["deskPhone"] })).toEqual([]);
    expect(m({ phones: ["softphone", "deskPhone"] })).toEqual([]);
    expect(m({ phones: undefined })).toEqual(["manifest.phones.required"]);
    expect(m({ phones: [] })).toEqual(["manifest.phones.required"]);
    expect(m({ phones: ["handset"] })).toEqual(["manifest.phone"]);
    expect(m({ phones: ["softphone", "softphone"] })).toEqual(["manifest.phone.unique"]);
    expect(m({ channel: "chat", phones: ["softphone"] })).toEqual(["manifest.phones.channel"]);
    expect(m({ channel: "chat" })).toEqual([]);
  });

  it("holds the host's choice of phone to the manifest", () => {
    const voice = manifest({ phones: ["softphone"] });
    expect(rules(validatePhone("softphone", voice))).toEqual([]);
    expect(rules(validatePhone("deskPhone", voice))).toEqual(["context.phone.unsupported"]);
    expect(rules(validatePhone("deskPhone", manifest({ phones: ["softphone", "deskPhone"] })))).toEqual([]);
    expect(rules(validatePhone("handset", voice))).toEqual(["context.phone"]);
    expect(rules(validatePhone(undefined, voice))).toEqual(["context.phone.required"]);
    expect(rules(validatePhone("softphone", manifest({ channel: "chat" })))).toEqual(["context.phone.unexpected"]);
    expect(rules(validatePhone(undefined, manifest({ channel: "chat" })))).toEqual([]);
  });
});

describe("the agent's day", () => {
  const user = { id: "1042", displayName: "Asha Rao", timeZone: "Asia/Kolkata" };
  const identity = (timeZone: unknown) =>
    rules(validateAuthenticationState({ status: "authenticated", identity: { ...user, timeZone }, capabilities: {}, expiresAt: "2026-08-21T12:00:00Z" }));

  it("carries an IANA zone on every identity, never absent", () => {
    expect(identity("Asia/Kolkata")).toEqual([]);
    expect(identity("America/Chicago")).toEqual([]);
    expect(identity(undefined)).toEqual(["authentication.identity.timeZone"]);
    // An offset cannot survive a daylight-saving boundary, and a made-up name is nowhere.
    expect(identity("+05:30")).toEqual(["authentication.identity.timeZone"]);
    expect(identity("Mars/Olympus")).toEqual(["authentication.identity.timeZone"]);
    expect(identity("")).toEqual(["authentication.identity.timeZone"]);
  });

  it("holds the host's connect-time zone to the same rule, and requires one", () => {
    expect(rules(validateTimeZone("Europe/London"))).toEqual([]);
    expect(rules(validateTimeZone(undefined))).toEqual(["context.timeZone"]);
    expect(rules(validateTimeZone("UTC+1"))).toEqual(["context.timeZone"]);
    expect(isTimeZone("Asia/Kolkata")).toBe(true);
    expect(isTimeZone("Asia/Nowhere")).toBe(false);
    // One zone under two names is one zone; two zones are two, whatever their offsets.
    expect(sameTimeZone("Asia/Kolkata", "Asia/Calcutta")).toBe(true);
    expect(sameTimeZone("Europe/Berlin", "Europe/Paris")).toBe(false);
    expect(sameTimeZone("Asia/Kolkata", undefined)).toBe(false);
  });
});

describe("preview: the agent presses Call", () => {
  const voice = { channel: "voice" };
  const at = "2026-08-21T09:02:00Z";
  const preview = (over: Record<string, unknown> = {}) => task({ capabilities: {}, phase: "preview", ...over });

  it("is a voice phase, and a dial the manifest must have an outcome for", () => {
    expect(rules(validateTask(preview(), voice))).toEqual([]);
    for (const channel of ["chat", "email"]) {
      expect(rules(validateTask(preview({ channel }), { channel }))).toEqual(["task.phase.channel"]);
    }
    const dialling = manifest({ dialOutcomes: ["answered", "no-answer"] });
    expect(rules(validateSnapshot(snapshot({ tasks: [preview()] }), dialling))).toEqual([]);
    expect(rules(validateSnapshot(snapshot({ tasks: [preview()] }), manifest()))).toEqual(["task.preview.dialOutcomes.required"]);
    // The control: the same manifest carries a confirmed task without complaint.
    expect(rules(validateSnapshot(snapshot({ tasks: [task({ capabilities: {}, phase: "confirmed" })] }), manifest()))).toEqual([]);
  });

  it("carries the deadline and what happens at it together, and only while previewing", () => {
    expect(rules(validateTask(preview({ previewEndsAt: at, atDeadline: "calls" }), voice))).toEqual([]);
    expect(rules(validateTask(preview({ previewEndsAt: at, atDeadline: "waits" }), voice))).toEqual([]);
    expect(rules(validateTask(preview({ previewEndsAt: at }), voice))).toEqual(["task.preview.atDeadline.required"]);
    expect(rules(validateTask(preview({ atDeadline: "calls" }), voice))).toEqual(["task.preview.previewEndsAt.required"]);
    expect(rules(validateTask(preview({ previewEndsAt: "soon", atDeadline: "calls" }), voice))).toEqual(["task.preview.previewEndsAt"]);
    expect(rules(validateTask(preview({ previewEndsAt: at, atDeadline: "dials" }), voice))).toEqual(["task.preview.atDeadline"]);
    expect(rules(validateTask(task({ phase: "in-progress", previewEndsAt: at, atDeadline: "calls" }), voice))).toEqual(["task.preview.deadline.unexpected"]);
    // No deadline at all: the agent has as long as they need.
    expect(rules(validateTask(preview(), voice))).toEqual([]);
  });
});

describe("listening a call", () => {
  const voice = { channel: "voice" };
  const since = "2026-08-21T09:04:00Z";
  const user = { id: "L-9", displayName: "Lead", timeZone: "Asia/Kolkata" };
  const login = (team: Record<string, unknown>) =>
    rules(validateAuthenticationState({ status: "authenticated", identity: user, capabilities: { team }, expiresAt: "2026-08-21T12:00:00Z" }));

  it("lists the modes a lead may listen in, and always listen among them", () => {
    expect(login({ listeningControl: ["listen"] })).toEqual([]);
    expect(login({ listeningControl: ["listen", "coach", "join-call"] })).toEqual([]);
    expect(login({ listeningControl: ["listen", "coach"] })).toEqual([]);
    expect(login({ listeningControl: true })).toEqual(["authentication.capability.team.listeningControl.shape"]);
    expect(login({ listeningControl: [] })).toEqual(["authentication.capability.team.listeningControl.shape"]);
    expect(login({ listeningControl: ["listen", "monitor"] })).toEqual(["authentication.capability.team.listeningControl.mode"]);
    expect(login({ listeningControl: ["listen", "coach", "coach"] })).toEqual(["authentication.capability.team.listeningControl.unique"]);
    // Coach and join-call begin from a listen.
    expect(login({ listeningControl: ["coach", "join-call"] })).toEqual(["authentication.capability.team.listeningControl.listen"]);
    // The control: the other team controls are still declared by presence.
    expect(login({ leadAssistControl: true })).toEqual([]);
    expect(login({ leadAssistControl: ["listen"] })).toEqual(["authentication.capability.value"]);
  });

  it("carries the listened call on the lead's own voice task, one at a time, and never beside a joined one", () => {
    const listening = { memberId: "A-1", taskId: "call-42", allocationId: "alloc-42", mode: "listen", since };
    const check = (over: Record<string, unknown>, context: { channel: string } = voice) => rules(validateTask(task({ capabilities: {}, ...over }), context));
    for (const mode of ["listen", "coach", "join-call"]) expect(check({ listening: { ...listening, mode } })).toEqual([]);
    expect(check({ listening: { ...listening, mode: "monitor" } })).toEqual(["task.listening.mode"]);
    expect(check({ listening: { ...listening, memberId: "" } })).toEqual(["task.listening.memberId"]);
    expect(check({ listening: { ...listening, taskId: "" } })).toEqual(["task.listening.taskId"]);
    expect(check({ listening: { ...listening, since: "now" } })).toEqual(["task.listening.since"]);
    expect(check({ listening: "A-1" })).toEqual(["task.listening.shape"]);
    expect(check({ channel: "chat", listening }, { channel: "chat" })).toEqual(["task.listening.channel"]);
    expect(check({ listening, assisting: { memberId: "A-1", since } })).toEqual(["task.listening.assisting"]);
    expect(check({ assisting: { memberId: "A-1", since } })).toEqual([]);
    const listeningTask = (id: string) => task({ id, capabilities: {}, listening });
    expect(rules(validateSnapshot(snapshot({ tasks: [listeningTask("m-1")] }), manifest()))).toEqual([]);
    // Two listened calls break two rules: one at a time, and a lead's only task.
    expect(rules(validateSnapshot(snapshot({ tasks: [listeningTask("m-1"), listeningTask("m-2")] }), manifest()))).toEqual(["snapshot.listening.single", "snapshot.listening.alone", "snapshot.listening.alone"]);
  });

  it("lets a lead listen only with no task of their own, and on a working break, never a rest", () => {
    const listening = { memberId: "A-1", taskId: "call-42", allocationId: "alloc-42", mode: "listen", since };
    const listeningTask = task({ id: "m-1", capabilities: {}, listening });
    const own = task({ id: "call-7" });
    expect(rules(validateSnapshot(snapshot({ tasks: [listeningTask] }), manifest()))).toEqual([]);
    expect(rules(validateSnapshot(snapshot({ tasks: [listeningTask, own] }), manifest()))).toEqual(["snapshot.listening.alone"]);
    // The control: two tasks of the lead's own are ordinary.
    expect(rules(validateSnapshot(snapshot({ tasks: [own, task({ id: "call-8" })] }), manifest()))).toEqual([]);
    const onBreak = (kind: string | undefined, tasks: unknown[]) => rules(validateSnapshot(snapshot({
      break: { approval: "in-effect", mayAsk: true, reasons: [{ id: "b", label: "Break", ...(kind === undefined ? {} : { kind }) }], activeReasonId: "b" },
      tasks,
    }), manifest()));
    for (const kind of ["coaching", "administrative", "training"]) expect(onBreak(kind, [listeningTask])).toEqual([]);
    for (const kind of ["meal", "rest", "short-break", "personal", "other"]) expect(onBreak(kind, [listeningTask])).toEqual(["snapshot.listening.break"]);
    expect(onBreak(undefined, [listeningTask])).toEqual(["snapshot.listening.break"]);
    // The rule it is an exception to still holds for the lead's own work.
    expect(onBreak("coaching", [own])).toEqual(["break.in-effect.tasks"]);
    expect(onBreak("coaching", [])).toEqual([]);
  });

  it("rejects the retired mode in permissions and state, including mixed permission lists", () => {
    for (const listeningControl of [["listen", "barge"], ["listen", "join-call", "barge"]]) {
      expect(login({ listeningControl })).toContain("authentication.capability.team.listeningControl.mode");
    }
    expect(rules(validateTask(task({ capabilities: {}, listening: {
      memberId: "A-1", taskId: "call-42", allocationId: "alloc-42", mode: "barge", since,
    } }), voice))).toContain("task.listening.mode");
  });

  it("rejects the retired private-audio mode in permissions and published state", () => {
    for (const listeningControl of [["listen", "whisper"], ["listen", "coach", "whisper"]]) {
      expect(login({ listeningControl })).toContain("authentication.capability.team.listeningControl.mode");
    }
    expect(rules(validateTask(task({ capabilities: {}, listening: {
      memberId: "A-1", taskId: "call-42", allocationId: "alloc-42", mode: "whisper", since,
    } }), voice))).toContain("task.listening.mode");
  });

  it("rejects legacy listening fields and mixed payloads", () => {
    const current = { memberId: "A-1", taskId: "call-42", allocationId: "alloc-42", mode: "listen", since };
    for (const listening of [undefined, current]) {
      expect(rules(validateTask(task({ capabilities: {}, monitoring: current, listening }), voice)))
        .toContain("task.listening.renamed");
    }
    for (const listeningControl of [undefined, ["listen"]]) {
      expect(login({ monitorControl: ["monitor"], listeningControl }))
        .toContain("authentication.capability.team.unknown");
    }
  });

  it("answers the listen method as every team method answers", () => {
    const failure = { code: "omni.capability-not-enabled", message: "Join call is not this lead's", retryable: false };
    expect(rules(validateResult({ status: "applied" }, "executeTeamListen"))).toEqual([]);
    expect(rules(validateResult({ status: "failed", failure }, "executeTeamListen"))).toEqual([]);
    expect(rules(validateResult({ status: "listening" }, "executeTeamListen"))).toEqual(["result.status"]);
  });
});

describe("protocol-version interoperability", () => {
  it("is checked on the manifest, as the guide's validator table promises", () => {
    // An adapter that speaks only a version this package does not is one Omni must refuse...
    expect(rules(validateManifest(manifest({ supportedProtocolVersions: [99] })))).toContain("manifest.supportedProtocolVersions.interoperable");
    // ...and the controls: declaring this version among others is fine, and a list with a bad
    // entry beside a good one is reported for the entry, not for interoperability.
    expect(rules(validateManifest(manifest({ supportedProtocolVersions: [99, 1] })))).toEqual([]);
    expect(rules(validateManifest(manifest({ supportedProtocolVersions: [1, 1.5] })))).toEqual(["manifest.supportedProtocolVersions.value"]);
  });
});

describe("validateTask capabilitySource", () => {
  const voice = { channel: "voice" };
  const rules = (t: unknown) => validateTask(t, voice).map(v => v.rule);

  it("requires the task to say where its capabilities came from, and closes the set", () => {
    for (const source of ["queue", "ungoverned", "undetermined"]) expect(rules(task({ capabilitySource: source }))).toEqual([]);
    expect(rules(task({ capabilitySource: undefined }))).toEqual(["task.capabilitySource"]);
    expect(rules(task({ capabilitySource: "Unreadable" }))).toEqual(["task.capabilitySource"]);
  });

  it("holds undetermined terms to no shape of their own: what the provider will honour is what it publishes", () => {
    expect(rules(task({ capabilitySource: "undetermined", capabilities: {} }))).toEqual([]);
    expect(rules(task({ capabilitySource: "undetermined", capabilities: { hold: true, endCall: true } }))).toEqual([]);
    expect(rules(task({ capabilitySource: "queue", capabilities: {} }))).toEqual([]);
  });
});


describe("interaction API migration", () => {
  it("rejects former task history fields instead of silently ignoring their facts", () => {
    const history = { steps: [], interactionSeconds: 12 };
    expect(validateTask(task({ interactionHistory: history }), { channel: "voice" })).toEqual([]);
    for (const interactionHistory of [undefined, history]) {
      expect(rules(validateTask(task({ handlingHistory: history, interactionHistory }), { channel: "voice" })))
        .toContain("task.interactionHistory.renamed");
    }
    expect(rules(validateTask(task({ interactionHistory: { ...history, handleSeconds: 12 } }), { channel: "voice" })))
      .toContain("task.interactionHistory.interactionSeconds.renamed");
  });

  it("requires the new completion bound and rejects mixed old/new manifests", () => {
    expect(validateManifest(manifest())).toEqual([]);
    expect(rules(validateManifest(manifest({ completionSettleMs: undefined, disposalSettleMs: 5000 }))))
      .toContain("manifest.completionSettleMs");
    expect(rules(validateManifest(manifest({ disposalSettleMs: 5000 }))))
      .toContain("manifest.completionSettleMs.renamed");
  });
});


describe("outcome API migration", () => {
  it("rejects former capability and command fields across channels, including mixed names", () => {
    const outcomes = { required: true, codes: [{ id: "resolved", label: "Resolved" }] };
    for (const channel of ["voice", "chat", "email"] as const) {
      const current = task({ channel, phase: "completing", capabilities: { outcomes } });
      expect(validateTask(current, { channel })).toEqual([]);
      expect(validateTaskCommand({ type: "complete", outcome: "resolved" }, current)).toEqual([]);
      for (const capabilities of [{ dispositions: outcomes }, { dispositions: outcomes, outcomes }]) {
        expect(rules(validateTask(task({ channel, phase: "completing", capabilities }), { channel })))
          .toContain("task.capability.unknown");
      }
      for (const command of [{ type: "complete", disposition: "resolved" }, { type: "complete", disposition: "resolved", outcome: "resolved" }]) {
        expect(rules(validateTaskCommand(command, current))).toContain("command.field");
      }
    }
  });
});
