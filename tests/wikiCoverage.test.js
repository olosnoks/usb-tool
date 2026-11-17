import { describe, it, expect } from 'vitest';
import { SIDEBAR_SECTIONS } from '../src/components/layout/Sidebar.jsx';
import { WIKI_ARTICLES } from '../src/wiki/wikiArticles.js';
import { TOOL_TO_ARTICLE_MAP, resolveArticleForTool } from '../src/wiki/WikiApp.jsx';
import { searchTools } from '../src/utils/toolSearch.js';

// Same fields the wiki search box uses (WikiApp.jsx).
const WIKI_SEARCH_FIELDS = { name: ['title'], id: ['id'], keywords: ['tags'], desc: ['summary'], body: ['content'] };
const searchArticles = (list, q) => searchTools(list, q, { fields: WIKI_SEARCH_FIELDS });

// Sidebar entries that intentionally have no wiki article. Adding a tool without an
// article (or an entry here with a reason) makes this test fail.
const NO_ARTICLE_ALLOWLIST = {
  workspace: 'The workspace itself; the wiki home article covers it',
  'wiki-external': 'Link to the wiki',
};

const ITEMS = SIDEBAR_SECTIONS.flatMap((s) => s.items || []).filter((i) => !i.isModal);

describe('wiki coverage: every tool has an article or an explicit allow-list entry', () => {
  it('maps every non-modal sidebar tool to a dedicated article', () => {
    const missing = [];
    for (const item of ITEMS) {
      if (item.id in NO_ARTICLE_ALLOWLIST) continue;
      const a = resolveArticleForTool(item.id);
      // resolveArticleForTool falls back to the generic workspace article when nothing matches.
      if (!a || a.id === 'workspace') missing.push(item.id);
    }
    expect(missing, `tools without a wiki article or allow-list entry: ${missing.join(', ')}`).toEqual([]);
  });

  it('every allow-list entry still refers to a real tool (no stale entries)', () => {
    const ids = new Set(ITEMS.map((i) => i.id));
    for (const id of Object.keys(NO_ARTICLE_ALLOWLIST)) {
      if (id === 'workspace') continue;
      expect(ids.has(id) || SIDEBAR_SECTIONS.flatMap((s) => s.items || []).some((i) => i.id === id), `stale allow-list entry ${id}`).toBe(true);
      // An allow-listed tool that now resolves to a real article should be removed from the list.
      if (['crtsh-finder', 'ip-calculator', 'osint-clients'].includes(id)) {
        expect(resolveArticleForTool(id).id, `${id} now has an article; drop it from the allow-list`).toBe('workspace');
      }
    }
  });

  it('every TOOL_TO_ARTICLE_MAP value points at an existing article', () => {
    const ids = new Set(WIKI_ARTICLES.map((a) => a.id));
    for (const [tool, articleId] of Object.entries(TOOL_TO_ARTICLE_MAP)) {
      expect(ids.has(articleId), `${tool} -> ${articleId}`).toBe(true);
    }
  });

  it('article ids are unique', () => {
    const ids = WIKI_ARTICLES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('crypto & data tool articles (DAT-8)', () => {
  const NEW = { 'hash-calculator': 'hash', 'jwt-inspector': 'jwt', 'regex-tester': 'regex', 'db-browser': 'sqlite' };

  for (const [toolId, keyword] of Object.entries(NEW)) {
    it(`${toolId} resolves to its own article, mapped explicitly`, () => {
      expect(TOOL_TO_ARTICLE_MAP[toolId]).toBe(toolId);
      const a = resolveArticleForTool(toolId);
      expect(a.id).toBe(toolId);
      expect(a.toolId).toBe(toolId);
      expect(a.content.length).toBeGreaterThan(1500);
      expect(a.tags.length).toBeGreaterThan(3);
      expect(searchArticles(WIKI_ARTICLES, keyword).map((x) => x.id)).toContain(toolId);
      expect(searchArticles(WIKI_ARTICLES, toolId).map((x) => x.id)).toContain(toolId);
    });
  }

  it('no wiki article contains a world-writable wildcard udev rule', () => {
    for (const a of WIKI_ARTICLES) {
      expect(a.content, a.id).not.toMatch(/idVendor\}?=="\*"/);
      expect(a.content, a.id).not.toMatch(/ATTRS\{idVendor\}[^\n]*MODE="0666"/);
    }
  });
});
