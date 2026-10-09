# Chat flow

How one agent's part of a chat moves, from the offer to the moment it leaves the agent's screen. A
chat has no call: no audio, no phone, no preview. Terms are in `GLOSSARY.md`; the rules are in
`guide.md`, `guide/agent.md` and `guide/chat.md`.

## Where a chat task stands

```mermaid
stateDiagram-v2
  [*] --> pending: task-offered
  [*] --> in_progress: already underway on connect (snapshot)
  pending --> confirmed: accepted
  pending --> [*]: declined, withdrawn, customer left (cancelled) or offer ran out (expired)
  confirmed --> in_progress: chat begins
  in_progress --> paused: pause
  paused --> in_progress: resume
  in_progress --> completing: the conversation ends and follow-up work remains
  paused --> completing: the conversation ends while paused
  in_progress --> [*]: complete (task-ended)
  completing --> [*]: complete (task-ended)

  state "in-progress" as in_progress
```

| Phase | What the agent sees | Default label |
| --- | --- | --- |
| `pending` | A new chat flashes, with Accept and maybe Decline. | Incoming Chat |
| `confirmed` | Accepted, waiting for the chat to open. | Accepted |
| `in-progress` | Chatting with the customer. | In Chat |
| `paused` | The chat is paused; the customer waits. | Paused |
| `completing` | The customer is gone; the agent finishes notes. | Wrap-up |

## A chat on the wire

```mermaid
sequenceDiagram
  participant P as Provider (adapter)
  participant A as Agent application
  actor G as Agent
  P->>A: task-offered (pending)
  G->>A: Accept
  A->>P: execute accept
  P->>A: task-updated (in-progress)
  G->>A: Pause
  A->>P: execute pause
  P->>A: task-updated (paused)
  G->>A: Resume
  A->>P: execute resume
  P->>A: task-updated (in-progress)
  G->>A: Complete with outcome
  A->>P: execute complete
  P->>A: task-ended (completed)
```

## Rules worth knowing

- **One agent can hold several chats at once.** How many is the agent's capacity on this provider.
- **A chat is completed from where it stands.** There is no call to end, so the agent completes from `in-progress`, or from `completing` where the provider moved it there.
- **Pause is the chat's hold.** The `hold` capability offers it; the command is `pause`, then `resume`.
- **Every offer is owed an ending.** Whatever happens to the chat, the provider sends `task-ended`.
