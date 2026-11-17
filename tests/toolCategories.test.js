import { describe, it, expect } from 'vitest';
import * as lucide from 'lucide-react';
import { SIDEBAR_SECTIONS } from '../src/components/layout/Sidebar.jsx';
import { TOOL_CATEGORIES, flattenToolIds, findCategoryPath } from '../src/components/layout/toolCategories.js';

const sidebarIds = SIDEBAR_SECTIONS.flatMap((s) => s.items.map((i) => i.id));

function walk(nodes, depth, visit) {
  for (const n of nodes) {
    visit(n, depth);
    if (n.children) walk(n.children, depth + 1, visit);
  }
}

describe('toolCategories', () => {
  it('lists every sidebar item exactly once', () => {
    const ids = flattenToolIds();
    expect(ids.length).toBe(new Set(ids).size);
    expect([...ids].sort()).toEqual([...sidebarIds].sort());
  });

  it('has no unknown toolIds', () => {
    const known = new Set(sidebarIds);
    expect(flattenToolIds().filter((id) => !known.has(id))).toEqual([]);
  });

  it('is at most 3 levels deep and categories are well-formed', () => {
    const ids = new Set();
    walk(TOOL_CATEGORIES, 1, (n, depth) => {
      expect(depth).toBeLessThanOrEqual(3);
      if (n.toolId) return;
      expect(n.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(ids.has(n.id)).toBe(false);
      ids.add(n.id);
      expect(n.name && n.desc).toBeTruthy();
      expect(n.children.length).toBeGreaterThanOrEqual(2);
    });
    expect(TOOL_CATEGORIES.length).toBeGreaterThanOrEqual(6);
    expect(TOOL_CATEGORIES.length).toBeLessThanOrEqual(9);
  });

  it('uses real lucide-react icons', () => {
    walk(TOOL_CATEGORIES, 1, (n) => {
      if (n.toolId) return;
      expect(lucide[n.icon], `icon ${n.icon}`).toBeTruthy();
    });
  });

  it('findCategoryPath resolves tools', () => {
    expect(findCategoryPath('terminal')).toEqual(['serial-console', 'console-control']);
    expect(findCategoryPath('flasher')).toEqual(['flash-program']);
    expect(findCategoryPath('nope')).toBeNull();
    for (const id of sidebarIds) expect(findCategoryPath(id)).not.toBeNull();
  });
});
