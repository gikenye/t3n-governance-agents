# T3N Agent Dev Kit submission: a governance pair

This submission has two small agents. Each agent builds on the
confirmed ADK surface at `/developers/adk/reference`.

1. **[z-audit-sentinel](../z-audit-sentinel)**: each agent logs a
   sensitive action here. A report script turns the log into a
   compliance report.
2. **[z-credential-guardrail](../z-credential-guardrail)**: agents
   call this contract before they act. This contract returns
   auto-approve, escalate, or deny. This contract keeps a human
   approvals inbox for each escalated request.

Neither agent is a payment flow or a booking flow. Terminal 3's own
reference agents, Payroll, Procurement, E-visa, and Travel, already
cover that ground well. These two agents answer a different gap.
Terminal 3's own manifesto names this gap: the governance and audit
problem. Each agent here sits in front of an agent such as one of
those four, or any other agent. Neither agent here replaces another
agent.

## Setup order

```bash
npm install

export T3N_API_KEY="<from the claim page>"
export AGENT_KEY="<any second T3N key, to act as a calling agent>"

# 1. audit-sentinel
cd ../z-audit-sentinel && cargo build --target wasm32-wasip2 --release && cd ../my-t3n-app
npm run setup:sentinel
npm run demo:sentinel
npm run report:sentinel

# 2. guardrail (this agent builds on top of sentinel)
cd ../z-credential-guardrail && cargo build --target wasm32-wasip2 --release && cd ../my-t3n-app
npm run setup:guardrail
npm run demo:guardrail
```

## Project layout

```
my-t3n-app/
├── lib/session.ts              ← one shared connect and auth helper (see the file header for the reason)
├── scripts/
│   ├── 02-setup-audit-sentinel.ts
│   ├── 03-demo-audit-sentinel.ts
│   ├── 04-report-audit-sentinel.ts
│   ├── 10-setup-guardrail.ts
│   └── 11-demo-guardrail.ts
z-audit-sentinel/                ← Rust TEE contract 1, with its own README
z-credential-guardrail/          ← Rust TEE contract 2, with its own README
```

## Bugs and doc gaps found (for the bug-submission criterion)

1. **`getAuditEvents()`**: the page `/developers/adk/reference` lists
   this symbol as "reported to exist but undocumented". We did not
   build on this symbol. See `z-audit-sentinel/README.md` for our
   design choice.
2. **`kv-store::scan`**: this function has no documented pattern for
   "read the whole map". We used one byte, the value `0xFF`, as the
   `end` value. This choice works, because our keys are ASCII
   characters only. We suggest one added line in the `kv-store` docs
   for this case.
3. **`list-pending`'s `limit` field**: this field bounds the row count
   that the scan reads. This field does not bound the row count after
   an in-contract filter. This is a real MVP limit, noted in
   `z-credential-guardrail/README.md`. We do not state this limit as
   a platform bug. We flag this limit so the next builder does not
   meet a surprise with this pattern.
4. **A contract with no outbound HTTP call**: it is not clear if such
   a contract needs an `agent-auth-update` grant before an agent can
   call it. The docs frame the grant as a gate on egress only. We
   built on the rule "no egress, no grant is needed". This rule
   worked in our design. No doc page states this rule outright.

## Handover

Each agent here keeps state in its own KV map only. Neither agent
uses a secret. Neither agent depends on a third-party API. So each
agent is cheap to keep running as is. We are glad to keep both agents
running. We are also glad to hand both agents to Terminal 3, as
starter "governance agent" templates in the startup-program listing.
Either choice works for us. We are glad to join a short handover call
for either choice.
