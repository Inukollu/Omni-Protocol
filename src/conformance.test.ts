import { describe, expect, it, vi } from "vitest";
import {
  OMNI_PROTOCOL_VERSION,
  type Adapter,
  type Connection,
  type Manifest,
  type ProviderEventEnvelope,
  type Snapshot,
} from "./index.js";
import { ProtocolConformanceError, exerciseAdapter } from "./testing.js";

const context = { protocolVersion: OMNI_PROTOCOL_VERSION, sessionId: "session-1" };

const conformingManifest = {
  id: "acme-voice",
  displayName: "Acme Voice",
  channel: "voice",
  supportedProtocolVersions: [OMNI_PROTOCOL_VERSION],
  authenticationMethods: ["browser-sso"],
  idleCapabilities: {
    dial: { destinationPolicy: "any-number" },
    contacts: true,
    calendar: true,
    personalBrowser: { access: { mode: "block-all", allowList: ["https://*.example.com/*"], blockList: [] } },
  },
} satisfies Manifest<"voice">;

// Declares breaks and publishes a UserId, so the conforming connection below has to carry the
// four break methods and describeUsers().
const conformingSnapshot = {
  status: "active",
  sessionId: "session-1",
  sessionCapabilities: { breaks: true },
  break: { approval: "not-requested", accepting: true },
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
      custom: [{ id: "request-supervisor", ui: { kind: "button", label: "Request supervisor", placement: "secondary" } }],
    },
    phase: "in-progress",
    completionMode: "agent-command",
    completionAllowance: 60,
    contact: { name: "Maya Rao", number: "+919876543210" },
    browsers: [
      { id: "crm", name: "CRM", purpose: "Customer record", url: "https://crm.example.com/42", reuse: true, isolationScheme: "ProviderName.TaskTypeName.TabName" },
      { id: "kb", name: "Knowledge", purpose: "Article lookup", url: "https://kb.example.com/", reuse: false },
    ],
    handlingHistory: [
      { step: "queued", at: "2026-08-21T08:59:19Z", seconds: 41 },
      { step: "answered", at: "2026-08-21T09:00:00Z", by: "A-1" },
    ],
  }],
  contacts: [{ name: "Asha Rao", number: "+919876543210", email: "asha@example.com", attributes: [{ key: "Category", value: "High priority" }] }],
  scheduledActivities: [{ id: "cb-1", title: "Callback", startsAt: "2026-08-21T10:00:00Z", endsAt: "2026-08-21T10:15:00Z" }],
} satisfies Snapshot<"voice">;

/** Declares nothing optional, so no optional method is required of it. */
const minimalSnapshot = {
  status: "active",
  sessionId: "session-1",
  sessionCapabilities: {},
  break: { approval: "not-requested", accepting: true },
  tasks: [],
} satisfies Snapshot<"voice">;

interface AdapterOverrides {
  manifest?: unknown;
  snapshot?: unknown;
  emit?: (listener: (envelope: ProviderEventEnvelope<"voice">) => void) => void;
  /** Methods to replace, or to remove by passing `undefined`. */
  connection?: Partial<Record<keyof Connection<"voice">, unknown>>;
  authenticated?: boolean;
  disconnect?: () => Promise<void>;
  close?: () => Promise<void>;
}

function makeAdapter(overrides: AdapterOverrides = {}) {
  const disconnect = vi.fn(overrides.disconnect ?? (async () => undefined));
  const close = vi.fn(overrides.close ?? (async () => undefined));
  const unsubscribe = vi.fn(() => undefined);
  const adapter = {
    manifest: (overrides.manifest ?? conformingManifest) as Manifest<"voice">,
    async createAuthenticationSession() {
      return {
        state: () => overrides.authenticated === false
          ? { status: "signed-out" as const }
          : { status: "authenticated" as const, identity: { id: "1042", displayName: "Asha Rao" }, expiresAt: "2026-08-21T12:00:00Z" },
        subscribe: () => () => undefined,
        start: async () => ({ status: "rejected" as const, failure: { code: "already-authenticated", message: "Already authenticated", retryable: false } }),
        complete: async () => ({ status: "rejected" as const, failure: { code: "no-flow", message: "No authentication flow", retryable: false } }),
        cancelAuthentication: async () => ({ status: "accepted" as const }),
        signOut: async () => ({ status: "accepted" as const }),
        close,
      };
    },
    async connect() {
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
        setCapacity: async () => ({ status: "accepted" }),
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
        openMedia: async () => ({ status: "unavailable", failure: { code: "test", message: "No media in a test", retryable: false } }),
      };
      return { ...connection, ...overrides.connection } as Connection<"voice">;
    },
  } satisfies Adapter<"voice">;
  return { adapter, disconnect, close, unsubscribe };
}

