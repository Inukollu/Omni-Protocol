import { describe, expect, it } from "vitest";
import type { Task } from "../src/index.js";
import { validateTaskCommandRequest, validateTaskCommand, validateTask } from "../src/validation.js";
import { TaskStream } from "../src/testing.js";

const LEVELS = ["org", "site", "team", "person"];
const task: Task<"voice"> = {
  assignmentId: "H2", title: "Interaction", channel: "voice", taskType: "Queue",
  phase: "in-progress", capabilitySource: "queue", capabilities: { endCall: true },
  browsers: [], completionMode: "agent-command",
};
const request = { assignmentId: "H2", command: { type: "end-call" } };
describe("provider interaction controls", () => {
  it("requires the exact task and assignment rather than the caller journey or old interaction", () => {
    expect(validateTaskCommandRequest(request, task, "request", { levels: LEVELS })).toEqual([]);
    for (const ids of [{ taskId: "journey" }, { taskId: "H1" }, { assignmentId: "H1" }])
      expect(validateTaskCommandRequest({ ...request, ...ids }, task, "request", { levels: LEVELS })).not.toEqual([]);
    expect(validateTaskCommandRequest(request, undefined, "request", { levels: LEVELS })).not.toEqual([]);
    expect(validateTaskCommandRequest(null, task, "request", { levels: LEVELS })).not.toEqual([]);
  });
  it("rejects extra built-in fields without restricting custom payloads", () => {
    for (const extra of [{ executor: "host" }, { channels: ["invented"] }]) {
      expect(validateTaskCommandRequest({ ...request, command: { ...request.command, ...extra } }, task, "request", { levels: LEVELS })
        .some(v => v.rule === "command.field")).toBe(true);
    }
    for (const command of [
      { type: "hold", dialId: "extra" },
      { type: "conference", action: "remove", party: true, notes: "extra" },
      { type: "lead-assist", action: "leave", note: "extra" },
      { type: "conference", action: "remove", party: true, dialId: "extra" },
    ]) expect(validateTaskCommand(command).some(v => v.rule === "command.field")).toBe(true);
    expect(validateTaskCommand({ type: "custom", name: "control", extra: "payload" })).toEqual([]);
    expect(validateTaskCommand({ type: "lead-assist", action: "request", note: "help" })).toEqual([]);
  });
  it("gates caller disconnect by provider policy, interaction phase", () => {
    expect(validateTaskCommand(request.command, { ...task, capabilities: {} }, "command", { levels: LEVELS })).not.toEqual([]);
    expect(validateTaskCommand(request.command, { ...task, phase: "completing" }, "command", { levels: LEVELS })).not.toEqual([]);
    expect(validateTaskCommand(request.command, { ...task, onCall: [{ role: "party", since: "2026-09-11T00:00:00Z" }] }, "command", { levels: LEVELS })).toEqual([]);
  });
  it("routes only to the provider's directory, including an IVR, with no destination inference", () => {
    const policy = { ...task, capabilities: { conference: { destinations: [{ id: "ivr-return", label: "Main IVR" }, { id: "agent-target", label: "Agent" }] } } };
    for (const destinationId of ["ivr-return", "agent-target"])
      expect(validateTaskCommand({ type: "conference", action: "add", dialId: "dial", destinationId }, policy, "command", { levels: LEVELS })).toEqual([]);
    expect(validateTaskCommand({ type: "conference", action: "add", dialId: "dial", destinationId: "invented" }, policy, "command", { levels: LEVELS })).not.toEqual([]);
  });
  it("rejects provider mute while preserving ordinary interaction completion", () => {
    expect(validateTaskCommand({ type: "mute" }, task, "command", { levels: LEVELS })).not.toEqual([]);
    expect(validateTask({ ...task, capabilities: { mute: true } }, { levels: LEVELS, channel: "voice" })).not.toEqual([]);
    expect(validateTaskCommandRequest({ ...request, command: { type: "complete" } }, { ...task, phase: "completing", capabilities: {} }, "request", { levels: LEVELS })).toEqual([]);
  });
  it("ends an old wrap without ending the newer interaction, and refuses the late old ending", () => {
    const stream = new TaskStream();
    stream.resync({ tasks: [{ ...task, assignmentId: "H1", phase: "completing" }, task] }, "snapshot");
    const oldEnd = { event: { type: "task-ended", assignmentId: "H1", outcome: { type: "completed", by: "agent" } } };
    expect(stream.apply(oldEnd)).toEqual([]);
    expect(stream.apply({ event: { type: "task-updated", task } })).toEqual([]);
    expect(stream.apply(oldEnd)).not.toEqual([]);
    expect(stream.apply({ event: { type: "task-ended", assignmentId: "H1", outcome: { type: "completed", by: "agent" } } })).not.toEqual([]);
    expect(stream.apply({ event: { type: "task-updated", task } })).toEqual([]);
  });
  it("requires audio to end before the owned interaction ends, including inherited channels", () => {
    const active = { ...task, audio: "started", onCall: [{ role: "party", since: "2026-09-11T00:00:00Z" }, { role: "agent", userId: "previous-agent", since: "2026-09-11T00:00:00Z" }] };
    const stream = new TaskStream(); stream.resync({ tasks: [active] }, "snapshot");
    expect(validateTaskCommandRequest(request, active, "request", { levels: LEVELS })).toEqual([]);
    expect(stream.apply({ event: { type: "task-audio-ended", assignmentId: "H2" } })).toEqual([]);
    expect(stream.apply({ event: { type: "task-updated", task: { ...task, phase: "completing", audio: "ended", onCall: [] } } })).toEqual([]);
    expect(stream.apply({ event: { type: "task-ended", assignmentId: "H2", outcome: { type: "completed", by: "agent" } } })).toEqual([]);
  });
});
