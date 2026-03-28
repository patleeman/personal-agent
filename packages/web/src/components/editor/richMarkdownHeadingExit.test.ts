import { describe, expect, it, vi } from 'vitest';
import { exitHeadingOnEnter } from './richMarkdownHeadingExit';

function createEditor(parentTypeName: string, empty = true) {
  const run = vi.fn(() => true);
  const setParagraph = vi.fn(() => ({ run }));
  const splitBlock = vi.fn(() => ({ setParagraph }));
  const chain = vi.fn(() => ({ splitBlock }));

  return {
    editor: {
      state: {
        selection: {
          empty,
          $from: {
            parent: {
              type: {
                name: parentTypeName,
              },
            },
          },
        },
      },
      chain,
    },
    chain,
    splitBlock,
    setParagraph,
    run,
  };
}

describe('exitHeadingOnEnter', () => {
  it('splits a heading and converts the new block to a paragraph', () => {
    const { editor, chain, splitBlock, setParagraph, run } = createEditor('heading');

    expect(exitHeadingOnEnter(editor)).toBe(true);
    expect(chain).toHaveBeenCalledOnce();
    expect(splitBlock).toHaveBeenCalledOnce();
    expect(setParagraph).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });

  it('does nothing outside headings', () => {
    const { editor, chain } = createEditor('paragraph');

    expect(exitHeadingOnEnter(editor)).toBe(false);
    expect(chain).not.toHaveBeenCalled();
  });

  it('does nothing for non-empty selections', () => {
    const { editor, chain } = createEditor('heading', false);

    expect(exitHeadingOnEnter(editor)).toBe(false);
    expect(chain).not.toHaveBeenCalled();
  });
});
