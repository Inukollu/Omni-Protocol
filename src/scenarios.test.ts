import { describe, expect, it, vi } from "vitest";
import {
  BROWSER_ISOLATION_SCHEMES,
  browserSessionKey,
  type AuthenticationState,
  type Manifest,
  type ProviderEventEnvelope,
  type Snapshot,
  type Task,
  type TaskBrowser,
} from "./index.js";
import {
  assertAuthenticationRestoreAndExpiry,
  assertBrowserIsolationAndReuse,
  assertCapabilityWithdrawal,
  assertCommandRefusedAfterWithdrawal,
  assertDeniedAndRetriedBreak,
  assertDuplicateEventDelivery,
  assertNoBrowserSessionKeyCollisions,
  assertReconnectWithMissedAssignments,
  assertWrapTimeout,
} from "./testing.js";

const voiceTask = {
  id: "call-42",
  title: "Customer call",
  channel: "voice",
  taskType: "Customer Support",
  capabilities: { browsers: true, hold: true },
  phase: "in-progress",
  browsers: [],
  completionMode: "agent-command",
  completionAllowance: 60,
} satisfies Task<"voice">;

const statusEvent = {
  id: "event-1", sessionId: "session-1",
  occurredAt: "2026-08-21T01:00:00Z",
  event: { type: "provider-status", status: "active" },
} as const satisfies ProviderEventEnvelope<"voice">;

describe("assertAuthenticationRestoreAndExpiry", () => {
  it("accepts a restored session that refreshes and then expires", () => {
    expect(() => assertAuthenticationRestoreAndExpiry([
      { status: "authenticated", identity: { id: "A-1", displayName: "Ada" }, capabilities: {} },
      { status: "refreshing", identity: { id: "A-1", displayName: "Ada" }, capabilities: {} },
      { status: "expired", identity: { id: "A-1", displayName: "Ada" }, failure: { code: "expired", message: "Sign in again", retryable: true } },
    ])).not.toThrow();
  });

  it("rejects a sequence that never expires", () => {
    expect(() => assertAuthenticationRestoreAndExpiry([
      { status: "authenticated", identity: { id: "A-1", displayName: "Ada" }, capabilities: {} },
      { status: "refreshing", identity: { id: "A-1", displayName: "Ada" }, capabilities: {} },
    ])).toThrow(/must end in an expired state/);
  });

  it("rejects a sequence that does not start authenticated", () => {
    expect(() => assertAuthenticationRestoreAndExpiry([
      { status: "signed-out" },
      { status: "expired" },
    ])).toThrow(/restored authenticated state/);
  });

  it("validates every state, not only their order", () => {
    // The same sequence three ways: as published, with a state that forgot what the login may
    // do, and with a refresh that quietly changed it.
    const ada = { id: "A-1", displayName: "Ada" };
    const sequence = (refreshing: AuthenticationState) => () => assertAuthenticationRestoreAndExpiry([
      { status: "authenticated", identity: ada, capabilities: { breaks: true } },
      refreshing,
      { status: "expired", identity: ada },
    ]);
    expect(sequence({ status: "refreshing", identity: ada, capabilities: { breaks: true } })).not.toThrow();
    expect(sequence({ status: "refreshing", identity: ada } as unknown as AuthenticationState)).toThrow(/capabilities/);
    expect(sequence({ status: "refreshing", identity: ada, capabilities: {} })).toThrow(/refreshing/);
  });

  it("rejects a refresh reported after expiry", () => {
    expect(() => assertAuthenticationRestoreAndExpiry([
      { status: "authenticated", identity: { id: "A-1", displayName: "Ada" }, capabilities: {} },
      { status: "expired" },
      { status: "refreshing", identity: { id: "A-1", displayName: "Ada" }, capabilities: {} },
      { status: "expired" },
    ])).toThrow(/must occur before expiry/);
  });
});

