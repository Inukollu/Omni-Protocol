import { describe, expect, it, vi } from "vitest";
import { BROWSER_ISOLATION_SCHEMES, browserSessionKey, type AuthenticationState, type BreakApproval, type Manifest, type ProviderEventEnvelope, type Snapshot, type Task, type TaskBrowser, OMNI_PROTOCOL_VERSION, type Adapter, type Connection, type Host, type HostGuarantees, type HostReport, type ConnectContext, type UserCapabilities } from "../src/index.js";
import type { LoginStore } from "../src/index.js";
import { memoryStore, assertAuthenticationRestoreAndExpiry, assertBrowserSessionIsolation, assertCapabilityWithdrawal, assertTaskCapabilityWithdrawal, assertCommandRefusedAfterWithdrawal, assertBreakBeginsAfterTask, assertBreakFollowsItsRequests, assertBreakAttemptProviders, assertMediaFollowsTheTask, assertDeniedAndRetriedBreak, assertDuplicateEventDelivery, assertNoBrowserSessionKeyCollisions, assertReconnectWithMissedAssignments, assertWrapTimeout, ProtocolConformanceError, exerciseAdapter, assertReached, type ContractSubject, stillHost, TaskStream } from "../src/testing.js";

const voiceTask = {
  id: "call-42",
  title: "Customer call",
  channel: "voice",
  taskType: "Customer Support",
  capabilities: { hold: true },
  capabilitySource: "queue",
  phase: "in-progress",
  browsers: [],
  completionMode: "agent-command",
  wrapAllowance: 60,
} satisfies Task<"voice">;

const statusEvent = {
  id: "event-1", loginId: "session-1",
  occurredAt: "2026-08-21T01:00:00Z",
  event: { type: "transport-status", status: "active" },
} as const satisfies ProviderEventEnvelope<"voice">;

describe("assertAuthenticationRestoreAndExpiry", () => {
  it("accepts a restored session that refreshes and then expires", () => {
    expect(() => assertAuthenticationRestoreAndExpiry([
      { status: "authenticated", identity: { id: "A-1", displayName: "Ada", timeZone: "Pacific/Chatham" }, capabilities: {} },
      { status: "refreshing", identity: { id: "A-1", displayName: "Ada", timeZone: "Pacific/Chatham" }, capabilities: {} },
      { status: "expired", identity: { id: "A-1", displayName: "Ada", timeZone: "Pacific/Chatham" }, failure: { code: "expired", message: "Sign in again", retryable: true } },
    ])).not.toThrow();
  });

  it("rejects a sequence that never expires", () => {
    expect(() => assertAuthenticationRestoreAndExpiry([
      { status: "authenticated", identity: { id: "A-1", displayName: "Ada", timeZone: "Pacific/Chatham" }, capabilities: {} },
      { status: "refreshing", identity: { id: "A-1", displayName: "Ada", timeZone: "Pacific/Chatham" }, capabilities: {} },
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
    const ada = { id: "A-1", displayName: "Ada", timeZone: "Pacific/Chatham" };
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
      { status: "authenticated", identity: { id: "A-1", displayName: "Ada", timeZone: "Pacific/Chatham" }, capabilities: {} },
      { status: "expired" },
      { status: "refreshing", identity: { id: "A-1", displayName: "Ada", timeZone: "Pacific/Chatham" }, capabilities: {} },
      { status: "expired" },
    ])).toThrow(/must occur before expiry/);
  });
});

describe("assertCapabilityWithdrawal", () => {
  const manifest = {
    id: "acme-voice", displayName: "Acme Voice", channel: "voice",
    supportedProtocolVersions: [1], authenticationMethods: ["credentials"],
  } satisfies Manifest<"voice">;
  const ada = { id: "A-1", displayName: "Ada", timeZone: "Pacific/Chatham" };
  const lead = { status: "authenticated", identity: ada, capabilities: { breaks: true, team: { breakControl: true } } } satisfies AuthenticationState;
  const demoted = { status: "authenticated", identity: ada, capabilities: { breaks: true } } satisfies AuthenticationState;
  const bare: Snapshot<"voice"> = { transport: "active", loginId: "session-1", break: { approval: "not-requested", mayAsk: true }, tasks: [], taskCount: 0 };
  const withRoster: Snapshot<"voice"> = { ...bare, team: { members: [{ id: "A-2", availability: "ready" }] } };

  it("accepts a roster gone with the capability that entitled it, and rejects one that stayed", () => {
    expect(() => assertCapabilityWithdrawal([lead, demoted], bare, manifest)).not.toThrow();
    expect(() => assertCapabilityWithdrawal([lead, demoted], withRoster, manifest)).toThrow(/team\.unentitled/);
  });

  it("holds requests to a withdrawn leadAssistControl, and a snapshot to withdrawn breaks", () => {
    const consulting = { ...lead, capabilities: { team: { leadAssistControl: true as const } } } satisfies AuthenticationState;
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
    const other = { ...demoted, identity: { id: "A-9", displayName: "Bo", timeZone: "Pacific/Chatham" } } satisfies AuthenticationState;
    expect(() => assertCapabilityWithdrawal([lead, other], bare, manifest)).toThrow(/new login/);
  });

  it("validates every state on the way", () => {
    const silent = { status: "authenticated", identity: ada } as unknown as AuthenticationState;
    expect(() => assertCapabilityWithdrawal([lead, silent], bare, manifest)).toThrow(/capabilities/);
    expect(() => assertCapabilityWithdrawal([lead, demoted], bare, manifest)).not.toThrow();
  });
});

describe("assertTaskCapabilityWithdrawal", () => {
  const manifest = {
    id: "acme-voice", displayName: "Acme Voice", channel: "voice",
    supportedProtocolVersions: [1], authenticationMethods: ["credentials"],
  } satisfies Manifest<"voice">;
  const withHold = { ...voiceTask, capabilities: { hold: true, recording: true } } satisfies Task<"voice">;
  const withoutHold = { ...voiceTask, capabilities: { recording: true } } satisfies Task<"voice">;
  const hold = { type: "hold" };

  it("accepts a control withdrawn by a republish, refusing the command it governed and nothing else", () => {
    expect(() => assertTaskCapabilityWithdrawal([withHold, withoutHold], manifest, hold)).not.toThrow();
    // The control: the same sequence, and a command under a capability that stayed, is not refused.
    expect(() => assertTaskCapabilityWithdrawal([withHold, withoutHold], manifest, { type: "recording", action: "start" })).toThrow(/for want of hold; it was accepted/);
  });

  it("rejects a sequence that withdraws nothing, and does not count a lock as a withdrawal", () => {
    expect(() => assertTaskCapabilityWithdrawal([withHold, withHold], manifest, hold)).toThrow(/withdrawn/);
    const locked = { ...voiceTask, capabilities: { hold: { lockedBy: "team" }, recording: true } } satisfies Task<"voice">;
    expect(() => assertTaskCapabilityWithdrawal([withHold, locked], manifest, hold)).toThrow(/locked control is present/);
  });

  it("requires the command to have been issuable before the withdrawal", () => {
    const neverHeld = { ...voiceTask, capabilities: { recording: true } } satisfies Task<"voice">;
    expect(() => assertTaskCapabilityWithdrawal([{ ...neverHeld, capabilities: { recording: true, endCall: true } }, neverHeld], manifest, hold)).toThrow(/issuable against the task as offered/);
  });

  it("refuses a republish that changes more than the withdrawal", () => {
    const dials = { ...manifest, dialOutcomes: ["answered", "no-answer"] } satisfies Manifest<"voice">;
    const wrappingUp = { ...voiceTask, phase: "completing", capabilities: { connectBack: true, recording: true } } satisfies Task<"voice">;
    const backOnTheCall = { ...voiceTask, phase: "in-progress", capabilities: { recording: true } } satisfies Task<"voice">;
    const connectBack = { type: "connect-back", dialId: "dial-1" };
    expect(() => assertTaskCapabilityWithdrawal([wrappingUp, backOnTheCall], dials, connectBack)).toThrow(/more than the withdrawal/);
    expect(() => assertTaskCapabilityWithdrawal([wrappingUp, { ...wrappingUp, capabilities: { recording: true } }], dials, connectBack)).not.toThrow();
  });

  it("keeps the task, and validates every task on the way", () => {
    expect(() => assertTaskCapabilityWithdrawal([withHold, { ...withoutHold, id: "call-43" }], manifest, hold)).toThrow(/keep the task/);
    expect(() => assertTaskCapabilityWithdrawal([withHold, { ...withoutHold, phase: "ringing" } as unknown as Task<"voice">], manifest, hold)).toThrow(/tasks\[1\] must be a task/);
    expect(() => assertTaskCapabilityWithdrawal([withHold], manifest, hold)).toThrow(/at least one republish/);
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
    const mutated = { ...statusEvent, event: { type: "transport-status", status: "error" } } as ProviderEventEnvelope<"voice">;
    expect(() => assertDuplicateEventDelivery([statusEvent, mutated])).toThrow(/changed its payload/);
  });
});

describe("assertReconnectWithMissedAssignments", () => {
  const before: Snapshot<"voice"> = { transport: "active", loginId: "session-1", break: { approval: "not-requested", mayAsk: true }, tasks: [], taskCount: 0 };
  const reconnect = {
    id: "event-2", loginId: "session-1",
    occurredAt: "2026-08-21T01:01:00Z",
    event: { type: "snapshot", reason: "reconnected", snapshot: { transport: "active", loginId: "session-1", break: { approval: "not-requested", mayAsk: true }, tasks: [voiceTask], taskCount: 1 } },
  } as const satisfies ProviderEventEnvelope<"voice">;

  it("accepts a reconnect snapshot carrying the missed assignment", () => {
    expect(() => assertReconnectWithMissedAssignments(before, reconnect, [voiceTask.id])).not.toThrow();
  });

  it("rejects a reconnect snapshot that lost the missed assignment", () => {
    const empty = { ...reconnect, event: { ...reconnect.event, snapshot: before } } as ProviderEventEnvelope<"voice">;
    expect(() => assertReconnectWithMissedAssignments(before, empty, [voiceTask.id])).toThrow(/missing task/);
  });

  it("rejects a task that was already present and therefore never missed", () => {
    const populated: Snapshot<"voice"> = { ...before, tasks: [voiceTask], taskCount: 1 };
    expect(() => assertReconnectWithMissedAssignments(populated, reconnect, [voiceTask.id])).toThrow(/was not missed/);
  });

  it("rejects an event that is not a reconnect snapshot", () => {
    expect(() => assertReconnectWithMissedAssignments(before, statusEvent, [])).toThrow(/requires a reconnected snapshot/);
  });
});

