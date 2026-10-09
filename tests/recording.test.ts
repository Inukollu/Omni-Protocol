import { assertTaskCapabilityWithdrawal } from "../src/testing.js";
import { describe, expect, it } from "vitest";
import { type Task, type Recording, type HostRecording, type RecordingAction, type RecordingCommand, type VoiceTaskCommand } from "../src/index.js";
import { validateRecordingOutcome, validateRecordingCommandState, validateRecordings, validateRecordingPolicy, validateRecordingRequest, validateHostRecording, validateHostGuarantees, validateHostReport, validateTask, validateTaskCommand } from "../src/validation.js";

type Status = Recording["status"];
const recording = (status: Status = "recording", follows: "party" | "agent" = "party", id = "capture-1"): Recording =>
  (status === "paused" ? { id, follows, status, reason: "requested" }
    : status === "unknown" ? { id, follows, status, reason: "recorder-unreachable" }
    : { id, follows, status }) as Recording;
const actions = { start: true, pause: true, resume: true, stop: true, cancel: true } as const;
const task = (recordings: Recording[] = [recording()]): Task<"voice"> => ({
  assignmentId: "assignment-1", channel: "voice", title: "Call", taskType: "call",
  phase: "in-progress", audio: "started", capabilitySource: "queue", completionMode: "agent-command", browsers: [],
  capabilities: { recording: { provider: actions, host: { ...actions, storageId: "recordings" } } },
  recordings,
});
const command = (action: RecordingAction, source: "provider" | "host" = "provider"): RecordingCommand => ({
  type: "recording", source, action,
  ...(action === "start" ? { follows: "party" } : { recordingId: "capture-1" }),
}) as RecordingCommand;
const host: HostRecording = {
  actions: ["start", "pause", "resume", "stop", "cancel"], storageIds: ["recordings"],
  execute: async () => ({ status: "applied" }),
};
/** A request against a task whose only recording, on the party's side, stands in `status` -- or none at all. */
function check(action: RecordingAction, status: Status | "none", source: "provider" | "host" = "provider", changes: Record<string, unknown> = {}, context: Record<string, unknown> = {}, current?: Task<"voice">) {
  const list = status === "none" ? [] : [recording(status)];
  return validateRecordingRequest({ assignmentId: "assignment-1", command: { ...command(action, source), ...changes } }, current ?? task(source === "provider" ? list : []), {
    source, host, softphone: true,
    hostReport: { online: true, recordings: [{ assignmentId: "assignment-1", recordings: source === "host" ? list : [] }] }, ...context,
  });
}
const rules = (v: { rule: string }[]) => v.map(i => i.rule);

