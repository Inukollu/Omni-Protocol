import { describe, expect, it } from "vitest";
import type { Task } from "../src/index.js";
import { validateTaskCommandRequest, validateTaskCommand, validateTask } from "../src/validation.js";
import { TaskStream } from "../src/testing.js";
const task: Task<"voice"> = {
  id: "H2", allocationId: "H2", title: "Handling", channel: "voice", taskType: "Queue",
  phase: "in-progress", capabilitySource: "queue", capabilities: { endCall: true },
  browsers: [], completionMode: "agent-command",
};
const request = { taskId: "H2", allocationId: "H2", command: { type: "end-call" } };
describe("provider handling controls", () => {
  it("requires the exact task and allocation rather than the caller journey or old handling", () => {
    expect(validateTaskCommandRequest(request, task)).toEqual([]);
    for (const ids of [{ taskId: "journey" }, { taskId: "H1" }, { allocationId: "H1" }])
      expect(validateTaskCommandRequest({ ...request, ...ids }, task)).not.toEqual([]);
    expect(validateTaskCommandRequest(request, undefined)).not.toEqual([]);
    expect(validateTaskCommandRequest(null, task)).not.toEqual([]);
  });
  it("rejects extra built-in fields without restricting custom payloads", () => {
    for (const extra of [{ executor: "host" }, { channels: ["invented"] }]) {
      expect(validateTaskCommandRequest({ ...request, command: { ...request.command, ...extra } }, task)
        .some(v => v.rule === "command.field")).toBe(true);
    }
    for (const command of [
      { type: "hold", dialId: "extra" },
      { type: "transfer", action: "cancel", notes: "extra" },
      { type: "lead-assist", action: "leave", note: "extra" },
      { type: "conference", action: "remove", party: true, dialId: "extra" },
    ]) expect(validateTaskCommand(command).some(v => v.rule === "command.field")).toBe(true);
    expect(validateTaskCommand({ type: "custom", name: "control", extra: "payload" })).toEqual([]);
    expect(validateTaskCommand({ type: "lead-assist", action: "request", note: "help" })).toEqual([]);
  });
  it("gates caller disconnect by provider policy, handling phase", () => {
    expect(validateTaskCommand(request.command, { ...task, capabilities: {} })).not.toEqual([]);
    expect(validateTaskCommand(request.command, { ...task, phase: "completing" })).not.toEqual([]);
    expect(validateTaskCommand(request.command, { ...task, onCall: [{ role: "party", since: "2026-09-11T00:00:00Z" }] })).toEqual([]);
  });
  it("routes only to the provider's directory, including an IVR, with no destination inference", () => {
    const policy = { ...task, capabilities: { coldTransfer: { destinations: [{ id: "ivr-return", label: "Main IVR" }, { id: "agent-target", label: "Agent" }] } } };
    for (const destinationId of ["ivr-return", "agent-target"])
      expect(validateTaskCommand({ type: "transfer", action: "cold", dialId: "dial", destinationId }, policy)).toEqual([]);
    expect(validateTaskCommand({ type: "transfer", action: "cold", dialId: "dial", destinationId: "invented" }, policy)).not.toEqual([]);
  });
  it("rejects provider mute while preserving ordinary handling disposal", () => {
    expect(validateTaskCommand({ type: "mute" }, task)).not.toEqual([]);
    expect(validateTask({ ...task, capabilities: { mute: true } }, { channel: "voice" })).not.toEqual([]);
    expect(validateTaskCommandRequest({ ...request, command: { type: "complete" } }, { ...task, phase: "completing", capabilities: {} })).toEqual([]);
  });
  it("ends an old wrap without ending the newer handling, and refuses the late old ending", () => {
    const stream = new TaskStream();
    stream.resync({ tasks: [{ ...task, id: "H1", allocationId: "H1", phase: "completing" }, task] }, "snapshot");
    const oldEnd = { event: { type: "task-ended", taskId: "H1", allocationId: "H1", outcome: { type: "completed", by: "agent" } } };
    expect(stream.apply(oldEnd)).toEqual([]);
    expect(stream.apply({ event: { type: "task-updated", task } })).toEqual([]);
    expect(stream.apply(oldEnd)).not.toEqual([]);
    expect(stream.apply({ event: { type: "task-ended", taskId: "H2", allocationId: "H1", outcome: { type: "completed", by: "agent" } } })).not.toEqual([]);
    expect(stream.apply({ event: { type: "task-updated", task } })).toEqual([]);
  });
  it("requires media to end before the owned handling ends, including inherited channels", () => {
    const active = { ...task, media: "started", onCall: [{ role: "party", since: "2026-09-11T00:00:00Z" }, { role: "agent", userId: "previous-agent", since: "2026-09-11T00:00:00Z" }] };
    const stream = new TaskStream(); stream.resync({ tasks: [active] }, "snapshot");
    expect(validateTaskCommandRequest(request, active)).toEqual([]);
    expect(stream.apply({ event: { type: "task-media-ended", taskId: "H2", allocationId: "H2" } })).toEqual([]);
    expect(stream.apply({ event: { type: "task-updated", task: { ...task, phase: "completing", media: "ended", onCall: [] } } })).toEqual([]);
    expect(stream.apply({ event: { type: "task-ended", taskId: "H2", allocationId: "H2", outcome: { type: "completed", by: "agent" } } })).toEqual([]);
  });
});
