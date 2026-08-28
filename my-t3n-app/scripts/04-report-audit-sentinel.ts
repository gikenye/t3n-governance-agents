// This script turns the raw audit-log rows into a report. A
// compliance reviewer wants to read this report. The report shows
// what each agent did, grouped and counted. The report lists each
// anomaly, a denial or an error, first.
//
//   npm run report:sentinel

import { getScriptVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { connectTenant } from "../lib/session.js";

const CONTRACT_TAIL = "audit-sentinel";

interface AuditEvent {
  ts: number;
  actor_did: string;
  action: string;
  target: string;
  status: string;
  detail?: string;
}

async function main() {
  const { tenant, tenantDid } = await connectTenant();
  const scriptName = `z:${tenantDid.slice("did:t3n:".length)}:${CONTRACT_TAIL}`;
  const scriptVersion = await getScriptVersion(getNodeUrl(), scriptName);

  // This call reads the log back through the tenant's own contract
  // client. This call uses the same execute path as an agent call.
  // The tenant, not an agent, calls this function here.
  const { events } = await tenant.contracts.executeAndDecode({
    script_name: scriptName,
    script_version: scriptVersion,
    function_name: "list-actions",
    input: { limit: 500 },
  }) as { events: AuditEvent[] };

  if (events.length === 0) {
    console.log("No events are logged yet. Run `npm run demo:sentinel` first.");
    return;
  }

  const byActor = new Map<string, AuditEvent[]>();
  const anomalies: AuditEvent[] = [];

  for (const e of events) {
    if (!byActor.has(e.actor_did)) byActor.set(e.actor_did, []);
    byActor.get(e.actor_did)!.push(e);
    if (e.status !== "success") anomalies.push(e);
  }

  const fmtTs = (ts: number) => new Date(ts * 1000).toISOString();
  const first = fmtTs(events[0].ts);
  const last = fmtTs(events[events.length - 1].ts);

  console.log("=".repeat(60));
  console.log(`Agent activity report, tenant ${tenantDid}`);
  console.log(`Window: ${first} to ${last}`);
  console.log(`Total governed actions: ${events.length}`);
  console.log("=".repeat(60));

  console.log(`\n${anomalies.length} action(s) did not succeed:`);
  if (anomalies.length === 0) {
    console.log("  (none)");
  } else {
    for (const a of anomalies) {
      console.log(`  [${fmtTs(a.ts)}] ${a.actor_did.slice(0, 18)}... ${a.action} -> ${a.status}: ${a.detail ?? ""}`);
    }
  }

  console.log(`\nBy agent (${byActor.size} distinct actor(s)):`);
  for (const [actor, acts] of byActor) {
    const byAction = new Map<string, number>();
    for (const a of acts) byAction.set(a.action, (byAction.get(a.action) ?? 0) + 1);
    const summary = [...byAction.entries()].map(([a, n]) => `${a} x${n}`).join(", ");
    console.log(`  ${actor.slice(0, 24)}...  ${summary}`);
  }

  console.log(
    "\nThis tenant's own audit-sentinel contract wrote every record in this " +
      "report. This report does not depend on any log that the destination " +
      "systems, a bank or Duffel for example, keep on their own side.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
