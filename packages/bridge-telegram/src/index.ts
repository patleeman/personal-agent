import { hello } from '@personal-agent/core';

export function telegramHello(): string {
  return `${hello()} - telegram bridge`;
}