describe("recordings as published", () => {
  it("takes a list, each with its side, status, and a reason where paused or unknown", () => {
    expect(validateRecordings([])).toEqual([]);
    expect(validateRecordings([recording("recording", "party"), recording("starting", "agent", "capture-2")])).toEqual([]);
    expect(validateRecordings([recording("paused"), recording("not-recording", "party", "capture-0")])).toEqual([]);
    expect(validateRecordings([recording("unknown")])).toEqual([]);
    // A mark that is not lit says why; a lit one has nothing to explain.
    expect(rules(validateRecordings([{ id: "c", follows: "party", status: "paused" }]))).toEqual(["recording.reason"]);
    expect(rules(validateRecordings([{ id: "c", follows: "party", status: "unknown", reason: "requested" }]))).toEqual(["recording.reason"]);
    expect(rules(validateRecordings([{ id: "c", follows: "party", status: "recording", reason: "requested" }]))).toEqual(["recording.reason.unexpected"]);
    expect(rules(validateRecordings([{ id: "c", follows: "caller", status: "recording" }]))).toEqual(["recording.follows"]);
    expect(rules(validateRecordings([{ id: "c", follows: "party", status: "active" }]))).toEqual(["recording.status"]);
    expect(rules(validateRecordings([{ id: "", follows: "party", status: "recording" }]))).toEqual(["recording.id"]);
    expect(rules(validateRecordings([{ id: "c", follows: "party", status: "recording", validUntil: "2026-09-09T10:00:30.000Z" }]))).toEqual(["recording.field"]);
    expect(rules(validateRecordings({ status: "unknown" }))).toEqual(["recording.list.shape"]);
  });
  it("allows one recording capturing on each side, and finished ones beside it", () => {
    expect(rules(validateRecordings([recording("recording"), recording("paused", "party", "capture-2")]))).toEqual(["recording.follows.live"]);
    // An unknown one may still be capturing, so it holds its side too.
    expect(rules(validateRecordings([recording("unknown"), recording("starting", "party", "capture-2")]))).toEqual(["recording.follows.live"]);
    expect(validateRecordings([recording("not-recording"), recording("recording", "party", "capture-2")])).toEqual([]);
    expect(rules(validateRecordings([recording("recording"), recording("not-recording")]))).toEqual(["recording.id.unique"]);
  });
  it("sits on a voice task as recordings, and refuses the former recording state", () => {
    expect(validateTask(task(), { channel: "voice" })).toEqual([]);
    expect(rules(validateTask({ ...task(), recordings: undefined, recording: { provider: { status: "unknown" } } }, { channel: "voice" }))).toContain("recording.task.renamed");
    expect(rules(validateTask({ ...task(), channel: "chat" }, { channel: "chat" }))).toContain("recording.task.channel");
  });
});

