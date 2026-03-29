import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Logger } from "./types.js";

const mAxios = {
  get: jest.fn(),
  post: jest.fn(),
  delete: jest.fn(),
  patch: jest.fn(),
  create: jest.fn().mockReturnThis(),
};

// We must mock axios BEFORE importing the SDK
jest.unstable_mockModule("axios", () => ({
  default: mAxios,
  ...mAxios,
}));

const { SyncroSDK, init } = await import("./index.js");
const axios = (await import("axios")).default as any;

describe("Logger Integration", () => {
  let mockLogger: Logger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
  });

  describe("SyncroSDK with logger", () => {
    it("should accept logger in constructor", () => {
      const sdk = new SyncroSDK({
        apiKey: "test-key",
        logger: mockLogger,
      });
      sdk.on("error", () => {});

      expect(sdk).toBeDefined();
    });

    it("should use silent logger by default", () => {
      const sdk = new SyncroSDK({
        apiKey: "test-key",
      });
      sdk.on("error", () => {});

      expect(sdk).toBeDefined();
      // Should not throw with no logger
    });

    it("should log cancellation start and success", async () => {
      const sdk = new SyncroSDK({
        apiKey: "test-key",
        logger: mockLogger,
      });
      sdk.on("error", () => {});

      const mockResponse = {
        data: {
          success: true,
          data: {
            id: "sub-123",
            name: "Netflix",
            status: "cancelled",
          },
          blockchain: {
            synced: true,
          },
        },
      };

      axios.post.mockResolvedValueOnce(mockResponse);

      const result = await sdk.cancelSubscription("sub-123");

      expect(result.success).toBe(true);
      expect((mockLogger.info as any).mock.calls).toContainEqual(
        expect.arrayContaining([
          expect.stringContaining("Starting subscription cancellation"),
        ])
      );
      expect((mockLogger.info as any).mock.calls).toContainEqual(
        expect.arrayContaining([
          expect.stringContaining("Subscription cancelled successfully"),
        ])
      );
    });

    it("should log cancellation failure", async () => {
      const sdk = new SyncroSDK({
        apiKey: "test-key",
        logger: mockLogger,
      });
      sdk.on("error", () => {});

      const error = new Error("Network error");
      (error as any).response = {
        data: { error: "Failed to cancel" },
      };

      axios.post.mockRejectedValueOnce(error);

      try {
        await sdk.cancelSubscription("sub-123");
      } catch (e) {
        // Expected
      }

      expect((mockLogger.error as any).mock.calls.length).toBeGreaterThan(0);
    });

    it("should log user subscriptions fetch start and finish", async () => {
      const sdk = new SyncroSDK({
        apiKey: "test-key",
        logger: mockLogger,
      });
      sdk.on("error", () => {});

      const mockResponse = {
        data: {
          data: [
            {
              id: "sub-1",
              name: "Netflix",
              status: "active",
            },
          ],
          pagination: { total: 1 },
        },
      };

      axios.get.mockResolvedValueOnce(mockResponse);

      const result = await sdk.getUserSubscriptions();

      expect(result).toBeDefined();
      expect((mockLogger.info as any).mock.calls.length).toBeGreaterThan(0);
      const calls = (mockLogger.info as any).mock.calls.map((call: any[]) => call[0]);
      expect(calls).toContain("Fetching user subscriptions");
      expect(calls).toContain("User subscriptions fetched successfully");
    });

    it("should log debug info for subscription batches", async () => {
      const sdk = new SyncroSDK({
        apiKey: "test-key",
        logger: mockLogger,
      });
      sdk.on("error", () => {});

      const mockResponse = {
        data: {
          data: Array(50)
            .fill(null)
            .map((_, i) => ({
              id: `sub-${i}`,
              name: `Service ${i}`,
              status: "active",
            })),
          pagination: { total: 100 },
        },
      };

      axios.get
        .mockResolvedValueOnce(mockResponse)
        .mockResolvedValueOnce({ data: { data: [], pagination: { total: 100 } } });

      await sdk.getUserSubscriptions();

      expect((mockLogger.debug as any).mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe("init function with logger", () => {
    it("should pass logger to SDK during initialization", () => {
      const sdk = init({
        apiKey: "test-key",
        backendApiBaseUrl: "http://localhost:3001/api",
        wallet: { publicKey: "test-public-key" },
        logger: mockLogger,
      });

      sdk.on("error", () => {});
      expect(sdk).toBeDefined();
    });
  });

  describe("Event Listener with logger", () => {
    it("should accept logger in options", async () => {
      const { createEventListener } = await import("./event-listener.js");

      const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      } as unknown as Logger;

      const listener = createEventListener(
        {
          rpcUrl: "http://localhost:8000",
          contractIds: ["contract-1"],
          logger: mockLogger,
        },
        () => {}
      );

      // Check logger was called
      expect((mockLogger.info as any).mock.calls.length).toBeGreaterThan(0);

      listener.stop();
    });

    it("should log listener failures and reconnection attempts", async () => {
      const { createEventListener } = await import("./event-listener.js");

      const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      } as unknown as Logger;

      // Mock fetch globally to simulate RPC failures
      const originalFetch = global.fetch;
      let callCount = 0;
      (global as any).fetch = jest.fn(async () => {
        callCount++;
        // Simulate failure on the first few calls
        if (callCount <= 2) {
          throw new Error("Network error");
        }
        // After 2 failures, return valid response
        return {
          json: async () => ({
            result: { sequence: 100 },
          }),
        };
      });

      const listener = createEventListener(
        {
          rpcUrl: "http://localhost:8000",
          contractIds: ["contract-1"],
          logger: mockLogger,
          maxReconnectAttempts: 3,
          reconnectDelayMs: 50,
          pollIntervalMs: 50,
        },
        () => {},
        () => {}
      );

      // Allow time for poll attempts
      await new Promise((resolve) => setTimeout(resolve, 300));

      listener.stop();

      // Restore original fetch
      (global as any).fetch = originalFetch;

      // Should have logged warnings for failures
      const warnCalls = (mockLogger.warn as any).mock.calls;
      expect(warnCalls.length).toBeGreaterThan(0);
      expect(warnCalls.some((call: any[]) => 
        call[0].includes("Event listener poll failed")
      )).toBe(true);
    });
  });

  describe("Batch Operations with logger", () => {
    it("should log batch execution start, operations, and completion", async () => {
      const { runBatch } = await import("./batch-operations.js");

      const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      } as unknown as Logger;

      const ids = ["1", "2", "3"];
      const results = await runBatch(
        ids,
        async (id) => ({
          success: true,
          data: `result-${id}`,
        }),
        mockLogger
      );

      expect(results.successCount).toBe(3);

      // Check start logging
      expect((mockLogger.info as any).mock.calls).toContainEqual(
        expect.arrayContaining([
          expect.stringContaining("Batch execution starting"),
        ])
      );

      // Check completion logging
      expect((mockLogger.info as any).mock.calls).toContainEqual(
        expect.arrayContaining([
          expect.stringContaining("Batch execution completed"),
        ])
      );

      // Check individual operation logging
      expect((mockLogger.debug as any).mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it("should log batch failures", async () => {
      const { runBatch } = await import("./batch-operations.js");

      const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      } as unknown as Logger;

      const ids = ["1", "2", "3"];
      const results = await runBatch(
        ids,
        async (id) => {
          if (id === "2") {
            throw new Error("Operation failed");
          }
          return { success: true, data: `result-${id}` };
        },
        mockLogger
      );

      expect(results.failureCount).toBe(1);
      expect((mockLogger.error as any).mock.calls.length).toBeGreaterThan(0);

      // Check completion logging shows failure count
      expect((mockLogger.info as any).mock.calls).toContainEqual(
        expect.arrayContaining([
          expect.objectContaining({
            failureCount: 1,
          }),
        ])
      );
    });
  });
});
