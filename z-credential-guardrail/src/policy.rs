//! Policy storage: this module keeps one JSON value at
//! `guardrail-policy["rules"]`.
//! Request storage: this module writes one row per `check-policy`
//! call, at `guardrail-requests["<ts>-<seq>"]`. This key uses the same
//! sortable form as z-audit-sentinel. This form keeps the scan in
//! `list-pending` in order.

extern crate alloc;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

use crate::host::interfaces::{kv_store, logging};
use crate::host::tenant::tenant_context;
use serde::{Deserialize, Serialize};

const POLICY_KEY: &[u8] = b"rules";

fn policy_map() -> String {
    format!("z:{}:guardrail-policy", hex::encode(&tenant_context::tenant_did()))
}
fn requests_map() -> String {
    format!("z:{}:guardrail-requests", hex::encode(&tenant_context::tenant_did()))
}

// ---------- set-policy ----------

#[derive(Deserialize, Serialize, Clone)]
struct Rule {
    action: String,
    #[serde(default)]
    max_amount: Option<u64>,
    mode: String, // "auto_approve" | "needs_approval" | "deny"
}

#[derive(Deserialize, Serialize)]
struct Policy {
    default_mode: String,
    rules: Vec<Rule>,
    // Optional separation-of-duties allowlist. When non-empty, only a
    // DID in this list may resolve a pending request (see
    // resolve-approval). Defaults to empty so an existing set-policy
    // payload without this field still deserialises.
    #[serde(default)]
    approvers: Vec<String>,
}

pub fn set_policy(input: &[u8]) -> Result<Vec<u8>, String> {
    let policy: Policy =
        serde_json::from_slice(input).map_err(|e| format!("set-policy: bad input: {e}"))?;

    let valid_modes = ["auto_approve", "needs_approval", "deny"];
    if !valid_modes.contains(&policy.default_mode.as_str()) {
        return Err(format!("set-policy: invalid default_mode {}", policy.default_mode));
    }
    for r in &policy.rules {
        if !valid_modes.contains(&r.mode.as_str()) {
            return Err(format!("set-policy: invalid mode {} for action {}", r.mode, r.action));
        }
    }

    let value = serde_json::to_vec(&policy).map_err(|e| format!("set-policy: encode: {e}"))?;
    kv_store::put(&policy_map(), POLICY_KEY, &value)
        .map_err(|e| format!("set-policy: kv write failed: {e}"))?;

    let _ = logging::info(&format!("guardrail: policy updated, {} rule(s)", policy.rules.len()));

    let out = serde_json::json!({ "saved": true, "rule_count": policy.rules.len() as u32 });
    serde_json::to_vec(&out).map_err(|e| format!("set-policy: encode response: {e}"))
}

fn load_policy() -> Policy {
    match kv_store::get(&policy_map(), POLICY_KEY) {
        Ok(Some(bytes)) => serde_json::from_slice(&bytes).unwrap_or(Policy {
            default_mode: "needs_approval".to_string(),
            rules: Vec::new(),
            approvers: Vec::new(),
        }),
        // No policy is set yet, or the read failed. Fail safe, not fail open.
        _ => Policy {
            default_mode: "needs_approval".to_string(),
            rules: Vec::new(),
            approvers: Vec::new(),
        },
    }
}

// ---------- check-policy ----------

#[derive(Deserialize)]
struct CheckPolicyInput {
    actor_did: String,
    action: String,
    #[serde(default)]
    amount: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone)]
struct RequestRecord {
    request_id: String,
    actor_did: String,
    action: String,
    amount: Option<u64>,
    decision: String,
    reason: String,
    status: String, // "auto_approved" | "denied" | "pending" | "approved" | "rejected"
    approver_did: Option<String>,
}

