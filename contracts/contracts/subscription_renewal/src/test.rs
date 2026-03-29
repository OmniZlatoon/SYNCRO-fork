use soroban_sdk::{
    contract, contractimpl, contracttype, contractevent,
    Address, Env, Symbol,
};

#[contracttype]
#[derive(Clone)]
pub struct Subscription {
    pub subscriber: Address,
    pub plan_id: Symbol,
    pub next_payment_time: u64,
    pub active: bool,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Subscription(Address),
}

#[contractevent]
pub struct SubscriptionCreated {
    pub subscriber: Address,
    pub plan_id: Symbol,
}

#[contractevent]
pub struct SubscriptionRenewed {
    pub subscriber: Address,
}

#[contract]
pub struct SubscriptionRenewal;

#[contractimpl]
impl SubscriptionRenewal {

    pub fn create_subscription(
        env: Env,
        subscriber: Address,
        plan_id: Symbol,
        next_payment_time: u64,
    ) {
        subscriber.require_auth();

        let subscription = Subscription {
            subscriber: subscriber.clone(),
            plan_id: plan_id.clone(),
            next_payment_time,
            active: true,
        };

        env.storage()
            .instance()
            .set(&DataKey::Subscription(subscriber.clone()), &subscription);

        SubscriptionCreated { subscriber, plan_id }.publish(&env);
    }

    pub fn renew_subscription(env: Env, subscriber: Address) {
        subscriber.require_auth();

        let key = DataKey::Subscription(subscriber.clone());
        let mut subscription: Subscription = env
            .storage()
            .instance()
            .get(&key)
            .unwrap();

        if !subscription.active {
            panic!("Subscription not active");
        }

        subscription.next_payment_time += 30 * 24 * 60 * 60;

        env.storage().instance().set(&key, &subscription);

        SubscriptionRenewed { subscriber }.publish(&env);
    }

    pub fn get_subscription(env: Env, subscriber: Address) -> Subscription {
        env.storage()
            .instance()
            .get(&DataKey::Subscription(subscriber))
            .unwrap()
    }
}
