#!/usr/bin/env node
// CLI locale formatter — emits a DeprecationWarning on every run.
const args = process.argv.slice(2);
const locale = args.find(a => a.startsWith('--locale='))?.split('=')[1] ?? 'en';

// Simulates a transitive DeprecationWarning from a dependency.
// Always fires unless NODE_NO_WARNINGS=1 or --no-deprecation is set.
process.emitWarning(
  'The --locale flag is deprecated. Use --language instead.',
  'DeprecationWarning'
);

const formatted = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date());
console.log(`Locale: ${locale}`);
console.log(`Date: ${formatted}`);
