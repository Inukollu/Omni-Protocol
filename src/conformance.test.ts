import { describe, expect, it, vi } from "vitest";
import {
  OMNI_PROTOCOL_VERSION,
  type Adapter,
  type Connection,
  type Manifest,
  type ProviderEventEnvelope,
  type AuthenticationState, type Host, type HostGuarantees, type HostReport, type ConnectContext, type UserCapabilities, type Snapshot,
} from "./index.js";
import { ProtocolConformanceError, exerciseAdapter, assertReached, type ContractSubject , stillHost } from "./testing.js";

/** A voice host with everything working: the microphone captured and flowing, a speaker present. */
const speaking: HostReport = { online: true, audio: { input: { status: "available", localAudio: {} as MediaStream, flowing: true }, output: { status: "available" } } };
const context = { protocolVersion: OMNI_PROTOCOL_VERSION, loginId: "session-1", host: stillHost(speaking) };
/** The host a connection on this manifest's channel gets: audio for voice, none for the rest. */
const hostFor = (manifest: unknown): Host =>
  stillHost((manifest as { channel?: string } | undefined)?.channel === "voice" ? speaking : { online: true });

const conformingManifest = {
  id: "acme-voice",
  displayName: "Acme Voice",
  channel: "voice",
  supportedProtocolVersions: [OMNI_PROTOCOL_VERSION],
  authenticationMethods: ["browser-sso"],
  idleCapabilities: {
    dial: { destinations: "any-number" },
    contacts: true,
    calendar: true,
    personalBrowser: { access: { mode: "block-all", allowList: ["https://*.example.com/*"], blockList: [] } },
  },
} satisfies Manifest<"voice">;

// Declares breaks and publishes a UserId, so the conforming connection below has to carry the
// four break methods and describeUsers().
const conformingSnapshot = {
  transport: "active",
  loginId: "session-1",
  break: { approval: "not-requested", mayAsk: true },
  tasks: [{
    id: "call-42",
    title: "Customer call",
    channel: "voice",
    taskType: "Customer Support",
    capabilities: {
      browsers: true,
      hold: true,
      mute: true,
      dispositions: { required: true, notes: "optional", codes: [{ id: "resolved", label: "Resolved" }, { id: "callback", label: "Callback needed" }] },
      blindTransfer: { allowManualEntry: true, destinations: [{ id: "tier2", label: "Tier 2", address: "+14155550111", kind: "queue" }] },
      custom: [{ id: "request-supervisor", ui: { control: "button", label: "Request supervisor", placement: "secondary" } }],
    },
    phase: "in-progress",
    media: "started",
    completionMode: "agent-command",
    wrapAllowance: 60,
    party: { name: "Maya Rao", number: "+919876543210" },
    browsers: [
      { id: "crm", name: "CRM", purpose: "Customer record", url: "https://crm.example.com/42", sharedSession: true, isolationScheme: "ProviderName.TaskTypeName.TabName" },
      { id: "kb", name: "Knowledge", purpose: "Article lookup", url: "https://kb.example.com/", sharedSession: false },
    ],
    handlingHistory: [
      { step: "queued", at: "2026-08-21T08:59:19Z", seconds: 41 },
      { step: "answered", at: "2026-08-21T09:00:00Z", by: "A-1" },
    ],
  }],
  taskCount: 1,
  contacts: [{ name: "Asha Rao", number: "+919876543210", email: "asha@example.com", attributes: [{ key: "Category", value: "High priority" }] }],
  scheduledActivities: [{ id: "cb-1", title: "Callback", startsAt: "2026-08-21T10:00:00Z", endsAt: "2026-08-21T10:15:00Z" }],
} satisfies Snapshot<"voice">;

/** Declares nothing optional, so no optional method is required of it. */
const minimalSnapshot = {
  transport: "active",
  loginId: "session-1",
  break: { approval: "not-requested", mayAsk: true },
  tasks: [], taskCount: 0,
} satisfies Snapshot<"voice">;

/** Declares no idle capability, so the minimal snapshot owes it no contribution. */
const plainManifest = { ...conformingManifest, idleCapabilities: undefined } satisfies Manifest<"voice">;

interface AdapterOverrides {
  manifest?: unknown;
  snapshot?: unknown;
  emit?: (listener: (envelope: ProviderEventEnvelope<"voice">) => void) => void;
  /** Replaces connect() entirely, for an adapter that cannot connect. */
  connect?: () => Promise<never>;
  /** An adapter that never asks the host anything. */
  ignoresHost?: boolean;
  /** Publishes authentication states to the harness once it subscribes to the session. */
  emitAuthentication?: (listener: (state: AuthenticationState) => void) => void;
  /** Methods to replace, or to remove by passing `undefined`. */
  connection?: Partial<Record<keyof Connection<"voice">, unknown>>;
  authenticated?: boolean;
  /** What the login declares. Breaks by default, so the conforming connection needs the four methods. */
  capabilities?: UserCapabilities;
  disconnect?: () => Promise<void>;
  close?: () => Promise<void>;
}

