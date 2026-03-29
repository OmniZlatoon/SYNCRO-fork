# Stellar Wallet Connection Service

## Overview
Provides seamless wallet connection and signature handling for Stellar blockchain interactions.

## Features
- ✅ Connect/disconnect Freighter wallet
- ✅ Verify signatures for contract calls
- ✅ Session storage persistence
- ✅ Event-driven architecture
- ✅ TypeScript support

## Usage

### Service (Vanilla JS/TS)

```typescript
import { stellarWallet } from '@/lib/stellar-wallet';

// Connect wallet
const wallet = await stellarWallet.connect('testnet');
console.log(wallet.publicKey); // G...

// Check connection
if (stellarWallet.isConnected()) {
  const info = stellarWallet.getWallet();
}

// Sign transaction
const signedXdr = await stellarWallet.signTransaction(xdr);

// Listen to events
const unsubscribe = stellarWallet.on('walletConnected', (info) => {
  console.log('Connected:', info?.publicKey);
});

// Disconnect
stellarWallet.disconnect();
```

### React Hook

```typescript
import { useWallet } from '@/hooks/use-wallet';

function MyComponent() {
  const { wallet, isConnected, isConnecting, error, connect, disconnect, signTransaction } = useWallet();

  return (
    <div>
      {!isConnected ? (
        <button onClick={() => connect('testnet')} disabled={isConnecting}>
          {isConnecting ? 'Connecting...' : 'Connect Wallet'}
        </button>
      ) : (
        <>
          <p>Connected: {wallet?.publicKey}</p>
          <button onClick={disconnect}>Disconnect</button>
        </>
      )}
      {error && <p>Error: {error}</p>}
    </div>
  );
}
```

## API

### StellarWalletService

#### Methods
- `connect(network)` - Connect to Freighter wallet
- `disconnect()` - Disconnect wallet and clear session
- `getWallet()` - Get current wallet info
- `isConnected()` - Check if wallet is connected
- `signTransaction(xdr)` - Sign transaction XDR
- `on(event, handler)` - Subscribe to events
- `off(event, handler)` - Unsubscribe from events

#### Events
- `walletConnected` - Emitted when wallet connects
- `walletDisconnected` - Emitted when wallet disconnects

#### Types
```typescript
type WalletInfo = {
  publicKey: string;
  network: 'testnet' | 'mainnet';
  connectedAt: number;
};
```

## Requirements
- Freighter wallet browser extension
- Browser environment (uses sessionStorage)

## Session Storage
Wallet connection persists across page reloads using sessionStorage with key `stellar_wallet_session`.
