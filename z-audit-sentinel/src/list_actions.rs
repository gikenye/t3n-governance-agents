//! `list-actions` reads a window of the map `z:<tid>:audit-log`. The
//! function returns the window as JSON.
//!
//! This function calls `kv-store::scan(map_name, start, end, limit)`.
//! This function scans a half-open range `[start, end)` over the map.
//! The function returns `(key, value)` pairs in key order. The function
//! `log-action` writes each key as a zero-padded, ASCII string, in the
//! form `"<ts>-<seq>"`. So key order equals time order here. This
//! function needs no extra sort step. `end` is one byte, the value
//! `0xFF`. This value is larger than every real key. Every real key
//! starts with an ASCII digit, and every ASCII digit is smaller than
//! `0xFF`. The `scan` function has no built-in "read the whole map"
//! option. This end-byte value is the workaround. See the write-up for
//! this note.

extern crate alloc;
use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;

use crate::host::interfaces::kv_store;
use crate::host::tenant::tenant_context;
use serde::{Deserialize, Serialize};

const DEFAULT_LIMIT: u32 = 100;
const MAX_LIMIT: u32 = 500;

#[derive(Deserialize, Default)]
struct ListActionsInput {
    #[serde(default)]
    limit: Option<u32>,
}

#[derive(Serialize)]
struct ListActionsOutput {
    events: Vec<serde_json::Value>,
    count: usize,
}

fn audit_log_map_name() -> String {
    let tid = tenant_context::tenant_did();
    format!("z:{}:audit-log", hex::encode(&tid))
}

pub fn list_actions(input: &[u8]) -> Result<Vec<u8>, String> {
    let req: ListActionsInput = if input.is_empty() {
        ListActionsInput::default()
    } else {
        serde_json::from_slice(input).map_err(|e| format!("list-actions: bad input: {e}"))?
    };

    let limit = req.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let map_name = audit_log_map_name();

    let rows = kv_store::scan(&map_name, &[], &[0xFF], limit)
        .map_err(|e| format!("list-actions: scan failed: {e}"))?;

    let mut events = Vec::with_capacity(rows.len());
    for (_key, value) in rows {
        match serde_json::from_slice::<serde_json::Value>(&value) {
            Ok(v) => events.push(v),
            Err(_) => continue, // Skip a bad row. Do not fail the whole read.
        }
    }

    let out = ListActionsOutput {
        count: events.len(),
        events,
    };
    serde_json::to_vec(&out).map_err(|e| format!("list-actions: encode response: {e}"))
}