function makeAdapter(overrides: AdapterOverrides = {}) {
  const disconnect = vi.fn(overrides.disconnect ?? (async () => undefined));
  const close = vi.fn(overrides.close ?? (async () => undefined));
  const unsubscribe = vi.fn(() => undefined);
  const unsubscribeAuthentication = vi.fn(() => undefined);
  const adapter = {
    manifest: (overrides.manifest ?? conformingManifest) as Manifest<"voice">,
    async createAuthenticationSession() {
      return {
        state: () => overrides.authenticated === false
          ? { status: "signed-out" as const }
          : { status: "authenticated" as const, identity: { id: "1042", displayName: "Asha Rao" }, capabilities: overrides.capabilities ?? { breaks: true }, expiresAt: "2026-08-21T12:00:00Z" },
        subscribe: (listener: (state: AuthenticationState) => void) => {
          overrides.emitAuthentication?.(listener);
          return unsubscribeAuthentication;
        },
        start: async () => ({ status: "rejected" as const, failure: { code: "already-authenticated", message: "Already authenticated", retryable: false } }),
        complete: async () => ({ status: "rejected" as const, failure: { code: "no-flow", message: "No authentication flow", retryable: false } }),
        cancelAuthentication: async () => ({ status: "applied" as const }),
        signOut: async () => ({ status: "applied" as const }),
        close,
      };
    },
    async connect(connectContext) {
      if (overrides.connect !== undefined) return overrides.connect();
      // A voice adapter consults the host before it declares the agent ready to its platform.
      if (overrides.ignoresHost !== true) connectContext.host.report();
      const connection: Connection<"voice"> = {
        snapshot: async () => {
          // Give any queued asynchronous emission a chance to land before shutdown.
          await Promise.resolve();
          await Promise.resolve();
          return (overrides.snapshot ?? conformingSnapshot) as Snapshot<"voice">;
        },
        subscribe: listener => {
          overrides.emit?.(listener);
          return unsubscribe;
        },
        setCapacity: async () => ({ status: "applied" }),
        execute: async () => ({ status: "applied" }),
        disconnect,
        describeUsers: async ids => ids.map(id => ({ id, displayName: `User ${id}` })),
        dial: async () => ({ status: "dialled" }),
        requestBreak: async () => ({ status: "requested" }),
        commitBreak: async () => ({ status: "committed" }),
        cancelBreak: async () => ({ status: "cancelled" }),
        endBreak: async () => ({ status: "ended" }),
        executeTeamBreak: async () => ({ status: "applied" }),
        executeTeamConsult: async () => ({ status: "applied" }),
        setPreference: async () => ({ status: "applied" }),
        executeTeamPolicy: async () => ({ status: "applied" }),
        openMedia: async () => ({ status: "unavailable", failure: { code: "test", message: "No media in a test", retryable: false } }),
      };
      return { ...connection, ...overrides.connection } as Connection<"voice">;
    },
  } satisfies Adapter<"voice">;
  return { adapter, disconnect, close, unsubscribe, unsubscribeAuthentication };
}

const rules = async (overrides: AdapterOverrides) =>
  (await exerciseAdapter(makeAdapter(overrides).adapter, { ...context, host: hostFor(overrides.manifest ?? conformingManifest) }, { collectOnly: true })).violations.map(violation => violation.rule);

const badEnvelope = { id: "", loginId: "session-1", occurredAt: "not-a-time", event: { type: "transport-status", status: "active" } } as unknown as ProviderEventEnvelope<"voice">;