describe("assertBreakFollowsItsRequests", () => {
  const at = "2026-08-21T09:00:00Z";
  const state = (approval: BreakApproval, over: Record<string, unknown> = {}, id: string = approval): ProviderEventEnvelope<"voice"> =>
    ({ id, loginId: "session-1", occurredAt: at, event: { type: "break-state", break: { approval, mayAsk: true, ...over } } }) as ProviderEventEnvelope<"voice">;
  const rulesOf = (run: () => void): string[] => { try { run(); return []; } catch (error) { return (error as { violations?: { rule: string }[] }).violations?.map(v => v.rule) ?? [String(error)]; } };
  const idle: Snapshot<"voice"> = { transport: "active", loginId: "session-1", break: { approval: "not-requested", mayAsk: true }, tasks: [], taskCount: 0 };

  it("accepts every move the guide describes", () => {
    // Asked, decided, committed while working, begun when the work ended, ended.
    expect(rulesOf(() => assertBreakFollowsItsRequests([state("awaiting-decision"), state("granted"), state("starting-after-task"), state("in-effect"), state("not-requested")], idle))).toEqual([]);
    // Granted at once and committed with nothing outstanding; denied; cancelled after a grant.
    expect(rulesOf(() => assertBreakFollowsItsRequests([state("granted"), state("in-effect"), state("not-requested")], idle))).toEqual([]);
    expect(rulesOf(() => assertBreakFollowsItsRequests([state("awaiting-decision"), state("not-requested")], idle))).toEqual([]);
    expect(rulesOf(() => assertBreakFollowsItsRequests([state("granted"), state("not-requested")], idle))).toEqual([]);
    // Placed on the agent: in effect with nobody asking, and it says so -- or starting after the
    // call the member is on, which is the same placing reported while the work finishes.
    expect(rulesOf(() => assertBreakFollowsItsRequests([state("in-effect", { imposed: { by: "M-1", endsAutomatically: false } })], idle))).toEqual([]);
    expect(rulesOf(() => assertBreakFollowsItsRequests([state("starting-after-task", { imposed: { by: "M-1", endsAutomatically: false } }), state("in-effect", { imposed: { by: "M-1", endsAutomatically: false } })], idle))).toEqual([]);
    // A reconnect snapshot resets where the break stands; the same state twice is nothing.
    const reconnect: ProviderEventEnvelope<"voice"> = { id: "r", loginId: "session-1", occurredAt: at, event: { type: "snapshot", reason: "reconnected", snapshot: { ...idle, break: { approval: "granted", mayAsk: true } } } };
    expect(rulesOf(() => assertBreakFollowsItsRequests([reconnect, state("starting-after-task"), state("starting-after-task", {}, "again")], idle))).toEqual([]);
    // Without a beginning, the first state is taken as it comes.
    expect(rulesOf(() => assertBreakFollowsItsRequests([state("in-effect")]))).toEqual([]);
  });

  it("refuses a commit's states with no grant behind them", () => {
    expect(rulesOf(() => assertBreakFollowsItsRequests([state("starting-after-task")], idle))).toEqual(["stream.breakState.commitBeforeGrant"]);
    expect(rulesOf(() => assertBreakFollowsItsRequests([state("in-effect")], idle))).toEqual(["stream.breakState.commitBeforeGrant"]);
    expect(rulesOf(() => assertBreakFollowsItsRequests([state("awaiting-decision"), state("in-effect")], idle))).toEqual(["stream.breakState.commitBeforeGrant"]);
  });

  it("refuses a break that goes backwards", () => {
    expect(rulesOf(() => assertBreakFollowsItsRequests([state("granted"), state("in-effect"), state("granted", {}, "g2")], idle))).toEqual(["stream.breakState.backwards"]);
    expect(rulesOf(() => assertBreakFollowsItsRequests([state("granted"), state("starting-after-task"), state("awaiting-decision")], idle))).toEqual(["stream.breakState.backwards"]);
    expect(rulesOf(() => assertBreakFollowsItsRequests([state("granted"), state("awaiting-decision")], idle))).toEqual(["stream.breakState.backwards"]);
  });
});

describe("assertMediaFollowsTheTask", () => {
  const at = "2026-08-21T09:00:00Z";
  const call = (phase: Task<"voice">["phase"]): Task<"voice"> => ({ ...voiceTask, phase });
  const offered = (): ProviderEventEnvelope<"voice"> => ({ id: "e1", loginId: "session-1", occurredAt: at, event: { type: "task-offered", task: { ...call("pending"), acceptance: "consent" } } });
  const updated = (phase: Task<"voice">["phase"], id = "e2"): ProviderEventEnvelope<"voice"> => ({ id, loginId: "session-1", occurredAt: at, event: { type: "task-updated", task: call(phase) } });
  const mediaReady = (id = "e2b"): ProviderEventEnvelope<"voice"> => ({ id, loginId: "session-1", occurredAt: at, event: { type: "task-media-started", taskId: voiceTask.id } });
  const mediaEnded: ProviderEventEnvelope<"voice"> = { id: "e3", loginId: "session-1", occurredAt: at, event: { type: "task-media-ended", taskId: voiceTask.id } };
  const ended: ProviderEventEnvelope<"voice"> = { id: "e4", loginId: "session-1", occurredAt: at, event: { type: "task-ended", taskId: voiceTask.id, outcome: { type: "completed", by: "agent" } } };
  const rulesOf = (run: () => void): string[] => { try { run(); return []; } catch (error) { return (error as { violations?: { rule: string }[] }).violations?.map(v => v.rule) ?? [String(error)]; } };

  it("accepts a call offered, started, made ready, whose media ends, completing, then ending", () => {
    expect(rulesOf(() => assertMediaFollowsTheTask([offered(), updated("in-progress"), mediaReady(), mediaEnded, updated("completing", "e5"), ended]))).toEqual([]);
    // A snapshot may carry the task in with its media ready; connecting back puts media back and it ends again.
    expect(rulesOf(() => assertMediaFollowsTheTask([mediaEnded, updated("completing"), updated("in-progress", "e5"), mediaReady("e5b"), { ...mediaEnded, id: "e6" }, updated("completing", "e7"), ended], { transport: "active", loginId: "session-1", break: { approval: "not-requested", mayAsk: true }, tasks: [{ ...call("in-progress"), media: "started" }], taskCount: 1 }))).toEqual([]);
  });

  it("refuses media that moves before the work began, arrives twice, or ends where none arrived", () => {
    expect(rulesOf(() => assertMediaFollowsTheTask([offered(), mediaReady()]))).toEqual(["stream.taskMediaStarted.beforeWork"]);
    expect(rulesOf(() => assertMediaFollowsTheTask([offered(), mediaEnded]))).toEqual(["stream.taskMediaEnded.beforeWork", "stream.taskMediaEnded.silent"]);
    // The defect this rule is for: a live call whose provider said nothing about its audio.
    expect(rulesOf(() => assertMediaFollowsTheTask([offered(), updated("in-progress"), mediaEnded]))).toEqual(["stream.taskMediaEnded.silent"]);
    expect(rulesOf(() => assertMediaFollowsTheTask([offered(), updated("in-progress"), mediaReady(), mediaReady("e2c")]))).toEqual(["stream.taskMediaStarted.duplicate"]);
    expect(rulesOf(() => assertMediaFollowsTheTask([mediaReady()]))).toEqual(["stream.taskMediaStarted.unknown"]);
  });

  it("lets an update re-state media, and refuses one that moves it", () => {
    const restated = (id: string): ProviderEventEnvelope<"voice"> => ({ id, loginId: "session-1", occurredAt: at, event: { type: "task-updated", task: { ...call("paused"), media: "started" } } });
    const arrives = (id: string): ProviderEventEnvelope<"voice"> => ({ id, loginId: "session-1", occurredAt: at, event: { type: "task-updated", task: { ...call("in-progress"), media: "started" } } });
    // Republishing ready on a hold is a statement, not a second arrival.
    expect(rulesOf(() => assertMediaFollowsTheTask([offered(), updated("in-progress"), mediaReady(), restated("e2c")]))).toEqual([]);
    expect(rulesOf(() => assertMediaFollowsTheTask([offered(), arrives("e2c")]))).toEqual(["stream.taskUpdated.media"]);
    expect(rulesOf(() => assertMediaFollowsTheTask([offered(), updated("in-progress"), mediaReady(), { id: "e2d", loginId: "session-1", occurredAt: at, event: { type: "task-updated", task: { ...call("in-progress"), media: "ended" } } }]))).toEqual(["stream.taskUpdated.media"]);
  });

  it("refuses media that decides what follows", () => {
    expect(rulesOf(() => assertMediaFollowsTheTask([offered(), updated("in-progress"), mediaReady(), mediaEnded, updated("paused", "e5")]))).toEqual(["stream.taskMediaEnded.follow"]);
  });

  it("refuses a stream that speaks of a task it never introduced, or introduces one twice", () => {
    expect(rulesOf(() => assertMediaFollowsTheTask([updated("in-progress")]))).toEqual(["stream.taskUpdated.unknown"]);
    expect(rulesOf(() => assertMediaFollowsTheTask([mediaEnded]))).toEqual(["stream.taskMediaEnded.unknown"]);
    expect(rulesOf(() => assertMediaFollowsTheTask([ended]))).toEqual(["stream.taskEnded.unknown"]);
    expect(rulesOf(() => assertMediaFollowsTheTask([offered(), { ...offered(), id: "e9" }]))).toEqual(["stream.taskOffered.duplicate"]);
    expect(rulesOf(() => assertMediaFollowsTheTask([offered(), ended, { ...offered(), id: "e9" }]))).toEqual([]);
  });
});

