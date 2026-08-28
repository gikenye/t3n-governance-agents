//! `log-action` writes one event to the map `z:<tid>:audit-log`.
//!
//! Key design: each key has the form `"<10-digit ts>-<10-digit seq>"`.
//! Each key uses zero-padded, ASCII digits only. The function
//! `kv-store::scan` returns rows in key order. This key format makes a
//! plain range scan return events in time order. `list-actions` needs
//! no extra sort step. `seq-no()` is the store's own counter. This
//! counter breaks a tie between two events in the same clock second.

extern crate alloc;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

use crate::host::interfaces::{kv_store, logging};
use crate::host::tenant::tenant_context;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct LogActionInput {
    actor_did: String,
    action: String,
    target: String,
    status: String,
    #[serde(default)]
    detail: Option<String>,
}

#[derive(Serialize)]
struct AuditEvent {
    ts: u64,
    /// The DID the caller *claimed* took the action. Free-form input.
    actor_did: String,
    /// The DID the host authenticated for this call, if the call came
    /// through the Session API. This is the tamper-proof identity.
    caller_did: Option<String>,
    /// True when the authenticated caller matches the claimed actor_did.
    /// A forged actor_did leaves this false rather than passing silently.
    actor_verified: bool,
    action: String,
    target: String,
    status: String,
    detail: Option<String>,
}

#[derive(Serialize)]
struct LogActionOutput {
    logged: bool,
    event_key: String,
}

fn audit_log_map_name() -> String {
    let tid = tenant_context::tenant_did();
    format!("z:{}:audit-log", hex::encode(&tid))
}

pub fn log_action(input: &[u8]) -> Result<Vec<u8>, String> {
    let req: LogActionInput =
        serde_json::from_slice(input).map_err(|e| format!("log-action: bad input: {e}"))?;

    if req.actor_did.is_empty() || req.action.is_empty() {
        return Err("log-action: actor_did and action are required".to_string());
    }

    let ts = tenant_context::cluster_timestamp_secs();
    let seq = tenant_context::seq_no();
    let event_key = format!("{:010}-{:010}", ts, seq);

    // Stamp the host-authenticated caller. `calling_user_did()` is None
    // for direct /api/dev/exec invocations; it is Some for Session-API
    // calls, which is how another agent reaches this contract. This
    // closes the spoofing gap: `actor_did` alone is caller-supplied and
    // could name any DID, so we record the verified identity too.
    let caller_did = tenant_context::calling_user_did()
        .map(|bytes| format!("did:t3n:{}", hex::encode(bytes)));
    let actor_verified = matches!(&caller_did, Some(c) if *c == req.actor_did);
    if let Some(caller) = &caller_did {
        if !actor_verified {
            let _ = logging::error(&format!(
                "audit-sentinel: actor_did '{}' does not match authenticated caller '{}'",
                req.actor_did, caller
            ));
        }
    }

    let event = AuditEvent {
        ts,
        actor_did: req.actor_did,
        caller_did,
        actor_verified,
        action: req.action,
        target: req.target,
        status: req.status,
        detail: req.detail,
    };
    let value = serde_json::to_vec(&event).map_err(|e| format!("log-action: encode: {e}"))?;

    let map_name = audit_log_map_name();
    kv_store::put(&map_name, event_key.as_bytes(), &value)
        .map_err(|e| format!("log-action: kv write failed: {e}"))?;

    let _ = logging::info(&format!(
        "audit-sentinel: logged {} on {} ({})",
        event.action, event.target, event.status
    ));

    let out = LogActionOutput {
        logged: true,
        event_key,
    };
    serde_json::to_vec(&out).map_err(|e| format!("log-action: encode response: {e}"))
}
