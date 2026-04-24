/**
 * Exports the OpenAPI spec to openapi.json
 * Run with: npx ts-node scripts/export-swagger.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { swaggerSpec } from '../src/swagger';

const outputPath = path.join(__dirname, '..', 'openapi.json');
fs.writeFileSync(outputPath, JSON.stringify(swaggerSpec, null, 2));
console.log(`OpenAPI spec exported to ${outputPath}`);
