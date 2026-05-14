# Excalidraw input extension

Provides the composer drawing tool as a system extension.

The extension contributes a composer input tool that opens an Excalidraw modal and returns a serialized scene plus PNG preview to the host composer. The lightweight button loads first; the Excalidraw editor, styles, and export stack are split into lazy chunks loaded only when the modal opens.