describe("TaskStream holds a record once read", () => {
  const at = "2026-08-21T09:00:00Z";
  const rulesOf = (violations: { rule: string }[]) => violations.map(v => v.rule);
  const answered = { step: "answered" as const, at: "2026-08-21T08:59:41Z", by: "a-17" };
  const held = { step: "held" as const, at: "2026-08-21T09:02:10Z", seconds: 35, by: "a-17" };
  const muted = { step: "muted" as const, at: "2026-08-21T09:04:00Z", seconds: 4, by: "a-17", mutedBy: "host" as const };
  const withRecord = (steps: unknown[] | undefined): Task<"voice"> =>
    ({ ...voiceTask, handlingHistory: steps === undefined ? undefined : { steps } }) as unknown as Task<"voice">;
  const seeded = (steps: unknown[] | undefined) => { const s = new TaskStream(); s.seed({ tasks: [withRecord(steps)] }); return s; };
  const update = (steps: unknown[] | undefined): ProviderEventEnvelope<"voice"> =>
    ({ id: "e1", loginId: "session-1", occurredAt: at, event: { type: "task-updated", task: withRecord(steps) } });
  const resync = (steps: unknown[] | undefined): ProviderEventEnvelope<"voice"> =>
    ({ id: "s1", loginId: "session-1", occurredAt: at, event: { type: "snapshot", reason: "reconnected", snapshot: { transport: "active", loginId: "session-1", break: { approval: "not-requested", mayAsk: true }, tasks: [withRecord(steps)], taskCount: 1 } } });

  it("lets a record grow or stand, and refuses its loss on an update", () => {
    expect(rulesOf(seeded([answered]).apply(update([answered, held])))).toEqual([]);
    expect(rulesOf(seeded([answered, held]).apply(update([answered, held])))).toEqual([]);
    expect(rulesOf(seeded([answered, held]).apply(update([answered, held, muted])))).toEqual([]);
    // A record that arrives where there was none is a record arriving.
    expect(rulesOf(seeded(undefined).apply(update([answered])))).toEqual([]);
    // Lost: an entry the host read is gone, or the whole record is.
    expect(rulesOf(seeded([answered, held]).apply(update([answered])))).toEqual(["stream.taskUpdated.handlingHistory"]);
    expect(rulesOf(seeded([answered, held]).apply(update(undefined)))).toEqual(["stream.taskUpdated.handlingHistory"]);
    // An entry is known by its step and instant: the same hold restated with its final seconds is the same entry.
    expect(rulesOf(seeded([answered, { ...held, seconds: undefined }]).apply(update([answered, held])))).toEqual([]);
  });

  it("holds a resync snapshot to the same rule", () => {
    expect(rulesOf(seeded([answered, held]).apply(resync([answered])))).toEqual(["stream.snapshot.handlingHistory"]);
    expect(rulesOf(seeded([answered, held]).apply(resync(undefined)))).toEqual(["stream.snapshot.handlingHistory"]);
    // The control: a snapshot restating the record, or adding to it, is what a snapshot is for.
    expect(rulesOf(seeded([answered, held]).apply(resync([answered, held])))).toEqual([]);
    expect(rulesOf(seeded([answered]).apply(resync([answered, held, muted])))).toEqual([]);
    // And a snapshot replaces what is known: after it, the shorter record is the one held.
    const stream = seeded([answered]); stream.apply(resync([answered, held]));
    expect(rulesOf(stream.apply(update([answered])))).toEqual(["stream.taskUpdated.handlingHistory"]);
  });
});

describe("TaskStream holds terms once read", () => {
  const at = "2026-08-21T09:00:00Z";
  const rulesOf = (violations: { rule: string }[]) => violations.map(v => v.rule);
  const under = (capabilitySource: Task["capabilitySource"], id = "e1"): ProviderEventEnvelope<"voice"> =>
    ({ id, loginId: "session-1", occurredAt: at, event: { type: "task-updated", task: { ...voiceTask, capabilitySource } } });
  const seeded = (capabilitySource: Task["capabilitySource"]) => { const s = new TaskStream(); s.seed({ tasks: [{ ...voiceTask, capabilitySource }] }); return s; };

  it("lets terms arrive, and refuses their loss", () => {
    // Arriving: the terms were unread and now are read, under either kind of governance.
    expect(rulesOf(seeded("undetermined").apply(under("queue")))).toEqual([]);
    expect(rulesOf(seeded("undetermined").apply(under("ungoverned")))).toEqual([]);
    expect(rulesOf(seeded("undetermined").apply(under("undetermined")))).toEqual([]);
    // Moving queues, or into one: a fact replacing a fact.
    expect(rulesOf(seeded("ungoverned").apply(under("queue")))).toEqual([]);
    expect(rulesOf(seeded("queue").apply(under("queue")))).toEqual([]);
    // Lost: a task that had its terms cannot say it never did.
    expect(rulesOf(seeded("queue").apply(under("undetermined")))).toEqual(["stream.taskUpdated.capabilitySource"]);
    expect(rulesOf(seeded("ungoverned").apply(under("undetermined")))).toEqual(["stream.taskUpdated.capabilitySource"]);
  });

  it("holds a snapshot to the same rule: a resync may not say a task lost the terms it had", () => {
    const resync = (capabilitySource: Task["capabilitySource"]): ProviderEventEnvelope<"voice"> =>
      ({ id: "s1", loginId: "session-1", occurredAt: at, event: { type: "snapshot", reason: "reconnected", snapshot: { transport: "active", loginId: "session-1", break: { approval: "not-requested", mayAsk: true }, tasks: [{ ...voiceTask, capabilitySource }], taskCount: 1 } } });
    expect(rulesOf(seeded("queue").apply(resync("undetermined")))).toEqual(["stream.snapshot.capabilitySource"]);
    expect(rulesOf(seeded("ungoverned").apply(resync("undetermined")))).toEqual(["stream.snapshot.capabilitySource"]);
    // The control: terms arriving on a snapshot, or restated by one, are what a snapshot is for.
    expect(rulesOf(seeded("undetermined").apply(resync("queue")))).toEqual([]);
    expect(rulesOf(seeded("queue").apply(resync("queue")))).toEqual([]);
    // And a task the stream never knew arrives under whatever terms it has.
    const fresh = new TaskStream(); fresh.seed({ tasks: [] });
    expect(rulesOf(fresh.apply(resync("undetermined")))).toEqual([]);
  });

  it("holds an offer to the same rule once it is on the stream", () => {
    const s = new TaskStream(); s.seed({ tasks: [] });
    const offered: ProviderEventEnvelope<"voice"> = { id: "e0", loginId: "session-1", occurredAt: at, event: { type: "task-offered", task: { ...voiceTask, phase: "pending", acceptance: "consent", capabilitySource: "queue" } } };
    expect(rulesOf(s.apply(offered))).toEqual([]);
    expect(rulesOf(s.apply(under("undetermined", "e1")))).toEqual(["stream.taskUpdated.capabilitySource"]);
    expect(rulesOf(s.apply(under("queue", "e2")))).toEqual([]);
  });
});

describe("TaskStream places a dial outcome", () => {
  const at = "2026-08-21T09:00:00Z";
  const stream = () => { const s = new TaskStream(); s.seed({ tasks: [] }); return s; };
  const outcome = (dialId: string, id = "e1"): ProviderEventEnvelope<"voice"> =>
    ({ id, loginId: "session-1", occurredAt: at, event: { type: "dial-outcome", dialId, outcome: "answered", taskId: voiceTask.id } });
  const rulesOf = (violations: { rule: string }[]) => violations.map(v => v.rule);

  it("accepts an outcome for a dial the host placed, once, and refuses one for a dial nobody made", () => {
    const s = stream();
    s.dialled("dial-7f2");
    expect(rulesOf(s.apply(outcome("dial-7f2")))).toEqual([]);
    // Once: a dial ends one way, and a second outcome is a second claim about the same dial.
    expect(rulesOf(s.apply(outcome("dial-7f2", "e2")))).toEqual(["stream.dialOutcome.duplicate"]);
    expect(rulesOf(stream().apply(outcome("dial-9")))).toEqual(["stream.dialOutcome.unknown"]);
  });

  it("knows a dial from the record or from who is on the call, which is how a dial made before a transfer is placed", () => {
    const inherited: Task<"voice"> = { ...voiceTask, onCall: [{ role: "conferenced", destinationId: "tier2", dialId: "dial-3c9", stage: "joined", since: at }],
      handlingHistory: { steps: [{ step: "unanswered", at, by: "A-1", dialId: "dial-1a0", destinationId: "tier3" }] } };
    const s = new TaskStream();
    s.seed({ tasks: [inherited] });
    expect(rulesOf(s.apply(outcome("dial-3c9")))).toEqual([]);
    expect(rulesOf(s.apply(outcome("dial-1a0", "e2")))).toEqual([]);
    // The control: the same stream, a dial neither carried.
    expect(rulesOf(s.apply(outcome("dial-000", "e3")))).toEqual(["stream.dialOutcome.unknown"]);
    // And a dial arriving on an offer or an update counts the same way.
    const offered: ProviderEventEnvelope<"voice"> = { id: "e4", loginId: "session-1", occurredAt: at, event: { type: "task-offered", task: { ...inherited, id: "call-99", phase: "pending", acceptance: "consent", onCall: [{ role: "consulted", destinationId: "tier2", dialId: "dial-off", stage: "ringing", since: at }] } } };
    expect(rulesOf(s.apply(offered))).toEqual([]);
    expect(rulesOf(s.apply(outcome("dial-off", "e5")))).toEqual([]);
  });

  it("lets an update restate a joined entry after its answered outcome, and refuses one that joins it alone", () => {
    const ringing: Task<"voice"> = { ...voiceTask, onCall: [{ role: "conferenced", destinationId: "tier2", dialId: "dial-7f2", stage: "ringing", since: at }] };
    const joined: Task<"voice"> = { ...voiceTask, onCall: [{ role: "conferenced", destinationId: "tier2", dialId: "dial-7f2", stage: "joined", since: at }] };
    const update = (task: Task<"voice">, id: string): ProviderEventEnvelope<"voice"> => ({ id, loginId: "session-1", occurredAt: at, event: { type: "task-updated", task } });
    // The outcome is the transition and the stage the state: outcome first, then the room restated.
    const s = new TaskStream();
    s.seed({ tasks: [ringing] });
    expect(rulesOf(s.apply(outcome("dial-7f2")))).toEqual([]);
    expect(rulesOf(s.apply(update(joined, "e2")))).toEqual([]);
    // Alone, the update is moving what only an answered outcome moves.
    const alone = new TaskStream();
    alone.seed({ tasks: [ringing] });
    expect(rulesOf(alone.apply(update(joined, "e2")))).toEqual(["stream.taskUpdated.stage"]);
    // And a busy outcome does not join anyone either.
    const busy = new TaskStream();
    busy.seed({ tasks: [ringing] });
    expect(rulesOf(busy.apply({ id: "e1", loginId: "session-1", occurredAt: at, event: { type: "dial-outcome", dialId: "dial-7f2", outcome: "busy", taskId: voiceTask.id } }))).toEqual([]);
    expect(rulesOf(busy.apply(update(joined, "e2")))).toEqual(["stream.taskUpdated.stage"]);
    // Restating ringing, or a joined entry that was already joined, moves nothing.
    expect(rulesOf(alone.apply(update(ringing, "e3")))).toEqual([]);
  });

  it("places an outcome against a task that has already ended", () => {
    // A dial launched late routinely outlives its call, and an agent who moved on still learns nobody was reached.
    const s = new TaskStream();
    s.seed({ tasks: [voiceTask] });
    s.dialled("dial-late");
    expect(rulesOf(s.apply({ id: "e1", loginId: "session-1", occurredAt: at, event: { type: "task-ended", taskId: voiceTask.id, outcome: { type: "completed", by: "agent" } } }))).toEqual([]);
    expect(rulesOf(s.apply(outcome("dial-late", "e2")))).toEqual([]);
  });
});

