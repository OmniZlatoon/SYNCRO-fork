import { DynamicModule, Module } from '@nestjs/common';
import { BatchService } from './batch.service';
import { BatchConfig, DEFAULT_BATCH_CONFIG, validateBatchConfig } from '../config/batch.config';

export const BATCH_CONFIG = Symbol('BATCH_CONFIG');

@Module({})
export class BatchModule {
  /**
   * Register with default concurrency (10).
   */
  static register(): DynamicModule {
    return {
      module: BatchModule,
      providers: [
        { provide: BATCH_CONFIG, useValue: DEFAULT_BATCH_CONFIG },
        BatchService,
      ],
      exports: [BatchService],
    };
  }

  /**
   * Register with a custom concurrency limit.
   *
   * @example
   * BatchModule.registerWithConfig({ concurrency: 25 })
   */
  static registerWithConfig(config: Partial<BatchConfig>): DynamicModule {
    const validated = validateBatchConfig(config);
    return {
      module: BatchModule,
      providers: [
        { provide: BATCH_CONFIG, useValue: validated },
        BatchService,
      ],
      exports: [BatchService],
    };
  }
}