describe("assertCapabilityWithdrawal", () => {
  const manifest = {
    id: "acme-voice", displayName: "Acme Voice", channel: "voice",
    supportedProtocolVersions: [1], authenticationMethods: ["credentials"],
  } satisfies Manifest<"voice">;
  const ada = { id: "A-1", displayName: "Ada" };
  const lead = { status: "authenticated", identity: ada, capabilities: { breaks: true, team: { breakControl: true } } } satisfies AuthenticationState;
  const demoted = { status: "authenticated", identity: ada, capabilities: { breaks: true } } satisfies AuthenticationState;
  const bare: Snapshot<"voice"> = { status: "active", sessionId: "session-1", break: { approval: "not-requested", accepting: true }, tasks: [] };
  const withRoster: Snapshot<"voice"> = { ...bare, team: { members: [{ id: "A-2", availability: "ready" }] } };

  it("accepts a roster gone with the capability that entitled it, and rejects one that stayed", () => {
    expect(() => assertCapabilityWithdrawal([lead, demoted], bare, manifest)).not.toThrow();
    expect(() => assertCapabilityWithdrawal([lead, demoted], withRoster, manifest)).toThrow(/team\.unentitled/);
  });

  it("holds requests to a withdrawn consultControl, and a snapshot to withdrawn breaks", () => {
    const consulting = { ...lead, capabilities: { team: { consultControl: true as const } } } satisfies AuthenticationState;
    const watching = { ...lead, capabilities: { team: {} } } satisfies AuthenticationState;
    const members = [{ id: "A-2", availability: "on-task" as const }];
    const asking: Snapshot<"voice"> = { ...bare, team: { members, requests: [{ id: "req-7", memberId: "A-2", taskId: "call-42", since: "2026-08-21T09:04:00Z" }] } };
    const silent: Snapshot<"voice"> = { ...bare, team: { members } };
    expect(() => assertCapabilityWithdrawal([consulting, watching], silent, manifest)).not.toThrow();
    expect(() => assertCapabilityWithdrawal([consulting, watching], asking, manifest)).toThrow(/team\.requests\.capability/);
    // Breaks withdrawn: nothing on the snapshot depends on it, so the bare snapshot agrees.
    const noBreaks = { ...lead, capabilities: { team: { breakControl: true as const } } } satisfies AuthenticationState;
    expect(() => assertCapabilityWithdrawal([lead, noBreaks], withRoster, manifest)).not.toThrow();
  });

  it("passes only through usable states, and refreshing must carry the login over", () => {
    const refreshed = { status: "refreshing", identity: ada, capabilities: lead.capabilities } satisfies AuthenticationState;
    const drifted = { status: "refreshing", identity: ada, capabilities: {} } satisfies AuthenticationState;
    expect(() => assertCapabilityWithdrawal([lead, refreshed, demoted], bare, manifest)).not.toThrow();
    expect(() => assertCapabilityWithdrawal([lead, drifted, demoted], bare, manifest)).toThrow(/refreshing/);
    expect(() => assertCapabilityWithdrawal([lead, { status: "expired", identity: ada }, demoted], bare, manifest)).toThrow(/usable states/);
  });

  it("rejects a sequence that withdraws nothing", () => {
    expect(() => assertCapabilityWithdrawal([lead, lead], bare, manifest)).toThrow(/withdrawn/);
  });

  it("rejects a sequence that changes identity", () => {
    const other = { ...demoted, identity: { id: "A-9", displayName: "Bo" } } satisfies AuthenticationState;
    expect(() => assertCapabilityWithdrawal([lead, other], bare, manifest)).toThrow(/new login/);
  });

  it("validates every state on the way", () => {
    const silent = { status: "authenticated", identity: ada } as unknown as AuthenticationState;
    expect(() => assertCapabilityWithdrawal([lead, silent], bare, manifest)).toThrow(/capabilities/);
    expect(() => assertCapabilityWithdrawal([lead, demoted], bare, manifest)).not.toThrow();
  });
});

describe("assertCommandRefusedAfterWithdrawal", () => {
  it("accepts the named refusal and rejects anything else", () => {
    const refused = { status: "failed", failure: { code: "omni.capability-not-enabled", message: "No longer a lead", retryable: false } };
    expect(() => assertCommandRefusedAfterWithdrawal(refused)).not.toThrow();
    expect(() => assertCommandRefusedAfterWithdrawal({ status: "applied" })).toThrow(/must fail/);
    expect(() => assertCommandRefusedAfterWithdrawal({ status: "failed", failure: { code: "omni.unavailable" } })).toThrow(/omni\.capability-not-enabled/);
  });
});

describe("assertDuplicateEventDelivery", () => {
  it("applies a repeated event id exactly once", () => {
    expect(assertDuplicateEventDelivery([statusEvent, statusEvent])).toEqual([statusEvent]);
  });

  it("rejects a scenario with no duplicate to test", () => {
    expect(() => assertDuplicateEventDelivery([statusEvent])).toThrow(/requires a repeated event ID/);
  });

  it("rejects a reused id whose payload changed", () => {
    const mutated = { ...statusEvent, event: { type: "provider-status", status: "error" } } as ProviderEventEnvelope<"voice">;
    expect(() => assertDuplicateEventDelivery([statusEvent, mutated])).toThrow(/changed its payload/);
  });
});

