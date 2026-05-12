function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/images must be resolved by the Personal Agent host runtime.');
}

export type StoredImageProbeAttachment = any;
export const clearImageProbeAttachmentCacheForTests = (..._args: any[]): any => hostResolved();
export const getImageProbeAttachments = (..._args: any[]): any => hostResolved();
export const getImageProbeAttachmentsById = (..._args: any[]): any => hostResolved();
export const rememberImageProbeAttachments = (..._args: any[]): any => hostResolved();
export const getPiAgentRuntimeDir = (..._args: any[]): any => hostResolved();
