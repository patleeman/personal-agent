import { SCHEMA_VERSION, mergeProfiles } from '@personal-agent/core';

function main(): void {
  console.log(`CLI using schema ${SCHEMA_VERSION}`);
  
  // Example: merge a sample profile
  const profile = mergeProfiles({
    shared: { name: 'CLI User' },
  });
  console.log(`Loaded profile: ${profile.name}`);
}

main();
