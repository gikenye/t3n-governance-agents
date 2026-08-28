# z-credential-guardrail

This contract is a reusable policy gate. Other agents call this
contract before they take a state-changing action. This design saves
each team from a custom build of "which tool call needs a human"
logic inside its own contract.

## Why we built this agent

A write-up on live ADK use states the rule in plain terms. A
read-only tool, such as a balance query or an index read, can
auto-approve. A state-changing tool, such as a transfer or a contract
call, needs a real, multi-party approval step. The write-up states
that the ADK's own tool-confirmation feature is a start, not a full
answer. This contract is that missing layer. We built this contract
once, as its own small contract. Any agent can call this contract
before it acts. This rule applies to the agents in z-audit-sentinel.
This rule also applies to Terminal 3's own Payroll, Procurement, and
Travel demo agents. Each team need not build its own threshold logic.

## Design

- `set-policy`: the tenant sets the rules here. Each rule names an
  `action`. Each rule states a mode: auto-approve or needs a human. A
  rule can also state an amount ceiling for its action. A rule can
  never auto-approve an amount over its own ceiling. An amount over
  the ceiling always moves to needs_approval, even when the rule says
  auto_approve.
- `check-policy`: an agent calls this function first. The function
  returns one of three values: `auto_approve`, `needs_approval`, or
  `deny`. The function saves the request, for each of the three
  values.
- `resolve-approval`: a human, or a second, more-trusted agent, closes
  a pending request with this function.
- `list-pending`: this function is an approvals inbox. The function
  lists each request that still waits on a human.

The default rule is fail safe, not fail open. An action with no
matching rule falls back to `default_mode`. Our starter policy (see
`scripts/10-setup-guardrail.ts`) sets `default_mode` to
`"needs_approval"`.

## This agent works with z-audit-sentinel

The script `scripts/11-demo-guardrail.ts` calls `check-policy` first.
The script then calls `audit-sentinel.log-action`, with the decision.
Two small, single-purpose contracts join here, at the script layer.
This design avoids one large contract that tries to do both jobs.
Each contract stays useful on its own. Each contract stays easy to
maintain on its own.

## A known MVP limit, worth a line in the bug submission

The `limit` field in `list-pending` bounds the row count that
`kv-store::scan` reads. This field does not bound the "pending" row
count after the in-contract filter. So a call with `limit: 50`, on a
requests map where most rows carry the status `"approved"`, can
return fewer than 50 pending rows, even when more pending rows exist
further along the scan. This limit is fine for a hackathon-scale
demo. A production build would need a paging loop, or a second index
that lists pending request IDs only.

## Build and run

```bash
cargo build --target wasm32-wasip2 --release
```

```bash
npm run setup:guardrail   # register the contract, create the maps, set the starter policy
npm run demo:guardrail    # run the auto-approve case, the escalation case, the resolve step, and the inbox check
```

## How to maintain this agent

This agent uses no secrets. This agent makes no outbound HTTP call.
Over time, a maintainer needs to touch the policy only. A call to
`set-policy` can change the policy at any time. This call needs no
new contract build. So a change to a threshold is a one-line script
edit, not a Rust rebuild.
