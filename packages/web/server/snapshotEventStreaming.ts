export interface StreamSnapshotEventsOptions<TTopic, TEvent> {
  buildEvents: (topic: TTopic) => Promise<readonly TEvent[] | TEvent | null | undefined> | readonly TEvent[] | TEvent | null | undefined;
  writeEvent: (event: TEvent) => void;
}

export async function streamSnapshotEvents<TTopic, TEvent>(
  topics: readonly TTopic[],
  options: StreamSnapshotEventsOptions<TTopic, TEvent>,
): Promise<void> {
  const seen = new Set<TTopic>();

  for (const topic of topics) {
    if (seen.has(topic)) {
      continue;
    }
    seen.add(topic);

    const builtEvents = await options.buildEvents(topic);
    if (!builtEvents) {
      continue;
    }

    if (Array.isArray(builtEvents)) {
      for (const event of builtEvents) {
        options.writeEvent(event);
      }
      continue;
    }

    options.writeEvent(builtEvents);
  }
}