describe("assertReconnectWithMissedAssignments", () => {
  const before: Snapshot<"voice"> = { status: "active", sessionId: "session-1", break: { approval: "not-requested", accepting: true }, tasks: [] };
  const reconnect = {
    id: "event-2", sessionId: "session-1",
    occurredAt: "2026-08-21T01:01:00Z",
    event: { type: "snapshot", reason: "reconnected", snapshot: { status: "active", sessionId: "session-1", break: { approval: "not-requested", accepting: true }, tasks: [voiceTask] } },
  } as const satisfies ProviderEventEnvelope<"voice">;

  it("accepts a reconnect snapshot carrying the missed assignment", () => {
    expect(() => assertReconnectWithMissedAssignments(before, reconnect, [voiceTask.id])).not.toThrow();
  });

  it("rejects a reconnect snapshot that lost the missed assignment", () => {
    const empty = { ...reconnect, event: { ...reconnect.event, snapshot: before } } as ProviderEventEnvelope<"voice">;
    expect(() => assertReconnectWithMissedAssignments(before, empty, [voiceTask.id])).toThrow(/missing task/);
  });

  it("rejects a task that was already present and therefore never missed", () => {
    const populated: Snapshot<"voice"> = { ...before, tasks: [voiceTask] };
    expect(() => assertReconnectWithMissedAssignments(populated, reconnect, [voiceTask.id])).toThrow(/was not missed/);
  });

  it("rejects an event that is not a reconnect snapshot", () => {
    expect(() => assertReconnectWithMissedAssignments(before, statusEvent, [])).toThrow(/requires a reconnected snapshot/);
  });
});

describe("assertDeniedAndRetriedBreak", () => {
  it("accepts a refusal that returns to not-requested and a later grant", () => {
    // There is no `denied` approval: a refusal leaves nothing pending, because a request
    // nobody is coming to decide is worse than none.
    expect(() => assertDeniedAndRetriedBreak(["awaiting-decision", "not-requested", "awaiting-decision", "granted"])).not.toThrow();
    expect(() => assertDeniedAndRetriedBreak(["awaiting-decision", "not-requested", "awaiting-decision", "in-effect"])).not.toThrow();
  });

  it("accepts a provider that decides alone: granted at once, refused, granted again", () => {
    // No approver, so the request never waits on a person -- it is granted the moment it is
    // made. The rule is unchanged: the refusal still has to return to not-requested first.
    expect(() => assertDeniedAndRetriedBreak(["granted", "not-requested", "granted"])).not.toThrow();
    expect(() => assertDeniedAndRetriedBreak(["granted", "not-requested", "granted", "in-effect"])).not.toThrow();
  });

  it("rejects a sequence that was never asked for", () => {
    expect(() => assertDeniedAndRetriedBreak(["not-requested"])).toThrow(/requires an initial request/);
    expect(() => assertDeniedAndRetriedBreak([])).toThrow(/requires an initial request/);
  });

  it("rejects a grant that was never refused, however the request was made", () => {
    expect(() => assertDeniedAndRetriedBreak(["granted"])).toThrow(/leaving nothing pending/);
    expect(() => assertDeniedAndRetriedBreak(["granted", "in-effect"])).toThrow(/leaving nothing pending/);
  });

  it("rejects a refusal that leaves the request pending", () => {
    expect(() => assertDeniedAndRetriedBreak(["awaiting-decision", "granted"])).toThrow(/leaving nothing pending/);
  });

  it("rejects a sequence that never grants after the refusal", () => {
    expect(() => assertDeniedAndRetriedBreak(["awaiting-decision", "not-requested"])).toThrow(/must grant a later request/);
  });

  it("rejects a sequence that ends back at not-requested", () => {
    expect(() => assertDeniedAndRetriedBreak(["awaiting-decision", "not-requested", "granted", "not-requested"]))
      .toThrow(/must end granted or in effect/);
  });
});