describe("exerciseAdapter", () => {
  it("accepts a rich conforming adapter and releases its resources", async () => {
    const { adapter, disconnect, close, unsubscribe, unsubscribeAuthentication } = makeAdapter();
    const result = await exerciseAdapter(adapter, context);
    expect(result.violations).toEqual([]);
    expect(result.disconnectWasClean).toBe(true);
    expect(result.authenticationState.status).toBe("authenticated");
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(unsubscribeAuthentication).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("says what the run never reached, so a clean result is read for what it covers", async () => {
    // The rich fixture carries a task, a contact and an activity but no roster, no break reasons,
    // no imposed break, and delivers no event; the bare fixture reaches nothing at all.
    const run = async (overrides: AdapterOverrides) =>
      (await exerciseAdapter(makeAdapter(overrides).adapter, context, { collectOnly: true })).notExercised;
    const state = (subjects: readonly ContractSubject[]) => subjects.filter(subject => !subject.startsWith("event."));
    const events = (subjects: readonly ContractSubject[]) => subjects.filter(subject => subject.startsWith("event."));
    const everyEvent: ContractSubject[] = [
      "event.snapshot", "event.transport-status", "event.break-state", "event.task-offered", "event.task-updated",
      "event.task-media-started", "event.task-media-ended", "event.task-ended", "event.announcement", "event.queue-summary",
      "event.team-updated", "event.contacts-updated", "event.calendar-updated",
    ];
    // The rich task carries browsers, history, a disposition policy, transfer destinations and a
    // custom control, but no attributes and is neither consulting, asking for a lead, nor assisting.
    const rich = await run({});
    expect(state(rich)).toEqual(["task.attributes", "task.consultation", "task.lead", "task.assisting", "task.locked", "break.reasons", "break.imposed", "team.members", "team.requests", "team.policies"]);
    expect(events(rich)).toEqual(everyEvent);
    const bare = await run({ manifest: plainManifest, snapshot: minimalSnapshot });
    expect(state(bare)).toEqual([
      "tasks", "task.browsers", "task.attributes", "task.handlingHistory", "task.consultation", "task.lead", "task.assisting",
      "task.media", "task.dispositions", "task.destinations", "task.custom", "task.locked", "break.reasons", "break.imposed", "team.members", "team.requests",
      "contacts", "scheduledActivities", "team.policies",
    ]);
    // Each subject drops out exactly when the run meets it -- on the snapshot or on an event.
    const reached = {
      ...conformingSnapshot,
      break: { approval: "in-effect", mayAsk: true, reasons: [{ id: "lunch", label: "Lunch" }], imposed: { by: "M-1", endsAutomatically: false } },
      team: { members: [{ id: "A-2", availability: "on-task" }], requests: [{ id: "req-7", memberId: "A-2", taskId: "call-42", since: "2026-08-21T09:04:00Z" }] },
    } satisfies Snapshot<"voice">;
    expect(state(await run({ capabilities: { team: { consultControl: true } }, snapshot: reached })))
      .toEqual(["task.attributes", "task.consultation", "task.lead", "task.assisting", "task.locked", "team.policies"]);
    const later: ProviderEventEnvelope<"voice"> = {
      id: "evt-team", loginId: "session-1", occurredAt: "2026-08-21T09:05:00Z",
      event: { type: "team-updated", team: { members: [{ id: "A-2", availability: "ready" }] } },
    };
    const rosterOnly = { ...conformingSnapshot, team: { members: [] } } satisfies Snapshot<"voice">;
    const withEvent = await run({ capabilities: { team: {} }, snapshot: rosterOnly, emit: listener => listener(later) });
    expect(state(withEvent)).toEqual(["task.attributes", "task.consultation", "task.lead", "task.assisting", "task.locked", "break.reasons", "break.imposed", "team.requests", "team.policies"]);
    expect(events(withEvent)).toEqual(everyEvent.filter(subject => subject !== "event.team-updated"));
  });

  it("assertReached names every subject a run never met, and passes those it did", async () => {
    const result = await exerciseAdapter(makeAdapter().adapter, context, { collectOnly: true });
    expect(() => assertReached(result, ["tasks", "task.browsers", "contacts"])).not.toThrow();
    expect(() => assertReached(result, ["tasks", "team.members", "event.task-ended"])).toThrow(/never reached team\.members, event\.task-ended/);
  });

  it("holds a snapshot to its stated task count", async () => {
    // The conforming fixtures carry reconciled counts; a count nobody's tasks agree with is refused.
    expect(await rules({ manifest: plainManifest, snapshot: { ...minimalSnapshot, taskCount: 5 } })).toEqual(["snapshot.taskCount.mismatch"]);
    const { taskCount: _stated, ...uncounted } = minimalSnapshot;
    expect(await rules({ manifest: plainManifest, snapshot: uncounted })).toEqual(["snapshot.taskCount"]);
  });

  it("requires each contribution the manifest declares, [] included", async () => {
    // The conforming manifest declares contacts and calendar, and the conforming snapshot carries
    // both; the same snapshot without them fails, and passes again under a manifest that declares
    // neither.
    const { contacts: _contacts, scheduledActivities: _activities, ...neither } = conformingSnapshot;
    expect(await rules({ snapshot: neither })).toEqual(expect.arrayContaining(["snapshot.contacts.required", "snapshot.calendar.required"]));
    expect(await rules({ snapshot: { ...neither, contacts: [], scheduledActivities: [] } })).toEqual([]);
    expect(await rules({ manifest: plainManifest, snapshot: neither })).toEqual([]);
  });

  it("collects delivered events and deduplicates repeated ids", async () => {
    const good = { id: "event-1", loginId: "session-1", occurredAt: "2026-08-21T01:00:00Z", event: { type: "transport-status", status: "active" } } as ProviderEventEnvelope<"voice">;
    const { adapter } = makeAdapter({ emit: listener => { listener(good); listener(good); } });
    const result = await exerciseAdapter(adapter, context);
    expect(result.events).toEqual([good]);
  });

  it("reports a non-conforming adapter as a ProtocolConformanceError", async () => {
    const { adapter } = makeAdapter({ manifest: { ...conformingManifest, id: "" } });
    await expect(exerciseAdapter(adapter, context)).rejects.toBeInstanceOf(ProtocolConformanceError);
  });

  it("returns violations instead of throwing under collectOnly", async () => {
    expect(await rules({ manifest: { ...conformingManifest, id: "" } })).toContain("manifest.id");
  });

  it("still releases resources when the adapter does not conform", async () => {
    const { adapter, disconnect, close } = makeAdapter({ manifest: { ...conformingManifest, id: "" } });
    await expect(exerciseAdapter(adapter, context)).rejects.toThrow();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("still releases resources when authentication is not usable", async () => {
    const { adapter, close } = makeAdapter({ authenticated: false });
    await expect(exerciseAdapter(adapter, context)).rejects.toThrow(/requires authenticated test state/);
    expect(close).toHaveBeenCalledOnce();
  });

  it("catches a bad event from a synchronous emitter without unwinding the provider", async () => {
    const emit = vi.fn((listener: (envelope: ProviderEventEnvelope<"voice">) => void) => {
      listener(badEnvelope);
      // Reached only if the listener did not throw back into provider dispatch.
      listener({ id: "event-2", loginId: "session-1", occurredAt: "2026-08-21T01:00:00Z", event: { type: "transport-status", status: "active" } });
    });
    const { adapter } = makeAdapter({ emit });
    const result = await exerciseAdapter(adapter, context, { collectOnly: true });
    const found = result.violations.map(violation => violation.rule);
    expect(found).toContain("event.id");
    expect(found).toContain("event.occurredAt");
    expect(result.events.map(envelope => envelope.id)).toContain("event-2");
  });

  it("catches a bad event from an asynchronous emitter", async () => {
    // The regression that matters: a listener that throws here would surface as an
    // unhandled rejection and the exercise would resolve as though the adapter conformed.
    const { adapter } = makeAdapter({ emit: listener => { queueMicrotask(() => listener(badEnvelope)); } });
    const result = await exerciseAdapter(adapter, context, { collectOnly: true });
    expect(result.violations.map(violation => violation.rule)).toContain("event.occurredAt");
  });

  it("reports an unclean shutdown rather than hiding it", async () => {
    const { adapter } = makeAdapter({ disconnect: async () => { throw new Error("socket already gone"); } });
    const result = await exerciseAdapter(adapter, context, { collectOnly: true });
    expect(result.disconnectWasClean).toBe(false);
    expect(result.violations.map(violation => violation.rule)).toContain("connection.disconnect.clean");
  });

  it("validates the capacity result as it does a snapshot", async () => {
    // An adapter compiled against another version may answer a shape the host does not know.
    expect(await rules({ connection: { setCapacity: async () => ({ status: "ok" }) } })).toContain("result.status");
    expect(await rules({ connection: { setCapacity: async () => ({ status: "failed" }) } })).toContain("result.failure.required");
    expect(await rules({})).not.toContain("result.status");
  });

  it("flags a provider that will not accept a capacity", async () => {
    const failed = { status: "failed", failure: { code: "omni.unavailable", message: "down", retryable: true } };
    expect(await rules({ connection: { setCapacity: async () => failed } })).toContain("connection.setCapacity.failed");
  });
});

describe("exerciseAdapter requires each method the declarations call for", () => {
  // Every case pairs the refusal with its control: the same adapter with the declaration
  // withdrawn is clean, so a missing method is reported because of the declaration and not
  // because the check fires for everyone.
  const chatManifest = { ...conformingManifest, id: "acme-chat", channel: "chat", idleCapabilities: { contacts: true } } satisfies Manifest<"chat">;
  const chatSnapshot = { ...minimalSnapshot, contacts: [] } satisfies Snapshot<"chat">;

  it("dial(), when the manifest declares dial", async () => {
    expect(await rules({ connection: { dial: undefined } })).toContain("connection.dial.required");
    expect(await rules({ manifest: { ...conformingManifest, idleCapabilities: { contacts: true, calendar: true } }, connection: { dial: undefined } }))
      .not.toContain("connection.dial.required");
  });

  it("openMedia(), of every voice adapter", async () => {
    expect(await rules({ connection: { openMedia: undefined } })).toContain("connection.openMedia.required");
    expect(await rules({ manifest: chatManifest, snapshot: chatSnapshot, connection: { openMedia: undefined, dial: undefined } }))
      .not.toContain("connection.openMedia.required");
  });

  it("all four break methods together, when the login declares breaks", async () => {
    // Requesting without committing is the failure the guide names: a break granted that can
    // never start. Each of the four is required on its own.
    for (const method of ["requestBreak", "commitBreak", "cancelBreak", "endBreak"] as const) {
      expect(await rules({ connection: { [method]: undefined } })).toContain(`connection.${method}.required`);
      expect(await rules({ capabilities: {}, connection: { [method]: undefined } })).not.toContain(`connection.${method}.required`);
    }
  });

  const leadSnapshot = { ...conformingSnapshot, team: { members: [{ id: "A-2", availability: "ready" }] } } satisfies Snapshot<"voice">;

  it("executeTeamBreak(), when the login declares team.breakControl", async () => {
    const deciding = { team: { breakControl: true as const } };
    const watching = { team: {} };
    expect(await rules({ capabilities: deciding, snapshot: leadSnapshot, connection: { executeTeamBreak: undefined } })).toContain("connection.executeTeamBreak.required");
    expect(await rules({ capabilities: watching, snapshot: leadSnapshot, connection: { executeTeamBreak: undefined } })).not.toContain("connection.executeTeamBreak.required");
  });

  it("executeTeamConsult(), when the login declares team.consultControl", async () => {
    const consulting = { team: { consultControl: true as const } };
    const watching = { team: {} };
    expect(await rules({ capabilities: consulting, snapshot: leadSnapshot, connection: { executeTeamConsult: undefined } })).toContain("connection.executeTeamConsult.required");
    expect(await rules({ capabilities: watching, snapshot: leadSnapshot, connection: { executeTeamConsult: undefined } })).not.toContain("connection.executeTeamConsult.required");
  });

  it("validates every authentication state the session publishes during the run", async () => {
    const asha = { id: "1042", displayName: "Asha Rao" };
    const forgetful = { status: "refreshing", identity: asha } as unknown as AuthenticationState;
    const careful = { status: "refreshing", identity: asha, capabilities: { breaks: true } } satisfies AuthenticationState;
    expect(await rules({ emitAuthentication: publish => publish(forgetful) })).toContain("authentication.capabilities.shape");
    expect(await rules({ emitAuthentication: publish => publish(careful) })).not.toContain("authentication.capabilities.shape");
  });

  it("keeps the login it could trust when the session publishes a broken state", async () => {
    // A state with no identity is reported and not adopted: the roster is still checked against
    // the lead who signed in, and the run completes instead of throwing inside a listener.
    const roster = { ...minimalSnapshot, team: { members: [{ id: "A-2", availability: "ready" }] } } satisfies Snapshot<"voice">;
    const broken = { status: "authenticated" } as unknown as AuthenticationState;
    const found = await rules({ capabilities: { team: {} }, snapshot: roster, emitAuthentication: publish => publish(broken) });
    expect(found).toContain("authentication.identity");
    expect(found).not.toContain("team.unentitled");
    expect(await rules({ manifest: plainManifest, capabilities: { team: {} }, snapshot: roster })).toEqual([]);
  });

  it("holds refreshing to the login it refreshes", async () => {
    const asha = { id: "1042", displayName: "Asha Rao" };
    const same = { status: "refreshing", identity: asha, capabilities: { team: {} } } satisfies AuthenticationState;
    const fewer = { status: "refreshing", identity: asha, capabilities: {} } satisfies AuthenticationState;
    const other = { status: "refreshing", identity: { id: "A-9", displayName: "Bo" }, capabilities: { team: {} } } satisfies AuthenticationState;
    const roster = { ...minimalSnapshot, team: { members: [] } } satisfies Snapshot<"voice">;
    const lead = { team: {} };
    expect(await rules({ manifest: plainManifest, capabilities: lead, snapshot: roster, emitAuthentication: publish => publish(same) })).toEqual([]);
    expect(await rules({ manifest: plainManifest, capabilities: lead, snapshot: roster, emitAuthentication: publish => publish(fewer) })).toEqual(["authentication.refreshing.capabilities"]);
    expect(await rules({ manifest: plainManifest, capabilities: lead, snapshot: roster, emitAuthentication: publish => publish(other) })).toEqual(["authentication.refreshing.identity"]);
  });

  it("requires the methods a later login grants, and reports the latest login", async () => {
    // Signed in without breaks, then granted them after the snapshot was checked -- the grant is
    // published from setCapacity, the last thing the harness calls -- so the four methods are
    // required by the listener, not by the check that ran at snapshot time. The paired republish
    // grants nothing.
    const asha = { id: "1042", displayName: "Asha Rao" };
    const granted = { status: "authenticated", identity: asha, capabilities: { breaks: true } } satisfies AuthenticationState;
    const unchanged = { status: "authenticated", identity: asha, capabilities: {} } satisfies AuthenticationState;
    const later = (state: AuthenticationState): AdapterOverrides => {
      let publish: ((state: AuthenticationState) => void) | undefined;
      return {
        capabilities: {},
        connection: {
          requestBreak: undefined,
          setCapacity: async () => { publish?.(state); return { status: "applied" as const }; },
        },
        emitAuthentication: listener => { publish = listener; },
      };
    };
    expect(await rules(later(granted))).toContain("connection.requestBreak.required");
    expect(await rules(later(unchanged))).not.toContain("connection.requestBreak.required");
    const overrides = later(granted);
    const { adapter } = makeAdapter({ ...overrides, connection: { setCapacity: overrides.connection?.setCapacity } });
    const result = await exerciseAdapter(adapter, context, { collectOnly: true });
    expect(result.authenticationState).toMatchObject({ capabilities: {} });
    expect(result.login).toMatchObject({ capabilities: { breaks: true } });
  });

  it("requests follow the login's consultControl both ways", async () => {
    const members = [{ id: "A-2", availability: "on-task" as const }];
    const request = { id: "req-7", memberId: "A-2", taskId: "call-42", since: "2026-08-21T09:04:00Z" };
    const asking = { ...minimalSnapshot, team: { members, requests: [request] } } satisfies Snapshot<"voice">;
    const silent = { ...minimalSnapshot, team: { members } } satisfies Snapshot<"voice">;
    const may = { team: { consultControl: true as const } };
    const mayNot = { team: {} };
    const plain = { manifest: plainManifest };
    expect(await rules({ ...plain, capabilities: may, snapshot: asking })).toEqual([]);
    expect(await rules({ ...plain, capabilities: mayNot, snapshot: silent })).toEqual([]);
    expect(await rules({ ...plain, capabilities: mayNot, snapshot: asking })).toEqual(["team.requests.capability"]);
    expect(await rules({ ...plain, capabilities: may, snapshot: silent })).toEqual(["team.requests.required"]);
  });

  it("holds what follows to the latest login, not the one captured at sign-in", async () => {
    // Signed in as a lead, then demoted before the snapshot: the roster on that snapshot is now
    // published to a login that does not lead. A harness that froze the login at sign-in would
    // pass it. The paired run republishes the same capabilities and stays clean.
    const asha = { id: "1042", displayName: "Asha Rao" };
    const roster = { ...minimalSnapshot, team: { members: [{ id: "A-2", availability: "ready" }] } } satisfies Snapshot<"voice">;
    const demoted = { status: "authenticated", identity: asha, capabilities: {} } satisfies AuthenticationState;
    const unchanged = { status: "authenticated", identity: asha, capabilities: { team: {} } } satisfies AuthenticationState;
    expect(await rules({ capabilities: { team: {} }, snapshot: roster, emitAuthentication: publish => publish(demoted) })).toContain("team.unentitled");
    expect(await rules({ capabilities: { team: {} }, snapshot: roster, emitAuthentication: publish => publish(unchanged) })).not.toContain("team.unentitled");
  });

  it("a login that leads must publish a roster, and one that does not must not", async () => {
    // The case a fixture cannot hide: the login says lead, and the run never saw a roster.
    const roster = { ...minimalSnapshot, team: { members: [] } } satisfies Snapshot<"voice">;
    expect(await rules({ capabilities: { team: {} }, snapshot: minimalSnapshot })).toContain("team.required");
    expect(await rules({ capabilities: { team: {} }, snapshot: roster })).not.toContain("team.required");
    expect(await rules({ capabilities: {}, snapshot: roster })).toContain("team.unentitled");
    expect(await rules({ capabilities: {}, snapshot: minimalSnapshot })).not.toContain("team.unentitled");
  });

  it("nothing published to the signed-in agent may list them, on the snapshot or on a team-updated", async () => {
    // The stub authenticates as 1042. A colleague alone passes; the reader beside them fails —
    // and fails just the same when the roster arrives after a clean connect snapshot.
    const colleague = { id: "A-2", availability: "ready" } as const;
    const reader = { id: "1042", availability: "on-task" } as const;
    const withColleague = { ...minimalSnapshot, team: { members: [colleague] } } satisfies Snapshot<"voice">;
    const withReader = { ...minimalSnapshot, team: { members: [colleague, reader] } } satisfies Snapshot<"voice">;
    const leads = { team: {} };
    expect(await rules({ capabilities: leads, snapshot: withColleague })).not.toContain("team.member.self");
    expect(await rules({ capabilities: leads, snapshot: withReader })).toContain("team.member.self");
    const later: ProviderEventEnvelope<"voice"> = {
      id: "evt-team", loginId: "session-1", occurredAt: "2026-08-21T09:05:00Z",
      event: { type: "team-updated", team: { members: [colleague, reader] } },
    };
    expect(await rules({ capabilities: leads, snapshot: withColleague, emit: listener => listener(later) })).toContain("team.member.self");
  });

  it("holds the event stream to what came before it, from the connect snapshot on", async () => {
    // The conforming snapshot carries call-42 in progress; its media may end. A task the stream
    // never introduced may not; the same events before any snapshot are judged alone.
    const at = "2026-08-21T09:05:00Z";
    const ended = (taskId: string): ProviderEventEnvelope<"voice"> => ({ id: `evt-${taskId}`, loginId: "session-1", occurredAt: at, event: { type: "task-media-ended", taskId } });
    // Delivered from setCapacity, which the harness calls after the snapshot; before it, the
    // stream has no beginning and the same events are judged alone.
    const after = (envelope: ProviderEventEnvelope<"voice">): AdapterOverrides => {
      let deliver: ((envelope: ProviderEventEnvelope<"voice">) => void) | undefined;
      return {
        emit: listener => { deliver = listener; },
        connection: { setCapacity: async () => { deliver?.(envelope); return { status: "applied" as const }; } },
      };
    };
    expect(await rules(after(ended("call-42")))).toEqual([]);
    expect(await rules(after(ended("call-99")))).toEqual(["stream.taskMediaEnded.unknown"]);
    expect(await rules({ emit: listener => listener(ended("call-99")) })).toEqual([]);
  });

  it("validates the guarantees of the host a test hands the adapter, and passes them through to it", async () => {
    // A false guarantee is a host that cannot exist; the harness says so. A true one reaches the
    // adapter through the wrapped host, so an adapter can decide on it.
    const promising: Host = { guarantees: { personConsent: true }, report: () => ({ online: true }), subscribe: () => () => undefined };
    let seen: HostGuarantees | undefined;
    const { adapter } = makeAdapter();
    const observing = { ...adapter, connect: async (connectContext: ConnectContext) => { seen = connectContext.host.guarantees; return adapter.connect(connectContext); } } as typeof adapter;
    expect((await exerciseAdapter(observing, { ...context, host: { ...promising, report: () => speaking } }, { collectOnly: true })).violations.map(v => v.rule)).toEqual([]);
    expect(seen).toEqual({ personConsent: true });
    const lying: Host = { ...promising, guarantees: { personConsent: false } as unknown as HostGuarantees, report: () => speaking };
    expect((await exerciseAdapter(makeAdapter().adapter, { ...context, host: lying }, { collectOnly: true })).violations.map(v => v.rule)).toEqual(["host.guarantee.value"]);
  });

  it("validates the host report a test hands the adapter, first and later, and lets go of it", async () => {
    // A malformed host report is a host that cannot exist; the harness says so rather than let
    // an adapter pass against it.
    const microphone = { id: "mic" } as unknown as MediaStream;
    const failure = { code: "host.permission-denied", message: "Microphone access was refused", retryable: true };
    const unsubscribe = vi.fn(() => undefined);
    const host = (first: unknown, later?: unknown): Host => ({
      guarantees: {},
      report: () => first as HostReport,
      subscribe: listener => { if (later !== undefined) listener(later as HostReport); return unsubscribe; },
    });
    const run = async (h: Host) =>
      (await exerciseAdapter(makeAdapter().adapter, { ...context, host: h }, { collectOnly: true })).violations.map(violation => violation.rule);
    const speaking = { online: true, audio: { input: { status: "available", localAudio: microphone, flowing: true }, output: { status: "available" } } };
    expect(await run(host(speaking))).toEqual([]);
    expect(await run(host({ online: true, audio: { input: { status: "unavailable", reason: "denied", failure }, output: { status: "available" } } }))).toEqual([]);
    expect(await run(host({ online: true, audio: { input: { status: "available", flowing: true }, output: { status: "available" } } }))).toEqual(["host.audio.input.localAudio"]);
    expect(await run(host(speaking, { online: "yes" }))).toEqual(["host.online"]);
    expect(unsubscribe).toHaveBeenCalledTimes(4);
    expect(await rules({})).toEqual([]);
  });

  it("gives a voice connection a host with audio and no other, and refuses an adapter that never asked", async () => {
    const chatManifest = { ...conformingManifest, id: "acme-chat", channel: "chat", idleCapabilities: { contacts: true } } satisfies Manifest<"chat">;
    const chatSnapshot = { ...minimalSnapshot, contacts: [] } satisfies Snapshot<"chat">;
    const run = async (overrides: AdapterOverrides, host: Host) =>
      (await exerciseAdapter(makeAdapter(overrides).adapter, { ...context, host }, { collectOnly: true })).violations.map(violation => violation.rule);
    expect(await run({}, stillHost(speaking))).toEqual([]);
    expect(await run({}, stillHost({ online: true }))).toEqual(["context.host.audio.required"]);
    const chat = { manifest: chatManifest, snapshot: chatSnapshot, connection: { openMedia: undefined, dial: undefined } };
    expect(await run(chat, stillHost({ online: true }))).toEqual([]);
    expect(await run(chat, stillHost(speaking))).toEqual(["context.host.audio.unexpected"]);
    // The obligation: a voice adapter asks. A chat adapter has nothing to ask about and is not held to it.
    expect(await rules({ ignoresHost: true })).toEqual(["connection.host.consulted"]);
    expect(await rules({ ...chat, ignoresHost: true })).toEqual([]);
  });

  it("releases the host subscription when connect itself throws", async () => {
    const unsubscribe = vi.fn(() => undefined);
    const host: Host = { guarantees: {}, report: () => speaking, subscribe: () => unsubscribe };
    await expect(exerciseAdapter(makeAdapter({ connect: async () => { throw new Error("no transport"); } }).adapter, { ...context, host }, { collectOnly: true })).rejects.toThrow(/no transport/);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("holds the break's moves to where it stood, from the connect snapshot on", async () => {
    // The conforming snapshot stands at not-requested: a grant may follow, a commit's state may not.
    const at = "2026-08-21T09:05:00Z";
    const moved = (approval: string): ProviderEventEnvelope<"voice"> => ({ id: `evt-${approval}`, loginId: "session-1", occurredAt: at, event: { type: "break-state", break: { approval, mayAsk: true } } }) as ProviderEventEnvelope<"voice">;
    const after = (envelope: ProviderEventEnvelope<"voice">): AdapterOverrides => {
      let deliver: ((envelope: ProviderEventEnvelope<"voice">) => void) | undefined;
      return { emit: listener => { deliver = listener; }, connection: { setCapacity: async () => { deliver?.(envelope); return { status: "applied" as const }; } } };
    };
    expect(await rules(after(moved("granted")))).toEqual([]);
    expect(await rules(after(moved("in-effect")))).toEqual(["stream.breakState.commitBeforeGrant"]);
    // And backwards, through the harness: granted, in effect, then granted again.
    const both = (...envelopes: ProviderEventEnvelope<"voice">[]): AdapterOverrides => {
      let deliver: ((envelope: ProviderEventEnvelope<"voice">) => void) | undefined;
      return { emit: listener => { deliver = listener; }, connection: { setCapacity: async () => { envelopes.forEach(envelope => deliver?.(envelope)); return { status: "applied" as const }; } } };
    };
    expect(await rules(both(moved("granted"), moved("in-effect"), { ...moved("granted"), id: "evt-again" }))).toEqual(["stream.breakState.backwards"]);
  });

  it("holds the snapshot and every event to the login's session", async () => {
    const elsewhere = { ...minimalSnapshot, loginId: "session-0" } satisfies Snapshot<"voice">;
    expect(await rules({ manifest: plainManifest, snapshot: minimalSnapshot })).not.toContain("snapshot.loginId.mismatch");
    expect(await rules({ manifest: plainManifest, snapshot: elsewhere })).toContain("snapshot.loginId.mismatch");
    const stray: ProviderEventEnvelope<"voice"> = { id: "evt-1", loginId: "session-0", occurredAt: "2026-08-21T09:00:00Z", event: { type: "transport-status", status: "active" } };
    expect(await rules({ manifest: plainManifest, snapshot: minimalSnapshot, emit: listener => listener(stray) })).toContain("event.loginId.mismatch");
  });

  it("passes autoAcceptTasks through, absent meaning true", async () => {
    const offered = (acceptanceMode?: "consent"): ProviderEventEnvelope<"voice"> => ({
      id: "evt-offer", loginId: "session-1", occurredAt: "2026-08-21T09:00:00Z",
      event: { type: "task-offered", task: { ...conformingSnapshot.tasks[0]!, phase: "pending" }, ...(acceptanceMode ? { acceptanceMode } : {}) },
    });
    const run = async (autoAcceptTasks: boolean | undefined, envelope: ProviderEventEnvelope<"voice">) =>
      (await exerciseAdapter(makeAdapter({ emit: listener => listener(envelope) }).adapter, { ...context, ...(autoAcceptTasks === undefined ? {} : { autoAcceptTasks }) }, { collectOnly: true }))
        .violations.map(violation => violation.rule);
    expect(await run(undefined, offered("consent"))).toEqual([]);
    expect(await run(undefined, offered())).toContain("event.taskOffered.acceptanceMode.required");
    expect(await run(false, offered())).toEqual([]);
    expect(await run(false, offered("consent"))).toContain("event.taskOffered.acceptanceMode.unexpected");
  });

  it("describeUsers(), when a UserId arrives on an event or on a task's lead or assisting", async () => {
    const at = "2026-08-21T09:05:00Z";
    const bare = { ...minimalSnapshot, tasks: [{ ...conformingSnapshot.tasks[0]!, handlingHistory: [] }] } satisfies Snapshot<"voice">;
    const joined = { ...bare, tasks: [{ ...bare.tasks[0]!, capabilities: { ...bare.tasks[0]!.capabilities, consultLead: true }, lead: { stage: "joined", leadId: "L-9", since: at } }] } satisfies Snapshot<"voice">;
    const assisting = { ...bare, tasks: [{ ...bare.tasks[0]!, assisting: { memberId: "A-1", since: at } }] } satisfies Snapshot<"voice">;
    expect(await rules({ manifest: plainManifest, snapshot: bare, connection: { describeUsers: undefined } })).not.toContain("connection.describeUsers.required");
    expect(await rules({ manifest: plainManifest, snapshot: joined, connection: { describeUsers: undefined } })).toContain("connection.describeUsers.required");
    expect(await rules({ manifest: plainManifest, snapshot: assisting, connection: { describeUsers: undefined } })).toContain("connection.describeUsers.required");
    const later: ProviderEventEnvelope<"voice"> = { id: "evt-team", loginId: "session-1", occurredAt: at, event: { type: "team-updated", team: { members: [{ id: "A-2", availability: "ready" }] } } };
    expect(await rules({ manifest: plainManifest, capabilities: { team: {} }, snapshot: { ...bare, team: { members: [] } }, connection: { describeUsers: undefined }, emit: listener => listener(later) })).toContain("connection.describeUsers.required");
  });

  it("setPreference() and executeTeamPolicy(), when the login declares preferences or policyControl", async () => {
    const choosing = { preferences: [{ id: "mute" as const, label: "Mute", enabled: true, setBy: "team" as const }] };
    expect(await rules({ manifest: plainManifest, snapshot: minimalSnapshot, capabilities: choosing, connection: { setPreference: undefined } })).toContain("connection.setPreference.required");
    expect(await rules({ manifest: plainManifest, snapshot: minimalSnapshot, capabilities: {}, connection: { setPreference: undefined } })).not.toContain("connection.setPreference.required");
    const setting = { team: { policyControl: true as const } };
    const withPolicies = { ...minimalSnapshot, team: { members: [], policies: { mute: { setting: "off", setBy: "team" } } } } satisfies Snapshot<"voice">;
    expect(await rules({ manifest: plainManifest, snapshot: withPolicies, capabilities: setting, connection: { executeTeamPolicy: undefined } })).toContain("connection.executeTeamPolicy.required");
    expect(await rules({ manifest: plainManifest, snapshot: withPolicies, capabilities: setting })).toEqual([]);
    // The roster carries policies exactly when the login may set them.
    expect(await rules({ manifest: plainManifest, snapshot: { ...minimalSnapshot, team: { members: [] } }, capabilities: setting })).toEqual(["team.policies.required"]);
    expect(await rules({ manifest: plainManifest, snapshot: withPolicies, capabilities: { team: {} } })).toEqual(["team.policies.capability"]);
  });

  it("holds who-decided to the manifest's declared ladder, on the login and on the snapshot", async () => {
    const laddered = { ...conformingManifest, orgLevels: [{ id: "org", label: "Your organisation" }, { id: "region", label: "Your region" }, { id: "team", label: "Your team" }, { id: "person", label: "You" }] } satisfies Manifest<"voice">;
    const of = (setBy: string) => ({ preferences: [{ id: "mute" as const, label: "Mute", enabled: true, setBy }] });
    expect(await rules({ manifest: laddered, capabilities: of("region") })).toEqual([]);
    // The ladder is the whole ladder: the default the manifest left out is refused.
    expect(await rules({ manifest: laddered, capabilities: of("site") })).toEqual(["preference.setBy.unknown"]);
    const lockedTask = (lockedBy: string) => ({ ...conformingSnapshot, tasks: [{ ...conformingSnapshot.tasks[0]!, capabilities: { ...conformingSnapshot.tasks[0]!.capabilities, mute: { lockedBy } } }] });
    expect(await rules({ manifest: laddered, snapshot: lockedTask("region") })).toEqual([]);
    expect(await rules({ manifest: laddered, snapshot: lockedTask("site") })).toEqual(["task.capability.locked.lockedBy.unknown"]);
  });

  it("describeUsers(), when the snapshot publishes a UserId anywhere", async () => {
    // The conforming snapshot names A-1 in a handling step; a roster and an imposed break count too.
    expect(await rules({ connection: { describeUsers: undefined } })).toContain("connection.describeUsers.required");
    const roster = { ...minimalSnapshot, team: { members: [{ id: "A-2", availability: "on-task" }] } } satisfies Snapshot<"voice">;
    expect(await rules({ snapshot: roster, connection: { describeUsers: undefined } })).toContain("connection.describeUsers.required");
    const imposed = { ...minimalSnapshot, break: { approval: "in-effect", mayAsk: true, imposed: { by: "M-1", endsAutomatically: false } } } satisfies Snapshot<"voice">;
    expect(await rules({ snapshot: imposed, connection: { describeUsers: undefined } })).toContain("connection.describeUsers.required");
    expect(await rules({ snapshot: minimalSnapshot, connection: { describeUsers: undefined } })).not.toContain("connection.describeUsers.required");
  });

  it("nothing optional of an adapter that declares nothing optional", async () => {
    const bare = { ...conformingManifest, id: "acme-chat", channel: "chat", idleCapabilities: undefined } satisfies Manifest<"chat">;
    const found = await rules({
      manifest: bare,
      capabilities: {},
      snapshot: minimalSnapshot,
      connection: {
        describeUsers: undefined, dial: undefined, requestBreak: undefined, commitBreak: undefined,
        cancelBreak: undefined, endBreak: undefined, executeTeamBreak: undefined, executeTeamConsult: undefined, openMedia: undefined,
      },
    });
    expect(found).toEqual([]);
  });
});