describe("assertBreakAttemptProviders", () => {
  const voice = { id: "voice", authentication: "authenticated", holdsCapacity: true } as const;
  const chat = { id: "chat", authentication: "refreshing", holdsCapacity: true } as const;
  const email = { id: "email", authentication: "expired", holdsCapacity: true } as const;
  const idle = { id: "idle", authentication: "authenticated", holdsCapacity: false } as const;

  it("keeps a usable provider holding capacity in, refreshing included, and leaves an expired one out", () => {
    expect(() => assertBreakAttemptProviders([voice, chat, email, idle], ["voice", "chat"])).not.toThrow();
    // The stall: waiting on a provider whose login is dead.
    expect(() => assertBreakAttemptProviders([voice, chat, email, idle], ["voice", "chat", "email"])).toThrow(/email is expired and is not asked/);
    // And the other way: a provider that can give work cannot be skipped.
    expect(() => assertBreakAttemptProviders([voice, chat, email, idle], ["voice"])).toThrow(/chat can give the agent work/);
    expect(() => assertBreakAttemptProviders([voice, chat, email, idle], ["voice", "chat", "idle"])).toThrow(/idle holds no capacity/);
    expect(() => assertBreakAttemptProviders([voice], ["voice", "ghost"])).toThrow(/ghost is not a provider/);
  });
});

describe("assertBreakBeginsAfterTask", () => {
  const on = (approval: "not-requested" | "awaiting-decision" | "granted" | "starting-after-task" | "in-effect", outstanding: number) => ({ approval, outstanding });

  it("accepts a break asked for on a task that begins when the task ends, decided or granted at once", () => {
    expect(() => assertBreakBeginsAfterTask([on("not-requested", 1), on("awaiting-decision", 1), on("granted", 1), on("starting-after-task", 1), on("in-effect", 0)])).not.toThrow();
    expect(() => assertBreakBeginsAfterTask([on("granted", 2), on("starting-after-task", 2), on("starting-after-task", 1), on("in-effect", 0)])).not.toThrow();
  });

  it("rejects a break that begins beside a task, or waits after the work is gone", () => {
    expect(() => assertBreakBeginsAfterTask([on("granted", 1), on("starting-after-task", 1), on("in-effect", 1)])).toThrow(/begins when the work ends/);
    expect(() => assertBreakBeginsAfterTask([on("granted", 1), on("starting-after-task", 0), on("in-effect", 0)])).toThrow(/should have begun/);
  });

  it("rejects a request that was not made on a task, or a commit not reported as starting-after-task", () => {
    expect(() => assertBreakBeginsAfterTask([on("granted", 0), on("in-effect", 0)])).toThrow(/while a task is outstanding/);
    expect(() => assertBreakBeginsAfterTask([on("granted", 1), on("in-effect", 0)])).toThrow(/starting-after-task while the work remains/);
    expect(() => assertBreakBeginsAfterTask([on("not-requested", 1)])).toThrow(/requires a request/);
    expect(() => assertBreakBeginsAfterTask([on("granted", 1), on("starting-after-task", 1)])).toThrow(/must end in effect/);
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
    const untimed = { completionMode: "agent-command" } satisfies Pick<Task, "completionMode" | "wrapAllowance">;
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
    sharedSession: true,
    isolationScheme: BROWSER_ISOLATION_SCHEMES.PROVIDER_NAME__TASK_TYPE_NAME__TAB_NAME,
  } as const satisfies TaskBrowser;
  const isolated = { ...browser, sharedSession: false, isolationScheme: undefined } as const satisfies TaskBrowser;

  it("shares one session across tasks under a task-type scheme", () => {
    expect(() => assertBrowserSessionIsolation(
      { providerId: "voiceco", taskId: "call-1", taskType: "Support", browser },
      { providerId: "voiceco", taskId: "call-2", taskType: "Support", browser: { ...browser, id: "crm-copy" } },
      true,
    )).not.toThrow();
  });

  it("never shares a session when sharedSession is false", () => {
    expect(() => assertBrowserSessionIsolation(
      { providerId: "voiceco", taskId: "call-1", taskType: "Support", browser },
      { providerId: "voiceco", taskId: "call-1", taskType: "Support", browser: isolated },
      false,
    )).not.toThrow();
    // Two isolated browsers do not share with each other either: "no key" is not a matching key.
    expect(() => assertBrowserSessionIsolation(
      { providerId: "voiceco", taskId: "call-1", taskType: "Support", browser: isolated },
      { providerId: "voiceco", taskId: "call-1", taskType: "Support", browser: isolated },
      false,
    )).not.toThrow();
    expect(browserSessionKey({ providerId: "voiceco", taskId: "c", taskType: "Support", browser: isolated })).toBeUndefined();
  });

  it("reports a mismatch between expected and derived sharing", () => {
    expect(() => assertBrowserSessionIsolation(
      { providerId: "voiceco", taskId: "call-1", taskType: "Support", browser },
      { providerId: "otherco", taskId: "call-1", taskType: "Support", browser },
      true,
    )).toThrow(/Browser session sharing mismatch/);
    // And in the other direction, so the helper is known to check rather than to throw.
    expect(() => assertBrowserSessionIsolation(
      { providerId: "voiceco", taskId: "call-1", taskType: "Support", browser },
      { providerId: "voiceco", taskId: "call-2", taskType: "Support", browser },
      false,
    )).toThrow(/Browser session sharing mismatch/);
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

// ---------------------------------------------------------------------------
// exerciseAdapter: the conformance harness.
// ---------------------------------------------------------------------------

/** A voice host with everything working: the microphone captured and flowing, a speaker present. */
const speaking: HostReport = { online: true, audio: { input: { status: "available", localAudio: {} as MediaStream, flowing: true }, output: { status: "available" } } };
const context = { protocolVersion: OMNI_PROTOCOL_VERSION, loginId: "session-1", timeZone: "Pacific/Chatham", phone: "softphone" as const, host: stillHost(speaking, {}, "stream"), store: memoryStore() };
/** The host a connection on this manifest's channel gets: audio for voice, none for the rest. */

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
  dialOutcomes: ["answered", "no-answer"],
  phones: ["softphone", "deskPhone"],
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
      dispositions: { required: true, notes: "optional", codes: [{ id: "resolved", label: "Resolved" }, { id: "callback", label: "Callback needed" }] },
      coldTransfer: { destinations: [{ id: "tier2", label: "Tier 2" }] },
      custom: [{ id: "request-supervisor", ui: { control: "button", label: "Request supervisor", placement: "secondary" } }],
    },
    capabilitySource: "queue",
    phase: "in-progress",
    media: "started",
    completionMode: "agent-command",
    wrapAllowance: 60,
    party: { name: "Maya Rao", number: "+919876543210" },
    browsers: [
      { id: "crm", name: "CRM", purpose: "Customer record", url: "https://crm.example.com/42", sharedSession: true, isolationScheme: "ProviderName.TaskTypeName.TabName" },
      { id: "kb", name: "Knowledge", purpose: "Article lookup", url: "https://kb.example.com/", sharedSession: false },
    ],
    handlingHistory: { steps: [
        { step: "queued", at: "2026-08-21T08:59:19Z", seconds: 41 },
        { step: "answered", at: "2026-08-21T09:00:00Z", by: "A-1" },
    ] },
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
  /** Sees the context connect() was handed, for a fixture that must use what the host gave it rather than what the test holds. */
  onConnect?: (connectContext: ConnectContext) => void;
  /** Publishes authentication states to the harness once it subscribes to the session. */
  emitAuthentication?: (listener: (state: AuthenticationState) => void) => void;
  /** Methods to replace, or to remove by passing `undefined`. */
  connection?: Partial<Record<keyof Connection<"voice">, unknown>>;
  authenticated?: boolean;
  /** What the login declares. Breaks by default, so the conforming connection needs the four methods. */
  capabilities?: UserCapabilities;
  /** The zone the identity republishes; `false` for a provider that never stored it. */
  identityTimeZone?: string | false;
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
          : { status: "authenticated" as const, identity: { id: "1042", displayName: "Asha Rao", timeZone: (overrides.identityTimeZone === false ? undefined : overrides.identityTimeZone ?? "Pacific/Chatham") as string }, capabilities: overrides.capabilities ?? { breaks: true }, expiresAt: "2026-08-21T12:00:00Z" },
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
      overrides.onConnect?.(connectContext);
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
        describeUsers: async ids => ids.map(id => ({ id, displayName: `User ${id}`, timeZone: "Pacific/Chatham" })),
        dial: async ({ dialId }) => ({ status: "dialling", dialId }),
        requestBreak: async () => ({ status: "requested" }),
        commitBreak: async () => ({ status: "committed" }),
        cancelBreak: async () => ({ status: "cancelled" }),
        endBreak: async () => ({ status: "ended" }),
        executeTeamBreak: async () => ({ status: "applied" }),
        executeTeamLeadAssist: async () => ({ status: "applied" }),
        setPreference: async () => ({ status: "applied" }),
        recordStep: async () => ({ status: "recorded" }),
        executeTeamPolicy: async () => ({ status: "applied" }),
        openMedia: async () => ({ status: "unavailable", failure: { code: "test", message: "No media in a test", retryable: false } }),
      };
      return { ...connection, ...overrides.connection } as Connection<"voice">;
    },
  } satisfies Adapter<"voice">;
  return { adapter, disconnect, close, unsubscribe, unsubscribeAuthentication };
}

/** The context a manifest's channel gets: a softphone on voice, no phone at all elsewhere. */
const contextFor = (manifest: unknown): ConnectContext =>
  (manifest as { channel?: string } | undefined)?.channel === "voice"
    ? { ...context, phone: "softphone", host: stillHost(speaking, {}, "stream") }
    : { ...context, phone: undefined, host: stillHost({ online: true }) };