describe("assertWrapTimeout", () => {
  it("accepts a deadline of media end plus the task allowance", () => {
    expect(() => assertWrapTimeout(voiceTask, "2026-08-21T01:00:00.000Z", "2026-08-21T01:01:00.000Z")).not.toThrow();
  });

  it("accepts scheduler jitter inside the tolerance", () => {
    expect(() => assertWrapTimeout(voiceTask, "2026-08-21T01:00:00.000Z", "2026-08-21T01:01:00.400Z")).not.toThrow();
  });

  it("rejects a deadline outside the tolerance", () => {
    expect(() => assertWrapTimeout(voiceTask, "2026-08-21T01:00:00.000Z", "2026-08-21T01:02:00.000Z")).toThrow(/Wrap deadline mismatch/);
  });

  it("rejects jitter when an exact match is demanded", () => {
    expect(() => assertWrapTimeout(voiceTask, "2026-08-21T01:00:00.000Z", "2026-08-21T01:01:00.400Z", 0)).toThrow(/Wrap deadline mismatch/);
  });

  it("rejects an unparseable time", () => {
    expect(() => assertWrapTimeout(voiceTask, "just now", "2026-08-21T01:01:00.000Z")).toThrow(/valid ISO-8601/);
  });

  it("treats a task with no allowance as having no deadline, in both directions", () => {
    const untimed = { completionMode: "agent-command" } satisfies Pick<Task, "completionMode" | "completionAllowance">;
    // No allowance, nothing counted down: conforming.
    expect(() => assertWrapTimeout(untimed, "2026-08-21T01:00:00.000Z", undefined)).not.toThrow();
    // A host counting down what the provider left open is the violation...
    expect(() => assertWrapTimeout(untimed, "2026-08-21T01:00:00.000Z", "2026-08-21T01:01:00.000Z")).toThrow(/no deadline/);
    // ...and so is a host counting nothing down when the provider set a clock.
    expect(() => assertWrapTimeout(voiceTask, "2026-08-21T01:00:00.000Z", undefined)).toThrow(/no deadline was observed/);
  });
});

describe("browser isolation", () => {
  const browser = {
    id: "crm",
    name: "CRM",
    purpose: "Customer record",
    url: "https://crm.example.test/customer/42",
    reuse: true,
    isolationScheme: BROWSER_ISOLATION_SCHEMES.PROVIDER_NAME__TASK_TYPE_NAME__TAB_NAME,
  } as const satisfies TaskBrowser;
  const isolated = { ...browser, reuse: false, isolationScheme: undefined } as const satisfies TaskBrowser;

  it("shares one session across tasks under a task-type scheme", () => {
    expect(() => assertBrowserIsolationAndReuse(
      { providerId: "voiceco", taskId: "call-1", taskType: "Support", browser },
      { providerId: "voiceco", taskId: "call-2", taskType: "Support", browser: { ...browser, id: "crm-copy" } },
      true,
    )).not.toThrow();
  });

  it("never shares a session when reuse is false", () => {
    expect(() => assertBrowserIsolationAndReuse(
      { providerId: "voiceco", taskId: "call-1", taskType: "Support", browser },
      { providerId: "voiceco", taskId: "call-1", taskType: "Support", browser: isolated },
      false,
    )).not.toThrow();
    // Two isolated browsers do not share with each other either: "no key" is not a matching key.
    expect(() => assertBrowserIsolationAndReuse(
      { providerId: "voiceco", taskId: "call-1", taskType: "Support", browser: isolated },
      { providerId: "voiceco", taskId: "call-1", taskType: "Support", browser: isolated },
      false,
    )).not.toThrow();
    expect(browserSessionKey({ providerId: "voiceco", taskId: "c", taskType: "Support", browser: isolated })).toBeUndefined();
  });

  it("reports a mismatch between expected and derived reuse", () => {
    expect(() => assertBrowserIsolationAndReuse(
      { providerId: "voiceco", taskId: "call-1", taskType: "Support", browser },
      { providerId: "otherco", taskId: "call-1", taskType: "Support", browser },
      true,
    )).toThrow(/Browser reuse mismatch/);
    // And in the other direction, so the helper is known to check rather than to throw.
    expect(() => assertBrowserIsolationAndReuse(
      { providerId: "voiceco", taskId: "call-1", taskType: "Support", browser },
      { providerId: "voiceco", taskId: "call-2", taskType: "Support", browser },
      false,
    )).toThrow(/Browser reuse mismatch/);
  });

  it("keeps every adversarial naming variant in its own session", () => {
    const variants = ["Acme.Voice", "Acme", "acme", "Acme Voice", "Acme-Voice", "Acme%2EVoice"];
    expect(() => assertNoBrowserSessionKeyCollisions(
      variants.flatMap(providerId => ["Support", "Voice.Support", "support"].map(taskType => ({
        providerId, taskId: "t1", taskType, browser,
      }))),
    )).not.toThrow();
  });

  it("detects a genuine collision when one exists", () => {
    expect(() => assertNoBrowserSessionKeyCollisions([
      { providerId: "voiceco", taskId: "call-1", taskType: "Support", browser },
      { providerId: "voiceco", taskId: "call-2", taskType: "Support", browser },
    ])).toThrow(/collision/);
  });
});
