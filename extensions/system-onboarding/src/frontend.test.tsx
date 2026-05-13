// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { OnboardingBootstrap } from './frontend';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

describe('OnboardingBootstrap', () => {
  it('navigates to the onboarding conversation with client-side routing', async () => {
    const invoke = vi.fn().mockResolvedValue({ conversationId: 'conv-1' });
    const pa = {
      extension: {
        invoke,
      },
    } as never;

    render(
      <MemoryRouter initialEntries={['/']}>
        <OnboardingBootstrap pa={pa} />
        <LocationProbe />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/conversations/conv-1');
    });
    expect(invoke).toHaveBeenCalledWith('ensure');
  });

  it('does not yank navigation away from non-landing pages', async () => {
    const invoke = vi.fn().mockResolvedValue({ conversationId: 'conv-1' });
    const pa = {
      extension: {
        invoke,
      },
    } as never;

    render(
      <MemoryRouter initialEntries={['/knowledge']}>
        <OnboardingBootstrap pa={pa} />
        <LocationProbe />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('ensure');
    });
    expect(screen.getByTestId('location').textContent).toBe('/knowledge');
  });

  it('stays put when ensure does not return a conversation id', async () => {
    const invoke = vi.fn().mockResolvedValue({ created: false, skipped: 'completed' });
    const pa = {
      extension: {
        invoke,
      },
    } as never;

    render(
      <MemoryRouter initialEntries={['/settings']}>
        <OnboardingBootstrap pa={pa} />
        <LocationProbe />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('ensure');
    });
    expect(screen.getByTestId('location').textContent).toBe('/settings');
  });
});
