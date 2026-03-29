import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import {
  silentLogger,
  createConsoleLogger,
  createCompositeLogger,
  type Logger,
} from "./logger.js";

describe("Logger", () => {
  describe("silentLogger", () => {
    it("should not throw when calling any method", () => {
      expect(() => {
        silentLogger.info("test message");
        silentLogger.warn("test warning");
        silentLogger.error("test error");
        silentLogger.debug("test debug");
      }).not.toThrow();
    });

    it("should accept metadata", () => {
      expect(() => {
        silentLogger.info("test", { key: "value", number: 123 });
        silentLogger.warn("test", { foo: "bar" });
        silentLogger.error("test", { status: 500 });
        silentLogger.debug("test", { level: "deep" });
      }).not.toThrow();
    });
  });

  describe("createConsoleLogger", () => {
    let logger: Logger;
    const originalConsole = { ...console };

    beforeEach(() => {
      logger = createConsoleLogger();
      // Mock console methods
      console.log = jest.fn();
      console.warn = jest.fn();
      console.error = jest.fn();
      console.debug = jest.fn();
    });

    afterEach(() => {
      // Restore original console
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
      console.debug = originalConsole.debug;
    });

    it("should log info messages to console.log", () => {
      logger.info("test message", { key: "value" });
      expect(console.log).toHaveBeenCalledWith(
        "[INFO] test message",
        { key: "value" }
      );
    });

    it("should log warn messages to console.warn", () => {
      logger.warn("test warning", { code: 404 });
      expect(console.warn).toHaveBeenCalledWith(
        "[WARN] test warning",
        { code: 404 }
      );
    });

    it("should log error messages to console.error", () => {
      logger.error("test error", { status: 500 });
      expect(console.error).toHaveBeenCalledWith(
        "[ERROR] test error",
        { status: 500 }
      );
    });

    it("should log debug messages to console.debug", () => {
      logger.debug("test debug", { details: "verbose" });
      expect(console.debug).toHaveBeenCalledWith(
        "[DEBUG] test debug",
        { details: "verbose" }
      );
    });

    it("should log without metadata", () => {
      logger.info("message without metadata");
      expect(console.log).toHaveBeenCalledWith("[INFO] message without metadata", "");
    });
  });

  describe("createCompositeLogger", () => {
    it("should delegate to all loggers in the array", () => {
      const logger1 = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      } as Logger;

      const logger2 = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      } as Logger;

      const composite = createCompositeLogger([logger1, logger2]);

      const message = "test message";
      const meta = { key: "value" };

      composite.info(message, meta);
      expect(logger1.info).toHaveBeenCalledWith(message, meta);
      expect(logger2.info).toHaveBeenCalledWith(message, meta);

      composite.warn(message, meta);
      expect(logger1.warn).toHaveBeenCalledWith(message, meta);
      expect(logger2.warn).toHaveBeenCalledWith(message, meta);

      composite.error(message, meta);
      expect(logger1.error).toHaveBeenCalledWith(message, meta);
      expect(logger2.error).toHaveBeenCalledWith(message, meta);

      composite.debug(message, meta);
      expect(logger1.debug).toHaveBeenCalledWith(message, meta);
      expect(logger2.debug).toHaveBeenCalledWith(message, meta);
    });

    it("should work with empty logger array", () => {
      const composite = createCompositeLogger([]);
      expect(() => {
        composite.info("test");
        composite.warn("test");
        composite.error("test");
        composite.debug("test");
      }).not.toThrow();
    });

    it("should work with single logger", () => {
      const logger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      } as Logger;

      const composite = createCompositeLogger([logger]);

      composite.info("message");
      expect(logger.info).toHaveBeenCalledWith("message", undefined);
    });
  });
});
