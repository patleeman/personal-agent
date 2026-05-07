import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../client/api';
import type { ConversationAutoModeState, RunMode } from '../shared/types';

export interface UseConversationAutoModeCallbacks {
  ensureConversationIsLive: (actionDescription?: string) => Promise<string>;
  materializeDraftConversation: (options?: { enableAutoModeOnLoad?: boolean }) => Promise<string | undefined>;
  showNotice: (tone: 'accent' | 'danger', text: string, durationMs?: number) => void;
}

function createMissionInput(
  goal: string,
  maxTurns: number,
  existingTasks: Array<{ id: string; description: string; status: string }>,
  existingTurnsUsed: number,
) {
  return {
    goal: goal || 'Mission',
    tasks: existingTasks,
    maxTurns,
    turnsUsed: existingTurnsUsed,
  };
}

function createLoopInput(prompt: string, maxIterations: number, delay: string, existingIterationsUsed: number) {
  return {
    prompt: prompt || 'Run loop iteration',
    maxIterations,
    delay,
    iterationsUsed: existingIterationsUsed,
  };
}

export function useConversationAutoMode({
  id,
  draft,
  currentSurfaceId,
  conversationEventVersion,
  initialDraftHydrationState,
  externalAutoModeState,
  callbacks,
}: {
  id: string | null;
  draft: boolean | undefined;
  currentSurfaceId: string | undefined;
  conversationEventVersion: number;
  initialDraftHydrationState: { conversationId: string; enableAutoModeOnLoad?: boolean } | null;
  externalAutoModeState: ConversationAutoModeState | null | undefined;
  callbacks: UseConversationAutoModeCallbacks;
}) {
  const { ensureConversationIsLive, materializeDraftConversation, showNotice } = callbacks;

  // ── State ────────────────────────────────────────────────────────────────
  const [conversationAutoModeState, setConversationAutoModeStateRaw] = useState<ConversationAutoModeState | null>(null);
  const [conversationAutoModeBusy, setConversationAutoModeBusy] = useState(false);
  const [draftMissionConfig, setDraftMissionConfig] = useState<{ goal: string; maxTurns: number }>({ goal: '', maxTurns: 20 });
  const [draftLoopConfig, setDraftLoopConfig] = useState<{ prompt: string; maxIterations: number; delay: string }>({
    prompt: '',
    maxIterations: 5,
    delay: 'After each turn',
  });

  // Merge live-stream state with our fetched state
  const effectiveAutoModeState = externalAutoModeState ?? conversationAutoModeState;
  const autoModeEnabled = effectiveAutoModeState?.enabled === true;

  // ── Busy guard ref (avoids React 18 batching race) ───────────────────────
  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = conversationAutoModeBusy;
  }, [conversationAutoModeBusy]);

  // ── Draft sync refs ──────────────────────────────────────────────────────
  const lastSyncedMissionRef = useRef<string>('');
  const lastSyncedLoopRef = useRef<string>('');
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Initial fetch on mount / conversation change ─────────────────────────
  useEffect(() => {
    if (draft) {
      setConversationAutoModeStateRaw(null);
      setConversationAutoModeBusy(false);
      return;
    }

    if (!id) {
      setConversationAutoModeStateRaw({ enabled: false, mode: 'manual', stopReason: null, updatedAt: null });
      return;
    }

    let cancelled = false;
    api
      .conversationAutoMode(id)
      .then((data) => {
        if (!cancelled) {
          setConversationAutoModeStateRaw(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConversationAutoModeStateRaw({ enabled: false, mode: 'manual', stopReason: null, updatedAt: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [conversationEventVersion, draft, id]);

  // ── enableAutoModeOnLoad side effect ─────────────────────────────────────
  useEffect(() => {
    if (draft || !id || !initialDraftHydrationState?.enableAutoModeOnLoad) {
      return;
    }

    setConversationAutoModeBusy(true);
    api
      .updateConversationAutoMode(id, { enabled: true }, currentSurfaceId)
      .then((nextState) => {
        setConversationAutoModeStateRaw(nextState);
      })
      .catch((error) => {
        showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
      })
      .finally(() => {
        setConversationAutoModeBusy(false);
      });
    // Intentionally run only when the hook is first created with a new
    // id/initialDraftHydrationState — not on every render.
  }, [id, initialDraftHydrationState?.enableAutoModeOnLoad === true]);

  // ── Debounced draft config → API sync ────────────────────────────────────
  useEffect(() => {
    if (!id || conversationAutoModeBusy) {
      return;
    }

    const mode = effectiveAutoModeState?.mode;
    if (mode === 'mission') {
      const serialized = JSON.stringify(draftMissionConfig);
      if (serialized === lastSyncedMissionRef.current) {
        return;
      }
      lastSyncedMissionRef.current = serialized;
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        syncTimerRef.current = null;
        if (!id || !effectiveAutoModeState?.enabled) return;
        void api
          .updateConversationAutoMode(id, {
            mode: 'mission',
            mission: createMissionInput(
              draftMissionConfig.goal,
              draftMissionConfig.maxTurns,
              effectiveAutoModeState?.mission?.tasks ?? [],
              effectiveAutoModeState?.mission?.turnsUsed ?? 0,
            ),
          })
          .then(setConversationAutoModeStateRaw)
          .catch(() => undefined);
      }, 500);
    } else if (mode === 'loop') {
      const serialized = JSON.stringify(draftLoopConfig);
      if (serialized === lastSyncedLoopRef.current) {
        return;
      }
      lastSyncedLoopRef.current = serialized;
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        syncTimerRef.current = null;
        if (!id || !effectiveAutoModeState?.enabled) return;
        void api
          .updateConversationAutoMode(id, {
            mode: 'loop',
            loop: createLoopInput(
              draftLoopConfig.prompt,
              draftLoopConfig.maxIterations,
              draftLoopConfig.delay,
              effectiveAutoModeState?.loop?.iterationsUsed ?? 0,
            ),
          })
          .then(setConversationAutoModeStateRaw)
          .catch(() => undefined);
      }, 500);
    }

    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [draftMissionConfig, draftLoopConfig, id, conversationAutoModeBusy, effectiveAutoModeState]);

  // ── toggle: manual ↔ nudge ───────────────────────────────────────────────
  const toggleAutoMode = useCallback(async () => {
    if (busyRef.current) {
      return;
    }

    const nextEnabled = !effectiveAutoModeState?.enabled;
    setConversationAutoModeBusy(true);

    try {
      if (draft) {
        if (!nextEnabled) {
          return;
        }

        await materializeDraftConversation({ enableAutoModeOnLoad: true });
        return;
      }

      if (!id) {
        return;
      }

      const targetConversationId = nextEnabled ? await ensureConversationIsLive('enable auto mode') : id;
      const nextState = await api.updateConversationAutoMode(targetConversationId, { enabled: nextEnabled }, currentSurfaceId);

      if (targetConversationId === id) {
        setConversationAutoModeStateRaw(nextState);
      }
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    } finally {
      setConversationAutoModeBusy(false);
    }
  }, [effectiveAutoModeState, draft, id, currentSurfaceId, ensureConversationIsLive, materializeDraftConversation, showNotice]);

  // ── select mode: manual/nudge/mission/loop ───────────────────────────────
  const selectMode = useCallback(
    async (nextMode: RunMode) => {
      if (busyRef.current) {
        return;
      }

      setConversationAutoModeBusy(true);

      try {
        if (draft) {
          if (nextMode === 'manual') {
            return;
          }

          await materializeDraftConversation({ enableAutoModeOnLoad: true });
          return;
        }

        if (!id) {
          return;
        }

        const needsLive = nextMode !== 'manual';
        const targetConversationId = needsLive ? await ensureConversationIsLive('set run mode') : id;

        const input: Record<string, unknown> = { mode: nextMode };
        if (nextMode === 'mission') {
          const goal = draftMissionConfig.goal.trim();
          input.mission = {
            goal: goal || 'Mission',
            tasks: [],
            maxTurns: draftMissionConfig.maxTurns,
            turnsUsed: 0,
          };
        } else if (nextMode === 'loop') {
          input.loop = {
            prompt: draftLoopConfig.prompt || 'Run loop iteration',
            maxIterations: draftLoopConfig.maxIterations,
            iterationsUsed: 0,
            delay: draftLoopConfig.delay,
          };
        }

        const nextState = await api.updateConversationAutoMode(targetConversationId, input, currentSurfaceId);

        if (targetConversationId === id) {
          setConversationAutoModeStateRaw(nextState);
        }
      } catch (error) {
        showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
      } finally {
        setConversationAutoModeBusy(false);
      }
    },
    [draft, id, currentSurfaceId, draftMissionConfig, draftLoopConfig, ensureConversationIsLive, materializeDraftConversation, showNotice],
  );

  return useMemo(
    () => ({
      effectiveAutoModeState,
      autoModeEnabled,
      autoModeBusy: conversationAutoModeBusy,
      draftMissionConfig,
      draftLoopConfig,
      setDraftMissionConfig,
      setDraftLoopConfig,
      toggleAutoMode,
      selectMode,
    }),
    [effectiveAutoModeState, autoModeEnabled, conversationAutoModeBusy, draftMissionConfig, draftLoopConfig, toggleAutoMode, selectMode],
  );
}
