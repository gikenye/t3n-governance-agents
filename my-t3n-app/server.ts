import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEthAuthInput,
  eth_get_address,
  getContractVersion,
  getNodeUrl,
  metamask_sign,
  T3nClient,
} from "@terminal3/t3n-sdk";
import { connectTenant } from "./lib/session.js";

const port = Number(process.env.PORT ?? 8787);
const staticRoot = fileURLToPath(new URL("./web", import.meta.url));

async function body(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

async function agentSession() {
  const { wasmComponent, trustAnchor } = await connectTenant();
  const key = process.env.AGENT_KEY;
  if (!key) throw new Error("AGENT_KEY is required for action execution");
  const address = eth_get_address(key);
  const client = new T3nClient({
    trustAnchor,
    wasmComponent,
    handlers: { EthSign: metamask_sign(address, undefined, key) },
  });
  await client.handshake();
  const auth = await client.authenticate(createEthAuthInput(address));
  return { client, agentDid: auth.value };
}

async function contractName(tail: string): Promise<{ name: string; version: string }> {
  const { tenantDid } = await connectTenant();
  const name = `z:${tenantDid.slice("did:t3n:".length)}:${tail}`;
  return { name, version: await getContractVersion(getNodeUrl(), name) };
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (req.method === "GET" && url.pathname === "/healthz") {
    send(res, 200, { ok: true });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/health") {
    const { tenantDid } = await connectTenant();
    send(res, 200, { ok: true, environment: process.env.T3N_ENVIRONMENT ?? "testnet", tenantDid });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/audit/events") {
    const { t3n } = await connectTenant();
    const contract = await contractName("audit-sentinel");
    const result = await t3n.executeAndDecode({
      contract_id: contract.name, contract_version: contract.version,
      function_name: "list-actions", input: { limit: 500 },
    });
    send(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/reports/audit") {
    const { t3n } = await connectTenant();
    const contract = await contractName("audit-sentinel");
    const result = await t3n.executeAndDecode({
      contract_id: contract.name, contract_version: contract.version,
      function_name: "list-actions", input: { limit: 500 },
    }) as { events?: Array<{ actor_did?: string; action?: string; status?: string }> };
    const events = result.events ?? [];
    const byActor = new Map<string, number>();
    const byAction = new Map<string, number>();
    for (const event of events) {
      if (event.actor_did) byActor.set(event.actor_did, (byActor.get(event.actor_did) ?? 0) + 1);
      if (event.action) byAction.set(event.action, (byAction.get(event.action) ?? 0) + 1);
    }
    send(res, 200, {
      total: events.length,
      failures: events.filter((event) => event.status !== "success").length,
      byActor: Object.fromEntries(byActor),
      byAction: Object.fromEntries(byAction),
      events,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/approvals") {
    const { client } = await agentSession();
    const contract = await contractName("guardrail");
    send(res, 200, await client.executeAndDecode({
      contract_id: contract.name, contract_version: contract.version,
      function_name: "list-pending", input: {},
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/actions/preview") {
    const input = await body(req) as { action?: string; amount?: number };
    if (!input.action || (input.amount !== undefined && (!Number.isFinite(input.amount) || input.amount < 0))) {
      send(res, 400, { error: "action and a non-negative numeric amount are required" });
      return;
    }
    const { client, agentDid } = await agentSession();
    const contract = await contractName("guardrail");
    const decision = await client.executeAndDecode({
      contract_id: contract.name, contract_version: contract.version,
      function_name: "check-policy",
      input: { actor_did: agentDid, action: input.action, amount: input.amount },
    });
    send(res, 200, decision);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/approvals/resolve") {
    const input = await body(req) as { request_id?: string; approve?: boolean };
    if (!input.request_id || typeof input.approve !== "boolean") {
      send(res, 400, { error: "request_id and boolean approve are required" });
      return;
    }
    const { t3n, tenantDid } = await connectTenant();
    const contract = await contractName("guardrail");
    send(res, 200, await t3n.executeAndDecode({
      contract_id: contract.name, contract_version: contract.version,
      function_name: "resolve-approval",
      input: { request_id: input.request_id, approver_did: tenantDid, approve: input.approve },
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/llm/parse") {
    const input = await body(req) as { text?: string };
    const text = input.text?.trim() ?? "";
    const match = text.match(/([a-z][a-z-]+).{0,30}?(\d+(?:\.\d+)?)/i);
    const action = text.match(/transfer|book-offer|get-balance|search-offers/i)?.[0]?.toLowerCase();
    if (!action) {
      send(res, 400, { error: "Could not identify a supported action", supported: ["transfer-funds", "book-offer", "get-balance", "search-offers"] });
      return;
    }
    send(res, 200, { action: action === "transfer" ? "transfer-funds" : action, amount: match ? Number(match[2]) : undefined, source: "deterministic-parser", requiresGuardrail: true });
    return;
  }

  if (req.method === "GET") {
    try {
      const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const target = join(staticRoot, file);
      const relativeTarget = relative(staticRoot, target);
      if (isAbsolute(relativeTarget) || relativeTarget.startsWith("..")) {
        send(res, 400, { error: "invalid path" });
        return;
      }
      const content = await readFile(join(staticRoot, file));
      res.writeHead(200, { "content-type": file.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8" });
      res.end(content);
      return;
    } catch {
      send(res, 404, { error: "not found" });
      return;
    }
  }
  send(res, 404, { error: "not found" });
}

createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error(error);
    send(res, 500, { error: "request failed" });
  });
}).listen(port, () => console.log(`Governance dashboard listening on http://localhost:${port}`));
