import { describe, expect, it } from 'vitest';
import { getCapabilitiesLandingPath } from './capabilitiesSelection';
import { getKnowledgeLandingPath } from './knowledgeSelection';

describe('hub route redirects', () => {
  it('redirects the knowledge hub overview to projects', () => {
    expect(getKnowledgeLandingPath('')).toBe('/projects');
    expect(getKnowledgeLandingPath('?section=overview')).toBe('/projects');
  });

  it('keeps section-specific knowledge routes in place', () => {
    expect(getKnowledgeLandingPath('?section=projects')).toBeNull();
    expect(getKnowledgeLandingPath('?section=skills')).toBeNull();
  });

  it('redirects the capabilities hub overview to presets', () => {
    expect(getCapabilitiesLandingPath('')).toBe('/plans');
    expect(getCapabilitiesLandingPath('?section=overview')).toBe('/plans');
  });

  it('keeps section-specific capabilities routes in place', () => {
    expect(getCapabilitiesLandingPath('?section=scheduled')).toBeNull();
    expect(getCapabilitiesLandingPath('?section=tools')).toBeNull();
  });
});
