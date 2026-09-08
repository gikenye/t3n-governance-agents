# Live test bugs

Run date: 2026-09-03

Environment:

- `T3N_ENVIRONMENT` from `.env.local` (secrets omitted)
- Node.js `v20.12.0`
- `@terminal3/t3n-sdk` initially installed from `latest`; support recommended
  and the app now pins `5.2.0`
- Rust contracts built successfully for `wasm32-wasip2`

## 1. Testnet trust manifest rejected by SDK 5.7.0 (fixed by SDK downgrade)

Reproduction:

```text
npx tsx scripts/00-probe.ts
npm run setup:sentinel
```

Observed error:

```text
Error: Trust manifest at
https://cn-api.sg.testnet.t3n.terminal3.io/api/trust-manifest is malformed.
```

The live JSON response contains `cluster`, `version`, `peer_ids`,
`rtmr3_allowlist`, `signed_at`, and `signature`, but omits the required
`rtmr1_allowlist` field introduced by the installed SDK's trust-anchor schema.
Because that field is covered by the operator signature, the application
cannot safely synthesize it or bypass verification.

Impact with SDK 5.7.0: authentication could not proceed, so no live contract
registration or on-chain setup could be performed.

The failure originated in the SDK 5.7.0 `fetchTrustedManifest()` call in
`lib/session.ts`, before handshake/authentication completed. Support advised
using SDK 5.2.0. With 5.2.0, the probe succeeds and both DIDs match:

- tenant: `did:t3n:049703350742f9db626ebeb9ef7a3ce8f8b4b2df`
- agent: `did:t3n:5d7565f359cde5c57c2c8d4bc70f7ccf7286c101`

No API keys are recorded here.

## 2. Contract setup is not rerunnable with the same version

After authentication was fixed, `npm run setup:sentinel` reached the node but
failed because `audit-sentinel@0.1.0` was already registered:

```text
contract version invalid: version 0.1.0 is not higher than current version 0.1.0
```

The attempted workaround registered `audit-sentinel@0.1.1`, but then failed
because the existing `audit-log` map remained owned by the earlier contract:

```text
map already exists
```

The source version remains `0.1.0`; no map was deleted or overwritten.

## 3. SDK 5.2 exposes execution on `T3nClient`, not `tenant.contracts`

`npm run setup:guardrail` registered the contract and created both maps, then
failed with:

```text
TypeError: tenant.contracts.executeAndDecode is not a function
```

The SDK 5.2 type definitions expose `executeAndDecode` on `T3nClient`. The
setup and report scripts now call `t3n.executeAndDecode`.

## 4. New contract cannot reuse an existing private map

The attempted `audit-sentinel@0.1.1` registration received contract ID `906`,
but the existing `audit-log` map is still writable only by the earlier
sentinel contract. The guardrail demo therefore fails after its policy check:

```text
access denied: TenantContract(.../906) cannot write map
"...:audit-log"
```

No map was deleted or broadened. Completing a fresh deployment requires a
coordinated map migration or a new map name; changing the contract version
alone is insufficient.

Resolution: in the dev tenant, the stale map was deleted and allowed to reach
`absent`, the disabled stale contract was unregistered, and
`audit-sentinel@0.1.2` was registered as contract ID `937` with a newly
created `audit-log` map owned by that contract.

## 5. Guardrail demo used the requesting agent as its approver

After the deployment migration, the guardrail demo correctly returned
`auto_approve` for 400 and `needs_approval` for 8000, then failed because it
passed `agentDid` as `approver_did`. The contract intentionally rejects
self-approval for separation of duties. The demo now invokes
`resolve-approval` through the tenant session and supplies `tenantDid` as the
second-party approver.

Resolution: the stale pending request was approved by the tenant DID, and the
rerun completed with `0 request(s) still pending human review`.

## 7. Repeatability plan validated

The dev reset commands removed both prior deployments and waited for map
cleanup. Fresh setup registered sentinel contract `939` and guardrail
contract `940`; immediately repeating both setup commands reported
`Already ready` without new registrations. The complete sentinel and
guardrail demos then passed, including a zero-pending approval inbox.

## 8. SDK did not export `getScriptVersion` (fixed)

Reproduction:

```text
npm run demo:sentinel
npm run report:sentinel
npm run setup:guardrail
npm run demo:guardrail
```

Observed error:

```text
SyntaxError: The requested module '@terminal3/t3n-sdk' does not provide an
export named 'getScriptVersion'
```

Root cause: the scripts targeted an older SDK API. SDK 5.2.0 and 5.7.0
export `getContractVersion`, and their execute payload uses
`contract_id`/`contract_version`, not `script_name`/`script_version`.

Fix: all affected scripts now use `getContractVersion` and the current
contract execution field names. The scripts pass module loading and reach the
shared trust-manifest fetch.

## 9. Node engine warnings during dependency installation

`npm install` completed, but reported unsupported engine warnings:

- `@noble/curves@2.4.0` requires Node `>=20.19.0`
- `@noble/hashes@2.4.0` requires Node `>=20.19.0`
- `p-retry@8.0.1` requires Node `>=22`

These warnings did not cause the observed live-test failures, but Node
`v20.12.0` is outside the declared engine range of these transitive
dependencies.

## 10. Mainnet trust verification is not provisioned in SDK 5.7.0

Reproduction:

```text
T3N_ENVIRONMENT=production npx tsx scripts/00-probe.ts
```

Observed error:

```text
No trust-manifest operator key pinned for environment "production" —
signed trust manifests are not provisioned for it yet.
```

Impact: the mainnet probe stops before handshake/authentication, so the
configured DIDs cannot be verified against their keys. The SDK offers an
explicit `{ unsafe_trust_server: true }` opt-out, but the live-test client
does not enable it because that disables attestation verification.

## 11. Main checkout did not contain the API script

The API and dashboard were added on the `agents/live-tests-with-env-local`
worktree. Running `npm run serve` from a separate `main` checkout produced:

```text
npm error Missing script: "serve"
```

Resolution: the worktree now contains the `serve` script and must be merged or
cherry-picked into the checkout used for deployment.

## 12. Fly image build requires a running Docker daemon

The application smoke test and TypeScript check pass locally. A local
`docker build` could not run because Docker Desktop's daemon was stopped:

```text
The system cannot find the file specified: docker_engine
```

This is a local tooling limitation, not an application failure. Fly's remote
builder can build the included `Dockerfile` after Fly authentication.
