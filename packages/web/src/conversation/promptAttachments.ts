import type { PromptAttachmentRefInput, PromptImageInput } from '../shared/types';
import type { DraftConversationDrawingAttachment } from './draftConversation';
import {
  buildDrawingFileNames,
  inferDrawingTitleFromFileName,
  loadExcalidrawSceneFromBlob,
  serializeExcalidrawScene,
} from '../content/excalidrawUtils';

export type ComposerDrawingAttachment = DraftConversationDrawingAttachment;

export const MAX_PROMPT_IMAGE_DIMENSION = 2000;

function readBlobAsDataUrl(blob: Blob, label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error(`Failed to read ${label}`));
    };
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${label}`));
    reader.readAsDataURL(blob);
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return readBlobAsDataUrl(file, file.name);
}

function dataUrlToBase64(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(',');
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to decode image.'));
    image.src = dataUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to encode image.'));
        return;
      }

      resolve(blob);
    }, mimeType, quality);
  });
}

function normalizePromptImageMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') {
    return 'image/jpeg';
  }

  if (normalized === 'image/webp') {
    return 'image/webp';
  }

  return 'image/png';
}

export function constrainPromptImageDimensions(width: number, height: number, maxDimension = MAX_PROMPT_IMAGE_DIMENSION): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return {
      width: Math.max(1, Math.round(width) || 1),
      height: Math.max(1, Math.round(height) || 1),
    };
  }

  const longSide = Math.max(width, height);
  if (longSide <= maxDimension) {
    return {
      width: Math.round(width),
      height: Math.round(height),
    };
  }

  const scale = maxDimension / longSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function preparePromptImage(file: File): Promise<PromptImageInput> {
  const previewUrl = await readFileAsDataUrl(file);
  const mimeType = file.type || 'image/png';

  try {
    const image = await loadImageFromDataUrl(previewUrl);
    const targetSize = constrainPromptImageDimensions(image.naturalWidth, image.naturalHeight);
    if (targetSize.width === image.naturalWidth && targetSize.height === image.naturalHeight) {
      return {
        name: file.name,
        mimeType,
        data: dataUrlToBase64(previewUrl),
        previewUrl,
      } satisfies PromptImageInput;
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetSize.width;
    canvas.height = targetSize.height;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to resize image.');
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, targetSize.width, targetSize.height);

    const outputMimeType = normalizePromptImageMimeType(mimeType);
    const outputBlob = await canvasToBlob(
      canvas,
      outputMimeType,
      outputMimeType === 'image/png' ? undefined : 0.9,
    );
    const resizedPreviewUrl = await readBlobAsDataUrl(outputBlob, file.name);

    return {
      name: file.name,
      mimeType: outputBlob.type || outputMimeType,
      data: dataUrlToBase64(resizedPreviewUrl),
      previewUrl: resizedPreviewUrl,
    } satisfies PromptImageInput;
  } catch {
    return {
      name: file.name,
      mimeType,
      data: dataUrlToBase64(previewUrl),
      previewUrl,
    } satisfies PromptImageInput;
  }
}

export function fileExtensionForMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === 'image/jpeg') {
    return 'jpg';
  }

  const [, subtype] = normalized.split('/');
  return subtype || 'png';
}

export function base64ToFile(data: string, mimeType: string, name: string): File {
  const decoded = globalThis.atob(data);
  const bytes = new Uint8Array(decoded.length);

  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }

  return new File([bytes], name, { type: mimeType });
}

function safeBase64ToFile(data: string, mimeType: string, name: string): File | null {
  const normalizedMimeType = mimeType.trim();
  if (!data.trim() || !normalizedMimeType.toLowerCase().startsWith('image/')) {
    return null;
  }

  try {
    return base64ToFile(data.trim(), normalizedMimeType, name);
  } catch {
    return null;
  }
}

export function screenshotCaptureImageToFile(image: {
  data: string;
  mimeType: string;
  name?: string | null;
}): File {
  return base64ToFile(
    image.data,
    image.mimeType,
    image.name?.trim() || 'Screenshot.png',
  );
}

export function restoreQueuedImageFiles(
  images: PromptImageInput[] | undefined | null,
  behavior: 'steer' | 'followUp',
  queueIndex: number,
): File[] {
  const normalizedImages = Array.isArray(images) ? images : [];
  return normalizedImages.flatMap((image, imageIndex) => {
    const extension = fileExtensionForMimeType(image.mimeType);
    const name = image.name?.trim() || `queued-${behavior}-${queueIndex + 1}-${imageIndex + 1}.${extension}`;
    const file = safeBase64ToFile(image.data, image.mimeType, name);
    return file ? [file] : [];
  });
}

export function restoreComposerImageFiles(
  images: PromptImageInput[] | undefined | null,
  fallbackNamePrefix: string,
): File[] {
  const normalizedImages = Array.isArray(images) ? images : [];
  return normalizedImages.flatMap((image, imageIndex) => {
    const extension = fileExtensionForMimeType(image.mimeType);
    const name = image.name?.trim() || `${fallbackNamePrefix}-${imageIndex + 1}.${extension}`;
    const file = safeBase64ToFile(image.data, image.mimeType, name);
    return file ? [file] : [];
  });
}

export async function buildPromptImages(files: File[]): Promise<PromptImageInput[]> {
  const imageFiles = files.filter((file) => file.type.startsWith('image/'));
  return Promise.all(imageFiles.map((file) => preparePromptImage(file)));
}

export interface PreparedComposerFiles {
  imageFiles: File[];
  drawingAttachments: ComposerDrawingAttachment[];
  rejectedFileNames: string[];
  drawingParseFailures: Array<{ fileName: string; message: string }>;
}

export interface ComposerFilePreparationNotice {
  tone: 'accent' | 'danger';
  text: string;
  durationMs?: number;
}

export type ComposerTransferFileList = Iterable<File> | ArrayLike<File> | null | undefined;

export function readComposerTransferFiles(files: ComposerTransferFileList): File[] {
  return files ? Array.from(files) : [];
}

export function hasComposerTransferFiles(files: ComposerTransferFileList): boolean {
  return readComposerTransferFiles(files).length > 0;
}

export async function prepareComposerFiles(
  files: File[],
  buildDrawing: (file: File) => Promise<ComposerDrawingAttachment> = buildComposerDrawingFromFile,
): Promise<PreparedComposerFiles> {
  const imageFiles: File[] = [];
  const drawingAttachments: ComposerDrawingAttachment[] = [];
  const rejectedFileNames: string[] = [];
  const drawingParseFailures: PreparedComposerFiles['drawingParseFailures'] = [];

  for (const file of files) {
    if (isPotentialExcalidrawFile(file)) {
      try {
        const drawing = await buildDrawing(file);
        drawingAttachments.push(drawing);
        continue;
      } catch (error) {
        if (file.name.trim().toLowerCase().endsWith('.excalidraw')) {
          drawingParseFailures.push({
            fileName: file.name,
            message: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
      }
    }

    if (file.type.startsWith('image/')) {
      imageFiles.push(file);
      continue;
    }

    rejectedFileNames.push(file.name || 'Unnamed file');
  }

  return {
    imageFiles,
    drawingAttachments,
    rejectedFileNames,
    drawingParseFailures,
  };
}

export function buildComposerFilePreparationNotices(
  prepared: Pick<PreparedComposerFiles, 'drawingAttachments' | 'drawingParseFailures' | 'rejectedFileNames'>,
): ComposerFilePreparationNotice[] {
  const notices: ComposerFilePreparationNotice[] = [];

  if (prepared.drawingAttachments.length > 0) {
    notices.push({
      tone: 'accent',
      text: `Attached ${prepared.drawingAttachments.length} drawing${prepared.drawingAttachments.length === 1 ? '' : 's'}.`,
    });
  }

  for (const failure of prepared.drawingParseFailures) {
    notices.push({
      tone: 'danger',
      text: `Failed to parse ${failure.fileName}: ${failure.message}`,
      durationMs: 4000,
    });
  }

  if (prepared.rejectedFileNames.length > 0) {
    const preview = prepared.rejectedFileNames.slice(0, 3).join(', ');
    const suffix = prepared.rejectedFileNames.length > 3 ? `, +${prepared.rejectedFileNames.length - 3} more` : '';
    notices.push({
      tone: 'danger',
      text: `Unsupported file type: ${preview}${suffix}`,
      durationMs: 4000,
    });
  }

  return notices;
}

export function removeComposerImageFileAtIndex(files: File[], indexToRemove: number): File[] {
  return files.filter((_, index) => index !== indexToRemove);
}

export function removeComposerDrawingAttachmentByLocalId(
  attachments: ComposerDrawingAttachment[],
  localId: string,
): ComposerDrawingAttachment[] {
  return attachments.filter((attachment) => attachment.localId !== localId);
}

export function createComposerDrawingLocalId(): string {
  return `drawing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isPotentialExcalidrawFile(file: File): boolean {
  const lowerName = file.name.trim().toLowerCase();
  if (lowerName.endsWith('.excalidraw')) {
    return true;
  }

  if (lowerName.endsWith('.png')) {
    return true;
  }

  return file.type === 'application/json' || file.type === 'application/vnd.excalidraw+json';
}

