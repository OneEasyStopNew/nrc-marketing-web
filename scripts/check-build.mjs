// Checks a production build in dist/ before it is deployed (NRC-27):
// no source maps, no simulation code or dummy data, no obvious secrets.
// Run after `npm run build`: `npm run check:build`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(DIST);

const problems = [];
if (files.some((f) => f.endsWith('.map'))) problems.push('Source maps are present in dist/.');

const FORBIDDEN = [
  [/sim-cr-\d|SIM-FACTS|example\.test|mockFetch|Simulation tools|__sim\//, 'simulation code or dummy data'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/client_secret\s*[:=]\s*["'][^"']+["']/i, 'a client secret'],
  [/AKIA[0-9A-Z]{16}/, 'an AWS access key id'],
];
for (const f of files.filter((x) => /\.(js|html|css)$/.test(x))) {
  const text = readFileSync(f, 'utf8');
  for (const [re, what] of FORBIDDEN) if (re.test(text)) problems.push(`${f} contains ${what}.`);
}

const js = files.filter((f) => f.endsWith('.js')).map((f) => [f, statSync(f).size]).sort((a, b) => b[1] - a[1]);
console.log('JavaScript files (largest first):');
for (const [f, size] of js) console.log(`  ${(size / 1024).toFixed(1).padStart(7)} kB  ${f}`);

if (problems.length) {
  console.error('\nBuild check failed:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\nBuild check passed: no source maps, simulation code, dummy data or obvious secrets.');
