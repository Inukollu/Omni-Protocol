import { describe, expect, it } from "vitest";
import { BREAK_KINDS, BROWSER_ISOLATION_SCHEMES, IDLE_CAPABILITIES } from "./index.js";
import {
  assertNoViolations,
  ProtocolConformanceError,
  validateAuthenticationState,
  validateContact,
  validateEventEnvelope,
  validateManifest,
  validateScheduledActivity,
  validateSnapshot,
  validateTask,
  validateTeamRoster,
  type ProtocolViolation,
} from "./validation.js";

const rules = (violations: readonly ProtocolViolation[]) => violations.map(violation => violation.rule);

const manifest = (over: Record<string, unknown> = {}) => ({
  id: "acme-voice",
  displayName: "Acme Voice",
  channel: "voice",
  supportedProtocolVersions: [1],
  authenticationMethods: ["credentials"],
  ...over,
});

const task = (over: Record<string, unknown> = {}) => ({
  id: "call-42",
  title: "Customer call",
  channel: "voice",
  taskType: "Customer Support",
  capabilities: { browsers: true, hold: true },
  browsers: [{ id: "crm", name: "CRM", purpose: "Account", url: "https://crm.example.com", reuse: false }],
  phase: "in-progress",
  completionMode: "agent-command",
  completionAllowance: 15,
  ...over,
});

const snapshot = (over: Record<string, unknown> = {}) => ({
  status: "active",
  sessionId: "session-1",
  sessionCapabilities: { breaks: true },
  break: { approval: "not-requested", accepting: true },
  tasks: [],
  ...over,
});

const envelope = (event: unknown, over: Record<string, unknown> = {}) => ({
  id: "evt-1",
  sessionId: "session-1",
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
  it("accepts a conforming manifest", () => {
    expect(validateManifest(manifest())).toEqual([]);
    expect(validateManifest(manifest({ idleCapabilities: { dial: { destinationPolicy: "any-number" }, contacts: true } }))).toEqual([]);
  });

  it.each([
    ["a missing id", manifest({ id: "" }), "manifest.id"],
    ["an unknown channel", manifest({ channel: "fax" }), "manifest.channel"],
    ["no protocol versions", manifest({ supportedProtocolVersions: [] }), "manifest.supportedProtocolVersions"],
    ["a non-integer version", manifest({ supportedProtocolVersions: [1.5] }), "manifest.supportedProtocolVersions.value"],
    ["no authentication method", manifest({ authenticationMethods: [] }), "manifest.authenticationMethods"],
    ["an unknown authentication method", manifest({ authenticationMethods: ["magic-link"] }), "manifest.authenticationMethod"],
    ["an unknown phase label", manifest({ phaseLabels: { ringing: "Ringing" } }), "manifest.phaseLabels.phase"],
  ])("rejects %s", (_label, value, rule) => {
    expect(rules(validateManifest(value))).toContain(rule);
  });

  it("lets only voice declare dial", () => {
    const chat = { ...manifest({ channel: "chat" }), idleCapabilities: { dial: { destinationPolicy: "any-number" } } };
    expect(rules(validateManifest(chat))).toContain("manifest.idleCapability.channel");
    // The control: the same capability on voice is fine, so the rejection is about the channel.
    expect(validateManifest(manifest({ idleCapabilities: { dial: { destinationPolicy: "any-number" } } }))).toEqual([]);
  });

  it("declares presence capabilities by presence", () => {
    expect(rules(validateManifest(manifest({ idleCapabilities: { contacts: false } })))).toContain("manifest.idleCapability.value");
    expect(validateManifest(manifest({ idleCapabilities: { contacts: true } }))).toEqual([]);
  });
});

