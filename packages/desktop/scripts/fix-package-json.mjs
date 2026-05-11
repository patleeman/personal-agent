#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
pkg.scripts['build:main'] =
  "esbuild src/main.ts --bundle --platform=node --format=esm --target=node20 --external:electron --external:fsevents --outfile=dist/main.js --banner:js=\"import process from 'node:process';import { createRequire } from 'node:module';const require=createRequire(import.meta.url);\"";
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
