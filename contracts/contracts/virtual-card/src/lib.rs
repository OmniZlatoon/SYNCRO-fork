#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Card(u64),
    CardCount,
}

// ── Data types ────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CardStatus {
    Active,
    Revoked,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct VirtualCard {
    pub id: u64,
    pub holder: Address,
    pub issued_at: u64,
    pub expires_at: u64,
    pub status: CardStatus,
    pub reference: String,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct VirtualCardContract;

#[contractimpl]
impl VirtualCardContract {
    /// Issue a new virtual card to `holder`.
    /// Returns the new card's ID.
    pub fn issue_card(
        env: Env,
        holder: Address,
        expires_at: u64,
        reference: String,
    ) -> u64 {
        holder.require_auth();

        let count: u64 = env.storage().instance().get(&DataKey::CardCount).unwrap_or(0);
        let card_id = count + 1;

        let card = VirtualCard {
            id: card_id,
            holder: holder.clone(),
            issued_at: env.ledger().timestamp(),
            expires_at,
            status: CardStatus::Active,
            reference,
        };

        env.storage().instance().set(&DataKey::Card(card_id), &card);
        env.storage().instance().set(&DataKey::CardCount, &card_id);

        env.events().publish(
            (soroban_sdk::symbol_short!("issued"),),
            (card_id, holder),
        );

        card_id
    }

    /// Revoke a card. Only the card holder may revoke their own card.
    pub fn revoke_card(env: Env, card_id: u64) {
        let mut card: VirtualCard = env
            .storage()
            .instance()
            .get(&DataKey::Card(card_id))
            .expect("card not found");

        card.holder.require_auth();

        if card.status == CardStatus::Revoked {
            panic!("card already revoked");
        }

        card.status = CardStatus::Revoked;
        env.storage().instance().set(&DataKey::Card(card_id), &card);

        env.events().publish(
            (soroban_sdk::symbol_short!("revoked"),),
            (card_id, card.holder),
        );
    }

    /// Get card details.
    pub fn get_card(env: Env, card_id: u64) -> VirtualCard {
        env.storage()
            .instance()
            .get(&DataKey::Card(card_id))
            .expect("card not found")
    }

    /// Check whether a card is currently active and not expired.
    pub fn is_active(env: Env, card_id: u64) -> bool {
        let card: VirtualCard = env
            .storage()
            .instance()
            .get(&DataKey::Card(card_id))
            .expect("card not found");

        card.status == CardStatus::Active && env.ledger().timestamp() < card.expires_at
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    fn setup() -> (Env, VirtualCardContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, VirtualCardContract);
        let client = VirtualCardContractClient::new(&env, &contract_id);
        (env, client)
    }

    #[test]
    fn test_issue_card() {
        let (env, client) = setup();
        let holder = Address::generate(&env);
        let reference = soroban_sdk::String::from_str(&env, "CARD-001");

        let card_id = client.issue_card(&holder, &(env.ledger().timestamp() + 3600), &reference);
        assert_eq!(card_id, 1);

        let card = client.get_card(&card_id);
        assert_eq!(card.holder, holder);
        assert_eq!(card.status, CardStatus::Active);
    }

    #[test]
    fn test_revoke_card() {
        let (env, client) = setup();
        let holder = Address::generate(&env);
        let reference = soroban_sdk::String::from_str(&env, "CARD-002");

        let card_id = client.issue_card(&holder, &(env.ledger().timestamp() + 3600), &reference);
        client.revoke_card(&card_id);

        let card = client.get_card(&card_id);
        assert_eq!(card.status, CardStatus::Revoked);
    }

    #[test]
    #[should_panic(expected = "card already revoked")]
    fn test_revoke_already_revoked() {
        let (env, client) = setup();
        let holder = Address::generate(&env);
        let reference = soroban_sdk::String::from_str(&env, "CARD-003");

        let card_id = client.issue_card(&holder, &(env.ledger().timestamp() + 3600), &reference);
        client.revoke_card(&card_id);
        client.revoke_card(&card_id); // should panic
    }

    #[test]
    fn test_is_active_returns_false_after_revoke() {
        let (env, client) = setup();
        let holder = Address::generate(&env);
        let reference = soroban_sdk::String::from_str(&env, "CARD-004");

        let card_id = client.issue_card(&holder, &(env.ledger().timestamp() + 3600), &reference);
        assert!(client.is_active(&card_id));

        client.revoke_card(&card_id);
        assert!(!client.is_active(&card_id));
    }

    #[test]
    fn test_is_active_returns_false_when_expired() {
        let (env, client) = setup();
        let holder = Address::generate(&env);
        let reference = soroban_sdk::String::from_str(&env, "CARD-005");

        // expires_at in the past
        let card_id = client.issue_card(&holder, &0u64, &reference);
        assert!(!client.is_active(&card_id));
    }

    #[test]
    fn test_multiple_cards_independent() {
        let (env, client) = setup();
        let holder1 = Address::generate(&env);
        let holder2 = Address::generate(&env);
        let ref1 = soroban_sdk::String::from_str(&env, "CARD-A");
        let ref2 = soroban_sdk::String::from_str(&env, "CARD-B");

        let id1 = client.issue_card(&holder1, &(env.ledger().timestamp() + 3600), &ref1);
        let id2 = client.issue_card(&holder2, &(env.ledger().timestamp() + 3600), &ref2);

        assert_eq!(id1, 1);
        assert_eq!(id2, 2);

        client.revoke_card(&id1);
        // id2 should still be active
        assert!(client.is_active(&id2));
        assert!(!client.is_active(&id1));
    }
}