describe("independent recording controls", () => {
  it("checks the complete action/state matrix for each owner", () => {
    const allowed: Record<RecordingAction, (Status | "none")[]> = {
      start: ["none", "not-recording"], pause: ["recording"], resume: ["paused"], stop: ["recording", "paused"], cancel: ["recording", "paused"],
    };
    for (const source of ["provider", "host"] as const) for (const action of Object.keys(allowed) as RecordingAction[]) {
      for (const status of ["none", "starting", "recording", "paused", "not-recording", "unknown"] as const) {
        expect(check(action, status, source).length === 0, `${source}/${action}/${status}`).toBe(allowed[action].includes(status));
      }
    }
  });
  it("starts on the side named, and only where that side has nothing capturing", () => {
    expect(check("start", "recording", "provider", { follows: "agent" })).toEqual([]);
    expect(rules(check("start", "recording", "provider", { follows: "party" }))).toContain("recording.command.state");
    expect(rules(check("start", "none", "provider", { follows: undefined }))).toContain("recording.command.follows");
  });
  it("names the recording by its id, and refuses one the task does not carry", () => {
    expect(rules(check("stop", "recording", "provider", { recordingId: "replacement" }))).toContain("recording.command.recordingId");
    expect(rules(check("stop", "recording", "provider", { recordingId: undefined }))).toContain("recording.command.identity");
    // The former evidence identity is not part of a command.
    expect(rules(check("stop", "recording", "provider", { observationId: "obs" }))).toContain("recording.field");
  });
  it("allows a task already recording without controls, even on arrival", () => {
    const current = { ...task(), phase: "pending", audio: undefined, capabilities: {} };
    expect(validateTask(current, { channel: "voice" })).toEqual([]);
    expect(rules(check("stop", "recording", "provider", {}, {}, current as Task<"voice">))).toContain("recording.command.permission");
  });
  it("holds a start or resume sent through validateTaskCommand to live audio, as dispatch does", () => {
    const silent = { ...task([]), audio: undefined } as Task<"voice">;
    expect(rules(validateTaskCommand(command("start"), silent))).toContain("recording.request.phase");
    expect(validateTaskCommand(command("start"), task([]))).toEqual([]);
    const paused = [recording("paused")];
    expect(rules(validateTaskCommand(command("resume"), { ...task(paused), audio: undefined } as Task<"voice">))).toContain("recording.request.phase");
    expect(validateTaskCommand(command("resume"), task(paused))).toEqual([]);
  });
  it("routes provider commands only through execute and rejects legacy commands", () => {
    expect(validateTaskCommand(command("pause"), task())).toEqual([]);
    expect(rules(validateTaskCommand(command("pause", "host"), task()))).toContain("recording.command.source");
    expect(validateTaskCommand({ type: "recording", action: "start" })).not.toEqual([]);
    expect(validateRecordingPolicy(true)).not.toEqual([]);
  });
  it("keeps owners independent: the host's recordings are on its report, never on the provider's task", () => {
    expect(check("pause", "recording", "host", {}, {}, task([]))).toEqual([]);
    expect(check("pause", "recording", "provider", {}, {}, task([]))).not.toEqual([]);
  });
  it("refuses changed task permissions, storage and host abilities", () => {
    const locked = { ...task(), capabilities: { recording: { lockedBy: "team" } } } as Task<"voice">;
    expect(check("stop", "recording", "provider", {}, {}, locked)).not.toEqual([]);
    const restricted = { ...task(), capabilities: { recording: { provider: { stop: true } } } } as Task<"voice">;
    expect(check("pause", "recording", "provider", {}, {}, restricted)).not.toEqual([]);
    expect(check("stop", "recording", "provider", {}, {}, restricted)).toEqual([]);
    expect(rules(check("start", "none", "host", {}, { host: { ...host, storageIds: ["other"] } }))).toContain("recording.host.storage");
    expect(rules(check("pause", "recording", "host", {}, { host: { ...host, actions: ["stop"] } }))).toContain("recording.host.action");
    expect(rules(check("stop", "recording", "host", {}, { softphone: false }))).toContain("recording.host.channel");
    expect(check("stop", "recording", "host", {}, { host: undefined })).not.toEqual([]);
    expect(rules(check("stop", "recording", "provider", {}, {}, { ...task(), assignmentId: "next" }))).toContain("recording.request.scope");
  });
  it("offers cancel as a discard-only action and refuses legacy effect fields", () => {
    expect(check("cancel", "recording")).toEqual([]);
    expect(check("cancel", "recording", "host")).toEqual([]);
    for (const cancelEffect of ["retain", "discard", undefined]) {
      expect(check("cancel", "recording", "provider", { cancelEffect })).not.toEqual([]);
    }
    expect(validateRecordingPolicy({ provider: { cancel: true } })).toEqual([]);
    expect(validateRecordingPolicy({ provider: { cancel: false } })).not.toEqual([]);
    expect(validateHostRecording({ ...host, cancelEffects: ["discard"] }, true)).not.toEqual([]);
    expect(validateRecordingPolicy({ host: { start: true } })).not.toEqual([]);
  });
  it("permits terminal actions during wrap-up but cannot resume or start ended audio", () => {
    const wrapping = { ...task(), phase: "completing", audio: "ended" } as Task<"voice">;
    expect(check("stop", "recording", "provider", {}, {}, wrapping)).toEqual([]);
    expect(check("cancel", "recording", "provider", {}, {}, wrapping)).toEqual([]);
    expect(check("resume", "paused", "host", {}, {}, { ...wrapping, recordings: [] } as Task<"voice">)).not.toEqual([]);
    expect(check("start", "none", "host", {}, {}, { ...task([]), audio: "ended" })).not.toEqual([]);
  });
});

describe("host recording declarations and reports", () => {
  it("validates host declarations, reports, unique scopes and malformed nested inputs", () => {
    expect(validateHostRecording(host, true)).toEqual([]);
    for (const declaration of [{ ...host, actions: ["pause"] }, { ...host, actions: ["stop", "stop"] }, { ...host, actions: ["rewind"] }, { ...host, storageIds: [] }, { ...host, execute: undefined }]) {
      expect(validateHostRecording(declaration, true)).not.toEqual([]);
    }
    const report = { assignmentId: "assignment-1", recordings: [recording()] };
    expect(validateHostReport({ online: true, recordings: [report] })).toEqual([]);
    expect(validateHostReport({ online: true, recordings: [report, report] })).not.toEqual([]);
    expect(validateHostReport({ online: true, recordings: [{ assignmentId: "assignment-1", state: { status: "unknown" } }] })).not.toEqual([]);
    expect(check("stop", "recording", "host", {}, { hostReport: { recordings: [{ ...report, assignmentId: "other" }] } })).not.toEqual([]);
    for (const bad of [null, false, [], "x", 1, {}, { toString: null }]) {
      expect(() => validateRecordingRequest(bad, task(), { source: "provider" })).not.toThrow();
      expect(() => validateRecordingPolicy({ provider: bad, host: bad })).not.toThrow();
      expect(() => validateHostRecording(bad, true)).not.toThrow();
      expect(() => validateRecordings(bad)).not.toThrow();
    }
  });
});

