import { describe, expect, it } from "vitest";
import { BREAK_KINDS, BROWSER_ISOLATION_SCHEMES, IDLE_CAPABILITIES, effectiveTiers } from "./index.js";
import {
  assertNoViolations,
  ProtocolConformanceError,
  validateAuthenticationState,
  validateContact,
  validateEventEnvelope,
  validateHostReport,
  validateManifest,
  validateScheduledActivity,
  validateSnapshot,
  validateTask,
  validateResult,
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

const task = (over: Record<string, unknown> = {}) => {
  const capabilities = (over.capabilities ?? { browsers: true, hold: true }) as Record<string, unknown>;
  return {
    id: "call-42",
    title: "Customer call",
    channel: "voice",
    taskType: "Customer Support",
    capabilities,
    // A task supplies browsers only under the capability that shows them.
    browsers: capabilities.browsers === true ? [{ id: "crm", name: "CRM", purpose: "Account", url: "https://crm.example.com", reuse: false }] : [],
    phase: "in-progress",
    completionMode: "agent-command",
    completionAllowance: 15,
    ...over,
  };
};

const snapshot = (over: Record<string, unknown> = {}) => ({
  status: "active",
  sessionId: "session-1",
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
    ["no version this host speaks", manifest({ supportedProtocolVersions: [99] }), "manifest.supportedProtocolVersions.interoperable"],
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
    // The guide names the rule for a reusing browser that declares no scheme.
    expect(browser({ reuse: true })).toContain("task.browser.isolationScheme.required");
    expect(browser({ reuse: true })).not.toContain("task.browser.isolationScheme");
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

  it("refuses a break in effect beside a task, and accepts one that is waiting for it to end", () => {
    // A break begins when the work ends. Until then the state is starting-after-task, which may
    // stand beside any task; in-effect beside one is a report of a state the agent cannot be in.
    const withTask = (approval: string) =>
      rules(validateSnapshot(snapshot({ tasks: [task()], break: { approval, accepting: true } }), manifest()));
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

describe("validateTeamRoster", () => {
  const roster = (over: Record<string, unknown> = {}) => ({
    members: [{ id: "A-2", availability: "ready" }],
    ...over,
  });

  it("accepts a conforming roster", () => {
    expect(validateTeamRoster(roster())).toEqual([]);
    expect(validateTeamRoster({ members: [{ id: "A-2", availability: "on-task", since: "2026-08-21T09:00:00Z", break: "starting-after-task" }] })).toEqual([]);
  });

  it.each([
    ["a member with no id", { members: [{ availability: "ready" }] }, "team.member.id"],
    ["an availability the contract dropped", { members: [{ id: "A-2", availability: "available" }] }, "team.member.availability"],
    ["a duplicate member", { members: [{ id: "A-2", availability: "ready" }, { id: "A-2", availability: "on-task" }] }, "team.member.unique"],
    ["a since without a zone", { members: [{ id: "A-2", availability: "ready", since: "2026-08-21T09:00:00" }] }, "team.member.since"],
    ["no members array", {}, "team.members.shape"],
  ])("rejects %s", (_label, value, rule) => {
    expect(rules(validateTeamRoster(value))).toContain(rule);
  });

  it("rejects the agent it is published to, in members and in requests, once told who that is", () => {
    // A lead does not report to themself. The roster below carries a colleague and the reader in
    // both places, so the check has to pick the reader out rather than object to either list.
    const published = {
      members: [{ id: "A-2", availability: "ready" }, { id: "1042", availability: "on-task" }],
      requests: [
        { id: "req-1", memberId: "A-2", taskId: "call-7", since: "2026-08-21T09:00:00Z" },
        { id: "req-2", memberId: "1042", taskId: "call-9", since: "2026-08-21T09:01:00Z" },
      ],
    };
    const found = (self: string) =>
      validateTeamRoster(published, "team", { self }).map(violation => `${violation.rule} at ${violation.path}`).sort();
    expect(found("1042")).toEqual(["team.member.self at team.members[1].id", "team.request.self at team.requests[1].memberId"]);
    // A colleague is not the reader, and without a reader there is nothing to compare against.
    expect(found("A-9")).toEqual([]);
    expect(validateTeamRoster(published)).toEqual([]);
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
    ["two tasks with one id", snapshot({ tasks: [task(), task()] }), "task.id.unique"],
  ])("rejects %s", (_label, value, rule) => {
    expect(rules(validateSnapshot(value, manifest()))).toContain(rule);
  });

  it("requires each contribution the manifest declares, [] included, and refuses one it does not", () => {
    const declaring = manifest({ idleCapabilities: { contacts: true, calendar: true } });
    expect(rules(validateSnapshot(snapshot({ contacts: [], scheduledActivities: [] }), declaring))).toEqual([]);
    expect(rules(validateSnapshot(snapshot(), declaring)).sort()).toEqual(["snapshot.calendar.required", "snapshot.contacts.required"]);
    expect(rules(validateSnapshot(snapshot(), manifest()))).toEqual([]);
    expect(rules(validateSnapshot(snapshot({ contacts: [], scheduledActivities: [] }), manifest())).sort()).toEqual(["snapshot.calendar.capability", "snapshot.contacts.capability"]);
  });

  it("carries the reader into the roster", () => {
    const team = { members: [{ id: "A-2", availability: "ready" }, { id: "1042", availability: "ready" }] };
    expect(rules(validateSnapshot(snapshot({ team }), manifest(), "snapshot", { self: "1042" }))).toEqual(["team.member.self"]);
    expect(rules(validateSnapshot(snapshot({ team }), manifest(), "snapshot", { self: "A-9" }))).toEqual([]);
  });

  it("holds the roster to the login once told what it declares", () => {
    // The login is the permission, and it cuts both ways: a lead's snapshot must carry a roster
    // and nobody else's may. Both agreeing cases pass, so each refusal is about the disagreement.
    const team = { members: [{ id: "A-2", availability: "ready" }] };
    const lead = { capabilities: { team: {} } };
    const agent = { capabilities: {} };
    expect(rules(validateSnapshot(snapshot({ team }), manifest(), "snapshot", lead))).toEqual([]);
    expect(rules(validateSnapshot(snapshot(), manifest(), "snapshot", agent))).toEqual([]);
    expect(rules(validateSnapshot(snapshot(), manifest(), "snapshot", lead))).toEqual(["team.required"]);
    expect(rules(validateSnapshot(snapshot({ team }), manifest(), "snapshot", agent))).toEqual(["team.unentitled"]);
    // The roster validator carries the same refusal on its own, for a caller holding just the roster.
    expect(rules(validateTeamRoster(team, "team", lead))).toEqual([]);
    expect(rules(validateTeamRoster(team, "team", agent))).toEqual(["team.unentitled"]);
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

  it("requires the envelope to name its session", () => {
    // A login is identified by its session id, and an event that does not name one cannot be
    // attributed to the login it belongs to.
    expect(check({ type: "provider-status", status: "active" }, { sessionId: "" })).toContain("event.sessionId");
    expect(check({ type: "provider-status", status: "active" })).toEqual([]);
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
    expect(check({ type: "break-state", break: { approval: "in-effect", accepting: false } })).toEqual([]);
    expect(check({ type: "task-offered", task: task({ phase: "pending" }), acceptanceMode: "require-agent-acceptance" })).toEqual([]);
    expect(check({ type: "task-offered", task: task(), acceptanceMode: "whenever" })).toContain("event.taskOffered.acceptanceMode");
    expect(check({ type: "task-media-ended", taskId: "call-42" })).toEqual([]);
    expect(check({ type: "task-media-ended", taskId: "" })).toContain("event.taskMediaEnded.taskId");
    expect(check({ type: "announcement", text: "Hello", announcedAt: "2026-08-21T09:00:00Z" })).toEqual([]);
    expect(check({ type: "announcement", text: "", announcedAt: "2026-08-21T09:00:00Z" })).toContain("event.announcement.text");
    expect(check({ type: "team-updated", team: { members: [] } })).toEqual([]);
    expect(rules(validateEventEnvelope(envelope({ type: "contacts-updated", contacts: [{ name: "Asha" }] }), manifest({ idleCapabilities: { contacts: true } })))).toEqual([]);
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

describe("who decides what an agent may do", () => {
  const voice = { channel: "voice" };

  it("takes the typical four tiers by default, or exactly the ladder the manifest states", () => {
    expect(effectiveTiers(undefined).map(tier => tier.id)).toEqual(["org", "site", "team", "person"]);
    // A declared ladder is the whole ladder: what it leaves out does not exist.
    const tiers = effectiveTiers([{ id: "org", label: "Your organisation" }, { id: "team", label: "Your queue group" }, { id: "person", label: "You" }]);
    expect(tiers.map(tier => `${tier.id}=${tier.label}`)).toEqual(["org=Your organisation", "team=Your queue group", "person=You"]);
    const m = (orgTiers: unknown) => rules(validateManifest(manifest({ orgTiers })));
    expect(m([{ id: "region", label: "Your region" }, { id: "person", label: "You" }])).toEqual([]);
    expect(m("region")).toEqual(["manifest.orgTiers.shape"]);
    expect(m(["region"])).toEqual(["manifest.orgTier.shape"]);
    expect(m([{ label: "Your region" }])).toEqual(["manifest.orgTier.id"]);
    expect(m([{ id: "region" }])).toEqual(["manifest.orgTier.label"]);
    expect(m([{ id: "region", label: "A" }, { id: "region", label: "B" }])).toEqual(["manifest.orgTier.unique"]);
    // The subject of every resolution cannot be declared away.
    expect(m([{ id: "org", label: "Your organisation" }, { id: "team", label: "Your team" }])).toEqual(["manifest.orgTiers.person"]);
  });

  it("lets a control stand locked in its place, naming the tier, and never a queue's own content", () => {
    const caps = (capabilities: unknown) => rules(validateTask(task({ capabilities }), voice));
    expect(caps({ hold: true, mute: { lockedBy: "team", reason: "Nobody on this team mutes" }, recording: { lockedBy: "site" } })).toEqual([]);
    expect(caps({ blindTransfer: { lockedBy: "org" } })).toEqual([]);
    expect(caps({ mute: { lockedBy: "person" } })).toEqual(["task.capability.locked.lockedBy.person"]);
    // A tier is one of the four defaults when the manifest declares no ladder.
    expect(caps({ mute: { lockedBy: "org" } })).toEqual([]);
    expect(caps({ mute: { lockedBy: "region" } })).toEqual(["task.capability.locked.lockedBy.unknown"]);
    // The control: a manifest that declares no ladder has all four defaults in force.
    expect(rules(validateSnapshot(snapshot({ tasks: [task({ capabilities: { mute: { lockedBy: "site" } } })] }), manifest()))).toEqual([]);
    const regional = manifest({ orgTiers: [{ id: "org", label: "Your organisation" }, { id: "region", label: "Your region" }, { id: "team", label: "Your team" }, { id: "person", label: "You" }] });
    expect(rules(validateSnapshot(snapshot({ tasks: [task({ capabilities: { mute: { lockedBy: "region" } } })] }), regional))).toEqual([]);
    // The ladder is the whole ladder: a default the manifest left out is not in force.
    expect(rules(validateSnapshot(snapshot({ tasks: [task({ capabilities: { mute: { lockedBy: "site" } } })] }), regional))).toEqual(["task.capability.locked.lockedBy.unknown"]);
    expect(rules(validateSnapshot(snapshot({ tasks: [task({ capabilities: { mute: { lockedBy: "district" } } })] }), regional))).toEqual(["task.capability.locked.lockedBy.unknown"]);
    expect(caps({ mute: { lockedBy: "team", reason: "" } })).toEqual(["task.capability.locked.reason"]);
    expect(caps({ browsers: { lockedBy: "team" } })).toEqual(["task.capability.locked.unexpected"]);
    // lockedBy is the discriminant: a directory carrying it would read as a lock, so it may not.
    expect(caps({ blindTransfer: { allowManualEntry: true, destinations: [] } })).toEqual([]);
    expect(caps({ blindTransfer: { lockedBy: "org" } })).toEqual([]);
    // A chat task has no mute to lock; the channel rule speaks first.
    expect(rules(validateTask(task({ channel: "chat", capabilities: { mute: { lockedBy: "team" } } }), { channel: "chat" }))).toEqual(["task.capability.channel"]);
  });

  it("withholds a number by locking it in place, never by a flag", () => {
    const contact = (value: unknown) => rules(validateTask(task({ contact: value }), voice));
    expect(contact({ name: "Asha", number: "+14155550111" })).toEqual([]);
    expect(contact({ name: "Asha", number: { lockedBy: "org" } })).toEqual([]);
    expect(contact({ name: "Asha", number: { lockedBy: "person" } })).toEqual(["contact.number.locked.lockedBy.person"]);
    // Email identifies a person as a number does, and is locked the same way; a name is not.
    expect(contact({ name: "Asha", email: { lockedBy: "site" } })).toEqual([]);
    expect(contact({ name: "Asha", email: { lockedBy: "person" } })).toEqual(["contact.email.locked.lockedBy.person"]);
    expect(contact({ name: { lockedBy: "org" } })).toEqual(["contact.name"]);
    expect(contact({ name: "Asha", number: "" })).toEqual(["contact.number"]);
  });

  it("declares what the team left to the person on the login, with who set it", () => {
    const user = { id: "agent-1", displayName: "Ada" };
    const prefs = (value: unknown) => rules(validateAuthenticationState({ status: "authenticated", identity: user, capabilities: { preferences: value } }));
    const mute = { id: "mute", label: "Mute", enabled: true, setBy: "team" };
    expect(prefs([mute, { id: "hold", label: "Hold", enabled: false, setBy: "person" }, { id: "skill:billing", label: "Billing", enabled: true, setBy: "provisioning" }])).toEqual([]);
    // Nothing is hidden: a preference a tier above has since locked is listed, locked.
    expect(prefs([{ ...mute, lockedBy: "site", reason: "No mute at this site" }])).toEqual([]);
    expect(prefs(undefined)).toEqual([]);
    expect(prefs([])).toEqual(["authentication.capability.preferences.empty"]);
    expect(prefs([{ ...mute, id: "callback" }])).toEqual(["preference.id"]);
    expect(prefs([{ ...mute, id: "skill:" }])).toEqual(["preference.id"]);
    expect(prefs([mute, mute])).toEqual(["preference.unique"]);
    expect(prefs([{ id: "mute", enabled: true, setBy: "team" }])).toEqual(["preference.label"]);
    expect(prefs([{ id: "mute", label: "Mute", setBy: "team" }])).toEqual(["preference.enabled"]);
    expect(prefs([{ id: "mute", label: "Mute", enabled: true }])).toEqual(["preference.setBy"]);
    expect(prefs([{ ...mute, setBy: "queue" }])).toEqual(["preference.setBy.unknown"]);
    expect(prefs([{ ...mute, lockedBy: "person" }])).toEqual(["preference.lockedBy.person"]);
    // Given the manifest's tiers, a declared one is accepted and an undeclared one is not.
    const declared = { tiers: ["org", "region", "team", "person"] };
    expect(rules(validateAuthenticationState({ status: "authenticated", identity: user, capabilities: { preferences: [{ ...mute, setBy: "region" }] } }, "authentication", declared))).toEqual([]);
    expect(rules(validateAuthenticationState({ status: "authenticated", identity: user, capabilities: { preferences: [{ ...mute, setBy: "site" }] } }, "authentication", declared))).toEqual(["preference.setBy.unknown"]);
    expect(prefs([{ ...mute, reason: "Because" }])).toEqual(["preference.reason.unexpected"]);
    expect(prefs(["mute"])).toEqual(["preference.shape"]);
    expect(prefs("mute")).toEqual(["preferences.shape"]);
  });

  it("carries the team's policies on the roster, as the lead sees them", () => {
    const may = { capabilities: { team: { policyControl: true as const } } };
    const policies = (value: unknown) => rules(validateTeamRoster({ members: [], policies: value }, "team", may));
    expect(policies({ mute: { setting: "off", setBy: "team" }, hold: { setting: "agent", setBy: "team" }, recording: { setting: "on", setBy: "site", lockedBy: "site", reason: "Compliance" }, dial: { setting: "on", setBy: "provisioning" }, "skill:billing": { setting: "agent", setBy: "org" } })).toEqual([]);
    expect(policies({ telepathy: { setting: "on", setBy: "team" } })).toEqual(["team.policy.key"]);
    expect(policies({ mute: "off" })).toEqual(["team.policy.shape"]);
    expect(policies({ mute: { setting: "maybe", setBy: "team" } })).toEqual(["team.policy.setting"]);
    expect(policies({ callback: { setting: "agent", setBy: "team" } })).toEqual(["team.policy.agent"]);
    expect(policies({ dial: { setting: "agent", setBy: "team" } })).toEqual(["team.policy.agent"]);
    expect(policies({ mute: { setting: "off" } })).toEqual(["team.policy.setBy"]);
    expect(policies({ mute: { setting: "off", setBy: "person" } })).toEqual(["team.policy.setBy"]);
    expect(policies("off")).toEqual(["team.policies.shape"]);
    // Present exactly when the login may set them.
    expect(rules(validateTeamRoster({ members: [] }, "team", may))).toEqual(["team.policies.required"]);
    expect(rules(validateTeamRoster({ members: [], policies: {} }, "team", { capabilities: { team: {} } }))).toEqual(["team.policies.capability"]);
    expect(rules(validateTeamRoster({ members: [], policies: {} }))).toEqual([]);
  });

  it("lets a custom action ask for what it needs and say where it renders", () => {
    const custom = (over: Record<string, unknown>) => rules(validateTask(task({ capabilities: { custom: [{ id: "transfer-out", ui: { kind: "button", label: "Transfer out", placement: "secondary" }, ...over }] } }), voice));
    const destination = { name: "destination", label: "Number", type: "text" };
    expect(custom({})).toEqual([]);
    expect(custom({ prompt: { fields: [destination] } })).toEqual([]);
    expect(custom({ ui: { kind: "button", label: "Transfer out", placement: "secondary", render: "page" } })).toEqual([]);
    expect(custom({ ui: { kind: "button", label: "Transfer out", placement: "secondary", render: "popup" } })).toEqual(["task.custom.ui.render"]);
    expect(custom({ prompt: { fields: [] } })).toEqual(["task.custom.prompt.fields"]);
    expect(custom({ prompt: "destination" })).toEqual(["task.custom.prompt.shape"]);
    expect(custom({ prompt: { fields: ["destination"] } })).toEqual(["task.custom.prompt.field.shape"]);
    expect(custom({ prompt: { fields: [{ label: "Number", type: "text" }] } })).toEqual(["task.custom.prompt.field.name"]);
    expect(custom({ prompt: { fields: [{ name: "destination", type: "text" }] } })).toEqual(["task.custom.prompt.field.label"]);
    expect(custom({ prompt: { fields: [{ ...destination, type: "number" }] } })).toEqual(["task.custom.prompt.field.type"]);
  });

  it("validates a preference or policy result like any other", () => {
    expect(rules(validateResult({ status: "applied" }, "setPreference"))).toEqual([]);
    expect(rules(validateResult({ status: "applied" }, "executeTeamPolicy"))).toEqual([]);
    expect(rules(validateResult({ status: "failed", failure: { code: "omni.capability-not-enabled", message: "Not yours to set", retryable: false } }, "setPreference"))).toEqual([]);
    expect(rules(validateResult({ status: "set" }, "executeTeamPolicy"))).toEqual(["result.status"]);
  });
});

describe("validateHostReport", () => {
  const microphone = { id: "mic" };
  const failure = { code: "host.permission-denied", message: "Microphone access was refused", retryable: true };
  const ready = { status: "ready", localAudio: microphone, flowing: true };
  const denied = { status: "unavailable", reason: "denied", failure };
  const audio = (input: unknown, output: unknown = { status: "ready" }) => rules(validateHostReport({ online: true, browsers: { urlVisibility: "hidden" }, audio: { input, output } }));

  it("accepts a report with and without audio, and holds each part to its shape", () => {
    expect(rules(validateHostReport({ online: true, browsers: { urlVisibility: "hidden" } }))).toEqual([]);
    expect(rules(validateHostReport({ online: false, browsers: { urlVisibility: "full" } }))).toEqual([]);
    expect(rules(validateHostReport({ browsers: { urlVisibility: "domain" } }))).toEqual(["host.online"]);
    expect(rules(validateHostReport({ online: true }))).toEqual(["host.browsers.shape"]);
    expect(rules(validateHostReport({ online: true, browsers: { urlVisibility: "partial" } }))).toEqual(["host.browsers.urlVisibility"]);
    expect(rules(validateHostReport("online"))).toEqual(["host.shape"]);
    expect(rules(validateHostReport({ online: true, browsers: { urlVisibility: "hidden" }, audio: "ready" }))).toEqual(["host.audio.shape"]);
    expect(audio(ready)).toEqual([]);
    expect(audio({ ...ready, flowing: false })).toEqual([]);
    expect(audio(denied)).toEqual([]);
    expect(audio(ready, { status: "unavailable", reason: "no-device", failure })).toEqual([]);
    for (const reason of ["no-device", "denied", "not-asked", "in-use", "lost"]) expect(audio({ ...denied, reason })).toEqual([]);
  });

  it("refuses an input or output that carries the wrong things", () => {
    expect(audio({ status: "ready", flowing: true })).toEqual(["host.audio.input.localAudio"]);
    expect(audio({ status: "ready", localAudio: microphone })).toEqual(["host.audio.input.flowing"]);
    expect(audio({ ...ready, failure })).toEqual(["host.audio.input.failure.unexpected"]);
    expect(audio({ ...ready, reason: "lost" })).toEqual(["host.audio.input.reason.unexpected"]);
    expect(audio({ ...denied, flowing: true })).toEqual(["host.audio.input.flowing.unexpected"]);
    expect(audio(ready, { status: "ready", reason: "no-device" })).toEqual(["host.audio.output.reason.unexpected"]);
    expect(audio({ status: "unavailable", failure })).toEqual(["host.audio.input.reason"]);
    expect(audio({ status: "unavailable", reason: "broken", failure })).toEqual(["host.audio.input.reason"]);
    expect(audio({ status: "unavailable", reason: "lost" })).toEqual(["host.audio.input.failure.required"]);
    expect(audio({ ...denied, failure: { code: "x" } })).toEqual(["failure.message", "failure.retryable"]);
    expect(audio({ ...denied, localAudio: microphone })).toEqual(["host.audio.input.localAudio.unexpected"]);
    expect(audio({ status: "muted" })).toEqual(["host.audio.input.status"]);
    expect(audio(undefined)).toEqual(["host.audio.input.shape"]);
    expect(audio(ready, { status: "ready", failure })).toEqual(["host.audio.output.failure.unexpected"]);
    expect(audio(ready, { status: "unavailable", reason: "no-device" })).toEqual(["host.audio.output.failure.required"]);
    expect(audio(ready, { status: "unavailable", failure })).toEqual(["host.audio.output.reason"]);
    expect(audio(ready, { status: "unavailable", reason: "denied", failure })).toEqual(["host.audio.output.reason"]);
    expect(audio(ready, { status: "silent" })).toEqual(["host.audio.output.status"]);
    expect(rules(validateHostReport({ online: true, browsers: { urlVisibility: "hidden" }, audio: { input: ready } }))).toEqual(["host.audio.output.shape"]);
  });
});

describe("validateResult", () => {
  const failure = { code: "provider.busy", message: "Try later", retryable: true, retryAfterMs: 500 };

  it("accepts each method's own answers and refuses a status it does not give", () => {
    // Every method's success status beside the same status on a method that does not answer it.
    const pairs = [
      ["execute", "applied"], ["dial", "dialled"], ["setCapacity", "accepted"], ["requestBreak", "requested"],
      ["commitBreak", "committed"], ["cancelBreak", "cancelled"], ["endBreak", "ended"],
      ["executeTeamBreak", "applied"], ["executeTeamConsult", "applied"],
    ] as const;
    for (const [method, status] of pairs) {
      expect(rules(validateResult({ status }, method))).toEqual([]);
      expect(rules(validateResult({ status: "failed", failure }, method))).toEqual([]);
    }
    expect(rules(validateResult({ status: "applied" }, "dial"))).toEqual(["result.status"]);
    expect(rules(validateResult({ status: "ok" }, "execute"))).toEqual(["result.status"]);
    expect(rules(validateResult({ status: "opened", session: { close: () => undefined } }, "openMedia"))).toEqual([]);
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

  it("lets a provider name its own codes and holds the omni namespace to the contract", () => {
    expect(rules(validateResult({ status: "failed", failure: { ...failure, code: "omni.unavailable" } }, "execute"))).toEqual([]);
    expect(rules(validateResult({ status: "failed", failure: { ...failure, code: "acme.circuit-open" } }, "execute"))).toEqual([]);
    expect(rules(validateResult({ status: "failed", failure: { ...failure, code: "omni.retry-later" } }, "execute"))).toEqual(["failure.code.unknown"]);
    // The same failure shape on a task's failed outcome.
    const ended = (failure: unknown) => rules(validateEventEnvelope(envelope({ type: "task-ended", taskId: "call-42", outcome: { type: "failed", failure } }), manifest()));
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
    const directory = (over: Record<string, unknown>) => rules(validateTask(task({ capabilities: { blindTransfer: { allowManualEntry: false, ...over } } }), voice));
    const tier2 = { id: "t2", label: "Tier 2", address: "+14155550111", kind: "queue" };
    expect(directory({ destinations: [tier2] })).toEqual([]);
    expect(directory({ allowManualEntry: true })).toEqual([]);
    expect(directory({ allowManualEntry: true, destinations: [] })).toEqual([]);
    expect(directory({})).toEqual(["task.destinations.offer"]);
    expect(directory({ destinations: [] })).toEqual(["task.destinations.offer"]);
    expect(directory({ destinations: [tier2, tier2] })).toEqual(["task.destination.unique"]);
  });

  it("gives a required disposition policy a code to collect", () => {
    const policy = (over: Record<string, unknown>) => rules(validateTask(task({ capabilities: { dispositions: over } }), voice));
    expect(policy({ required: true, codes: [{ id: "resolved", label: "Resolved" }] })).toEqual([]);
    expect(policy({ required: false })).toEqual([]);
    expect(policy({ required: true })).toEqual(["task.dispositions.required.codes"]);
    expect(policy({ required: true, codes: [] })).toEqual(["task.dispositions.required.codes"]);
  });

  it("keeps browser names and attribute keys unique within a task", () => {
    const crm = { id: "crm", name: "CRM", purpose: "Account", url: "https://crm.example.com", reuse: false };
    expect(rules(validateTask(task({ browsers: [crm, { ...crm, id: "kb", name: "Knowledge" }] }), voice))).toEqual([]);
    expect(rules(validateTask(task({ browsers: [crm, { ...crm, id: "kb" }] }), voice))).toEqual(["task.browser.name.unique"]);
    const order = { type: "text", key: "order", value: "42" };
    expect(rules(validateTask(task({ attributes: [order, { ...order, key: "region" }] }), voice))).toEqual([]);
    expect(rules(validateTask(task({ attributes: [order, order] }), voice))).toEqual(["task.attribute.unique"]);
  });

  it("names nobody on a queued step", () => {
    const step = (entry: Record<string, unknown>) => rules(validateTask(task({ handlingHistory: [{ at: "2026-08-21T09:00:00Z", ...entry }] }), voice));
    expect(step({ step: "answered", by: "A-1" })).toEqual([]);
    expect(step({ step: "queued" })).toEqual([]);
    expect(step({ step: "queued", by: "A-1" })).toEqual(["task.handlingHistory.by.unexpected"]);
  });

  it("declares the capability that shows a task's browsers", () => {
    const crm = { id: "crm", name: "CRM", purpose: "Account", url: "https://crm.example.com", reuse: false };
    expect(rules(validateTask(task({ capabilities: { browsers: true }, browsers: [crm] }), voice))).toEqual([]);
    expect(rules(validateTask(task({ capabilities: {}, browsers: [] }), voice))).toEqual([]);
    expect(rules(validateTask(task({ capabilities: {}, browsers: [crm] }), voice))).toEqual(["task.browsers.capability"]);
    // And the other way: the capability puts a panel in the workspace, so there is something in it.
    expect(rules(validateTask(task({ capabilities: { browsers: true }, browsers: [] }), voice))).toEqual(["task.browsers.required"]);
  });

  it("holds the break state's parts to its approval", () => {
    const check = (over: Record<string, unknown>) =>
      rules(validateSnapshot(snapshot({ break: { approval: "not-requested", accepting: true, ...over } }), manifest()));
    expect(check({ accepting: false, refusedReason: "Busy hours" })).toEqual([]);
    expect(check({ accepting: true, refusedReason: "Busy hours" })).toEqual(["break.refusedReason.accepting"]);
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

  it("lets only an outstanding request appear on a roster member", () => {
    const member = (over: Record<string, unknown>) => rules(validateTeamRoster({ members: [{ id: "A-2", availability: "on-task", ...over }] }));
    for (const approval of ["awaiting-decision", "granted", "starting-after-task"]) expect(member({ break: approval })).toEqual([]);
    expect(member({ availability: "on-break" })).toEqual([]);
    expect(member({ break: "in-effect" })).toEqual(["team.member.break"]);
    expect(member({ break: "not-requested" })).toEqual(["team.member.break"]);
    expect(member({ availability: "signed-out", break: "granted" })).toEqual(["team.member.break.availability"]);
    expect(member({ availability: "on-break", break: "granted" })).toEqual(["team.member.break.availability"]);
  });

  it("holds a snapshot and an event to the login's session, once told it", () => {
    const login = { sessionId: "session-1" };
    expect(rules(validateSnapshot(snapshot(), manifest(), "snapshot", login))).toEqual([]);
    expect(rules(validateSnapshot(snapshot({ sessionId: "session-0" }), manifest(), "snapshot", login))).toEqual(["snapshot.sessionId.mismatch"]);
    expect(rules(validateSnapshot(snapshot({ sessionId: "session-0" }), manifest()))).toEqual([]);
    const status = { type: "provider-status", status: "active" };
    expect(rules(validateEventEnvelope(envelope(status), manifest(), "event", login))).toEqual([]);
    expect(rules(validateEventEnvelope(envelope(status, { sessionId: "session-0" }), manifest(), "event", login))).toEqual(["event.sessionId.mismatch"]);
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

  it("offers a task only before it is under way, with the mode the login asked for", () => {
    const offer = (over: Record<string, unknown>, context: Record<string, unknown> = {}) =>
      rules(validateEventEnvelope(envelope({ type: "task-offered", task: task({ phase: "pending" }), acceptanceMode: "require-agent-acceptance", ...over }), manifest(), "event", context));
    for (const phase of ["pending", "confirmed", "preparing"]) expect(offer({ task: task({ phase }) })).toEqual([]);
    for (const phase of ["in-progress", "paused", "completing"]) expect(offer({ task: task({ phase }) })).toEqual(["event.taskOffered.phase"]);
    expect(offer({}, { autoAcceptTasks: true })).toEqual([]);
    expect(offer({ acceptanceMode: undefined }, { autoAcceptTasks: true })).toEqual(["event.taskOffered.acceptanceMode.required"]);
    expect(offer({ acceptanceMode: undefined }, { autoAcceptTasks: false })).toEqual([]);
    expect(offer({}, { autoAcceptTasks: false })).toEqual(["event.taskOffered.acceptanceMode.unexpected"]);
    expect(offer({ acceptanceMode: undefined })).toEqual([]);
  });

  it("keeps summary metric ids unique", () => {
    const summary = (metrics: unknown[]) => rules(validateEventEnvelope(envelope({ type: "provider-summary", summary: { title: "Voice", waitingCount: 0, updatedAt: "2026-08-21T09:00:00Z", metrics } }), manifest()));
    const waiting = { id: "waiting", label: "Waiting", value: "3" };
    expect(summary([waiting, { ...waiting, id: "longest" }])).toEqual([]);
    expect(summary([waiting, waiting])).toEqual(["event.summary.metric.unique"]);
  });

  it("carries a failure only on an expired state", () => {
    const user = { id: "agent-1", displayName: "Ada" };
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
    expect(m({ idleCapabilities: { dial: { destinationPolicy: "any-number" } } })).toEqual([]);
    expect(m({ idleCapabilities: { dial: {} } })).toEqual(["manifest.dial.destinationPolicy"]);
    expect(m({ idleCapabilities: { personalBrowser: { access: { mode: "block-all", allowList: [], blockList: [] } } } })).toEqual([]);
    expect(m({ idleCapabilities: { personalBrowser: { access: "block-all" } } })).toEqual(["manifest.personalBrowser.access.shape"]);
  });

  it("disposition policies and codes", () => {
    const policy = (over: unknown) => rules(validateTask(task({ capabilities: { dispositions: over } }), voice));
    const resolved = { id: "resolved", label: "Resolved" };
    expect(policy({ required: false, notes: "optional", codes: [resolved] })).toEqual([]);
    expect(policy({ required: "yes" })).toEqual(["task.dispositions.required"]);
    expect(policy({ notes: "sometimes" })).toEqual(["task.dispositions.notes"]);
    expect(policy({ codes: "resolved" })).toEqual(["task.dispositions.codes"]);
    expect(policy({ codes: [{ label: "Resolved" }] })).toEqual(["task.disposition.id"]);
    expect(policy({ codes: [{ id: "resolved" }] })).toEqual(["task.disposition.label"]);
    expect(policy({ codes: [resolved, resolved] })).toEqual(["task.disposition.unique"]);
  });

  it("custom controls", () => {
    const custom = (over: unknown) => rules(validateTask(task({ capabilities: { custom: over } }), voice));
    const control = { id: "supervisor", ui: { kind: "button", label: "Request supervisor", placement: "secondary" } };
    expect(custom([control])).toEqual([]);
    expect(custom("supervisor")).toEqual(["task.custom.shape"]);
    expect(custom(["supervisor"])).toEqual(["task.custom.entry"]);
    expect(custom([{ ui: control.ui }])).toEqual(["task.custom.id"]);
    expect(custom([control, control])).toEqual(["task.custom.unique"]);
    expect(custom([{ id: "supervisor" }])).toEqual(["task.custom.ui"]);
    expect(custom([{ ...control, ui: { ...control.ui, kind: "dial" } }])).toEqual(["task.custom.ui.kind"]);
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
    const offer = { type: "task-offered", task: task({ phase: "pending" }), acceptanceMode: "require-agent-acceptance" };
    expect(check({ ...offer, allocationExpiresAt: "2026-08-21T09:01:00Z", preparationEndsAt: "2026-08-21T09:02:00Z" })).toEqual([]);
    expect(check({ ...offer, allocationExpiresAt: "soon" })).toEqual(["event.taskOffered.allocationExpiresAt"]);
    expect(check({ ...offer, preparationEndsAt: "soon" })).toEqual(["event.taskOffered.preparationEndsAt"]);
    const ended = (outcome: unknown) => check({ type: "task-ended", taskId: "call-42", outcome });
    expect(ended({ type: "transferred", destination: "+14155550111" })).toEqual([]);
    expect(ended({ type: "transferred", destination: "" })).toEqual(["event.taskEnded.outcome.transferred"]);
    expect(ended({ type: "cancelled", reason: "Caller hung up" })).toEqual([]);
    expect(ended({ type: "cancelled", reason: "" })).toEqual(["event.taskEnded.outcome.cancelled"]);
    expect(check({ type: "provider-status", status: "error", message: "Upstream down" })).toEqual([]);
    expect(check({ type: "provider-status", status: "error", message: "" })).toEqual(["event.providerStatus.message"]);
  });
});

describe("validateAuthenticationState", () => {
  const user = { id: "agent-1", displayName: "Ada" };

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
    expect(validateAuthenticationState({ status: "authenticated", identity: user, capabilities: { breaks: true, team: { breakControl: true, consultControl: true } } })).toEqual([]);
    expect(validateAuthenticationState({ status: "expired" })).toEqual([]);
    expect(validateAuthenticationState({ status: "expired", identity: user })).toEqual([]);
  });

  it.each([
    ["a status the contract dropped", { status: "connected" }, "authentication.status"],
    ["authenticated with no identity", { status: "authenticated" }, "authentication.identity"],
    ["refreshing with no identity", { status: "refreshing" }, "authentication.identity"],
    ["an identity with no id", { status: "authenticated", identity: { displayName: "Ada" } }, "authentication.identity.id"],
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
    expect(rules(validateTask(task({ capabilities: { consultTransfer: { allowManualEntry: true } } }), voice))).toEqual([]);
    expect(rules(validateTask(task({ capabilities: { consultTransfer: { allowManualEntry: false } } }), voice))).toEqual(["task.destinations.offer"]);
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

  it("puts requests on the roster only where the login may act on them", () => {
    const request = { id: "req-7", memberId: "A-1", taskId: "call-42", note: "Refund dispute", since: "2026-08-21T09:04:00Z" };
    const members = [{ id: "A-1", availability: "on-task" }];
    const may = { capabilities: { team: { consultControl: true as const } } };
    const mayNot = { capabilities: { team: {} } };
    expect(rules(validateTeamRoster({ members, requests: [request] }, "team", may))).toEqual([]);
    expect(rules(validateTeamRoster({ members, requests: [] }, "team", may))).toEqual([]);
    expect(rules(validateTeamRoster({ members, requests: [request] }, "team", mayNot))).toContain("team.requests.capability");
    // And the other way: a login that may be asked always carries the list, `[]` included.
    expect(rules(validateTeamRoster({ members }, "team", may))).toEqual(["team.requests.required"]);
    expect(rules(validateTeamRoster({ members }, "team", mayNot))).toEqual([]);
    // The permission is on the login, so without the login in hand neither rule is checked.
    expect(rules(validateTeamRoster({ members, requests: [request] }))).toEqual([]);
    expect(rules(validateTeamRoster({ members }))).toEqual([]);
    // Through the snapshot, the path adapters actually take.
    expect(rules(validateSnapshot(snapshot({ team: { members, requests: [request] } }), manifest(), "snapshot", mayNot))).toEqual(["team.requests.capability"]);
    expect(rules(validateSnapshot(snapshot({ team: { members, requests: [request] } }), manifest(), "snapshot", may))).toEqual([]);
    expect(rules(validateTeamRoster({ members, requests: [request, request] }, "team", may))).toContain("team.request.unique");
    expect(rules(validateTeamRoster({ members, requests: [{ ...request, taskId: "" }] }, "team", may))).toContain("team.request.taskId");
    expect(rules(validateTeamRoster({ members, requests: [{ ...request, since: "now" }] }, "team", may))).toContain("team.request.since");
  });

  it("accepts the left outcome, and still refuses one the contract lacks", () => {
    const ended = (outcome: unknown) => envelope({ type: "task-ended", taskId: "call-42", outcome });
    expect(rules(validateEventEnvelope(ended({ type: "left" }), manifest()))).toEqual([]);
    expect(rules(validateEventEnvelope(ended({ type: "vanished" }), manifest()))).toContain("event.taskEnded.outcome.type");
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