const rules = async (overrides: AdapterOverrides) =>
  (await exerciseAdapter(makeAdapter(overrides).adapter, contextFor(overrides.manifest ?? conformingManifest), { collectOnly: true })).violations.map(violation => violation.rule);

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

  it("holds the host's phone to the manifest, and lets a desk phone own no audio", async () => {
    const on = async (phone: unknown, overrides: AdapterOverrides = {}, host: Host = stillHost(speaking, {}, "stream")) =>
      (await exerciseAdapter(makeAdapter(overrides).adapter, { ...context, phone: phone as "softphone", host } as ConnectContext, { collectOnly: true })).violations.map(v => v.rule);
    // A softphone login: the host reports audio and the adapter opens media.
    expect(await on("softphone")).toEqual([]);
    expect(await on("softphone", { connection: { openMedia: undefined } })).toContain("connection.openMedia.required");
    expect(await on("softphone", {}, stillHost({ online: true }, {}, "stream"))).toEqual(["context.host.audio.required"]);
    // What the host's Mute does is stated on a softphone, in one of two words, and nowhere else.
    expect(await on("softphone", {}, stillHost(speaking, {}, "station"))).toEqual([]);
    expect(await on("softphone", {}, stillHost(speaking, {}))).toEqual(["host.mute.required"]);
    expect(await on("softphone", {}, stillHost(speaking, {}, "soft" as "stream"))).toEqual(["host.mute"]);
    expect(await on("deskPhone", { connection: { openMedia: undefined, recordStep: undefined } }, stillHost({ online: true }, {}, "stream"))).toEqual(["host.mute.unexpected"]);
    // A desk-phone login: the host has no audio to report and nothing to open.
    expect(await on("deskPhone", { connection: { openMedia: undefined, recordStep: undefined } }, stillHost({ online: true }))).toEqual([]);
    // A softphone's host handed to a desk-phone login is wrong twice: it reports audio it does not have, and a mute it cannot perform.
    expect(await on("deskPhone")).toEqual(["context.host.audio.unexpected", "host.mute.unexpected"]);
    // The choice is held to the manifest, and required on voice.
    expect(await on("deskPhone", { manifest: { ...conformingManifest, phones: ["softphone"] } })).toContain("context.phone.unsupported");
    expect(await on("handset")).toContain("context.phone");
    expect(await on(undefined)).toContain("context.phone.required");
  });

  it("fails a run whose platform could not determine a task's terms, and passes one that states them", async () => {
    const [carried] = (conformingSnapshot as { tasks: Record<string, unknown>[] }).tasks;
    const under = (capabilitySource: string) => ({ ...conformingSnapshot, tasks: [{ ...carried, capabilitySource }] });
    expect(await rules({ snapshot: under("queue") })).toEqual([]);
    expect(await rules({ snapshot: under("ungoverned") })).toEqual([]);
    expect(await rules({ snapshot: under("undetermined") })).toEqual(["capabilitySource.undetermined"]);
    // And on the wire after the snapshot: an offer under undetermined terms is the same fault.
    const offer = (capabilitySource: string): ProviderEventEnvelope<"voice"> => ({ id: "offer-1", loginId: "session-1", occurredAt: "2026-08-21T09:00:00Z",
      event: { type: "task-offered", task: { ...voiceTask, id: "call-77", phase: "pending", acceptance: "consent", capabilitySource: capabilitySource as "queue" } } });
    expect(await rules({ emit: listener => listener(offer("queue")) })).toEqual([]);
    expect(await rules({ emit: listener => listener(offer("undetermined")) })).toEqual(["capabilitySource.undetermined"]);
  });

  it("requires the host to state a time zone, and the provider to keep it on the identity", async () => {
    // Both directions: the host's word is validated, and the provider is held to storing it.
    expect(await rules({})).toEqual([]);
    const without = await exerciseAdapter(makeAdapter({}).adapter, { ...context, timeZone: undefined as unknown as string }, { collectOnly: true });
    expect(without.violations.map(v => v.rule)).toContain("context.timeZone");
    const offset = await exerciseAdapter(makeAdapter({}).adapter, { ...context, timeZone: "+05:30" }, { collectOnly: true });
    expect(offset.violations.map(v => v.rule)).toContain("context.timeZone");
    // A zone is judged by what it denotes: the host says Asia/Kolkata, the provider keeps Asia/Calcutta, one zone.
    const alias = await exerciseAdapter(makeAdapter({ identityTimeZone: "Asia/Calcutta" }).adapter, { ...context, timeZone: "Asia/Kolkata" }, { collectOnly: true });
    expect(alias.violations.map(v => v.rule)).toEqual([]);
    // An identity without a zone is not an identity on this wire; one with somebody else's day is told so.
    expect(await rules({ identityTimeZone: false })).toContain("authentication.identity.timeZone");
    expect(await rules({ identityTimeZone: "America/Chicago" })).toEqual(["authentication.identity.timeZone.republished"]);
  });

  it("catches a preview task that leaves preview still carrying its deadline, through the full run", async () => {
    // The natural provider implementation spreads the old task into the new one, and its own
    // state looks right; only the host's boundary sees the deadline a task past preview cannot have.
    const previewed = { ...conformingSnapshot.tasks[0]!, id: "call-77", capabilities: {}, browsers: [], phase: "preview" as const, media: undefined, handlingHistory: undefined,
      previewEndsAt: "2026-08-21T09:02:00Z", atDeadline: "calls" as const };
    const withPreview = { ...conformingSnapshot, tasks: [previewed], taskCount: 1 } satisfies Snapshot<"voice">;
    const update = (task: Task<"voice">): ProviderEventEnvelope<"voice"> =>
      ({ id: "evt-spread", loginId: "session-1", occurredAt: "2026-08-21T09:01:30Z", event: { type: "task-updated", task } });
    const spread = await rules({ snapshot: withPreview, emit: listener => listener(update({ ...previewed, phase: "in-progress" })) });
    expect(spread).toEqual(["task.preview.deadline.unexpected"]);
    // The control: the same move with both fields dropped is exactly what the guide asks for.
    const dropped = await rules({ snapshot: withPreview, emit: listener => listener(update({ ...previewed, phase: "in-progress", previewEndsAt: undefined, atDeadline: undefined })) });
    expect(dropped).toEqual([]);
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
      "event.task-media-started", "event.task-media-ended", "event.task-ended", "event.dial-outcome", "event.announcement", "event.queue-summary",
      "event.diagnostic", "event.team-updated", "event.contacts-updated", "event.calendar-updated",
    ];
    // The rich task carries browsers, history, a disposition policy, transfer destinations and a
    // custom control, but no attributes and nobody on the call, no lead asked for, and nobody assisted.
    const rich = await run({});
    expect(state(rich)).toEqual(["task.attributes", "task.onCall", "task.leadAssist", "task.assisting", "task.monitoring", "task.acceptance", "task.locked", "break.reasons", "break.imposed", "team.members", "team.requests", "team.policies"]);
    expect(events(rich)).toEqual(everyEvent);
    const bare = await run({ manifest: plainManifest, snapshot: minimalSnapshot });
    expect(state(bare)).toEqual([
      "tasks", "task.browsers", "task.attributes", "task.handlingHistory", "task.onCall", "task.leadAssist", "task.assisting", "task.monitoring",
      "task.media", "task.acceptance", "task.dispositions", "task.destinations", "task.custom", "task.locked", "break.reasons", "break.imposed", "team.members", "team.requests",
      "contacts", "scheduledActivities", "team.policies",
    ]);
    // Each subject drops out exactly when the run meets it -- on the snapshot or on an event.
    const reached = {
      ...conformingSnapshot,
      break: { approval: "in-effect", mayAsk: true, reasons: [{ id: "lunch", label: "Lunch" }], imposed: { by: "M-1", endsAutomatically: false } },
      team: { members: [{ id: "A-2", availability: "on-task" }], requests: [{ id: "req-7", memberId: "A-2", taskId: "call-42", since: "2026-08-21T09:04:00Z" }] },
    } satisfies Snapshot<"voice">;
    expect(state(await run({ capabilities: { team: { leadAssistControl: true } }, snapshot: reached })))
      .toEqual(["task.attributes", "task.onCall", "task.leadAssist", "task.assisting", "task.monitoring", "task.acceptance", "task.locked", "team.policies"]);
    const later: ProviderEventEnvelope<"voice"> = {
      id: "evt-team", loginId: "session-1", occurredAt: "2026-08-21T09:05:00Z",
      event: { type: "team-updated", team: { members: [{ id: "A-2", availability: "ready" }] } },
    };
    const rosterOnly = { ...conformingSnapshot, team: { members: [] } } satisfies Snapshot<"voice">;
    const withEvent = await run({ capabilities: { team: {} }, snapshot: rosterOnly, emit: listener => listener(later) });
    expect(state(withEvent)).toEqual(["task.attributes", "task.onCall", "task.leadAssist", "task.assisting", "task.monitoring", "task.acceptance", "task.locked", "break.reasons", "break.imposed", "team.requests", "team.policies"]);
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

describe("exerciseAdapter drives one call", () => {
  const at = "2026-08-21T09:00:00Z";
  type Listener = (envelope: ProviderEventEnvelope<"voice">) => void;
  interface Script { skipMediaStart?: boolean; keepRoomOnEnd?: boolean; refuseHold?: boolean; holdAfterEnd?: boolean; confirmFirst?: boolean; holdBeforeStart?: boolean; noEndCall?: boolean; badCapability?: boolean; refuseRecordStep?: boolean; restateHistory?: "with-mute" | "with-mute-by-station" | "without-mute";
    /** A platform shared between instances of the adapter, as a host reload shares it: which task is open. */
    platform?: { open: boolean };
    /** Where this adapter keeps the host's legs: in its own closure, or in the login's store handed to it. */
    legsIn?: "memory" | "store";
    /** How a second instance misbehaves: another provider's manifest, a record missing the answer, a snapshot that miscounts. */
    reloadAs?: "another-provider" | "without-answered" | "miscounted";
    /** An adapter that ends the task and leaves its key in the store, for the next offer of the id to inherit. */
    leavesKeys?: boolean }
  /** A provider whose platform answers every command with the events a host is owed, or misbehaves on request. */
  const driveable = (script: Script = {}) => {
    let listener: Listener | undefined;
    let n = 0;
    const id = () => `drv-${n += 1}`;
    const base: Record<string, unknown> = {
      ...conformingSnapshot.tasks[0]!, id: "call-77", capabilities: { hold: script.badCapability ? "yes" : true, ...(script.noEndCall ? {} : { endCall: true }), dispositions: { required: true, codes: [{ id: "resolved", label: "Resolved" }] } },
      browsers: [], handlingHistory: undefined, media: undefined, party: { name: "Maya Rao", number: "+919876543210" },
    };
    let phase = "pending";
    let muted: { at: string; seconds: number; mutedBy: "host" | "station" } | undefined;
    // The store as the host handed it on connect: an adapter writes through what it was given, never a copy the test holds.
    let given: LoginStore | undefined;
    const legEntry = (leg: { at: string; seconds: number; mutedBy: "host" | "station" }) =>
      ({ step: "muted" as const, ...leg, by: "1042", mutedBy: script.restateHistory === "with-mute-by-station" ? "station" as const : leg.mutedBy });
    const history = () => script.restateHistory === undefined ? undefined
      : { steps: [{ step: "answered" as const, at }, ...(muted !== undefined && script.restateHistory !== "without-mute" ? [legEntry(muted)] : [])] };
    // What a second instance knows: the platform's open task, and the legs it can reach -- the store's, or its own empty memory.
    const reloaded = async () => {
      if (script.platform?.open !== true) return { ...conformingSnapshot, tasks: [], taskCount: 0 };
      const kept = script.legsIn === "store" && given !== undefined ? await given.get("legs:call-77") : undefined;
      const legs = kept === undefined ? (muted === undefined ? [] : [legEntry(muted)]) : [legEntry(JSON.parse(kept) as { at: string; seconds: number; mutedBy: "host" | "station" })];
      const steps = [...(script.reloadAs === "without-answered" ? [] : [{ step: "answered" as const, at }]), ...legs];
      return { ...conformingSnapshot, tasks: [t({ phase: "in-progress", media: "started", onCall: room, handlingHistory: { steps } })], taskCount: script.reloadAs === "miscounted" ? 2 : 1 };
    };
    // A provider that restates its record does so on every publication once work has begun, never only at the end.
    const t = (over: Record<string, unknown>) => {
      if (typeof over.phase === "string") phase = over.phase;
      const begun = over.phase !== "pending" && over.phase !== "confirmed";
      return { ...base, ...(begun && script.restateHistory !== undefined ? { handlingHistory: history() } : {}), ...over } as unknown as Task<"voice">;
    };
    const emit = (event: ProviderEventEnvelope<"voice">["event"]) => listener?.({ id: id(), loginId: "session-1", occurredAt: at, event });
    const room = [{ role: "party" as const, since: at }, { role: "agent" as const, userId: "1042", since: at }];
    // Nothing is offered until a capacity is stated, which is when a provider may allocate; the
    // offer lands after the snapshot, as it does in life.
    const { adapter } = makeAdapter({
      snapshot: { ...conformingSnapshot, tasks: [], taskCount: 0 },
      ...(script.reloadAs === "another-provider" && script.platform?.open === true ? { manifest: { ...conformingManifest, id: "acme-voice-2" } } : {}),
      emit: l => { listener = l; },
      onConnect: connectContext => { given = connectContext.store; },
      connection: {
        ...(script.platform === undefined ? {} : { snapshot: reloaded }),
        setCapacity: async () => { if (script.platform !== undefined) script.platform.open = true; emit({ type: "task-offered", task: t({ phase: "pending", acceptance: "consent" }) }); return { status: "applied" }; },
        execute: async ({ command }: { command: { type: string } }) => {
          switch (command.type) {
            case "answer":
              // The phase moves first and the audio follows on its own event, which is the only
              // order the stream allows: an update never moves media, and media never arrives on
              // a task whose work has not begun.
              // A provider that acknowledges before it starts says so: confirmed first, then work begins.
              if (script.confirmFirst) { emit({ type: "task-updated", task: t({ phase: "confirmed" }) }); return { status: "applied" }; }
              emit({ type: "task-updated", task: t({ phase: "in-progress", onCall: room }) });
              if (!script.skipMediaStart) emit({ type: "task-media-started", taskId: "call-77" });
              return { status: "applied" };
            case "hold":
              if (script.refuseHold) return { status: "failed", failure: { code: "provider.busy", message: "No hold today", retryable: false } };
              // A conforming adapter refuses a control on a call that is over; one that applies it is the second gate failing.
              if (phase === "completing") {
                return script.holdAfterEnd ? { status: "applied" } : { status: "failed", failure: { code: "provider.call-ended", message: "Nothing to hold", retryable: false } };
              }
              if (phase === "confirmed") {
                // Work begins once the probe has been answered: the drive is still in confirmed when it sends.
                const answer = script.holdBeforeStart ? { status: "applied" as const } : { status: "failed" as const, failure: { code: "provider.not-started", message: "Nothing to hold yet", retryable: false } };
                emit({ type: "task-updated", task: t({ phase: "in-progress", onCall: room }) });
                emit({ type: "task-media-started", taskId: "call-77" });
                return answer;
              }
              emit({ type: "task-updated", task: t({ phase: "paused", media: "started", onCall: room }) }); return { status: "applied" };
            case "resume": emit({ type: "task-updated", task: t({ phase: "in-progress", media: "started", onCall: room }) }); return { status: "applied" };
            case "end-call":
              emit({ type: "task-media-ended", taskId: "call-77" });
              emit({ type: "task-updated", task: t({ phase: "completing", media: "ended", onCall: script.keepRoomOnEnd ? room : [], handlingHistory: history() }) });
              return { status: "applied" };
            case "complete":
              if (script.platform !== undefined) script.platform.open = false;
              // A task's keys go with the task, before its end is published.
              if (script.legsIn === "store" && given !== undefined && !script.leavesKeys) await given.delete("legs:call-77");
              emit({ type: "task-ended", taskId: "call-77", outcome: { type: "completed", by: "agent" } });
              return { status: "applied" };
            default: return { status: "failed", failure: { code: "omni.capability-not-enabled", message: command.type, retryable: false } };
          }
        },
        openMedia: async () => ({ status: "opened", session: { remoteAudio: {} as MediaStream, setMuted: () => undefined, close: () => undefined } }),
        recordStep: async (report: { step: string; at: string; seconds?: number; ended?: boolean; mutedBy?: "host" | "station" }) => {
          if (script.refuseRecordStep) return { status: "failed", failure: { code: "provider.unavailable", message: "No record today", retryable: true } };
          if (report.step === "muted" && report.ended === true && report.seconds !== undefined && report.mutedBy !== undefined) {
            muted = { at: report.at, seconds: report.seconds, mutedBy: report.mutedBy };
            // The store write is part of recording: what the platform cannot hold goes there first.
            if (script.legsIn === "store" && given !== undefined) await given.set("legs:call-77", JSON.stringify(muted));
          }
          return { status: "recorded" };
        },
      },
    });
    return adapter;
  };
  const drive = async (adapter: Adapter<"voice">) => exerciseAdapter(adapter, context, { collectOnly: true, drive: true, driveTimeoutMs: 200 });

  it("takes the first offer through answer, media, hold, resume, end-call and complete, reaching what a static run never does", async () => {
    const result = await drive(driveable());
    expect(result.violations).toEqual([]);
    // The subjects a run without a drive lists as never reached are now reached.
    for (const subject of ["tasks", "task.onCall", "task.media", "task.acceptance", "task.dispositions", "event.task-offered", "event.task-updated", "event.task-media-started", "event.task-media-ended", "event.task-ended"] as const) {
      expect(result.notExercised).not.toContain(subject);
    }
    // The control: without the drive the same adapter reaches none of the call.
    const still = await exerciseAdapter(driveable(), context, { collectOnly: true });
    expect(still.violations).toEqual([]);
    expect(still.notExercised).toContain("task.media");
  });

  it("names what the provider owed and never sent, and a refusal of a control the task offered", async () => {
    expect((await drive(driveable({ skipMediaStart: true }))).violations.map(v => v.rule)).toEqual(["drive.timeout"]);
    expect((await drive(driveable({ refuseHold: true }))).violations.map(v => v.rule)).toEqual(["drive.command.failed"]);
    // A command is never sent against a task that does not stand: the malformed offer is named, and so is the command held to it.
    const bad = (await drive(driveable({ badCapability: true }))).violations.map(v => v.rule);
    expect(bad).toContain("task.capability.value");
    expect(bad).toContain("command.task");
  });

  it("reaches the rules about a live call: a room left full after end-call is refused at the boundary", async () => {
    expect((await drive(driveable({ keepRoomOnEnd: true }))).violations.map(v => v.rule)).toContain("task.onCall.ended");
  });

  it("mutes the open audio for a moment and reports the leg, expecting it recorded and, where the record is restated, present", async () => {
    // The conforming fixture records it and the run is clean (the first test). The provider may
    // restate the record afterwards; when it does, the host's leg is in it or the hole is named.
    expect((await drive(driveable({ refuseRecordStep: true }))).violations.map(v => v.rule)).toEqual(["drive.recordStep.failed", "drive.recordStep.failed"]);
    expect((await drive(driveable({ restateHistory: "with-mute" }))).violations).toEqual([]);
    expect((await drive(driveable({ restateHistory: "without-mute" }))).violations.map(v => v.rule)).toEqual(["drive.recordStep.history"]);
    // The record keeps the host's word on whose the silence was.
    expect((await drive(driveable({ restateHistory: "with-mute-by-station" }))).violations.map(v => v.rule)).toEqual(["drive.recordStep.history"]);
  });

  it("builds the adapter again as a host reload does, and names one whose record died with it", async () => {
    // Two instances share the platform and the store, as a reloaded host's do; the first's closure is gone.
    const run = async (legsIn: "memory" | "store", sharesPlatform = true) => {
      const store = memoryStore();
      const script = { restateHistory: "with-mute" as const, legsIn, platform: sharesPlatform ? { open: false } : undefined };
      return (await exerciseAdapter(driveable(script), { ...context, store }, { collectOnly: true, drive: true, driveTimeoutMs: 200, rebuild: () => driveable(script) })).violations.map(v => v.rule);
    };
    expect(await run("store")).toEqual([]);
    expect(await run("memory")).toEqual(["drive.reload.history"]);
    // A second instance that does not carry the open task at all is named for that first.
    expect(await run("store", false)).toEqual(["drive.reload.snapshot"]);
    // The control: the same adapters without a rebuild pass either way, which is what the rebuild exists to end.
    const store = memoryStore();
    expect((await exerciseAdapter(driveable({ restateHistory: "with-mute", legsIn: "memory", platform: { open: false } }), { ...context, store }, { collectOnly: true, drive: true, driveTimeoutMs: 200 })).violations).toEqual([]);
  }, 20000);

  it("holds the second adapter to what the first was: the same provider, a snapshot that stands, a record that lost nothing", async () => {
    const misbehaving = async (reloadAs: "another-provider" | "without-answered" | "miscounted") => {
      const store = memoryStore();
      const script = { restateHistory: "with-mute" as const, legsIn: "store" as const, platform: { open: false }, reloadAs };
      return (await exerciseAdapter(driveable(script), { ...context, store }, { collectOnly: true, drive: true, driveTimeoutMs: 200, rebuild: () => driveable(script) })).violations.map(v => v.rule);
    };
    expect(await misbehaving("another-provider")).toEqual(["drive.reload.manifest"]);
    expect(await misbehaving("without-answered")).toEqual(["drive.reload.history"]);
    expect(await misbehaving("miscounted")).toEqual(["snapshot.taskCount.mismatch"]);
  }, 20000);

  it("names a task's key still in the store after the task has ended, and passes one that went with the task", async () => {
    // The clean case is the store-kept adapter above, which deletes its key before publishing the end. This one leaves it.
    const store = memoryStore();
    const script = { restateHistory: "with-mute" as const, legsIn: "store" as const, leavesKeys: true };
    expect((await exerciseAdapter(driveable(script), { ...context, store }, { collectOnly: true, drive: true, driveTimeoutMs: 200 })).violations.map(v => v.rule)).toEqual(["drive.store.retained"]);
    // The control in the same process: the same adapter deleting its key is clean, and the store the test holds is empty afterwards.
    const kept = memoryStore();
    expect((await exerciseAdapter(driveable({ ...script, leavesKeys: false }), { ...context, store: kept }, { collectOnly: true, drive: true, driveTimeoutMs: 200 })).violations).toEqual([]);
    expect(await kept.get("legs:call-77")).toBeUndefined();
    expect(await store.get("legs:call-77")).toBeDefined();
  });

  it("sends hold once more after the call has ended, past the validator, and names an adapter that applies it", async () => {
    // The conforming fixture refuses it and the run is clean (the first test); this one applies it.
    expect((await drive(driveable({ holdAfterEnd: true }))).violations.map(v => v.rule)).toEqual(["drive.command.handling"]);
  });

  it("sends hold in confirmed too, where the provider publishes it, and names an adapter that applies it there", async () => {
    // The drive sees the fixture's confirmed while the task is in it, so the pass through that phase is real, not raced.
    const confirming = driveable({ confirmFirst: true });
    const clean = await exerciseAdapter(confirming, context, { collectOnly: true, drive: true, driveTimeoutMs: 200 });
    expect(clean.violations).toEqual([]);
    expect((await drive(driveable({ confirmFirst: true, holdBeforeStart: true }))).violations.map(v => v.rule)).toEqual(["drive.command.handling"]);
    // The control: without confirmed on the way, the misbehaviour has nowhere to show.
    expect((await drive(driveable({ holdBeforeStart: true }))).violations).toEqual([]);
  });

  it("completes a task from where it stands when there is no call to end, and says what it could not reach", async () => {
    // A voice task offering no end-call, like a chat or an email, has no completing phase to wait
    // for: the agent completes it from in-progress, and the run reaches the end.
    const result = await drive(driveable({ noEndCall: true }));
    expect(result.violations).toEqual([]);
    expect(result.notExercised).toContain("event.task-media-ended");
    expect(result.notExercised).not.toContain("event.task-ended");
  });
});

describe("exerciseAdapter requires each method the declarations call for", () => {
  // Every case pairs the refusal with its control: the same adapter with the declaration
  // withdrawn is clean, so a missing method is reported because of the declaration and not
  // because the check fires for everyone.
  const chatManifest = { ...conformingManifest, id: "acme-chat", channel: "chat", dialOutcomes: undefined, phones: undefined, idleCapabilities: { contacts: true } } satisfies Manifest<"chat">;
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

  it("executeTeamMonitor(), when the login declares team.monitorControl", async () => {
    const listening = { team: { monitorControl: ["monitor", "whisper"] as ("monitor" | "whisper")[] } };
    expect(await rules({ capabilities: listening, snapshot: leadSnapshot, connection: { executeTeamMonitor: undefined } })).toContain("connection.executeTeamMonitor.required");
    expect(await rules({ capabilities: listening, snapshot: leadSnapshot, connection: { executeTeamMonitor: async () => ({ status: "applied" }) } })).toEqual([]);
    // The control: a lead who may not listen owes no method.
    expect(await rules({ capabilities: { team: {} }, snapshot: leadSnapshot, connection: { executeTeamMonitor: undefined } })).not.toContain("connection.executeTeamMonitor.required");
  });

  it("executeTeamLeadAssist(), when the login declares team.leadAssistControl", async () => {
    const consulting = { team: { leadAssistControl: true as const } };
    const watching = { team: {} };
    expect(await rules({ capabilities: consulting, snapshot: leadSnapshot, connection: { executeTeamLeadAssist: undefined } })).toContain("connection.executeTeamLeadAssist.required");
    expect(await rules({ capabilities: watching, snapshot: leadSnapshot, connection: { executeTeamLeadAssist: undefined } })).not.toContain("connection.executeTeamLeadAssist.required");
  });

  it("validates every authentication state the session publishes during the run", async () => {
    const asha = { id: "1042", displayName: "Asha Rao", timeZone: "Pacific/Chatham" };
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
    const asha = { id: "1042", displayName: "Asha Rao", timeZone: "Pacific/Chatham" };
    const same = { status: "refreshing", identity: asha, capabilities: { team: {} } } satisfies AuthenticationState;
    const fewer = { status: "refreshing", identity: asha, capabilities: {} } satisfies AuthenticationState;
    const other = { status: "refreshing", identity: { id: "A-9", displayName: "Bo", timeZone: "Pacific/Chatham" }, capabilities: { team: {} } } satisfies AuthenticationState;
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
    const asha = { id: "1042", displayName: "Asha Rao", timeZone: "Pacific/Chatham" };
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

  it("requests follow the login's leadAssistControl both ways", async () => {
    const members = [{ id: "A-2", availability: "on-task" as const }];
    const request = { id: "req-7", memberId: "A-2", taskId: "call-42", since: "2026-08-21T09:04:00Z" };
    const asking = { ...minimalSnapshot, team: { members, requests: [request] } } satisfies Snapshot<"voice">;
    const silent = { ...minimalSnapshot, team: { members } } satisfies Snapshot<"voice">;
    const may = { team: { leadAssistControl: true as const } };
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
    const asha = { id: "1042", displayName: "Asha Rao", timeZone: "Pacific/Chatham" };
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

  it("fails a run in which the provider reports a diagnostic, and says what it reported", async () => {
    // Informational to a host, a failure here: a green conformance result must not sit over a
    // platform that is breaking the rules the adapter relies on.
    const diagnostic: ProviderEventEnvelope<"voice"> = { id: "evt-diag", loginId: "session-1", occurredAt: "2026-08-21T09:05:00Z",
      event: { type: "diagnostic", expected: "a task-ended names the task the agent holds", observed: "task-ended named call-99 while call-42 was held", taskId: "call-99" } };
    const result = await exerciseAdapter(makeAdapter({ emit: listener => listener(diagnostic) }).adapter, context, { collectOnly: true });
    expect(result.violations.map(v => v.rule)).toEqual(["diagnostic.raised"]);
    expect(result.violations[0]?.message).toContain("task-ended named call-99");
    expect(result.notExercised).not.toContain("event.diagnostic");
  });

  it("validates the guarantees of the host a test hands the adapter, and passes them through to it", async () => {
    // A false guarantee is a host that cannot exist; the harness says so. A true one reaches the
    // adapter through the wrapped host, so an adapter can decide on it.
    const promising: Host = { guarantees: { personConsent: true }, mute: "stream", report: () => ({ online: true }), subscribe: () => () => undefined };
    let seen: HostGuarantees | undefined;
    const { adapter } = makeAdapter();
    const observing = { ...adapter, connect: async (connectContext: ConnectContext) => { seen = connectContext.host.guarantees; return adapter.connect(connectContext); } } as typeof adapter;
    expect((await exerciseAdapter(observing, { ...context, host: { ...promising, report: () => speaking } } as ConnectContext, { collectOnly: true })).violations.map(v => v.rule)).toEqual([]);
    expect(seen).toEqual({ personConsent: true });
    const lying: Host = { ...promising, guarantees: { personConsent: false } as unknown as HostGuarantees, report: () => speaking };
    expect((await exerciseAdapter(makeAdapter().adapter, { ...context, host: lying } as ConnectContext, { collectOnly: true })).violations.map(v => v.rule)).toEqual(["host.guarantee.value"]);
  });

  it("validates the host report a test hands the adapter, first and later, and lets go of it", async () => {
    // A malformed host report is a host that cannot exist; the harness says so rather than let
    // an adapter pass against it.
    const microphone = { id: "mic" } as unknown as MediaStream;
    const failure = { code: "host.permission-denied", message: "Microphone access was refused", retryable: true };
    const unsubscribe = vi.fn(() => undefined);
    const host = (first: unknown, later?: unknown): Host => ({
      guarantees: {},
      mute: "stream",
      report: () => first as HostReport,
      subscribe: listener => { if (later !== undefined) listener(later as HostReport); return unsubscribe; },
    });
    const run = async (h: Host) =>
      (await exerciseAdapter(makeAdapter().adapter, { ...context, host: h } as ConnectContext, { collectOnly: true })).violations.map(violation => violation.rule);
    const speaking = { online: true, audio: { input: { status: "available", localAudio: microphone, flowing: true }, output: { status: "available" } } };
    expect(await run(host(speaking))).toEqual([]);
    expect(await run(host({ online: true, audio: { input: { status: "unavailable", reason: "denied", failure }, output: { status: "available" } } }))).toEqual([]);
    expect(await run(host({ online: true, audio: { input: { status: "available", flowing: true }, output: { status: "available" } } }))).toEqual(["host.audio.input.localAudio"]);
    expect(await run(host(speaking, { online: "yes" }))).toEqual(["host.online"]);
    expect(unsubscribe).toHaveBeenCalledTimes(4);
    expect(await rules({})).toEqual([]);
  });

  it("requires the login's store of every connection, and passes it through", async () => {
    // A store the test hands the harness reaches the adapter; one missing or malformed is named before connect.
    let seen: unknown;
    const { adapter } = makeAdapter();
    const observing = { ...adapter, connect: async (connectContext: ConnectContext) => { seen = connectContext.store; return adapter.connect(connectContext); } } as typeof adapter;
    const store = memoryStore();
    expect((await exerciseAdapter(observing, { ...context, store }, { collectOnly: true })).violations).toEqual([]);
    // The adapter is handed a store the harness watches; what it writes lands in the host's, and what the host holds it reads.
    const handed = seen as LoginStore;
    await handed.set("k", "v");
    expect(await store.get("k")).toBe("v");
    await store.set("host", "wrote");
    expect(await handed.get("host")).toBe("wrote");
    await handed.delete("k");
    expect(await store.get("k")).toBeUndefined();
    expect((await exerciseAdapter(makeAdapter().adapter, { ...context, store: undefined } as unknown as ConnectContext, { collectOnly: true })).violations.map(v => v.rule)).toEqual(["store.shape"]);
    expect((await exerciseAdapter(makeAdapter().adapter, { ...context, store: { get: store.get, set: store.set } } as unknown as ConnectContext, { collectOnly: true })).violations.map(v => v.rule)).toEqual(["store.delete"]);
    // The store keeps what it is given, by key, until it is deleted.
    await store.set("legs:call-42", "[]");
    expect(await store.get("legs:call-42")).toBe("[]");
    await store.delete("legs:call-42");
    expect(await store.get("legs:call-42")).toBeUndefined();
  });

  it("gives a voice connection a host with audio and no other, and refuses an adapter that never asked", async () => {
    const chatManifest = { ...conformingManifest, id: "acme-chat", channel: "chat", dialOutcomes: undefined, phones: undefined, idleCapabilities: { contacts: true } } satisfies Manifest<"chat">;
    const chatSnapshot = { ...minimalSnapshot, contacts: [] } satisfies Snapshot<"chat">;
    const run = async (overrides: AdapterOverrides, host: Host) =>
      (await exerciseAdapter(makeAdapter(overrides).adapter, { ...contextFor(overrides.manifest ?? conformingManifest), host } as ConnectContext, { collectOnly: true })).violations.map(violation => violation.rule);
    expect(await run({}, stillHost(speaking, {}, "stream"))).toEqual([]);
    expect(await run({}, stillHost({ online: true }, {}, "stream"))).toEqual(["context.host.audio.required"]);
    const chat = { manifest: chatManifest, snapshot: chatSnapshot, connection: { openMedia: undefined, dial: undefined } };
    expect(await run(chat, stillHost({ online: true }))).toEqual([]);
    expect(await run(chat, stillHost(speaking, {}, "stream"))).toEqual(["context.host.audio.unexpected", "host.mute.unexpected"]);
    // The obligation: a voice adapter asks. A chat adapter has nothing to ask about and is not held to it.
    expect(await rules({ ignoresHost: true })).toEqual(["connection.host.consulted"]);
    expect(await rules({ ...chat, ignoresHost: true })).toEqual([]);
  });

  it("releases the host subscription when connect itself throws", async () => {
    const unsubscribe = vi.fn(() => undefined);
    const host: Host = { guarantees: {}, mute: "stream", report: () => speaking, subscribe: () => unsubscribe };
    await expect(exerciseAdapter(makeAdapter({ connect: async () => { throw new Error("no transport"); } }).adapter, { ...context, host } as ConnectContext, { collectOnly: true })).rejects.toThrow(/no transport/);
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
    const offered = (acceptance?: "consent"): ProviderEventEnvelope<"voice"> => ({
      id: "evt-offer", loginId: "session-1", occurredAt: "2026-08-21T09:00:00Z",
      event: { type: "task-offered", task: { ...conformingSnapshot.tasks[0]!, phase: "pending", media: undefined, ...(acceptance ? { acceptance } : {}) } },
    });
    const run = async (autoAcceptTasks: boolean | undefined, envelope: ProviderEventEnvelope<"voice">) =>
      (await exerciseAdapter(makeAdapter({ emit: listener => listener(envelope) }).adapter, { ...context, ...(autoAcceptTasks === undefined ? {} : { autoAcceptTasks }) }, { collectOnly: true }))
        .violations.map(violation => violation.rule);
    expect(await run(undefined, offered("consent"))).toEqual([]);
    expect(await run(undefined, offered())).toContain("task.acceptance.required");
    expect(await run(false, offered())).toEqual([]);
    expect(await run(false, offered("consent"))).toContain("task.acceptance.unexpected");
    // The word is on the task, so a reconnect snapshot says it too: a pending task carried in without it is refused the same way.
    const carried = { ...conformingSnapshot, tasks: [{ ...conformingSnapshot.tasks[0]!, phase: "pending" as const, media: undefined }] };
    expect(await rules({ snapshot: carried })).toContain("task.acceptance.required");
    expect(await rules({ snapshot: { ...carried, tasks: [{ ...carried.tasks[0]!, acceptance: "consent" as const }] } })).toEqual([]);
  });

  it("describeUsers(), when a UserId arrives on an event or on a task's lead or assisting", async () => {
    const at = "2026-08-21T09:05:00Z";
    const bare = { ...minimalSnapshot, tasks: [{ ...conformingSnapshot.tasks[0]!, handlingHistory: { steps: [] } }] } satisfies Snapshot<"voice">;
    const joined = { ...bare, tasks: [{ ...bare.tasks[0]!, capabilities: { ...bare.tasks[0]!.capabilities, leadAssist: true }, leadAssist: { stage: "joined", leadId: "L-9", since: at } }] } satisfies Snapshot<"voice">;
    const assisting = { ...bare, tasks: [{ ...bare.tasks[0]!, assisting: { memberId: "A-1", since: at } }] } satisfies Snapshot<"voice">;
    expect(await rules({ manifest: plainManifest, snapshot: bare, connection: { describeUsers: undefined } })).not.toContain("connection.describeUsers.required");
    expect(await rules({ manifest: plainManifest, snapshot: joined, connection: { describeUsers: undefined } })).toContain("connection.describeUsers.required");
    expect(await rules({ manifest: plainManifest, snapshot: assisting, connection: { describeUsers: undefined } })).toContain("connection.describeUsers.required");
    const later: ProviderEventEnvelope<"voice"> = { id: "evt-team", loginId: "session-1", occurredAt: at, event: { type: "team-updated", team: { members: [{ id: "A-2", availability: "ready" }] } } };
    expect(await rules({ manifest: plainManifest, capabilities: { team: {} }, snapshot: { ...bare, team: { members: [] } }, connection: { describeUsers: undefined }, emit: listener => listener(later) })).toContain("connection.describeUsers.required");
  });

  it("setPreference() and executeTeamPolicy(), when the login declares preferences or policyControl", async () => {
    const choosing = { preferences: [{ id: "hold" as const, label: "Hold", enabled: true, setBy: "team" as const }] };
    expect(await rules({ manifest: plainManifest, snapshot: minimalSnapshot, capabilities: choosing, connection: { setPreference: undefined } })).toContain("connection.setPreference.required");
    expect(await rules({ manifest: plainManifest, snapshot: minimalSnapshot, capabilities: {}, connection: { setPreference: undefined } })).not.toContain("connection.setPreference.required");
    const setting = { team: { policyControl: true as const } };
    const withPolicies = { ...minimalSnapshot, team: { members: [], policies: { hold: { setting: "off", setBy: "team" } } } } satisfies Snapshot<"voice">;
    expect(await rules({ manifest: plainManifest, snapshot: withPolicies, capabilities: setting, connection: { executeTeamPolicy: undefined } })).toContain("connection.executeTeamPolicy.required");
    expect(await rules({ manifest: plainManifest, snapshot: withPolicies, capabilities: setting })).toEqual([]);
    // The roster carries policies exactly when the login may set them.
    expect(await rules({ manifest: plainManifest, snapshot: { ...minimalSnapshot, team: { members: [] } }, capabilities: setting })).toEqual(["team.policies.required"]);
    expect(await rules({ manifest: plainManifest, snapshot: withPolicies, capabilities: { team: {} } })).toEqual(["team.policies.capability"]);
  });

  it("holds who-decided to the manifest's declared ladder, on the login and on the snapshot", async () => {
    const laddered = { ...conformingManifest, orgLevels: [{ id: "org", label: "Your organisation" }, { id: "region", label: "Your region" }, { id: "team", label: "Your team" }, { id: "person", label: "You" }] } satisfies Manifest<"voice">;
    const of = (setBy: string) => ({ preferences: [{ id: "hold" as const, label: "Hold", enabled: true, setBy }] });
    expect(await rules({ manifest: laddered, capabilities: of("region") })).toEqual([]);
    // The ladder is the whole ladder: the default the manifest left out is refused.
    expect(await rules({ manifest: laddered, capabilities: of("site") })).toEqual(["preference.setBy.unknown"]);
    const lockedTask = (lockedBy: string) => ({ ...conformingSnapshot, tasks: [{ ...conformingSnapshot.tasks[0]!, capabilities: { ...conformingSnapshot.tasks[0]!.capabilities, recording: { lockedBy } } }] });
    expect(await rules({ manifest: laddered, snapshot: lockedTask("region") })).toEqual([]);
    expect(await rules({ manifest: laddered, snapshot: lockedTask("site") })).toEqual(["task.capability.locked.lockedBy.unknown"]);
  });

  it("recordStep(), of every softphone login: the host mutes its microphone, and the record is the provider's", async () => {
    expect(await rules({ connection: { recordStep: undefined } })).toContain("connection.recordStep.required");
    // A chat provider has no microphone in play; a desk phone's is the phone's own, and the host mutes nothing.
    expect(await rules({ manifest: chatManifest, snapshot: chatSnapshot, connection: { recordStep: undefined, dial: undefined, openMedia: undefined } }))
      .not.toContain("connection.recordStep.required");
    const deskPhone = await exerciseAdapter(makeAdapter({ connection: { recordStep: undefined, openMedia: undefined } }).adapter,
      { ...context, phone: "deskPhone", host: stillHost({ online: true }) }, { collectOnly: true });
    expect(deskPhone.violations.map(v => v.rule)).not.toContain("connection.recordStep.required");
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
    const bare = { ...conformingManifest, id: "acme-chat", channel: "chat", dialOutcomes: undefined, phones: undefined, idleCapabilities: undefined } satisfies Manifest<"chat">;
    const found = await rules({
      manifest: bare,
      capabilities: {},
      snapshot: minimalSnapshot,
      connection: {
        describeUsers: undefined, dial: undefined, requestBreak: undefined, commitBreak: undefined,
        cancelBreak: undefined, endBreak: undefined, executeTeamBreak: undefined, executeTeamLeadAssist: undefined, openMedia: undefined,
      },
    });
    expect(found).toEqual([]);
  });
});
