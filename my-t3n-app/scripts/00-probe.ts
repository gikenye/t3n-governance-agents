// Read-only auth probe. Authenticates BOTH keys from .env.local against
// the T3N testnet and checks the returned DIDs match the file. Writes
// nothing on-chain: no contract registration, no map creation. Safe to
// run repeatedly.
//
//   npx tsx scripts/00-probe.ts

import {
  T3nClient,
  createEthAuthInput,
  eth_get_address,
  metamask_sign,
} from "@terminal3/t3n-sdk";
import { connectTenant } from "../lib/session.js";

async function main() {
  console.log("== T3N key probe (no on-chain writes) ==\n");

  // Tenant (primary key). connectTenant() does handshake + authenticate
  // + tenant.me() only.
  const { tenantDid, wasmComponent } = await connectTenant();
  const expectTenant = process.env.DID;
  console.log("tenant DID (key 1):", tenantDid);
  console.log("  matches .env DID:", expectTenant ? tenantDid === expectTenant : "(DID not in .env)");

  // Agent (second key) — same auth path the demo scripts use.
  const agentKey = process.env.AGENT_KEY;
  if (!agentKey) throw new Error("AGENT_KEY unset (expected from T3N_API_KEY_2)");
  const agentAddress = eth_get_address(agentKey);
  const agentClient = new T3nClient({
    wasmComponent,
    handlers: { EthSign: metamask_sign(agentAddress, undefined, agentKey) },
  });
  await agentClient.handshake();
  const agentAuth = await agentClient.authenticate(createEthAuthInput(agentAddress));
  const agentDid = agentAuth.value;
  const expectAgent = process.env.DID_2;
  console.log("\nagent DID  (key 2):", agentDid);
  console.log("  matches .env DID_2:", expectAgent ? agentDid === expectAgent : "(DID_2 not in .env)");

  console.log("\ndistinct identities:", tenantDid !== agentDid);
  console.log("\nOK: both keys authenticated against the T3N testnet.");
}

main().catch((err) => {
  console.error("\nPROBE FAILED:", err);
  process.exit(1);
});
