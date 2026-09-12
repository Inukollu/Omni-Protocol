# `@xema/omni-protocol`: Chat

What is true of a chat and of nothing else. Part of the contract in `guide.md`, which holds the terms, the shapes and the rules every file here relies on; a reference in bold names the file it points into where that is not this one.

## Chat capabilities

| Capability | Omni UI | Contract |
| --- | --- | --- |
| `decline` | Pending-task button: Decline | The provider can decline a pending chat offer. Omni shows it only when local policy also permits declining. |
| `hold` | Primary toggle: Hold | Omni may pause and resume the agent’s interaction in the chat. |
| `schedule` | Secondary menu item: Schedule | Omni may put a follow-up for this party on the calendar, from the conversation or from its wrap. See **Scheduling a follow-up** in `guide/agent.md`. |
| `outcomes` | Primary button: Complete | Omni may request task completion with a provider outcome and notes. |
