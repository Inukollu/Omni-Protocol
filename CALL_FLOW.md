# Call flow

How one agent's part of a phone call moves, from the offer to the moment it leaves the agent's
screen. Terms are in `GLOSSARY.md`; the rules are in `guide.md`, `guide/agent.md`,
`guide/voice.md` and `guide/phone.md`.

## Where a call task stands

```mermaid
stateDiagram-v2
  [*] --> pending: task-offered
  [*] --> in_progress: already underway on connect (snapshot)
  pending --> confirmed: answered, waiting to connect
  pending --> in_progress: answered and connected at once
  pending --> [*]: declined, withdrawn, caller hung up (cancelled) or offer ran out (expired)
  confirmed --> preview: outbound record shown first
  confirmed --> in_progress: work begins
  preview --> in_progress: agent presses Call, customer answers
  preview --> completing: the call goes out and nobody answers
  in_progress --> paused: hold
  paused --> in_progress: resume
  in_progress --> completing: end call, or the caller hangs up
  completing --> in_progress: connect back
  completing --> [*]: complete (task-ended)
  in_progress --> [*]: completed straight from the call (task-ended)

  state "in-progress" as in_progress
```

| Phase | What the agent sees | Default label |
| --- | --- | --- |
| `pending` | The phone rings, with Answer and maybe Decline. | Offered |
| `confirmed` | Answered, waiting for the call to connect. Many platforms skip it. | Accepted |
| `preview` | An outbound customer's record, with a Call button and maybe a countdown. | Preview |
| `in-progress` | On the call. | On Call |
| `paused` | The caller is on hold. | On Hold |
| `completing` | The caller is gone; the agent finishes notes and picks an outcome. | After Call Work |

## An inbound call on the wire

```mermaid
sequenceDiagram
  participant P as Provider (adapter)
  participant A as Agent application
  actor G as Agent
  P->>A: task-offered (pending)
  A->>G: rings, shows Answer
  G->>A: Answer
  A->>P: execute answer
  P->>A: task-updated (in-progress)
  P->>A: task-audio-started
  A->>P: openAudio (softphone only)
  G->>A: Hold
  A->>P: execute hold
  P->>A: task-updated (paused)
  Note over A,G: Mute and End call are unavailable on hold
  G->>A: Resume
  A->>P: execute resume
  P->>A: task-updated (in-progress)
  G->>A: End call
  A->>P: execute end-call
  P->>A: task-audio-ended
  P->>A: task-updated (completing, wrap time left)
  G->>A: Complete with outcome
  A->>P: execute complete
  P->>A: task-ended (completed)
```

## An outbound preview call

```mermaid
sequenceDiagram
  participant P as Provider (adapter)
  participant A as Agent application
  actor G as Agent
  P->>A: task-offered, then task-updated (preview, maybe a countdown)
  G->>A: reads the record, presses Call
  A->>P: execute dial (with a new dialId)
  P-->>A: dialling
  P->>A: task-audio-started (ring-back)
  P->>A: dial-outcome (answered, busy, no-answer, ...)
  alt answered
    P->>A: task-updated (in-progress)
  else nobody answered
    P->>A: task-audio-ended
    P->>A: task-updated (completing)
  end
```

When the countdown runs out, `atDeadline` says who acts: the provider dials (`provider-dials`),
the agent application dials (`host-dials`), or nobody does and the record waits (`waits`).

## Rules worth knowing

- **Every offer is owed an ending.** Whatever happens to the call, the provider sends `task-ended`.
- **Every dial has exactly one outcome.** A dial answered `dialling` always gets its `dial-outcome`.
- **Audio follows the task, never the other way round.** A dropped stream changes nothing until the provider says so.
- **No End call from hold.** Resume first; `terminate-call` may end everything, held caller included.
- **No Mute from hold on a softphone.** A mute already on when the hold began stays on.
- **No transfer.** Help comes from a lead: listen, coach, join the call, or take it over.
- **A callback carries the call it comes back to.** Its task's history starts with the earlier call's steps.
