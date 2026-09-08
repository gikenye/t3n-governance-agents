// This script acts out two other agents, a payroll agent and a travel
// agent. Each agent calls audit-sentinel.log-action right after a
// sensitive action. In a real deployment, add one `logAction(...)`
// call at the end of each function in your other agents. See the note
// near the bottom of this file.
//
//   export AGENT_KEY="<any second T3N key, to act as the calling agent>"
//   npm run demo:sentinel

import {
  T3nClient,
  loadWasmComponent,
  createEthAuthInput,
  eth_get_address,
  metamask_sign,
  getContractVersion,
  getNodeUrl,
} from "@terminal3/t3n-sdk";
import { connectTenant } from "../lib/session.js";

const CONTRACT_TAIL = "audit-sentinel";

async function buildAgentClient(
  agentKey: string,
  wasmComponent: unknown,
  trustAnchor: unknown,
) {
  const agentAddress = eth_get_address(agentKey);
  const client = new T3nClient({
    trustAnchor, // required on every T3nClient, agent clients included
    wasmComponent,
    handlers: { EthSign: metamask_sign(agentAddress, undefined, agentKey) },
  });
  await client.handshake();
  const auth = await client.authenticate(createEthAuthInput(agentAddress));
  return { client, agentDid: auth.value };
}

async function main() {
  const { tenantDid, wasmComponent, trustAnchor } = await connectTenant();

  const agentKey = process.env.AGENT_KEY;
  if (!agentKey) {
    throw new Error('Set AGENT_KEY to any second T3N key: export AGENT_KEY="..."');
  }
  const { client: agentClient, agentDid } = await buildAgentClient(agentKey, wasmComponent, trustAnchor);

  const scriptName = `z:${tenantDid.slice("did:t3n:".length)}:${CONTRACT_TAIL}`;
  const scriptVersion = await getContractVersion(getNodeUrl(), scriptName);

  // audit-sentinel makes no outbound HTTP call. So, unlike the flight
  // contract in the walkthrough, this contract needs no
  // `agent-auth-update` egress grant first. Any authenticated agent
  // can call log-action and list-actions directly. This point is
  // worth a flag in the submission. The docs describe the grant as a
  // gate on egress only. We infer the rule "a contract with no egress
  // needs no grant at all". No doc page states this rule outright.
  const events = [
    {
      actor_did: agentDid,
      action: "transfer-funds",
      target: "bank-payments",
      status: "success",
      detail: "payroll run 2026-08, batch #114",
    },
    {
      actor_did: agentDid,
      action: "book-offer",
      target: "duffel:air/orders",
      status: "success",
      detail: "LHR-JFK, economy",
    },
    {
      actor_did: agentDid,
      action: "transfer-funds",
      target: "bank-payments",
      status: "denied",
      detail: "over the per-transaction limit, see the guardrail demo",
    },
  ];

  for (const event of events) {
    const result = await agentClient.executeAndDecode({
      contract_id: scriptName,
      contract_version: scriptVersion,
      function_name: "log-action",
      input: event,
    });
    console.log("logged:", result.event_key, "-", event.action, event.status);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
