'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const SUITES = [
  'test-ssrf-guard.js',
  'test-signal-extraction.js',
  'test-scoring.js',
  'test-audit-engine.js',
  'test-rate-limit.js',
  'test-email.js',
  'test-api-handlers.js',
];

let failures = 0;

for (const suite of SUITES) {
  console.log('\n########################################');
  console.log('# ' + suite);
  console.log('########################################');
  try {
    execFileSync(process.execPath, [path.join(__dirname, suite)], { stdio: 'inherit' });
  } catch (e) {
    failures++;
  }
}

console.log('\n========================================');
if (failures === 0) {
  console.log('ALL SUITES PASSED');
} else {
  console.log(failures + ' SUITE(S) FAILED');
}
process.exit(failures > 0 ? 1 : 0);
