import { SCHEMA_VERSION } from '@personal-agent/core';

export function resourcesHello(): string {
  return `Resources using schema ${SCHEMA_VERSION}`;
}