describe("validateTask", () => {
  const check = (over: Record<string, unknown> = {}, channel = "voice") => rules(validateTask(task(over), { channel }));

  it("accepts a conforming task", () => {
    expect(check()).toEqual([]);
  });

  it.each([
    ["an unknown phase", { phase: "ringing" }, "task.phase"],
    ["an unknown completion mode", { completionMode: "whenever" }, "task.completionMode"],
    ["a fractional allowance", { completionAllowance: 1.5 }, "task.completionAllowance"],
    ["a negative allowance", { completionAllowance: -1 }, "task.completionAllowance"],
    ["an empty id", { id: "  " }, "task.id"],
    ["no title", { title: "" }, "task.title"],
  ])("rejects %s", (_label, over, rule) => {
    expect(check(over)).toContain(rule);
  });

  it("requires the task to agree with the provider's channel", () => {
    expect(check({ channel: "chat" })).toContain("task.channel");
    // Control: the same task on a chat provider is fine.
    expect(rules(validateTask(task({ channel: "chat", capabilities: { hold: true } }), { channel: "chat" }))).toEqual([]);
  });

  it("gates capabilities by channel", () => {
    // mute is a voice control; an email task declaring one would render a button that
    // cannot work.
    expect(rules(validateTask(task({ channel: "email", capabilities: { mute: true } }), { channel: "email" })))
      .toContain("task.capability.channel");
    expect(rules(validateTask(task({ channel: "email", capabilities: { reject: true } }), { channel: "email" }))).toEqual([]);
  });

  it("ties browser reuse to an isolation scheme in both directions", () => {
    const browser = (over: Record<string, unknown>) =>
      check({ browsers: [{ id: "b", name: "B", purpose: "P", url: "https://x.example.com", ...over }] });
    expect(browser({ reuse: true })).toContain("task.browser.isolationScheme");
    expect(browser({ reuse: true, isolationScheme: "Nonsense" })).toContain("task.browser.isolationScheme");
    expect(browser({ reuse: false, isolationScheme: "TabName" })).toContain("task.browser.isolationScheme.unexpected");
    expect(browser({})).toContain("task.browser.reuse");
    // Controls: both legal shapes pass.
    expect(browser({ reuse: true, isolationScheme: "TabName" })).toEqual([]);
    expect(browser({ reuse: false })).toEqual([]);
  });

  it("allows only http and https for a browser url", () => {
    const url = (value: string) => check({ browsers: [{ id: "b", name: "B", purpose: "P", url: value, reuse: false }] });
    expect(url("file:///etc/passwd")).toContain("task.browser.url.scheme");
    expect(url("javascript:alert(1)")).toContain("task.browser.url.scheme");
    expect(url("https://ok.example.com")).toEqual([]);
    expect(url("http://ok.example.com")).toEqual([]);
  });

  it("omits an unfinished duration rather than reporting nought", () => {
    const history = (over: Record<string, unknown>) =>
      check({ handlingHistory: [{ step: "answered", at: "2026-08-21T09:00:00Z", ...over }] });
    expect(history({ seconds: 0 })).toContain("task.handlingHistory.seconds");
    expect(history({ seconds: -5 })).toContain("task.handlingHistory.seconds");
    expect(history({ seconds: 22 })).toEqual([]);
    expect(history({})).toEqual([]);
  });

  it("takes a handling step without a person, and rejects an empty one", () => {
    const history = (over: Record<string, unknown>) =>
      check({ handlingHistory: [{ step: "answered", at: "2026-08-21T09:00:00Z", ...over }] });
    // Absent means the provider could not attribute it, which is a legitimate report.
    expect(history({})).toEqual([]);
    expect(history({ by: "" })).toContain("task.handlingHistory.by");
    expect(history({ by: "agent-17" })).toEqual([]);
    expect(check({ handlingHistory: [{ step: "ringing", at: "2026-08-21T09:00:00Z" }] })).toContain("task.handlingHistory.step");
  });

  it("validates each kind of task attribute", () => {
    const attribute = (value: unknown) => check({ attributes: [value] });
    expect(attribute({ key: "order", type: "text", value: "A-1" })).toEqual([]);
    expect(attribute({ key: "caller", type: "contact", contact: { name: "Maya" } })).toEqual([]);
    expect(attribute({ key: "due", type: "timestamp", at: "2026-08-21T09:00:00Z" })).toEqual([]);
    expect(attribute({ key: "order", type: "text" })).toContain("task.attribute.text");
    expect(attribute({ key: "due", type: "timestamp", at: "soon" })).toContain("task.attribute.timestamp");
    expect(attribute({ key: "x", type: "colour", value: "red" })).toContain("task.attribute.type");
    expect(attribute({ type: "text", value: "A-1" })).toContain("task.attribute.key");
  });
});

