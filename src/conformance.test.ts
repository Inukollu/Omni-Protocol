import { describe, expect, it, vi } from "vitest";
import {
  AuthenticationMethod,
  BrowserIsolationScheme,
  OMNI_PROTOCOL_VERSION,
  type Adapter,
  type Connection,
  type ProviderEventEnvelope,
  type Manifest,
  type Snapshot,
} from "./index.js";
import { ProtocolConformanceError, exerciseAdapter } from "./testing.js";

const context = { protocolVersion: OMNI_PROTOCOL_VERSION, sessionId: "session-1" };

// The approved protocol's shapes. Declared as `unknown` rather than `satisfies` because the
// declarations in index.ts still describe the previous protocol -- the validators are the
// authority here until the types catch up.
const conformingManifest: Record<string, unknown> = {
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
};

const conformingSnapshot: Record<string, unknown> = {
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
};

interface AdapterOverrides {
  manifest?: unknown;
  snapshot?: unknown;
  emit?: (listener: (envelope: ProviderEventEnvelope<"voice">) => void) => void;
  connection?: Partial<Connection<"voice">>;
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
        start: async () => ({ status: "failed" as const, failure: { code: "already-authenticated", message: "Already authenticated", retryable: false } }),
        complete: async () => ({ status: "failed" as const, failure: { code: "no-flow", message: "No authentication flow", retryable: false } }),
        cancelAuthentication: async () => ({ status: "accepted" as const }),
        signOut: async () => ({ status: "accepted" as const }),
        close,
      };
    },
    async connect() {
      return {
        snapshot: async () => {
          // Give any queued asynchronous emission a chance to land before shutdown.
          await Promise.resolve();
          await Promise.resolve();
          return (overrides.snapshot ?? conformingSnapshot) as Snapshot<"voice">;
        },
        subscribe: (listener: (envelope: ProviderEventEnvelope<"voice">) => void) => {
          overrides.emit?.(listener);
          return unsubscribe;
        },
        setCapacity: async () => ({ status: "accepted" as const }),
        requestBreak: async () => ({ status: "accepted" as const }),
        cancelBreak: async () => ({ status: "accepted" as const }),
        resume: async () => ({ status: "accepted" as const }),
        dial: async (request: { commandId: string }) => ({ commandId: request.commandId, status: "applied" as const }),
        execute: async (request: { commandId: string }) => ({ commandId: request.commandId, status: "applied" as const }),
        disconnect,
        ...overrides.connection,
      } as Connection<"voice">;
    },
  } as Adapter<"voice">;
  return { adapter, disconnect, close, unsubscribe };
}

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
    const { adapter } = makeAdapter({ manifest: { ...conformingManifest, id: "" } });
    const result = await exerciseAdapter(adapter, context, { collectOnly: true });
    expect(result.violations.map(violation => violation.rule)).toContain("manifest.id");
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

  it("requires dial() when the manifest enables dial", async () => {
    const { adapter } = makeAdapter({ connection: { dial: undefined } });
    const result = await exerciseAdapter(adapter, context, { collectOnly: true });
    expect(result.violations.map(violation => violation.rule)).toContain("connection.dial.required");
  });

  it("catches a bad event from a synchronous emitter without unwinding the provider", async () => {
    const emit = vi.fn((listener: (envelope: ProviderEventEnvelope<"voice">) => void) => {
      listener(badEnvelope);
      // Reached only if the listener did not throw back into provider dispatch.
      listener({ id: "event-2", sessionId: "session-1", occurredAt: "2026-08-21T01:00:00Z", event: { type: "provider-status", status: "active" } } as ProviderEventEnvelope<"voice">);
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

  it("flags a backend that rejects a zero-capacity signal", async () => {
    const { adapter } = makeAdapter({
      connection: { setCapacity: async () => ({ status: "failed", failure: { code: "omni.unavailable", message: "down", retryable: true } }) },
    });
    const result = await exerciseAdapter(adapter, context, { collectOnly: true });
    expect(result.violations.map(violation => violation.rule)).toContain("connection.setCapacity.rejected");
  });
});
