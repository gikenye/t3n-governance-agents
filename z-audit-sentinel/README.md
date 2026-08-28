# z-audit-sentinel

This contract is a governance agent for a T3N tenant. This contract
gives the tenant one place to keep a true record of every agent
action. This record does not depend on the log of the destination
system. The destination system can be a bank, Duffel, or a government
portal.

## Why we built this agent, and not another payment agent

Terminal 3 ships four reference agents: Payroll, E-commerce
Procurement, E-visa Form Filling, and Travel Booking. Each of the four
agents moves money or PII through a TEE contract. Terminal 3's own
manifesto raises a question: how does the enterprise get an audit
trail when an agent can hallucinate one? None of the four reference
agents answer this question. This contract is a direct answer to that
gap.

## Design

- `log-action`: any agent calls this function right after a sensitive
  action. The function writes one record to `z:<tid>:audit-log`.
- `list-actions`: this function reads that map back, oldest event
  first. The function returns a JSON array. A report script can read
  this array and build a summary.

The map's `readers` list and `writers` list name one contract only:
this contract's own `contract_id`. See
`scripts/02-setup-audit-sentinel.ts` for this step. So, inside the T3N
model, only this contract can read the log back. Not even the
tenant's own setup script can read the log directly. This rule is the
point of an audit trail: no agent, even a compromised agent, can
quietly edit its own history.

## What we could not confirm, and how we worked around it

The ADK reference page lists a symbol named `getAuditEvents()`. The
page marks this symbol "reported to exist but undocumented". One team
saw this symbol in the SDK's type definitions. No page documents this
symbol. So we did not build on this symbol. Instead, this agent keeps
its own audit log. This agent uses the confirmed `kv-store` interface
only: `put` to write, and `scan` to read. If `getAuditEvents()` later
turns out to expose a network-wide ledger read, that source could
feed `list-actions` directly. We suggest you ask about this symbol in
the [developer Telegram](https://t.me/terminal3developer). **This gap
is the bug we submit for the "bug submission quality" criterion.**

Separately, `kv-store::scan` takes a `[start, end)` byte range. The
docs show no "read the whole map" pattern for this function. We used
one byte, the value `0xFF`, as `end`. This choice works because every
real key here is an ASCII character, and each ASCII character has a
value under `0xFF`. No doc page states this pattern. We suggest one
line of doc text for this case.

## Build and run

```bash
rustup target add wasm32-wasip2
cargo build --target wasm32-wasip2 --release
wasm-tools component wit target/wasm32-wasip2/release/z_audit_sentinel.wasm  # check the interface
```

Then, from the sibling project `my-t3n-app/`, run these commands:

```bash
npm run setup:sentinel   # register the contract, create the audit-log map
npm run demo:sentinel    # write a few sample events, as other agents would
npm run report:sentinel  # print the compliance report
```

## How to maintain this agent

This agent has zero moving parts once you deploy it. This agent uses
no secrets. This agent makes no outbound HTTP call. This agent calls
no third-party API, so no third-party API can break this agent. Only
a change to T3N itself can break this agent. We are glad to keep this
agent running. We are also glad to hand this agent to Terminal 3, as
a starter "governance agent" template. Other builders could call this
template from their own agents. Each call adds one `log-action` call
after a sensitive action.
