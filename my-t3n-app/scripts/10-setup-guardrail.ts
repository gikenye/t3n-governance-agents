// Steps to do first:
//   cd ../z-credential-guardrail
//   cargo build --target wasm32-wasip2 --release
//
// Then run this command:
//   npm run setup:guardrail

import { readFile } from "fs/promises";
import { getContractVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { connectTenant } from "../lib/session.js";
import { readDeployment, saveDeployment } from "../lib/deployment.js";

const WASM_PATH =
  "../z-credential-guardrail/target/wasm32-wasip2/release/z_credential_guardrail.wasm";
const CONTRACT_TAIL = "guardrail";
const CONTRACT_VERSION = "0.1.0";

async function main() {
  const { t3n, tenant, tenantDid } = await connectTenant();
  const existing = await readDeployment(CONTRACT_TAIL);
  const scriptName = `z:${tenantDid.slice("did:t3n:".length)}:${CONTRACT_TAIL}`;

  if (existing?.version === CONTRACT_VERSION) {
    const mapStatuses = await Promise.all(
      ["guardrail-policy", "guardrail-requests"].map((tail) => tenant.maps.getStatus(tail)),
    );
    if (mapStatuses.every((status) => status === "active")) {
      console.log(`Already ready: ${scriptName} (contract id ${existing.contractId})`);
      return;
    }
    if (mapStatuses.some((status) => status === "deleting")) {
      throw new Error("A guardrail map is still deleting; rerun after cleanup finishes");
    }
    for (const tail of ["guardrail-policy", "guardrail-requests"]) {
      if ((await tenant.maps.getStatus(tail)) === "absent") {
        await tenant.maps.create({
          tail,
          visibility: "private",
          writers: { only: [existing.contractId] },
          readers: { only: [existing.contractId] },
        });
      }
    }
    console.log(`Recreated maps for ${scriptName} (contract id ${existing.contractId})`);
    return;
  }

  if (existing) {
    throw new Error(
      `Local deployment is ${existing.version}; run npm run reset:dev -- guardrail before changing version`,
    );
  }

  const wasmBytes = await readFile(WASM_PATH);
  const result = await tenant.contracts.register({
    tail: CONTRACT_TAIL,
    version: CONTRACT_VERSION,
    wasm: wasmBytes,
  });
  const contractId = result.contract_id;
  console.log(`Registered ${scriptName} as contract id ${contractId}`);

  for (const tail of ["guardrail-policy", "guardrail-requests"]) {
    await tenant.maps.create({
      tail,
      visibility: "private",
      writers: { only: [contractId] },
      readers: { only: [contractId] },
    });
    console.log(`  map ready: z:${tenantDid.slice("did:t3n:".length)}:${tail}`);
  }

  // This is a starter policy. Reads and queries auto-approve. A
  // transfer under $1,000 auto-approves. A transfer at $1,000 or over
  // needs a human. Any action not on this list falls back to
  // needs_approval. This default is fail safe, not fail open.
  const scriptVersion = await getContractVersion(getNodeUrl(), scriptName);
  const policyResult = await t3n.executeAndDecode({
    contract_id: scriptName,
    contract_version: scriptVersion,
    function_name: "set-policy",
    input: {
      default_mode: "needs_approval",
      rules: [
        { action: "search-offers", mode: "auto_approve" },
        { action: "get-balance", mode: "auto_approve" },
        { action: "transfer-funds", max_amount: 1000, mode: "auto_approve" },
        { action: "book-offer", max_amount: 5000, mode: "auto_approve" },
      ],
    },
  });
  console.log("Policy saved:", policyResult);
  await saveDeployment(CONTRACT_TAIL, { contractId, version: CONTRACT_VERSION });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
