import { type ComponentType, useCallback, useEffect, useRef, useState } from 'react';

import { createNativeExtensionClient } from './nativePaClient';
import { getExtensionRegistryRevision } from './extensionRegistryEvents';
import { systemExtensionModules } from './systemExtensionModules';

interface ModalState {
  extensionId: string;
  title?: string;
  component: string;
  props: Record<string, unknown>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export function ExtensionModalHost() {
  const [modal, setModal] = useState<ModalState | null>(null);
  const [Component, setComponent] = useState<ComponentType<{ pa: ReturnType<typeof createNativeExtensionClient>; props: Record<string, unknown>; close: (result?: unknown) => void }> | null>(null);
  const resolveRef = useRef<((value: unknown) => void) | null>(null);

  useEffect(() => {
    function handleModal(event: CustomEvent) {
      const { extensionId, title, component: componentName, props, resolve, reject } = event.detail as ModalState & {
        extensionId: string;
      };
      resolveRef.current = resolve;

      // Load the component from the extension
      const revision = getExtensionRegistryRevision();
      const systemLoader = systemExtensionModules.get(extensionId);
      const loadPromise = systemLoader
        ? systemLoader()
        : import(/* @vite-ignore */ ''); // Will be resolved via module key below

      const pa = createNativeExtensionClient(extensionId);

      // We can't dynamically resolve arbitrary extension modules from here trivially,
      // so we set the modal state with metadata and let the render path handle it.
      setModal({ extensionId, title, component: componentName, props, resolve, reject });
    }

    window.addEventListener('pa-extension-modal', handleModal as EventListener);
    return () => window.removeEventListener('pa-extension-modal', handleModal as EventListener);
  }, []);

  const handleClose = useCallback(
    (result?: unknown) => {
      if (resolveRef.current) {
        resolveRef.current(result ?? null);
        resolveRef.current = null;
      }
      setModal(null);
      setComponent(null);
    },
    [],
  );

  // Load the component when modal state changes
  useEffect(() => {
    if (!modal) {
      setComponent(null);
      return;
    }

    const revision = getExtensionRegistryRevision();
    const systemLoader = systemExtensionModules.get(modal.extensionId);

    async function load() {
      try {
        const module = systemLoader ? await systemLoader() : null;
        if (!module) return; // For runtime extensions, component must be pre-bundled
        const comp = module[modal.component] as ComponentType | undefined;
        if (typeof comp !== 'function') return;
        setComponent(() => comp as ComponentType<{ pa: ReturnType<typeof createNativeExtensionClient>; props: Record<string, unknown>; close: (result?: unknown) => void }>);
      } catch {
        // Component load failed
      }
    }

    load();
  }, [modal]);

  if (!modal || !Component) return null;

  const pa = createNativeExtensionClient(modal.extensionId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') handleClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={modal.title ?? 'Extension dialog'}
    >
      <div className="mx-4 max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border-default bg-surface p-6 shadow-2xl">
        {modal.title ? (
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-primary">{modal.title}</h2>
            <button
              type="button"
              onClick={() => handleClose()}
              className="ui-icon-button h-7 w-7 rounded-md text-secondary hover:text-primary"
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        ) : null}
        <Component pa={pa} props={modal.props} close={handleClose} />
      </div>
    </div>
  );
}