pub fn check_policy(input: &[u8]) -> Result<Vec<u8>, String> {
    let req: CheckPolicyInput =
        serde_json::from_slice(input).map_err(|e| format!("check-policy: bad input: {e}"))?;

    let policy = load_policy();
    let matched = policy.rules.iter().find(|r| r.action == req.action);

    let (mut decision, mut reason) = match matched {
        Some(rule) => (rule.mode.clone(), format!("matched rule for action '{}'", req.action)),
        None => (
            policy.default_mode.clone(),
            format!("no rule for action '{}', used default_mode", req.action),
        ),
    };

    // A rule cannot auto-approve past its own ceiling. An amount over
    // max_amount always moves the decision to needs_approval, even when
    // the matched rule says auto_approve. Crucially, a MISSING amount on
    // a rule that has a ceiling must also escalate: otherwise a caller
    // bypasses the ceiling entirely just by omitting the amount field.
    if let Some(rule) = matched {
        if let Some(max) = rule.max_amount {
            if decision == "auto_approve" {
                match req.amount {
                    Some(amount) if amount > max => {
                        decision = "needs_approval".to_string();
                        reason =
                            format!("amount {amount} is over the rule ceiling {max}, escalated");
                    }
                    None => {
                        decision = "needs_approval".to_string();
                        reason = format!(
                            "action '{}' has ceiling {max} but no amount was supplied, escalated",
                            req.action
                        );
                    }
                    _ => {}
                }
            }
        }
    }

    let ts = tenant_context::cluster_timestamp_secs();
    let seq = tenant_context::seq_no();
    let request_id = format!("{:010}-{:010}", ts, seq);

    let status = match decision.as_str() {
        "auto_approve" => "auto_approved",
        "deny" => "denied",
        _ => "pending",
    };

    let record = RequestRecord {
        request_id: request_id.clone(),
        actor_did: req.actor_did,
        action: req.action,
        amount: req.amount,
        decision: decision.clone(),
        reason: reason.clone(),
        status: status.to_string(),
        approver_did: None,
    };
    let value = serde_json::to_vec(&record).map_err(|e| format!("check-policy: encode: {e}"))?;
    kv_store::put(&requests_map(), request_id.as_bytes(), &value)
        .map_err(|e| format!("check-policy: kv write failed: {e}"))?;

    let _ = logging::info(&format!("guardrail: {} -> {}", record.action, decision));

    let out = serde_json::json!({ "decision": decision, "reason": reason, "request_id": request_id });
    serde_json::to_vec(&out).map_err(|e| format!("check-policy: encode response: {e}"))
}

// ---------- resolve-approval ----------

#[derive(Deserialize)]
struct ResolveInput {
    request_id: String,
    approver_did: String,
    approve: bool,
}

pub fn resolve_approval(input: &[u8]) -> Result<Vec<u8>, String> {
    let req: ResolveInput =
        serde_json::from_slice(input).map_err(|e| format!("resolve-approval: bad input: {e}"))?;

    let map = requests_map();
    let existing = kv_store::get(&map, req.request_id.as_bytes())
        .map_err(|e| format!("resolve-approval: kv read failed: {e}"))?
        .ok_or_else(|| format!("resolve-approval: no request {}", req.request_id))?;

    let mut record: RequestRecord =
        serde_json::from_slice(&existing).map_err(|e| format!("resolve-approval: decode: {e}"))?;

    // Separation of duties. The whole point of an escalation is that a
    // *second* party signs off. Reject an empty approver, and reject the
    // requesting actor approving their own request.
    if req.approver_did.is_empty() {
        return Err("resolve-approval: approver_did is required".to_string());
    }
    if req.approver_did == record.actor_did {
        return Err(
            "resolve-approval: the requesting actor cannot approve their own request".to_string(),
        );
    }
    // When the tenant has configured an approver allowlist, the approver
    // must be on it. An empty allowlist keeps the MVP behaviour (any
    // second party may approve).
    let policy = load_policy();
    if !policy.approvers.is_empty() && !policy.approvers.contains(&req.approver_did) {
        return Err(format!(
            "resolve-approval: {} is not an authorised approver",
            req.approver_did
        ));
    }

    if record.status != "pending" {
        return Err(format!(
            "resolve-approval: request {} already resolved as '{}'",
            req.request_id, record.status
        ));
    }

    record.status = if req.approve { "approved".to_string() } else { "rejected".to_string() };
    record.approver_did = Some(req.approver_did);

    let value = serde_json::to_vec(&record).map_err(|e| format!("resolve-approval: encode: {e}"))?;
    kv_store::put(&map, req.request_id.as_bytes(), &value)
        .map_err(|e| format!("resolve-approval: kv write failed: {e}"))?;

    let _ = logging::info(&format!("guardrail: {} -> {}", req.request_id, record.status));

    let out = serde_json::json!({ "request_id": req.request_id, "resolved": record.status });
    serde_json::to_vec(&out).map_err(|e| format!("resolve-approval: encode response: {e}"))
}

// ---------- list-pending ----------

#[derive(Deserialize, Default)]
struct ListPendingInput {
    #[serde(default)]
    limit: Option<u32>,
}

pub fn list_pending(input: &[u8]) -> Result<Vec<u8>, String> {
    let req: ListPendingInput = if input.is_empty() {
        ListPendingInput::default()
    } else {
        serde_json::from_slice(input).map_err(|e| format!("list-pending: bad input: {e}"))?
    };
    // NOTE: `limit` bounds the row count that the scan reads. `limit`
    // does not bound the "pending" row count after the filter below.
    // This is a known MVP limit. Fix this if the pending queue grows large.
    let limit = req.limit.unwrap_or(200).clamp(1, 500);

    let rows = kv_store::scan(&requests_map(), &[], &[0xFF], limit)
        .map_err(|e| format!("list-pending: scan failed: {e}"))?;

    let mut pending = Vec::new();
    for (_key, value) in rows {
        if let Ok(record) = serde_json::from_slice::<RequestRecord>(&value) {
            if record.status == "pending" {
                pending.push(record);
            }
        }
    }

    let count = pending.len();
    let out = serde_json::json!({ "requests": pending, "count": count });
    serde_json::to_vec(&out).map_err(|e| format!("list-pending: encode response: {e}"))
}
