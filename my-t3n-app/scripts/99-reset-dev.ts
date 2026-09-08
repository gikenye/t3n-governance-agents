import { connectTenant } from "../lib/session.js";
import { clearDeployment } from "../lib/deployment.js";

const deployments = {
  sentinel: {
    tail: "audit-sentinel",
    maps: ["audit-log"],
  },
  guardrail: {
    tail: "guardrail",
    maps: ["guardrail-policy", "guardrail-requests"],
  },
} as const;

async function main() {
  const name = process.argv[2] as keyof typeof deployments | undefined;
  if (!name || !(name in deployments)) {
    throw new Error("Usage: npm run reset:dev -- sentinel|guardrail");
  }

  const { tenant } = await connectTenant();
  const deployment = deployments[name];

  for (const map of deployment.maps) {
    const status = await tenant.maps.getStatus(map);
    if (status === "active") {
      await tenant.maps.delete(map);
      console.log(`Deleting ${map}...`);
    }
    if (status !== "absent") {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const current = await tenant.maps.getStatus(map);
        if (current === "absent") break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (attempt === 59) throw new Error(`Map ${map} did not become absent`);
      }
    }
  }

  const contracts = await tenant.contracts.list();
  const contractName = tenant.canonicalName(deployment.tail);
  if (contracts.includes(contractName)) {
    await tenant.contracts.disable(deployment.tail);
    await tenant.contracts.unregister(deployment.tail);
    console.log(`Unregistered ${contractName}`);
  }

  await clearDeployment(deployment.tail);
  console.log(`Reset complete: ${name}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
