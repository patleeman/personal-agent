#!/usr/bin/env node
import { hello } from '@personal-agent/core';

function main(): void {
  console.log(hello());
  console.log('Hello from CLI');
}

main();
