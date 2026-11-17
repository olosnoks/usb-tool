import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import StartButton, { StartMenu, buildToolMap, searchResults, pathLabel, pushRecent, withAllTools, MAX_RECENT } from '../src/components/layout/StartMenu';
import { TOOL_CATEGORIES, flattenToolIds } from '../src/components/layout/toolCategories';

describe('StartMenu', () => {
  it('renders the search field, every top-level category and All tools', () => {
    const html = renderToString(<StartMenu initialRecent={[]} />);
    expect(html).toContain('data-testid="start-menu"');
    expect(html).toContain('Type to search tools');
    for (const c of TOOL_CATEGORIES) expect(html).toContain(`data-testid="start-category-${c.id}"`);
    expect(html).toContain('start-category-__all-tools');
    expect(html).toContain('data-testid="start-footer-pinouts-modal"');
  });

  it('shows a cascading flyout for an open category path', () => {
    const cat = TOOL_CATEGORIES[0];
    const html = renderToString(<StartMenu initialPath={[cat]} initialRecent={[]} />);
    expect(html).toContain('data-testid="start-flyout-1"');
  });

  it('with a query shows ranked results with their category path', () => {
    const map = buildToolMap();
    const res = searchResults(map, 'dns');
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].id).toBe('dns-toolkit');
    const html = renderToString(<StartMenu initialQuery="dns" initialRecent={[]} />);
    expect(html).toContain('data-testid="start-result-dns-toolkit"');
    expect(html).not.toContain('start-root');
    expect(pathLabel('dns-toolkit')).toContain('›');
  });

  it('every categorised tool resolves to a launchable sidebar item', () => {
    const map = buildToolMap();
    const withAll = withAllTools(TOOL_CATEGORIES, map);
    expect(withAll[withAll.length - 1].children.length).toBe(flattenToolIds(TOOL_CATEGORIES).filter((i) => map.has(i)).length);
  });

  it('recent list is de-duplicated, newest first and capped', () => {
    let r = [];
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'c']) r = pushRecent(r, id);
    expect(r[0]).toBe('c');
    expect(r.length).toBe(MAX_RECENT);
    expect(new Set(r).size).toBe(r.length);
  });

  it('the Start button renders closed by default', () => {
    const html = renderToString(<StartButton onLaunch={() => {}} />);
    expect(html).toContain('data-testid="start-button"');
    expect(html).not.toContain('data-testid="start-menu"');
  });
});
