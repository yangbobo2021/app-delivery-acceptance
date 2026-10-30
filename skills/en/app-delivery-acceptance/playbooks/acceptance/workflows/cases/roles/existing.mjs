// Same Agent runtime, debugging and output protocol; only existing tests are allowed.
process.argv.push('--existing-only');
await import('./implement.mjs');
