import { SCHEMA_VERSION } from '@personal-agent/core';

export function telegramHello(): string {
  return `Telegram bridge using schema ${SCHEMA_VERSION}`;
}
