interface HeadingExitEditorLike {
  state: {
    selection: {
      empty: boolean;
      $from: {
        parent: {
          type: {
            name: string;
          };
        };
      };
    };
  };
  chain: () => {
    splitBlock: () => {
      setParagraph: () => {
        run: () => boolean;
      };
    };
  };
}

export function exitHeadingOnEnter(editor: HeadingExitEditorLike): boolean {
  const { selection } = editor.state;
  if (!selection.empty || selection.$from.parent.type.name !== 'heading') {
    return false;
  }

  return editor.chain().splitBlock().setParagraph().run();
}