const rules = async (overrides: AdapterOverrides) =>
  (await exerciseAdapter(makeAdapter(overrides).adapter, context, { collectOnly: true })).violations.map(violation => violation.rule);

const badEnvelope = { id: "", sessionId: "session-1", occurredAt: "not-a-time", event: { type: "provider-status", status: "active" } } as unknown as ProviderEventEnvelope<"voice">;

describe("exerciseAdapter", () => {
  it("accepts a rich conforming adapter and releases its resources", async () => {
    const { adapter, disconnect, close, unsubscribe } = makeAdapter();
    const result = await exerciseAdapter(adapter, context);
    expect(result.violations).toEqual([]);
    expect(result.disconnectWasClean).toBe(true);
    expect(result.authenticationState.status).toBe("authenticated");
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("collects delivered events and deduplicates repeated ids", async () => {
    const good = { id: "event-1", sessionId: "session-1", occurredAt: "2026-08-21T01:00:00Z", event: { type: "provider-status", status: "active" } } as ProviderEventEnvelope<"voice">;
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
      listener({ id: "event-2", sessionId: "session-1", occurredAt: "2026-08-21T01:00:00Z", event: { type: "provider-status", status: "active" } });
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
  const withoutBreaks = { ...conformingSnapshot, sessionCapabilities: {} } satisfies Snapshot<"voice">;

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

  it("all four break methods together, when the snapshot declares breaks", async () => {
    // Requesting without committing is the failure the guide names: a break granted that can
    // never start. Each of the four is required on its own.
    for (const method of ["requestBreak", "commitBreak", "cancelBreak", "endBreak"] as const) {
      expect(await rules({ connection: { [method]: undefined } })).toContain(`connection.${method}.required`);
      expect(await rules({ snapshot: withoutBreaks, connection: { [method]: undefined } })).not.toContain(`connection.${method}.required`);
    }
  });

  it("executeTeamBreak(), when the roster carries breakControl", async () => {
    const lead = { ...conformingSnapshot, team: { members: [{ id: "A-2", availability: "ready" }], breakControl: true } } satisfies Snapshot<"voice">;
    const member = { ...conformingSnapshot, team: { members: [{ id: "A-2", availability: "ready" }] } } satisfies Snapshot<"voice">;
    expect(await rules({ snapshot: lead, connection: { executeTeamBreak: undefined } })).toContain("connection.executeTeamBreak.required");
    expect(await rules({ snapshot: member, connection: { executeTeamBreak: undefined } })).not.toContain("connection.executeTeamBreak.required");
  });

  it("executeTeamConsult(), when the roster carries consultControl", async () => {
    const consulting = { ...conformingSnapshot, team: { members: [{ id: "A-2", availability: "on-task" }], consultControl: true, requests: [] } } satisfies Snapshot<"voice">;
    const plain = { ...conformingSnapshot, team: { members: [{ id: "A-2", availability: "on-task" }] } } satisfies Snapshot<"voice">;
    expect(await rules({ snapshot: consulting, connection: { executeTeamConsult: undefined } })).toContain("connection.executeTeamConsult.required");
    expect(await rules({ snapshot: plain, connection: { executeTeamConsult: undefined } })).not.toContain("connection.executeTeamConsult.required");
  });

  it("describeUsers(), when the snapshot publishes a UserId anywhere", async () => {
    // The conforming snapshot names A-1 in a handling step; a roster and an imposed break count too.
    expect(await rules({ connection: { describeUsers: undefined } })).toContain("connection.describeUsers.required");
    const roster = { ...minimalSnapshot, team: { members: [{ id: "A-2", availability: "on-task" }] } } satisfies Snapshot<"voice">;
    expect(await rules({ snapshot: roster, connection: { describeUsers: undefined } })).toContain("connection.describeUsers.required");
    const imposed = { ...minimalSnapshot, break: { approval: "in-effect", accepting: true, imposed: { by: "M-1", endsAutomatically: false } } } satisfies Snapshot<"voice">;
    expect(await rules({ snapshot: imposed, connection: { describeUsers: undefined } })).toContain("connection.describeUsers.required");
    expect(await rules({ snapshot: minimalSnapshot, connection: { describeUsers: undefined } })).not.toContain("connection.describeUsers.required");
  });

  it("nothing optional of an adapter that declares nothing optional", async () => {
    const bare = { ...conformingManifest, id: "acme-chat", channel: "chat", idleCapabilities: undefined } satisfies Manifest<"chat">;
    const found = await rules({
      manifest: bare,
      snapshot: minimalSnapshot,
      connection: {
        describeUsers: undefined, dial: undefined, requestBreak: undefined, commitBreak: undefined,
        cancelBreak: undefined, endBreak: undefined, executeTeamBreak: undefined, executeTeamConsult: undefined, openMedia: undefined,
      },
    });
    expect(found).toEqual([]);
  });
});
