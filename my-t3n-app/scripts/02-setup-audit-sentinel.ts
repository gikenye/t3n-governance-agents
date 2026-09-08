// Run this script once per environment. Run this script again each
// time you raise CONTRACT_VERSION.
//
// Steps to do first (see /developers/adk/get-started/walkthrough/build-contract):
//   cd ../z-audit-sentinel
//   rustup target add wasm32-wasip2
//   cargo build --target wasm32-wasip2 --release
//
// Then, from my-t3n-app/, run this command:
//   npm run setup:sentinel

import { readFile } from "fs/promises";
import { connectTenant } from "../lib/session.js";
import { readDeployment, saveDeployment } from "../lib/deployment.js";

const WASM_PATH =
  "../z-audit-sentinel/target/wasm32-wasip2/release/z_audit_sentinel.wasm";
const CONTRACT_TAIL = "audit-sentinel"; // Keep this short. See the note in register-contract.md.
const CONTRACT_VERSION = "0.1.2";

async function main() {
  const { tenant, tenantDid } = await connectTenant();
  const existing = await readDeployment(CONTRACT_TAIL);
  const scriptName = `z:${tenantDid.slice("did:t3n:".length)}:${CONTRACT_TAIL}`;

  if (existing?.version === CONTRACT_VERSION) {
    const mapStatus = await tenant.maps.getStatus("audit-log");
    if (mapStatus === "active") {
      console.log(`Already ready: ${scriptName} (contract id ${existing.contractId})`);
      return;
    }
    if (mapStatus === "deleting") {
      throw new Error("audit-log is still deleting; rerun after it becomes absent");
    }
    await tenant.maps.create({
      tail: "audit-log",
      visibility: "private",
      writers: { only: [existing.contractId] },
      readers: { only: [existing.contractId] },
    });
    console.log(`Recreated ${scriptName}:audit-log for contract ${existing.contractId}`);
    return;
  }

  if (existing) {
    throw new Error(
      `Local deployment is ${existing.version}; run npm run reset:dev -- sentinel before changing version`,
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

  // This map is the contract's only state. The readers list and the
  // writers list both name the contract itself only. Nothing outside
  // the enclave can read the log directly, not even this setup
  // script. This rule is the point: the audit trail resists tampering
  // because only the audit-sentinel contract can touch it.
  await tenant.maps.create({
    tail: "audit-log",
    visibility: "private",
    writers: { only: [contractId] },
    readers: { only: [contractId] },
  });
  console.log(`z:${tenantDid.slice("did:t3n:".length)}:audit-log map ready`);
  await saveDeployment(CONTRACT_TAIL, { contractId, version: CONTRACT_VERSION });

  console.log(
    "\nSave this contract_id. A later registration of the same tail gives " +
      "a NEW contract_id. No API call can look up an old contract_id again " +
      "(see the Warning in register-contract.md). When you redeploy, run " +
      "this whole script again. Do not just raise the version number alone.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
