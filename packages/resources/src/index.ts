import { hello } from '@personal-agent/core';

export function resourcesHello(): string {
  return `${hello()} - resources`;
}
