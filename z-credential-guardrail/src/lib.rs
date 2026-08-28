//! z-credential-guardrail v0.1.0. This contract is a reusable policy
//! gate for a state-changing agent action. See wit/world.wit for the
//! full design.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

extern crate alloc;

pub const CONTRACT_VERSION: &str = "0.1.0";

wit_bindgen::generate!({
    world: "credential-guardrail",
    path: "wit",
    additional_derives: [
        serde::Deserialize,
        serde::Serialize,
    ],
    generate_all,
});

mod policy;

struct Component;

#[cfg(target_arch = "wasm32")]
impl exports::z::credential_guardrail::contracts::Guest for Component {
    fn set_policy(
        req: exports::z::credential_guardrail::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("set-policy: missing input")?;
        policy::set_policy(&input)
    }

    fn check_policy(
        req: exports::z::credential_guardrail::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("check-policy: missing input")?;
        policy::check_policy(&input)
    }

    fn resolve_approval(
        req: exports::z::credential_guardrail::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("resolve-approval: missing input")?;
        policy::resolve_approval(&input)
    }

    fn list_pending(
        req: exports::z::credential_guardrail::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.unwrap_or_default();
        policy::list_pending(&input)
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
        assert_eq!(parts.len(), 3);
        for part in parts {
            assert!(part.parse::<u32>().is_ok());
        }
    }
}
