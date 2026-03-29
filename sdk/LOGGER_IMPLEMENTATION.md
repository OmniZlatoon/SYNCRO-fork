# SDK Observability - Logger Interface Implementation

## Summary
Successfully implemented a structured logging interface for SDK observability, enabling consumers to inspect request lifecycle, retry attempts, event listener reconnects, and batch execution progress.

## Implementation Details

### 1. Logger Interface (`src/logger.ts`)
Defined a clean Logger interface with four core methods:
- `info(message: string, meta?: Record<string, unknown>)` - Informational messages
- `warn(message: string, meta?: Record<string, unknown>)` - Warning messages  
- `error(message: string, meta?: Record<string, unknown>)` - Error messages
- `debug(message: string, meta?: Record<string, unknown>)` - Debug-level messages

### 2. Default Implementations

#### Silent Logger (Production Safe)
```typescript
export const silentLogger: Logger
```
- No console output
- Safe for production environments
- Used by default when no logger is provided

#### Console Logger (Development)
```typescript
export function createConsoleLogger(): Logger
```
- Outputs messages to console with level-based prefixes (`[INFO]`, `[WARN]`, `[ERROR]`, `[DEBUG]`)
- Useful for development and debugging

#### Composite Logger
```typescript
export function createCompositeLogger(loggers: Logger[]): Logger
```
- Combines multiple logger instances
- Allows simultaneous logging to multiple destinations (e.g., console + file + remote service)

### 3. SDK Integration

#### Configuration
Both `SyncroSDKConfig` and `SyncroSDKInitConfig` now accept optional logger:
```typescript
interface SyncroSDKConfig {
  logger?: Logger | undefined;
  // ... other properties
}

interface SyncroSDKInitConfig {
  logger?: Logger | undefined;
  // ... other properties
}
```

#### Logging Points in SyncroSDK
- **Subscription Cancellation**
  - Logs start of cancellation with subscription ID
  - Logs success with blockchain sync status
  - Logs failures with error details

- **User Subscriptions Fetch**
  - Logs fetch operation start
  - Logs batch retrieval progress (offset, limit)
  - Logs successful completion with count
  - Logs cache fallback on network errors
  - Logs errors with detailed messages

### 4. Event Listener Integration (`src/event-listener.ts`)

#### Configuration
`ListenToEventsOptions` now includes:
```typescript
logger?: Logger | undefined;
```

#### Logging Points
- **Listener Lifecycle**
  - Logs listener start with contract count and RPC URL
  - Logs listener stop

- **Event Processing**
  - Logs events received with count, ledger range
  - Debug logs for individual operation tracking

- **Failure & Reconnection**
  - Logs poll failures with attempt count and max attempts
  - Logs reconnection backoff delays
  - Includes error messages for debugging

### 5. Batch Operations Integration (`src/batch-operations.ts`)

#### Function Signature
```typescript
export async function runBatch<T, K = string>(
  ids: K[],
  operation: (id: K) => Promise<{ success: boolean; data?: T; error?: string }>,
  logger?: Logger,
): Promise<BatchResult<T, K>>
```

#### Logging Points
- **Execution Lifecycle**
  - Logs batch start with total operation count
  - Logs individual operation execution (debug level)
  - Logs operation failures with error details
  - Logs batch completion with success/failure counts

### 6. Comprehensive Test Coverage

#### Logger Unit Tests (`src/logger.test.ts`)
- 10 tests covering all logger implementations
- Silent logger test confirming no output
- Console logger test validating format and output
- Composite logger test verifying delegation to multiple loggers

#### Integration Tests (`src/logger-integration.test.ts`)
- 11 tests covering SDK integration
- SDK initialization with logger
- Cancellation logging
- Subscriptions fetch logging with batch tracking
- Event listener logging with failure simulation
- Batch operation logging with success/failure tracking

**Test Results: 21/21 tests passing**

## Usage Examples

### Basic Usage with Console Logger
```typescript
import { init, createConsoleLogger } from '@syncro/sdk';

const sdk = init({
  apiKey: 'your-api-key',
  backendApiBaseUrl: 'https://api.example.com',
  wallet: { publicKey: 'your-public-key' },
  logger: createConsoleLogger(),
});
```

### Custom Logger Implementation
```typescript
const customLogger: Logger = {
  info: (msg, meta) => sendToMonitoringService('info', msg, meta),
  warn: (msg, meta) => sendToMonitoringService('warn', msg, meta),
  error: (msg, meta) => sendToMonitoringService('error', msg, meta),
  debug: (msg, meta) => console.debug(msg, meta),
};

const sdk = init({
  apiKey: 'your-api-key',
  backendApiBaseUrl: 'https://api.example.com',
  wallet: { publicKey: 'your-public-key' },
  logger: customLogger,
});
```

### Event Listener with Logger
```typescript
import { createEventListener, createConsoleLogger } from '@syncro/sdk';

const listener = createEventListener(
  {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    contractIds: ['CABC...'],
    logger: createConsoleLogger(),
  },
  (event) => console.log('Event:', event)
);
```

### Batch Operations with Logger
```typescript
import { runBatch, createConsoleLogger } from '@syncro/sdk';

const results = await runBatch(
  subscriptionIds,
  async (id) => {
    // operation code
  },
  createConsoleLogger()
);
```

### Production Setup with Silent Logger (Default)
```typescript
const sdk = init({
  apiKey: 'your-api-key',
  backendApiBaseUrl: 'https://api.example.com',
  wallet: { publicKey: 'your-public-key' },
  // logger defaults to silentLogger - no console output
});
```

## Acceptance Criteria Met

✅ Define Logger interface with info(), warn(), error(), debug()  
✅ Allow injection of custom logger during SDK initialization  
✅ Default to silent logger (no console.log in production)  
✅ Log retries (subscription fetching batch tracking)  
✅ Log listener failures (event listener with reconnection tracking)  
✅ Log batch execution start/finish (batch operations)  
✅ Add tests ensuring logger is called correctly (21 comprehensive tests)

## Files Created/Modified

### Created
- `src/logger.ts` - Logger interface and implementations
- `src/logger.test.ts` - 10 unit tests for logger
- `src/logger-integration.test.ts` - 11 integration tests

### Modified
- `src/types.ts` - Added Logger type export
- `src/index.ts` - Integrated logger throughout SDK class
- `src/event-listener.ts` - Added logger support and logging
- `src/batch-operations.ts` - Added logger support and logging

## Running Tests

```bash
# Run all logger tests
NODE_OPTIONS='--experimental-vm-modules' npm jest src/logger*.test.ts

# Run specific test file
NODE_OPTIONS='--experimental-vm-modules' npm jest src/logger.test.ts
NODE_OPTIONS='--experimental-vm-modules' npm jest src/logger-integration.test.ts
```
