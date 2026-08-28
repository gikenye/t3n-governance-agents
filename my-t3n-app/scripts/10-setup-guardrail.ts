// Steps to do first:
//   cd ../z-credential-guardrail
//   cargo build --target wasm32-wasip2 --release
//
// Then run this command:
//   npm run setup:guardrail

import { readFile } from "fs/promises";
import { getScriptVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { connectTenant } from "../lib/session.js";

const WASM_PATH =
  "../z-credential-guardrail/target/wasm32-wasip2/release/z_credential_guardrail.wasm";
const CONTRACT_TAIL = "guardrail";
const CONTRACT_VERSION = "0.1.0";

async function main() {
  const { tenant, tenantDid } = await connectTenant();

  const wasmBytes = await readFile(WASM_PATH);
  const result = await tenant.contracts.register({
    tail: CONTRACT_TAIL,
    version: CONTRACT_VERSION,
    wasm: wasmBytes,
  });
  const contractId = result.contract_id;
  const scriptName = `z:${tenantDid.slice("did:t3n:".length)}:${CONTRACT_TAIL}`;
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
  const scriptVersion = await getScriptVersion(getNodeUrl(), scriptName);
  const policyResult = await tenant.contracts.executeAndDecode({
    script_name: scriptName,
    script_version: scriptVersion,
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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
