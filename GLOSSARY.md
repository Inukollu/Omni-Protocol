# Glossary

The words this protocol uses, in everyday language, with what the larger contact-centre platforms
call the same thing. The protocol picks one word per idea and keeps it. Where the industry uses
several names for one idea, this list shows them so a reader from any platform can find their way.
The exact rules live in `guide.md` and the files under `guide/`.

The platform names in the last column are given as each platform commonly presents them. They are
for orientation only: each platform's own documentation is the authority on its terms.

## The pieces

| Term | In plain words | What others call it |
| --- | --- | --- |
| **Agent** | The person handling the work: answering calls, chats and emails. | Agent everywhere; *user* in Genesys Cloud's admin screens; *representative* or *advisor* in some service desks. |
| **Lead** | An agent who also looks after a team: sees their members, listens in, coaches, helps and takes calls over. | *Supervisor* in Amazon Connect, Genesys Cloud, NICE CXone and Twilio Flex; *team lead* on most floors. |
| **Provider** | One outside system that brings work to the agent: a phone platform, a chat platform, a mail platform. | *Channel provider*, *ACD*, *CCaaS platform*; Salesforce calls a connected phone system a *telephony provider*. |
| **Adapter** | The software that connects one provider to this protocol. | *Connector*, *integration*, *CTI adapter* (Salesforce Open CTI, Zendesk Talk Partner Edition). |
| **Agent application** | The software the agent works in, here called Omni. | *Agent desktop* (Amazon Connect CCP, Genesys Cloud agent UI, NICE CXone MAX), *agent workspace* (Salesforce, Zendesk). |
| **Agent computer** | The agent's screen and machine, where the agent application runs. | *Desktop*, *workstation*, *station*. |
| **Manifest** | What a provider declares about itself up front: its name, channel, phones and features. | *Integration definition*, *app manifest* (Twilio Flex plugins, Salesforce call center definition file). |
| **Channel** | The kind of work: voice, chat or email. | *Media type* (Genesys Cloud), *channel* (Amazon Connect, Salesforce Omni-Channel), *media* (NICE). |
| **Login** | One signed-in session of one agent on one provider. | *Session*, *agent session*. |

## The work

| Term | In plain words | What others call it |
| --- | --- | --- |
| **Call** | The customer's whole phone call, which may pass through menus, queues and several agents. | *Contact* (Amazon Connect), *conversation* (Genesys Cloud), *interaction* (NICE, Five9). |
| **Task** | One agent's piece of one contact, on any channel: offered to them, worked, wrapped up. A call that reaches three agents is three tasks. | *Task* (Twilio TaskRouter), *work item* or *AgentWork* (Salesforce Omni-Channel), *contact* as the agent sees it (Amazon Connect), *participant* in a conversation (Genesys Cloud). |
| **Assignment** | The routing of a call to this agent, from the offer until the task ends. Its id names the task. | *Reservation* (Twilio TaskRouter), *offer* or *routed work* (Salesforce), *alerting* (Genesys Cloud). |
| **Interaction** | The agent's time actually on the call: from answering until their audio ends, holds included. | *Talk time* plus *hold time*, together *handle time* without the wrap; Genesys Cloud reports it as *interact*. |
| **Party** | The customer on the other end. | *Customer*, *caller*, *external participant*; the number is the *ANI* or *caller ID*. |
| **Task type** | The provider's name for a kind of work, such as a queue or a mailbox. | *Queue*, *skill*, *routing profile*, *campaign*. |
| **Queue** | Where calls wait for an agent. | *Queue* everywhere; *hunt group* or *split* on older systems. |

## Where a task stands

| Term | In plain words | What others call it |
| --- | --- | --- |
| **Pending** | Offered and not yet accepted: the phone is ringing or the chat is flashing. | *Ringing*, *alerting* (Genesys Cloud), *incoming* (Amazon Connect), *reserved* (Twilio). |
| **Confirmed** | Accepted, waiting for the work to start. | *Accepted*, *connecting*. |
| **Preview** | An outbound record shown to the agent before the call goes out. | *Preview dialing* (Five9, Genesys Cloud, Amazon Connect outbound campaigns). |
| **In progress** | The agent is working it: on the call, in the chat, writing the email. | *Connected*, *on call*, *active*, *talking*. |
| **Paused** | The work is on hold: the caller hears hold music, or the chat waits. | *Hold* on a call; *paused* or *parked* on a chat. |
| **Completing** | The customer has gone and the agent is finishing their notes. | *After-call work* or *ACW* (Amazon Connect, Genesys Cloud, NICE), *wrap-up* (Twilio, Five9), *after conversation work* (Salesforce). |
| **Wrap allowance** | How long the agent has for that finishing work. | *ACW timeout*, *wrap-up time limit*. |
| **Outcome** | What the agent records about how the task went. | *Wrap-up code* (Genesys Cloud), *disposition* (Five9, NICE, Twilio), *contact disposition*. |
| **Task ended** | The task is gone from the agent's screen. | *Contact ended*, *disconnected*, *completed*. |

## Controls on a call

