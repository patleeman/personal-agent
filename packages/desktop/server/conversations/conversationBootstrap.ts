import {
  listAllLiveSessions,
  readConversationSessionSignature,
  readSessionDetailForRoute,
  toPublicLiveSessionMeta,
} from './conversationService.js';
import { buildAppendOnlySessionDetailResponse } from './sessions.js';

type ConversationBootstrapRemoteMirrorTelemetry = Awaited<ReturnType<typeof readSessionDetailForRoute>>['remoteMirror'];
type ConversationBootstrapSessionReadTelemetry = Awaited<ReturnType<typeof readSessionDetailForRoute>>['sessionRead']['telemetry'];

export interface ReadConversationBootstrapStateInput {
  conversationId: string;
  profile: string;
  tailBlocks?: number;
  knownSessionSignature?: string;
  knownBlockOffset?: number;
  knownTotalBlocks?: number;
  knownLastBlockId?: string;
}

export interface ReadConversationBootstrapStateResult {
  state: {
    conversationId: string;
    sessionDetail: Awaited<ReturnType<typeof readSessionDetailForRoute>>['sessionRead']['detail'];
    sessionDetailSignature?: string | null;
    sessionDetailUnchanged?: boolean;
    sessionDetailAppendOnly?: ReturnType<typeof buildAppendOnlySessionDetailResponse>;
    liveSession: ({ live: true } & ReturnType<typeof toPublicLiveSessionMeta>) | { live: false };
    integrityWarning?: boolean;
  };
  telemetry: {
    sessionRead: ConversationBootstrapSessionReadTelemetry;
    sessionDetailReused: boolean;
    remoteMirror: ConversationBootstrapRemoteMirrorTelemetry;
  };
}

export function isMissingConversationBootstrapState(state: ReadConversationBootstrapStateResult['state']): boolean {
  return !state.sessionDetail && !state.sessionDetailUnchanged && !state.sessionDetailAppendOnly && !state.liveSession.live;
}

export async function readConversationBootstrapState(
  input: ReadConversationBootstrapStateInput,
): Promise<ReadConversationBootstrapStateResult> {
  const sessionSignature = readConversationSessionSignature(input.conversationId);
  const sessionDetailReused = Boolean(sessionSignature && input.knownSessionSignature && input.knownSessionSignature === sessionSignature);
  const sessionResult = sessionDetailReused
    ? {
        sessionRead: {
          detail: null,
          telemetry: null,
        },
        remoteMirror: { status: 'deferred' as const, durationMs: 0 },
      }
    : await readSessionDetailForRoute({
        conversationId: input.conversationId,
        profile: input.profile,
        tailBlocks: input.tailBlocks,
      });
  const sessionDetailAppendOnly =
    !sessionDetailReused &&
    input.knownSessionSignature &&
    sessionResult.sessionRead.detail?.signature &&
    input.knownSessionSignature !== sessionResult.sessionRead.detail.signature
      ? buildAppendOnlySessionDetailResponse({
          detail: sessionResult.sessionRead.detail,
          knownBlockOffset: input.knownBlockOffset,
          knownTotalBlocks: input.knownTotalBlocks,
          knownLastBlockId: input.knownLastBlockId,
        })
      : null;

  const liveSession = listAllLiveSessions().find((session) => session.id === input.conversationId);

  return {
    state: {
      conversationId: input.conversationId,
      sessionDetail: sessionDetailAppendOnly ? null : sessionResult.sessionRead.detail,
      sessionDetailSignature: sessionDetailAppendOnly?.signature ?? sessionResult.sessionRead.detail?.signature ?? sessionSignature,
      ...(sessionDetailReused ? { sessionDetailUnchanged: true } : {}),
      ...(sessionDetailAppendOnly ? { sessionDetailAppendOnly } : {}),
      ...(sessionResult.sessionRead.telemetry?.modificationDetected ? { integrityWarning: true } : {}),
      liveSession: liveSession ? { live: true as const, ...toPublicLiveSessionMeta(liveSession) } : { live: false as const },
    },
    telemetry: {
      sessionRead: sessionResult.sessionRead.telemetry,
      sessionDetailReused,
      remoteMirror: sessionResult.remoteMirror,
    },
  };
}
