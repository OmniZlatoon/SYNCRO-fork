#!/bin/bash
set -e

# Usage: init.sh <network> <secret_key> <renewal_contract_id> <logging_contract_id>
# Can be run standalone after deploy.sh, or called by deploy.sh automatically.

NETWORK=${1:-testnet}
SECRET_KEY=${2:-${STELLAR_SECRET_KEY:?'STELLAR_SECRET_KEY required'}}
RENEWAL_ID=${3:-${SOROBAN_RENEWAL_ADDRESS:?'SOROBAN_RENEWAL_ADDRESS required'}}
LOGGING_ID=${4:-${SOROBAN_LOGGING_ADDRESS:?'SOROBAN_LOGGING_ADDRESS required'}}

# Resolve admin address from the deployer key
ADMIN_ADDRESS=$(stellar keys address "$SECRET_KEY" 2>/dev/null || \
  stellar keys show "$SECRET_KEY" --network "$NETWORK" | grep -oP 'G[A-Z0-9]{55}' | head -1)

echo "==> Initializing contracts on $NETWORK"
echo "    Admin: $ADMIN_ADDRESS"

# Initialize SubscriptionRenewal with admin address
echo "  Initializing SubscriptionRenewal..."
stellar contract invoke \
  --id "$RENEWAL_ID" \
  --source "$SECRET_KEY" \
  --network "$NETWORK" \
  -- init \
  --admin "$ADMIN_ADDRESS"
echo "  SubscriptionRenewal initialized."

# Initialize SubscriptionLogging with admin address
echo "  Initializing SubscriptionLogging..."
stellar contract invoke \
  --id "$LOGGING_ID" \
  --source "$SECRET_KEY" \
  --network "$NETWORK" \
  -- init \
  --admin "$ADMIN_ADDRESS"
echo "  SubscriptionLogging initialized."

# Wire the logging contract address into the renewal contract
echo "  Linking logging contract to renewal contract..."
stellar contract invoke \
  --id "$RENEWAL_ID" \
  --source "$SECRET_KEY" \
  --network "$NETWORK" \
  -- set_logging_contract \
  --address "$LOGGING_ID"
echo "  Logging contract linked."

echo ""
echo "==> Initialization complete."
