import React, { useState, useMemo, useEffect } from 'react';
import { 
  Search, 
  BookOpen, 
  Cpu, 
  Layers, 
  ChevronRight, 
  ChevronDown,
  ArrowLeft, 
  ArrowRight,
  ExternalLink, 
  Copy, 
  Check, 
  Terminal, 
  Radio, 
  HardDrive, 
  AlertTriangle, 
  CheckCircle2, 
  Sparkles, 
  Bookmark, 
  Hash, 
  Wrench,
  Activity,
  Gauge,
  Keyboard,
  Zap,
  Sliders,
  FileCode,
  Wifi,
  ShieldAlert,
  Bot,
  Usb,
  X,
  Github
} from 'lucide-react';
import { WIKI_ARTICLES, WIKI_CATEGORIES } from './wikiArticles';

// Map icon string names to Lucide icons
const CATEGORY_ICONS = {
  BookOpen,
  Terminal,
  Activity,
  Radio,
  Keyboard,
  Cpu,
  Wrench,
  AlertTriangle
};

export default function WikiApp() {
  const [searchQuery, setSearchQuery] = useState('');
  
  // Parse tool or article parameter from URL on load
  const [selectedArticleId, setSelectedArticleId] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlTool = params.get('tool');
      const urlArticle = params.get('article');
      if (urlArticle) {
        const found = WIKI_ARTICLES.find(a => a.id === urlArticle);
        if (found) return found.id;
      }
      if (urlTool) {
        const found = WIKI_ARTICLES.find(a => a.toolId === urlTool || a.id === urlTool);
        if (found) return found.id;
      }
      const hash = window.location.hash.replace('#', '');
      if (hash.startsWith('tool=')) {
        const t = hash.replace('tool=', '');
        const found = WIKI_ARTICLES.find(a => a.toolId === t || a.id === t);
        if (found) return found.id;
      }
      if (hash) {
        const found = WIKI_ARTICLES.find(a => a.id === hash || a.toolId === hash);
        if (found) return found.id;
      }
    } catch (e) {}
    return WIKI_ARTICLES[0].id;
  });

  const [selectedCategory, setSelectedCategory] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlTool = params.get('tool');
      const urlArticle = params.get('article');
      const target = urlArticle || urlTool;
      if (target) {
        const found = WIKI_ARTICLES.find(a => a.id === target || a.toolId === target);
        if (found) return found.category;
      }
    } catch (e) {}
    return 'all';
  });

  const [copiedCodeSnippet, setCopiedCodeSnippet] = useState(null);
  const [collapsedCategories, setCollapsedCategories] = useState({});

  // When article changes, keep URL search parameter in sync
  const handleSelectArticle = (articleId) => {
    setSelectedArticleId(articleId);
    try {
      const art = WIKI_ARTICLES.find(a => a.id === articleId);
      if (art) {
        const url = new URL(window.location.href);
        if (art.toolId) {
          url.searchParams.set('tool', art.toolId);
        } else {
          url.searchParams.set('article', art.id);
        }
        window.history.replaceState(null, '', url.toString());
      }
    } catch (e) {}
  };

  // Filter articles by category and search query
  const filteredArticles = useMemo(() => {
    return WIKI_ARTICLES.filter(article => {
      const q = searchQuery.toLowerCase().trim();
      const matchesCategory = selectedCategory === 'all' || article.category === selectedCategory;
      const matchesSearch = !q ||
        article.title.toLowerCase().includes(q) ||
        article.summary.toLowerCase().includes(q) ||
        article.content.toLowerCase().includes(q) ||
        article.tags.some(t => t.toLowerCase().includes(q));

      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, selectedCategory]);

  const activeArticle = useMemo(() => {
    return WIKI_ARTICLES.find(a => a.id === selectedArticleId) || filteredArticles[0] || WIKI_ARTICLES[0];
  }, [selectedArticleId, filteredArticles]);

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedCodeSnippet(id);
    setTimeout(() => setCopiedCodeSnippet(null), 2000);
  };

  const toggleCategoryCollapse = (catId) => {
    setCollapsedCategories(prev => ({
      ...prev,
      [catId]: !prev[catId]
    }));
  };

  // Group filtered articles by category for the vertical tree view
  const articlesByCategory = useMemo(() => {
    const map = {};
    WIKI_CATEGORIES.filter(c => c.id !== 'all').forEach(cat => {
      map[cat.id] = [];
    });
    filteredArticles.forEach(art => {
      if (map[art.category]) {
        map[art.category].push(art);
      }
    });
    return map;
  }, [filteredArticles]);

  // Inline formatting helper for bold, code snippets, and links
  const renderInline = (text) => {
    if (!text || typeof text !== 'string') return text;
    const parts = [];
    const regex = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
    let lastIdx = 0;
    let match;
    let partKey = 0;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIdx) {
        parts.push(text.substring(lastIdx, match.index));
      }
      const token = match[0];
      if (token.startsWith('`') && token.endsWith('`')) {
        parts.push(
          <code key={`code-${partKey++}`} className="px-1.5 py-0.5 rounded bg-[#181d2a] text-amber-300 font-mono text-[11px] border border-[#262f44]">
            {token.slice(1, -1)}
          </code>
        );
      } else if (token.startsWith('**') && token.endsWith('**')) {
        parts.push(
          <strong key={`bold-${partKey++}`} className="font-bold text-slate-100">
            {token.slice(2, -2)}
          </strong>
        );
      } else if (token.startsWith('[') && token.includes('](') && token.endsWith(')')) {
        const linkMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (linkMatch) {
          parts.push(
            <a key={`link-${partKey++}`} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">
              {linkMatch[1]}
            </a>
          );
        }
      }
      lastIdx = regex.lastIndex;
    }
    if (lastIdx < text.length) {
      parts.push(text.substring(lastIdx));
    }
    return parts.length > 0 ? parts : text;
  };

  // Markdown renderer for headings, code blocks, tables, callout blocks, and lists
  const renderMarkdown = (content) => {
    const lines = content.trim().split('\n');
    const elements = [];
    let inCodeBlock = false;
    let codeContent = [];
    let inTable = false;
    let tableRows = [];
    let keyIdx = 0;

    const flushTable = () => {
      if (!inTable || tableRows.length === 0) return;
      const headerRow = tableRows[0];
      const bodyRows = tableRows.slice(2); // Skip separator row

      elements.push(
        <div key={`table-${keyIdx++}`} className="overflow-x-auto my-4 rounded-xl border border-[#262c3d] bg-[#0e111a] shadow-inner">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#161a26] text-slate-300 border-b border-[#262c3d]">
              <tr>
                {headerRow.map((col, idx) => (
                  <th key={idx} className="px-3.5 py-2.5 font-bold uppercase tracking-wider text-[11px] text-amber-400">
                    {renderInline(col.trim())}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e2333] text-slate-300">
              {bodyRows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-[#151926] transition-colors">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-3.5 py-2.5 leading-relaxed">
                      {renderInline(cell.trim())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      inTable = false;
      tableRows = [];
    };

    const flushCode = () => {
      if (!inCodeBlock) return;
      const fullCode = codeContent.join('\n');
      const snippetId = `code-${keyIdx++}`;
      elements.push(
        <div key={snippetId} className="relative group my-4 rounded-xl overflow-hidden border border-[#2b3142] bg-[#090b10] shadow-md">
          <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#141722] border-b border-[#2b3142] text-[11px] font-mono text-slate-400">
            <span className="flex items-center gap-1.5 text-slate-400">
              <Terminal className="w-3.5 h-3.5 text-cyan-400" />
              <span>terminal / code</span>
            </span>
            <button
              onClick={() => handleCopy(fullCode, snippetId)}
              className="flex items-center gap-1 hover:text-cyan-300 transition text-[10px] bg-[#1d2230] px-2 py-0.5 rounded border border-[#2f3547]"
            >
              {copiedCodeSnippet === snippetId ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400 font-bold">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
          <pre className="p-4 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed">
            <code>{fullCode}</code>
          </pre>
        </div>
      );
      inCodeBlock = false;
      codeContent = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Expandable details disclosure
      if (line.trim().startsWith('<details>')) {
        flushTable();
        flushCode();
        let summaryText = 'Click to expand technical details';
        const innerLines = [];
        i++;
        while (i < lines.length) {
          const innerLine = lines[i];
          if (innerLine.trim().startsWith('</details>')) {
            break;
          }
          if (innerLine.trim().startsWith('<summary>') && innerLine.trim().endsWith('</summary>')) {
            summaryText = innerLine.trim().replace('<summary>', '').replace('</summary>', '');
          } else {
            innerLines.push(innerLine);
          }
          i++;
        }

        elements.push(
          <details key={`details-${keyIdx++}`} className="group my-4 rounded-xl border border-[#272e42] bg-[#0c0f18] overflow-hidden transition-all shadow-md">
            <summary className="cursor-pointer select-none px-4 py-3 font-mono font-bold text-xs text-amber-300 hover:text-amber-200 bg-[#141824] hover:bg-[#1a2030] transition-colors flex items-center justify-between border-b border-transparent group-open:border-[#272e42]">
              <span className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>{renderInline(summaryText)}</span>
              </span>
              <ChevronDown className="w-4 h-4 text-slate-400 transition-transform duration-200 group-open:rotate-180 shrink-0" />
            </summary>
            <div className="p-4 sm:p-5 bg-[#0a0d15] text-slate-300 text-xs sm:text-sm space-y-3">
              {renderMarkdown(innerLines.join('\n'))}
            </div>
          </details>
        );
        continue;
      }

      // Code blocks
      if (line.startsWith('```')) {
        if (inCodeBlock) {
          flushCode();
        } else {
          flushTable();
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        codeContent.push(line);
        continue;
      }

      // Tables
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        inTable = true;
        const columns = line.split('|').slice(1, -1);
        tableRows.push(columns);
        continue;
      } else if (inTable) {
        flushTable();
      }

      // Headings
      if (line.startsWith('# ')) {
        elements.push(
          <h1 key={`h1-${keyIdx++}`} className="text-2xl sm:text-3xl font-extrabold text-slate-100 tracking-tight mt-2 mb-4 pb-2 border-b border-[#222736]">
            {renderInline(line.replace('# ', ''))}
          </h1>
        );
      } else if (line.startsWith('### ')) {
        elements.push(
          <h3 key={`h3-${keyIdx++}`} className="text-base sm:text-lg font-bold text-amber-300 mt-6 mb-2 flex items-center gap-2">
            <Hash className="w-4 h-4 text-amber-500 shrink-0" />
            <span>{renderInline(line.replace('### ', ''))}</span>
          </h3>
        );
      } else if (line.startsWith('#### ')) {
        elements.push(
          <h4 key={`h4-${keyIdx++}`} className="text-sm font-bold text-slate-200 mt-4 mb-1">
            {renderInline(line.replace('#### ', ''))}
          </h4>
        );
      } else if (line.startsWith('> ')) {
        elements.push(
          <div key={`quote-${keyIdx++}`} className="my-3 p-3.5 rounded-xl bg-amber-500/10 border-l-4 border-amber-500 text-xs text-amber-200 leading-relaxed font-mono">
            {renderInline(line.replace('> ', ''))}
          </div>
        );
      } else if (line.startsWith('- ')) {
        elements.push(
          <li key={`li-${keyIdx++}`} className="text-xs sm:text-sm text-slate-300 ml-4 list-disc mb-1 leading-relaxed">
            {renderInline(line.replace('- ', ''))}
          </li>
        );
      } else if (/^\d+\.\s*/.test(line)) {
        elements.push(
          <li key={`oli-${keyIdx++}`} className="text-xs sm:text-sm text-slate-300 ml-4 list-decimal mb-1.5 leading-relaxed">
            {renderInline(line.replace(/^\d+\.\s*/, ''))}
          </li>
        );
      } else if (line.trim() === '---') {
        elements.push(<hr key={`hr-${keyIdx++}`} className="my-6 border-[#202534]" />);
      } else if (line.trim().length > 0) {
        elements.push(
          <p key={`p-${keyIdx++}`} className="text-xs sm:text-sm text-slate-300 mb-3 leading-relaxed">
            {renderInline(line)}
          </p>
        );
      }
    }

    flushTable();
    flushCode();

    return elements;
  };

  return (
    <div className="min-h-screen bg-[#06080d] text-slate-200 font-sans antialiased selection:bg-amber-400/30 selection:text-amber-300 flex flex-col">
      {/* Top Banner Navigation */}
      <header className="sticky top-0 z-40 bg-[#0a0d14]/95 backdrop-blur-md border-b border-[#1f2433] px-4 py-3 sm:px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <a 
              href={`../?tool=${activeArticle?.toolId || 'flasher'}`} 
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#141722] hover:bg-[#1e2333] text-slate-300 hover:text-white border border-[#252a3a] text-xs font-mono transition shadow-sm"
              title="Return to Skon's USB Tool"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Web Tool</span>
            </a>
            
            <div className="flex items-center gap-2">
              <span className="text-lg">📖</span>
              <h1 className="text-sm sm:text-base font-bold text-slate-100 font-mono tracking-tight flex items-center gap-1.5">
                <span>SKON'S USB TOOL</span>
                <span className="text-amber-400 text-xs px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 font-bold">KNOWLEDGE BASE</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="https://github.com/olosnoks/usb-tool"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#141722] hover:bg-[#1e2333] text-slate-300 hover:text-white border border-[#252a3a] text-xs font-mono transition"
            >
              <Github className="w-3.5 h-3.5 text-slate-400" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Layout Container */}
      <div className="max-w-7xl mx-auto w-full flex-1 flex flex-col md:flex-row gap-6 p-4 sm:p-6">
        {/* Left Sidebar — Vertical Navigation Hierarchy */}
        <aside className="w-full md:w-80 lg:w-96 shrink-0 flex flex-col gap-4">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search all 28 tools & guides..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#0f121a] border border-[#222738] rounded-xl pl-9 pr-8 py-2.5 text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400 transition shadow-inner"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Category Filter Selector (Vertical Hierarchy) */}
          <div className="bg-[#0b0e15] border border-[#1e2333] rounded-2xl p-2 flex flex-col gap-1 max-h-[calc(100vh-180px)] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
            {/* Header: All Articles Toggle */}
            <button
              onClick={() => setSelectedCategory('all')}
              className={`w-full text-left px-3 py-2 rounded-xl text-xs font-mono font-bold flex items-center justify-between transition border ${
                selectedCategory === 'all' && !searchQuery
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                  : 'bg-transparent text-slate-400 hover:bg-[#131722] hover:text-slate-200 border-transparent'
              }`}
            >
              <span className="flex items-center gap-2">
                <BookOpen className="w-3.5 h-3.5 text-amber-400" />
                <span>ALL DOCUMENTATION</span>
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#161a26] text-slate-400 border border-[#242938]">
                {WIKI_ARTICLES.length}
              </span>
            </button>

            <div className="my-1 border-t border-[#181c28]" />

            {/* Vertical Category Groups */}
            {WIKI_CATEGORIES.filter(c => c.id !== 'all').map(cat => {
              const IconComp = CATEGORY_ICONS[cat.icon] || BookOpen;
              const catArticles = articlesByCategory[cat.id] || [];
              const isCatActive = selectedCategory === cat.id;
              const isCollapsed = collapsedCategories[cat.id];

              if (catArticles.length === 0 && searchQuery) {
                return null;
              }

              return (
                <div key={cat.id} className="space-y-1">
                  {/* Category Title Row */}
                  <div
                    onClick={() => {
                      if (selectedCategory === cat.id) {
                        toggleCategoryCollapse(cat.id);
                      } else {
                        setSelectedCategory(cat.id);
                      }
                    }}
                    className={`w-full cursor-pointer px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center justify-between transition ${
                      isCatActive
                        ? 'bg-[#151926] text-amber-300 border border-amber-500/30'
                        : 'text-slate-400 hover:bg-[#11141e] hover:text-slate-200'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <IconComp className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="truncate uppercase text-[11px] tracking-wide">{cat.name}</span>
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-slate-500 font-mono">
                        {catArticles.length}
                      </span>
                      {isCollapsed ? (
                        <ChevronRight className="w-3 h-3 text-slate-500" />
                      ) : (
                        <ChevronDown className="w-3 h-3 text-slate-500" />
                      )}
                    </div>
                  </div>

                  {/* Vertical Article List under this Category */}
                  {!isCollapsed && catArticles.length > 0 && (
                    <div className="ml-3 pl-2 border-l border-[#1c2130] space-y-1 py-0.5">
                      {catArticles.map(article => {
                        const isSelected = activeArticle?.id === article.id;
                        return (
                          <button
                            key={article.id}
                            onClick={() => handleSelectArticle(article.id)}
                            className={`w-full text-left px-2.5 py-2 rounded-lg transition flex flex-col gap-0.5 border ${
                              isSelected
                                ? 'bg-gradient-to-r from-amber-500/20 to-transparent border-amber-500/40 text-amber-200 shadow-sm'
                                : 'hover:bg-[#131620] border-transparent text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span className={`text-[11px] leading-snug truncate ${isSelected ? 'font-bold text-amber-300' : 'font-medium'}`}>
                                {article.title.split('—')[0].trim()}
                              </span>
                              <span className="text-[9px] font-mono text-slate-500 shrink-0">
                                {article.readTime.replace(' read', '')}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-500 truncate font-mono">
                              {article.title.includes('—') ? article.title.split('—')[1].trim() : article.summary}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {filteredArticles.length === 0 && (
              <div className="p-6 text-center text-xs text-slate-500 font-mono">
                No matching articles found for "{searchQuery}".
              </div>
            )}
          </div>
        </aside>

        {/* Right Pane — Comprehensive Article Reader */}
        <main className="flex-1 bg-[#0b0e15] border border-[#1e2333] rounded-2xl p-5 sm:p-8 overflow-hidden shadow-2xl shadow-black/50">
          {activeArticle ? (
            <article className="space-y-5 max-w-4xl">
              {/* Top Meta Bar with Subtle Link to Web App */}
              <div className="flex items-center justify-between gap-3 flex-wrap pb-3 border-b border-[#1b202e]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold uppercase border border-amber-500/30">
                    {activeArticle.category}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    ⏱ {activeArticle.readTime}
                  </span>
                </div>

                {/* Subtle Direct Link to Web App Tool */}
                {activeArticle.toolId && (
                  <a
                    href={`../?tool=${activeArticle.toolId}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-mono transition group shadow-sm"
                    title={`Launch ${activeArticle.title} directly in Skon's USB Tool`}
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-400 group-hover:rotate-12 transition-transform" />
                    <span>Launch in USB Tool</span>
                    <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </a>
                )}
              </div>

              {/* Tag Badges */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {activeArticle.tags.map((tag, tIdx) => (
                  <span key={tIdx} className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#131620] text-slate-400 border border-[#212636]">
                    #{tag}
                  </span>
                ))}
              </div>

              {/* Article Content Rendered Markdown */}
              <div className="prose prose-invert max-w-none text-slate-200">
                {renderMarkdown(activeArticle.content)}
              </div>

              {/* Bottom Subtle Action Card */}
              <div className="mt-10 pt-4 border-t border-[#1e2333] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-mono text-slate-400">
                <span className="flex items-center gap-2 text-slate-400">
                  <Wrench className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Ready to test this hardware in your browser?</span>
                </span>
                <a
                  href={`../?tool=${activeArticle.toolId || 'flasher'}`}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold transition flex items-center gap-1.5 shadow-md shadow-amber-500/10"
                >
                  <span>Open {activeArticle.title.split('—')[0].trim()}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </article>
          ) : (
            <div className="text-center py-24 text-slate-500 font-mono text-xs">
              Select an article from the vertical sidebar to begin reading.
            </div>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-[#181c28] bg-[#07090f] px-6 py-4 text-center text-xs font-mono text-slate-500">
        Skon's USB Tool & Web Flasher Documentation • Built with React & Vite • 28 Comprehensive Hardware & Firmware Guides
      </footer>
    </div>
  );
}