// @ts-expect-error Host commands cannot be sent to provider execute.
const wrongExecutor: VoiceTaskCommand = { ...command("stop", "host"), source: "host" };
// @ts-expect-error Stop names the recording it acts on.
const missingIdentity: RecordingCommand = { type: "recording", source: "provider", action: "stop" };
// @ts-expect-error A start names the side to record.
const sidelessStart: RecordingCommand = { type: "recording", source: "provider", action: "start" };
// @ts-expect-error A paused recording says why.
const silentPause: Recording = { id: "r", follows: "party", status: "paused" };
void [wrongExecutor, missingIdentity, sidelessStart, silentPause];

describe("recording outcomes", () => {
  const applied = { status: "applied" };
  const failed = { status: "failed", failure: { code: "recorder.refused", message: "Refused", retryable: false } };
  it("requires the confirmed transition on the same recording, and a new recording for a start", () => {
    for (const [action, before, after] of [["pause", "recording", "paused"], ["resume", "paused", "recording"], ["stop", "paused", "not-recording"], ["cancel", "recording", "not-recording"]] as const) {
      expect(validateRecordingOutcome(command(action), [recording(before)], [recording(after)], applied), action).toEqual([]);
    }
    expect(validateRecordingOutcome(command("start"), [], [recording("recording", "party", "capture-9")], applied)).toEqual([]);
    expect(validateRecordingOutcome(command("start"), [recording("not-recording")], [recording("not-recording"), recording("recording", "party", "capture-9")], applied)).toEqual([]);
    // A start still settling is not yet applied; a pause that moved another recording is not this one.
    expect(validateRecordingOutcome(command("start"), [], [recording("starting", "party", "capture-9")], applied)).not.toEqual([]);
    expect(validateRecordingOutcome(command("pause"), [recording()], [recording("paused", "party", "other")], applied)).not.toEqual([]);
    expect(validateRecordingOutcome(command("pause"), [recording()], [recording()], applied)).not.toEqual([]);
    expect(validateRecordingOutcome(command("stop"), [recording()], [recording("not-recording")], { status: "dialling", dialId: "d" })).not.toEqual([]);
  });
  it("does not misrepresent partial effects or timeouts as confirmed failure", () => {
    expect(validateRecordingOutcome(command("stop"), [recording()], [recording()], failed)).toEqual([]);
    expect(validateRecordingOutcome(command("stop"), [recording()], [recording("not-recording")], failed)).not.toEqual([]);
    expect(validateRecordingOutcome(command("start"), [], [recording("recording", "party", "capture-9")], failed)).not.toEqual([]);
    expect(validateRecordingOutcome(command("stop"), [recording()], [recording("not-recording")], undefined)).toEqual([]);
    expect(validateRecordingOutcome(command("stop"), [recording()], [recording("unknown")], undefined)).toEqual([]);
  });
});