| Term | In plain words | What others call it |
| --- | --- | --- |
| **Answer** / **Accept** | Take an offered task: a call is answered, a chat or an email accepted. | *Accept*, *answer*, *pick up*. |
| **Decline** | Turn an offered task down. | *Reject*, *decline*. |
| **Hold** / **Resume** | Put the caller on hold, and take them off it. | The same everywhere. |
| **Mute** | Silence the agent's microphone. The caller hears nothing from the agent. | The same everywhere. |
| **End call** | End the agent's part. The caller carries on to wherever the provider sends them, such as a survey. | *Leave*, *drop*, *hang up* (agent leg only). |
| **Terminate call** | End the whole call for everyone. | *Disconnect all*, *end conversation*. |
| **Conference** | Bring a colleague into the call. | *Conference*, *add participant*, *three-way call*. |
| **Connect back** | Call the customer again after the call has ended, during the wrap. | *Callback from wrap*, *re-dial*. |
| **Schedule** | Put a follow-up with this customer on the calendar. | *Scheduled callback* (Amazon Connect, Genesys Cloud), *personal callback* (Five9). |
| **Callback requested** | The customer asked to be called back, or an agent arranged it. | *Queued callback* (Amazon Connect), *callback* (Genesys Cloud), *virtual hold*. |

There is deliberately no **transfer**. An agent who needs help asks a lead, and a call changes
hands only through routing or a lead's take-over.

## Leads and teams

| Term | In plain words | What others call it |
| --- | --- | --- |
| **Lead assist** | The agent asks a lead for help on the call. | *Request supervisor*, *raise hand*, *help request*. |
| **Listen** | The lead hears the call silently. | *Monitor* or *silent monitor* (Amazon Connect, Genesys Cloud, NICE). |
| **Coach** | The lead talks to the agent only; the customer cannot hear. | *Whisper* or *coach* (Genesys Cloud, Twilio Flex). |
| **Join call** | The lead speaks to both the agent and the customer. | *Barge* or *barge-in* (Amazon Connect, Genesys Cloud). |
| **Take over** | The lead takes the call from the agent. | *Take over*, *intercept*. |
| **Team** | The agents a lead looks after, each with their status and tasks. | *Team*, *group*, *agent list* in a supervisor view. |

## Availability

| Term | In plain words | What others call it |
| --- | --- | --- |
| **Capacity** | How many tasks the agent can take at once on this provider. Zero means none. | *Concurrency* (Amazon Connect routing profiles), *capacity* (Twilio, Salesforce), *utilization* (Genesys Cloud). |
| **Break** | Time away: lunch, training, a personal break. The agent asks, the provider decides. | *Aux* or *auxiliary code* (Avaya and many floors), *presence* such as Break or Meal (Genesys Cloud), *agent status* (Amazon Connect), *unavailable code* (NICE). |
| **Forced break** | A break a lead or the provider puts the agent on. | *Forced aux*, *supervisor-set status*. |
| **Next call** | The agent says they are ready for another call before this one ends. | *Request next*, *ready for next*. |
| **Lined up** | A call waiting in this agent's own queue, held for them. | *Agent queue* or *personal queue* (Amazon Connect), *direct routing*. |
| **Shift** | The agent's day: when they signed in, their breaks, their totals. | *Schedule adherence* data, *agent state history*. |

## The phone

| Term | In plain words | What others call it |
| --- | --- | --- |
| **Softphone** | A phone inside the agent application, using the computer's headset. | *Softphone* (Amazon Connect), *WebRTC phone* (Genesys Cloud). |
| **Hardphone** | A separate physical phone that the provider rings. | *Desk phone* (Amazon Connect), *SIP phone* or *physical phone* (Genesys Cloud). |
| **Station** | The agent's audio equipment: headset, speaker, microphone. | *Station*, *endpoint*. |

## Records and recording

| Term | In plain words | What others call it |
| --- | --- | --- |
| **History** | The steps a call went through before and with this agent: queued, answered, held, handed over. | *Contact trace record* (Amazon Connect), *conversation details* or *segments* (Genesys Cloud), *call detail record*. |
| **Recording** | A recording of one side of the call, the customer's or the agent's. | *Call recording*, *screen and voice recording*. |
| **Paused for sensitive details** | Recording stops while card or account details are given. | *Secure pause* (Genesys Cloud), *PCI pause*. |

## How the parts talk

| Term | In plain words | What others call it |
| --- | --- | --- |
| **Snapshot** | Everything the provider knows right now, sent whole when the agent application connects or reconnects. | *State sync*, *initial state*. |
| **Event** | One change the provider reports as it happens: a call offered, a task ended. | *Event*, *notification*, *webhook*. |
| **Command** | Something the agent asks the provider to do: hold, end call, complete. | *Action*, *API call*. |
| **Capability** | A control the provider offers on a task. If it is offered, the agent can use it. | *Permission*, *feature flag*, *agent capability*. |
| **Lock** | A setting fixed by a level above the agent, such as the team or the site. | *Policy*, *enforced setting*. |
| **Guarantee** | A promise the agent application makes at sign-in, such as not offering Mute while a call is on hold. | *Client capability*, *declared support*. |