export function drawingAttachmentToPromptImage(attachment: ComposerDrawingAttachment): PromptImageInput {
  return {
    name: `${attachment.title}.png`,
    mimeType: attachment.previewMimeType,
    data: attachment.previewData,
    previewUrl: attachment.previewUrl,
  };
}

export function drawingAttachmentToPromptRef(attachment: ComposerDrawingAttachment): PromptAttachmentRefInput | null {
  const attachmentId = attachment.attachmentId?.trim();
  if (!attachmentId) {
    return null;
  }

  const revision = typeof attachment.revision === 'number'
    ? attachment.revision
    : (typeof attachment.revision === 'string' ? Number.parseInt(attachment.revision, 10) : undefined);

  return {
    attachmentId,
    ...(Number.isInteger(revision) && Number(revision) > 0 ? { revision: Number(revision) } : {}),
  };
}

export async function buildComposerDrawingFromFile(file: File): Promise<ComposerDrawingAttachment> {
  const scene = await loadExcalidrawSceneFromBlob(file);
  const serialized = await serializeExcalidrawScene(scene);
  const title = inferDrawingTitleFromFileName(file.name);
  const fileNames = buildDrawingFileNames(title);

  return {
    localId: createComposerDrawingLocalId(),
    title,
    sourceData: serialized.sourceData,
    sourceMimeType: serialized.sourceMimeType,
    sourceName: fileNames.sourceName,
    previewData: serialized.previewData,
    previewMimeType: serialized.previewMimeType,
    previewName: fileNames.previewName,
    previewUrl: serialized.previewUrl,
    scene,
    dirty: true,
  };
}