describe("break state", () => {
  const check = (over: Record<string, unknown>) =>
    rules(validateSnapshot(snapshot({ break: { approval: "not-requested", accepting: true, ...over } }), manifest()));

  it("accepts each approval and rejects one the contract dropped", () => {
    for (const approval of ["not-requested", "awaiting-decision", "granted", "starting-after-task", "in-effect"]) {
      expect(check({ approval })).toEqual([]);
    }
    // "approved" and "denied" were the previous vocabulary. Accepting them would let two
    // providers mean different things by the same state.
    expect(check({ approval: "approved" })).toContain("break.approval");
    expect(check({ approval: "denied" })).toContain("break.approval");
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

  it("keeps who placed an imposed break whether or not it ends on a clock", () => {
    const imposed = (value: unknown) => check({ imposed: value });
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

describe("validateTeamRoster", () => {
  const roster = (over: Record<string, unknown> = {}) => ({
    members: [{ id: "A-2", availability: "ready" }],
    ...over,
  });

  it("accepts a conforming roster", () => {
    expect(validateTeamRoster(roster())).toEqual([]);
    expect(validateTeamRoster(roster({ breakControl: true }))).toEqual([]);
    expect(validateTeamRoster({ members: [{ id: "A-2", availability: "on-break", since: "2026-08-21T09:00:00Z", break: "in-effect" }] })).toEqual([]);
  });

  it.each([
    ["a member with no id", { members: [{ availability: "ready" }] }, "team.member.id"],
    ["an availability the contract dropped", { members: [{ id: "A-2", availability: "available" }] }, "team.member.availability"],
    ["a duplicate member", { members: [{ id: "A-2", availability: "ready" }, { id: "A-2", availability: "on-task" }] }, "team.member.unique"],
    ["a since without a zone", { members: [{ id: "A-2", availability: "ready", since: "2026-08-21T09:00:00" }] }, "team.member.since"],
    ["breakControl declared false", { members: [], breakControl: false }, "team.breakControl"],
    ["no members array", {}, "team.members.shape"],
  ])("rejects %s", (_label, value, rule) => {
    expect(rules(validateTeamRoster(value))).toContain(rule);
  });
});

describe("validateSnapshot", () => {
  it("accepts a conforming snapshot", () => {
    expect(validateSnapshot(snapshot(), manifest())).toEqual([]);
    expect(validateSnapshot(snapshot({ tasks: [task()] }), manifest())).toEqual([]);
  });

  it.each([
    ["a status the contract dropped", snapshot({ status: "inactive" }), "snapshot.status"],
    ["no session id", snapshot({ sessionId: "" }), "snapshot.sessionId"],
    ["no session capabilities", snapshot({ sessionCapabilities: undefined }), "snapshot.sessionCapabilities.shape"],
    ["an unknown session capability", snapshot({ sessionCapabilities: { telepathy: true } }), "snapshot.sessionCapability.unknown"],
    ["a session capability declared false", snapshot({ sessionCapabilities: { breaks: false } }), "snapshot.sessionCapability.value"],
    ["two tasks with one id", snapshot({ tasks: [task(), task()] }), "task.id.unique"],
  ])("rejects %s", (_label, value, rule) => {
    expect(rules(validateSnapshot(value, manifest()))).toContain(rule);
  });

  it("refuses data the manifest never declared a capability for", () => {
    // Presence is the permission, both ways: contacts Omni would show against a control the
    // agent does not have.
    expect(rules(validateSnapshot(snapshot({ contacts: [{ name: "Asha" }] }), manifest())))
      .toContain("snapshot.contacts.capability");
    expect(rules(validateSnapshot(snapshot({ scheduledActivities: [] }), manifest())))
      .toContain("snapshot.calendar.capability");
    // Controls: with the capability declared, the same data is fine.
    const full = manifest({ idleCapabilities: { contacts: true, calendar: true } });
    expect(validateSnapshot(snapshot({ contacts: [{ name: "Asha" }] }), full)).toEqual([]);
    expect(validateSnapshot(snapshot({ scheduledActivities: [] }), full)).toEqual([]);
  });
});

describe("validateEventEnvelope", () => {
  const check = (event: unknown, over: Record<string, unknown> = {}) =>
    rules(validateEventEnvelope(envelope(event, over), manifest()));

  it("requires the envelope to name its session", () => {
    // A login is identified by its session id, and an event that does not name one cannot be
    // attributed to the login it belongs to.
    expect(check({ type: "provider-status", status: "active" }, { sessionId: "" })).toContain("event.sessionId");
    expect(check({ type: "provider-status", status: "active" })).toEqual([]);
  });

  it("validates each event type", () => {
    expect(check({ type: "snapshot", reason: "reconnected", snapshot: snapshot() })).toEqual([]);
    expect(check({ type: "snapshot", reason: "because", snapshot: snapshot() })).toContain("event.snapshot.reason");
    expect(check({ type: "break-state", break: { approval: "in-effect", accepting: false } })).toEqual([]);
    expect(check({ type: "task-offered", task: task({ phase: "pending" }), acceptanceMode: "require-agent-acceptance" })).toEqual([]);
    expect(check({ type: "task-offered", task: task(), acceptanceMode: "whenever" })).toContain("event.taskOffered.acceptanceMode");
    expect(check({ type: "task-media-ended", taskId: "call-42" })).toEqual([]);
    expect(check({ type: "task-media-ended", taskId: "" })).toContain("event.taskMediaEnded.taskId");
    expect(check({ type: "announcement", text: "Hello", announcedAt: "2026-08-21T09:00:00Z" })).toEqual([]);
    expect(check({ type: "announcement", text: "", announcedAt: "2026-08-21T09:00:00Z" })).toContain("event.announcement.text");
    expect(check({ type: "team-updated", team: { members: [] } })).toEqual([]);
    expect(check({ type: "contacts-updated", contacts: [{ name: "Asha" }] })).toEqual([]);
    expect(check({ type: "contacts-updated", contacts: "Asha" })).toContain("event.contacts.shape");
    expect(check({ type: "smoke-signal" })).toContain("event.type");
  });

  it("validates every task outcome", () => {
    const ended = (outcome: unknown) => check({ type: "task-ended", taskId: "call-42", outcome });
    expect(ended({ type: "completed", by: "agent" })).toEqual([]);
    expect(ended({ type: "completed", by: "somebody" })).toContain("event.taskEnded.outcome.completed");
    expect(ended({ type: "transferred", destination: "tier2" })).toEqual([]);
    expect(ended({ type: "cancelled" })).toEqual([]);
    // Only the phases in which somebody is still being waited on can expire.
    expect(ended({ type: "expired", phase: "pending" })).toEqual([]);
    expect(ended({ type: "expired", phase: "in-progress" })).toContain("event.taskEnded.outcome.expired");
    expect(ended({ type: "failed", failure: { code: "x", message: "y", retryable: false } })).toEqual([]);
    expect(ended({ type: "failed" })).toContain("event.taskEnded.outcome.failed");
    expect(ended({ type: "vanished" })).toContain("event.taskEnded.outcome.type");
  });

  it("validates a provider summary", () => {
    const summary = (value: unknown) => check({ type: "provider-summary", summary: value });
    expect(summary({ title: "Queue", waitingCount: 3, updatedAt: "2026-08-21T09:00:00Z" })).toEqual([]);
    expect(summary({ title: "Queue", waitingCount: -1, updatedAt: "2026-08-21T09:00:00Z" })).toContain("event.summary.waitingCount");
    expect(summary({ title: "", waitingCount: 0, updatedAt: "2026-08-21T09:00:00Z" })).toContain("event.summary.title");
    expect(summary({ title: "Q", waitingCount: 0, updatedAt: "2026-08-21T09:00:00Z", metrics: [{ id: "a", label: "A", value: 7 }] }))
      .toContain("event.summary.metric.value");
  });
});

describe("validateAuthenticationState", () => {
  const user = { id: "agent-1", displayName: "Ada" };

  it("accepts each state with what it must carry", () => {
    expect(validateAuthenticationState({ status: "signed-out" })).toEqual([]);
    expect(validateAuthenticationState({ status: "authenticating" })).toEqual([]);
    expect(validateAuthenticationState({ status: "authenticated", identity: user })).toEqual([]);
    expect(validateAuthenticationState({ status: "authenticated", identity: user, expiresAt: "2026-08-21T10:00:00Z" })).toEqual([]);
    expect(validateAuthenticationState({ status: "refreshing", identity: user })).toEqual([]);
    expect(validateAuthenticationState({ status: "expired" })).toEqual([]);
    expect(validateAuthenticationState({ status: "expired", identity: user })).toEqual([]);
  });

  it.each([
    ["a status the contract dropped", { status: "connected" }, "authentication.status"],
    ["authenticated with no identity", { status: "authenticated" }, "authentication.identity"],
    ["refreshing with no identity", { status: "refreshing" }, "authentication.identity"],
    ["an identity with no id", { status: "authenticated", identity: { displayName: "Ada" } }, "authentication.identity.id"],
    ["an identity on a signed-out state", { status: "signed-out", identity: user }, "authentication.identity.unexpected"],
    // Only an authenticated session has something to expire.
    ["an expiry on a refreshing state", { status: "refreshing", identity: user, expiresAt: "2026-08-21T10:00:00Z" }, "authentication.expiresAt.unexpected"],
    ["an expiry with no zone", { status: "authenticated", identity: user, expiresAt: "2026-08-21T10:00:00" }, "authentication.expiresAt"],
  ])("rejects %s", (_label, value, rule) => {
    expect(rules(validateAuthenticationState(value))).toContain(rule);
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
      task({ browsers: [{ id: "crm", name: "CRM", purpose: "Account", url: "https://crm.example.com", reuse: true, isolationScheme }] });
    for (const scheme of Object.values(BROWSER_ISOLATION_SCHEMES)) {
      expect(rules(validateTask(reusing(scheme), { channel: "voice" }))).toEqual([]);
    }
    expect(rules(validateTask(reusing("ProviderName.Whatever"), { channel: "voice" }))).toContain("task.browser.isolationScheme");
  });

  it("every published break kind, and no unpublished one", () => {
    const withKind = (kind: unknown) => snapshot({ break: { approval: "not-requested", accepting: true, reasons: [{ id: "r1", label: "Rest", kind }] } });
    for (const kind of BREAK_KINDS) {
      expect(rules(validateSnapshot(withKind(kind), manifest()))).toEqual([]);
    }
    expect(rules(validateSnapshot(withKind("nap"), manifest()))).toContain("break.reason.kind");
  });

  it("every published idle capability on voice, and dial on nothing else", () => {
    const declaring = (name: string, channel: string) => {
      const value = name === "dial" ? { destinationPolicy: "any-number" }
        : name === "personalBrowser" ? { access: { mode: "allow-all" } }
        : true;
      return manifest({ channel, idleCapabilities: { [name]: value } });
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

describe("the completion allowance follows the completion mode", () => {
  const voice = { channel: "voice" };
  it("may be omitted only where the provider will not act on it", () => {
    // A provider waiting for `complete` may leave the deadline open...
    expect(rules(validateTask(task({ completionMode: "agent-command", completionAllowance: undefined }), voice))).toEqual([]);
    // ...and one that completes the task itself must say when.
    expect(rules(validateTask(task({ completionMode: "provider-automatic", completionAllowance: undefined }), voice)))
      .toContain("task.completionAllowance.required");
    // The controls: stated, either mode is fine, and zero is a deadline of now, not an absence.
    expect(rules(validateTask(task({ completionMode: "provider-automatic", completionAllowance: 0 }), voice))).toEqual([]);
    expect(rules(validateTask(task({ completionMode: "agent-command", completionAllowance: 0 }), voice))).toEqual([]);
  });

  it("is still a duration when present, whatever the mode", () => {
    expect(rules(validateTask(task({ completionMode: "agent-command", completionAllowance: 1.5 }), voice))).toContain("task.completionAllowance");
    expect(rules(validateTask(task({ completionMode: "agent-command", completionAllowance: "60" }), voice))).toContain("task.completionAllowance");
  });
});

describe("callback is a voice capability", () => {
  it("is accepted on voice and refused on every other channel, like the rest of the voice arm", () => {
    expect(rules(validateTask(task({ capabilities: { callback: true } }), { channel: "voice" }))).toEqual([]);
    for (const channel of ["chat", "email"]) {
      expect(rules(validateTask(task({ channel, capabilities: { callback: true } }), { channel }))).toContain("task.capability.channel");
    }
    // Presence is the permission: the flag carries no payload.
    expect(rules(validateTask(task({ capabilities: { callback: false } }), { channel: "voice" }))).toContain("task.capability.value");
  });
});

describe("consult transfer", () => {
  const voice = { channel: "voice" };
  it("is its own capability, declared like the other directories, and voice only", () => {
    expect(rules(validateTask(task({ capabilities: { consultTransfer: true } }), voice))).toEqual([]);
    expect(rules(validateTask(task({ capabilities: { consultTransfer: { allowManualEntry: false, destinations: [{ id: "t2", label: "Tier 2", address: "+14155550111", kind: "queue" }] } } }), voice))).toEqual([]);
    // The same directory rules as blindTransfer: a directory with nothing in it must allow typing.
    expect(rules(validateTask(task({ capabilities: { consultTransfer: { allowManualEntry: false } } }), voice))).toEqual([]);
    expect(rules(validateTask(task({ capabilities: { consultTransfer: { destinations: [] } } }), voice))).toContain("task.destinations.allowManualEntry");
    for (const channel of ["chat", "email"]) {
      expect(rules(validateTask(task({ channel, capabilities: { consultTransfer: true } }), { channel }))).toContain("task.capability.channel");
    }
  });

  it("carries the consultation in progress on voice, and nowhere else", () => {
    expect(rules(validateTask(task({ consultation: { destination: "+14155550111", label: "Tier 2", since: "2026-08-21T09:05:00Z" } }), voice))).toEqual([]);
    expect(rules(validateTask(task({ consultation: { destination: "+14155550111" } }), voice))).toEqual([]);
    expect(rules(validateTask(task({ consultation: { destination: "" } }), voice))).toContain("task.consultation.destination");
    expect(rules(validateTask(task({ consultation: { destination: "+14155550111", since: "yesterday" } }), voice))).toContain("task.consultation.since");
    expect(rules(validateTask(task({ consultation: "+14155550111" }), voice))).toContain("task.consultation.shape");
    expect(rules(validateTask(task({ channel: "email", capabilities: {}, consultation: { destination: "+14155550111" } }), { channel: "email" })))
      .toContain("task.consultation.channel");
  });
});

describe("consulting a lead", () => {
  const voice = { channel: "voice" };
  it("is its own voice capability", () => {
    expect(rules(validateTask(task({ capabilities: { consultLead: true } }), voice))).toEqual([]);
    expect(rules(validateTask(task({ capabilities: { consultLead: false } }), voice))).toContain("task.capability.value");
    for (const channel of ["chat", "email"]) {
      expect(rules(validateTask(task({ channel, capabilities: { consultLead: true } }), { channel }))).toContain("task.capability.channel");
    }
  });

  it("carries the request on the agent's task: requested names nobody, joined names the lead", () => {
    const since = "2026-08-21T09:04:00Z";
    expect(rules(validateTask(task({ lead: { status: "requested", note: "Refund dispute", since } }), voice))).toEqual([]);
    expect(rules(validateTask(task({ lead: { status: "joined", leadId: "L-9", since } }), voice))).toEqual([]);
    expect(rules(validateTask(task({ lead: { status: "joined", since } }), voice))).toContain("task.lead.leadId");
    expect(rules(validateTask(task({ lead: { status: "requested", leadId: "L-9", since } }), voice))).toContain("task.lead.leadId.unexpected");
    expect(rules(validateTask(task({ lead: { status: "declined", since } }), voice))).toContain("task.lead.status");
    expect(rules(validateTask(task({ lead: { status: "requested" } }), voice))).toContain("task.lead.since");
    expect(rules(validateTask(task({ channel: "chat", capabilities: {}, lead: { status: "requested", since } }), { channel: "chat" })))
      .toContain("task.lead.channel");
  });

  it("carries the joined call on the lead's task", () => {
    const since = "2026-08-21T09:05:00Z";
    expect(rules(validateTask(task({ assisting: { memberId: "A-1", note: "Refund dispute", since } }), voice))).toEqual([]);
    expect(rules(validateTask(task({ assisting: { note: "Refund dispute", since } }), voice))).toContain("task.assisting.memberId");
    expect(rules(validateTask(task({ assisting: { memberId: "A-1" } }), voice))).toContain("task.assisting.since");
    expect(rules(validateTask(task({ channel: "email", capabilities: {}, assisting: { memberId: "A-1", since } }), { channel: "email" })))
      .toContain("task.assisting.channel");
  });

  it("puts requests on the roster only where the lead may act on them", () => {
    const request = { id: "req-7", memberId: "A-1", taskId: "call-42", note: "Refund dispute", since: "2026-08-21T09:04:00Z" };
    const members = [{ id: "A-1", availability: "on-task" }];
    expect(rules(validateTeamRoster({ members, consultControl: true, requests: [request] }))).toEqual([]);
    expect(rules(validateTeamRoster({ members, consultControl: true, requests: [] }))).toEqual([]);
    expect(rules(validateTeamRoster({ members, requests: [request] }))).toContain("team.requests.capability");
    expect(rules(validateTeamRoster({ members, consultControl: false }))).toContain("team.consultControl");
    expect(rules(validateTeamRoster({ members, consultControl: true, requests: [request, request] }))).toContain("team.request.unique");
    expect(rules(validateTeamRoster({ members, consultControl: true, requests: [{ ...request, taskId: "" }] }))).toContain("team.request.taskId");
    expect(rules(validateTeamRoster({ members, consultControl: true, requests: [{ ...request, since: "now" }] }))).toContain("team.request.since");
  });

  it("accepts the left outcome, and still refuses one the contract lacks", () => {
    const ended = (outcome: unknown) => envelope({ type: "task-ended", taskId: "call-42", outcome });
    expect(rules(validateEventEnvelope(ended({ type: "left" }), manifest()))).toEqual([]);
    expect(rules(validateEventEnvelope(ended({ type: "vanished" }), manifest()))).toContain("event.taskEnded.outcome.type");
  });
});
