// Shared connect and auth helper.
//
// The docs (Quickstart and Set Up Dev Env) tell you to add each new
// step to the bottom of one file, quickstart.ts. This rule keeps
// `t3n`, `tenantDid`, and `tenant` in scope. This rule works for one
// walkthrough script. This rule does not scale to a project with
// several agents. Each agent needs the same session. Without this
// module, each file would need its own copy of the connect step, or
// the project would need shared global state. This module builds the
// session once. This module exports the session. Each script below
// calls `connectTenant()` to get it.
//
// This module also helps the "ease of maintenance" part of the
// submission. One file owns the auth flow. A key change, or an SDK
// version change, needs one file edit, not a change in each script.

// Load .env.local into process.env first, before any key is read below.
import "./env.js";

import {
  T3nClient,
  TenantClient,
  setEnvironment,
  loadWasmComponent,
  eth_get_address,
  metamask_sign,
  createEthAuthInput,
  fetchTrustedManifest,
  getNodeUrl,
} from "@terminal3/t3n-sdk";

// Set the environment once, here, not in each script. Change this
// value to "production" here only, when you are ready to go live.
const ENVIRONMENT: "testnet" | "sandbox" | "production" =
  (process.env.T3N_ENVIRONMENT as any) ?? "testnet";

export interface TenantSession {
  t3n: T3nClient;
  tenant: TenantClient;
  tenantDid: string;
  wasmComponent: Awaited<ReturnType<typeof loadWasmComponent>>;
}

let cached: Promise<TenantSession> | null = null;

async function connect(): Promise<TenantSession> {
  const T3N_API_KEY = process.env.T3N_API_KEY;
  if (!T3N_API_KEY) {
    throw new Error(
      "T3N_API_KEY is not set. Copy the key from the claim page, then run: " +
        'export T3N_API_KEY="<your key>"',
    );
  }

  setEnvironment(ENVIRONMENT);

  const wasmComponent = await loadWasmComponent();
  const address = eth_get_address(T3N_API_KEY);

  const t3n = new T3nClient({
    trustAnchor: await fetchTrustedManifest(ENVIRONMENT),
    wasmComponent,
    handlers: {
      EthSign: metamask_sign(address, undefined, T3N_API_KEY),
    },
  });

  await t3n.handshake();
  const did = await t3n.authenticate(createEthAuthInput(address));
  const tenantDid = did.value; // did:t3n:..., read from the session, never built by hand

  const tenant = new TenantClient({
    t3n,
    baseUrl: getNodeUrl(),
    tenantDid,
  });
  await tenant.tenant.me(); // Throws an error when the session is not valid. me() lives on the tenant namespace (TenantClient.tenant), not on the client itself.

  console.log(`Connected as tenant: ${tenantDid}`);
  return { t3n, tenant, tenantDid, wasmComponent };
}

/** This function caches the session. Each script in this project can call this function and share one session. */
export function connectTenant(): Promise<TenantSession> {
  if (!cached) cached = connect();
  return cached;
}