describe("recording validation context and direct permission checks", () => {
  it("never treats explicit false or malformed standalone inputs as permission", () => {
    expect(validateRecordingCommandState(command("pause"), { pause: false }, [recording()])).not.toEqual([]);
    expect(validateRecordingCommandState(null, actions, [recording()])).not.toEqual([]);
    expect(validateRecordingCommandState({ ...command("pause"), action: "rewind" }, { rewind: true }, [recording()])).not.toEqual([]);
  });

  it("honours the provider's organisation levels at dispatch and static command validation", () => {
    const current = task();
    current.capabilities.hold = { lockedBy: "region" };
    const taskContext = { levels: ["region", "person"] };
    expect(validateTask(current, { ...taskContext, channel: "voice" })).toEqual([]);
    expect(validateTaskCommand(command("pause"), current, "command", taskContext)).toEqual([]);
    expect(check("pause", "recording", "provider", {}, { taskContext }, current)).toEqual([]);
    expect(validateTaskCommand(command("pause"), current)).not.toEqual([]);
    expect(check("pause", "recording", "provider", {}, {}, current)).not.toEqual([]);
  });

  it("carries known task restrictions through to recording dispatch", () => {
    const current = task();
    current.capabilities.conference = { destinations: [{ id: "tier2", label: "Tier 2" }] };
    expect(check("pause", "recording", "provider", {}, { taskContext: { dialOutcomesDeclared: false } }, current)).not.toEqual([]);
    expect(check("pause", "recording", "provider", {}, { taskContext: { dialOutcomesDeclared: true } }, current)).toEqual([]);
  });
});

// @ts-expect-error Cancel is a permission flag, not a configurable retain/discard policy.
const legacyCancelPolicy: import("../src/index.js").RecordingActions = { cancel: { effect: "retain" } };
// @ts-expect-error Cancel has a fixed discard meaning and carries no effect override.
const legacyCancelCommand: RecordingCommand = { type: "recording", source: "provider", action: "cancel", recordingId: "r", cancelEffect: "retain" };
void [legacyCancelPolicy, legacyCancelCommand];

it("keeps recording capability withdrawal conformance scoped to the provider's levels", () => {
  const first = task();
  first.capabilities.decline = { lockedBy: "region" };
  const last = { ...first, capabilities: { decline: { lockedBy: "region" } } };
  const manifest = {
    id: "voice", displayName: "Voice", channel: "voice" as const,
    supportedProtocolVersions: [1], authenticationMethods: ["credentials" as const], settleMs: 150,
    orgLevels: [{ id: "region", label: "Region" }, { id: "person", label: "Person" }],
  };
  expect(() => assertTaskCapabilityWithdrawal([first, last], manifest, command("pause"))).not.toThrow();
});

describe("host-only caller recording announcement guarantee", () => {
  it("is optional and declared only as true inside host recording support", () => {
    expect(validateHostRecording(host, true)).toEqual([]);
    expect(validateHostRecording({ ...host, announcesToCaller: true }, true)).toEqual([]);
    for (const value of [false, null, "true", 1, {}]) {
      expect(rules(validateHostRecording({ ...host, announcesToCaller: value }, true))).toContain("recording.host.announcesToCaller");
    }
    expect(validateHostRecording({ announcesToCaller: true }, true)).not.toEqual([]);
    expect(validateHostRecording({ ...host, announcesToCaller: true }, false)).not.toEqual([]);
  });

  it("cannot be placed on provider task policy or the general host guarantees", () => {
    expect(validateHostGuarantees({ announcesToCaller: true })).not.toEqual([]);
    expect(validateRecordingPolicy({ provider: { start: true, announcesToCaller: true } })).not.toEqual([]);
    expect(validateRecordingPolicy({ host: { start: true, storageId: "recordings", announcesToCaller: true } })).not.toEqual([]);
  });

  it("does not grant recording permission or affect provider-owned dispatch", () => {
    const announcingHost = { ...host, announcesToCaller: true };
    expect(check("start", "none", "host", {}, { host: announcingHost })).toEqual([]);
    expect(check("stop", "recording", "provider", {}, { host: undefined })).toEqual([]);
    const withoutPermission = { ...task([]), capabilities: {} };
    expect(check("start", "none", "host", {}, { host: announcingHost }, withoutPermission)).not.toEqual([]);
  });
});

// @ts-expect-error Host recording caller announcement is a guarantee, never false.
const falseAnnouncement: HostRecording = { ...host, announcesToCaller: false };
void falseAnnouncement;
