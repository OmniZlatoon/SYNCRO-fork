#![no_std]

use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, vec, Address, Env, String, Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LogEvent {
    Reminder,
    Approval,
    Renewal,
    Failure,
    Retry,
    Cancellation,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LogEntry {
    pub sub_id: u64,
    pub event: LogEvent,
    pub timestamp: u64,
    pub data: String,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Logs(u64),
}

#[contractevent]
pub struct LogAppended {
    pub sub_id: u64,
    pub event: LogEvent,
}

#[contract]
pub struct SubscriptionLoggingContract;

#[contractimpl]
impl SubscriptionLoggingContract {
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
    }

    pub fn record_log(env: Env, sub_id: u64, event: LogEvent, data: String) {
        Self::require_admin(&env);

        let key = DataKey::Logs(sub_id);

        let mut logs: Vec<LogEntry> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(vec![&env]);

        let entry = LogEntry {
            sub_id,
            event: event.clone(),
            timestamp: env.ledger().timestamp(),
            data,
        };

        logs.push_back(entry);

        env.storage().persistent().set(&key, &logs);

        LogAppended { sub_id, event }.publish(&env);
    }

    pub fn get_logs(env: Env, sub_id: u64) -> Vec<LogEntry> {
        let key = DataKey::Logs(sub_id);

        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or(vec![&env])
    }
}

#[cfg(test)]
mod test;