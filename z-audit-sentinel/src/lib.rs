//! z-audit-sentinel v0.1.0
//!
//! This contract is a governance agent for a T3N tenant. Other agents
//! call this contract right after they do a sensitive action. Terminal
//! 3 ships four reference agents: Payroll, Procurement, E-visa, and
//! Travel. Each agent moves money or data. None of the four agents
//! produce a record that an auditor can read, independent of the
//! destination system's own log. This contract is that record. Agents
//! call `log-action` to write an event. A report script calls
//! `list-actions` to read the events back as plain output.
//!
//! # Why this contract does not read the T3N ledger
//!
//! The ADK reference page lists a symbol named `getAuditEvents()`. The
//! page marks this symbol as "reported to exist but undocumented". This
//! contract does not depend on that symbol. Instead, this contract
//! keeps its own audit log in a KV map named `z:<tid>:audit-log`. The
//! contract uses two confirmed functions only: `kv-store::put` to write
//! an event, and `kv-store::scan` to read a range of events back in
//! order. This design gives one more benefit: only this contract can
//! read the log. The kv-store namespace binds to the contract that owns
//! it. See `/t3n/how-t3n-works/host-api` for this rule. No other agent
//! can rewrite its own history in this log.
//!
//! # Host capabilities that this contract needs
//! ```json
//! { "host_capabilities": ["kv_store", "logging", "tenant_context"] }
//! ```
//!
//! # Setup
//! The tenant SDK must create the `audit-log` KV map before first use.
//! See `scripts/register-and-setup.ts` for this step. This contract
//! needs no secrets. This contract makes no outbound HTTP calls.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

extern crate alloc;

pub const CONTRACT_VERSION: &str = "0.1.0";

wit_bindgen::generate!({
    world: "audit-sentinel",
    path: "wit",
    additional_derives: [
        serde::Deserialize,
        serde::Serialize,
    ],
    generate_all,
});

mod list_actions;
mod log_action;

struct Component;

#[cfg(target_arch = "wasm32")]
impl exports::z::audit_sentinel::contracts::Guest for Component {
    fn log_action(
        req: exports::z::audit_sentinel::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("log-action: missing input")?;
        log_action::log_action(&input)
    }

    fn list_actions(
        req: exports::z::audit_sentinel::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.unwrap_or_default();
        list_actions::list_actions(&input)
    }
}

#[cfg(target_arch = "wasm32")]
export!(Component);

#[cfg(test)]
mod tests {
    use super::CONTRACT_VERSION;

    #[test]
    fn contract_version_is_semver() {
        let parts: alloc::vec::Vec<&str> = CONTRACT_VERSION.split('.').collect();
        assert_eq!(parts.len(), 3, "CONTRACT_VERSION must be MAJOR.MINOR.PATCH");
        for part in parts {
            assert!(part.parse::<u32>().is_ok(), "each part must be a number");
        }
    }
}
