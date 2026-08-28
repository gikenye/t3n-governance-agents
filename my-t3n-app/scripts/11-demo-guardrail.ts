// This script joins the two contracts. First, an agent asks the
// guardrail for a decision. Second, the agent logs that decision to
// audit-sentinel. This flow shows the two agents joined at the script
// layer, not merged into one contract.
//
//   export AGENT_KEY="<the same key, or another second T3N key>"
//   npm run demo:guardrail

import {
  T3nClient,
  createEthAuthInput,
  eth_get_address,
  metamask_sign,
  getScriptVersion,
  getNodeUrl,
} from "@terminal3/t3n-sdk";
import { connectTenant } from "../lib/session.js";

const GUARDRAIL = "guardrail";
const SENTINEL = "audit-sentinel";

async function buildAgentClient(agentKey: string, wasmComponent: unknown) {
  const agentAddress = eth_get_address(agentKey);
  const client = new T3nClient({
    wasmComponent,
    handlers: { EthSign: metamask_sign(agentAddress, undefined, agentKey) },
  });
  await client.handshake();
  const auth = await client.authenticate(createEthAuthInput(agentAddress));
  return { client, agentDid: auth.value };
}

async function main() {
  const { tenantDid, wasmComponent } = await connectTenant();
  const tid = tenantDid.slice("did:t3n:".length);

  const agentKey = process.env.AGENT_KEY;
  if (!agentKey) throw new Error('Set AGENT_KEY: export AGENT_KEY="..."');
  const { client: agentClient, agentDid } = await buildAgentClient(agentKey, wasmComponent);

  const guardrailScript = `z:${tid}:${GUARDRAIL}`;
  const guardrailVersion = await getScriptVersion(getNodeUrl(), guardrailScript);
  const sentinelScript = `z:${tid}:${SENTINEL}`;
  const sentinelVersion = await getScriptVersion(getNodeUrl(), sentinelScript);

  async function checkAndLog(action: string, amount?: number) {
    const decision = await agentClient.executeAndDecode({
      script_name: guardrailScript,
      script_version: guardrailVersion,
      function_name: "check-policy",
      input: { actor_did: agentDid, action, amount },
    });
    console.log(`check-policy(${action}, ${amount ?? "-"}) ->`, decision.decision, `(${decision.request_id})`);

    await agentClient.executeAndDecode({
      script_name: sentinelScript,
      script_version: sentinelVersion,
      function_name: "log-action",
      input: {
        actor_did: agentDid,
        action,
        target: "guardrail-gated-action",
        // A needs_approval decision is parked, not performed, so it must
        // not be logged as "success" — that would misreport a pending
        // transfer as a completed one in the compliance report.
        status:
          decision.decision === "deny"
            ? "denied"
            : decision.decision === "needs_approval"
              ? "escalated"
              : "success",
        detail: `guardrail decision=${decision.decision} request_id=${decision.request_id}`,
      },
    });

    return decision;
  }

  // This amount is under the threshold. This call auto-approves. No
  // human is needed here.
  await checkAndLog("transfer-funds", 400);

  // This amount is over the threshold. This call parks the request as
  // needs_approval.
  const escalated = await checkAndLog("transfer-funds", 8000);

  if (escalated.decision === "needs_approval") {
    // This call stands in for a human approver. The human resolves
    // the request from an approvals inbox.
    const resolved = await agentClient.executeAndDecode({
      script_name: guardrailScript,
      script_version: guardrailVersion,
      function_name: "resolve-approval",
      input: {
        request_id: escalated.request_id,
        approver_did: agentDid, // In production, use the approver's own DID here, not the agent's DID.
        approve: true,
      },
    });
    console.log("resolve-approval ->", resolved.resolved);
  }

  const pending = await agentClient.executeAndDecode({
    script_name: guardrailScript,
    script_version: guardrailVersion,
    function_name: "list-pending",
    input: {},
  });
  console.log(`\n${pending.count} request(s) still pending human review.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
