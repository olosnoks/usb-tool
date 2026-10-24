import React, { useState, useMemo } from 'react';
import { 
  Search, 
  BookOpen, 
  Cpu, 
  Layers, 
  ChevronRight, 
  ArrowLeft, 
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
  Share2, 
  Wrench,
  Github
} from 'lucide-react';
import { WIKI_ARTICLES, WIKI_CATEGORIES } from './wikiArticles';

export default function WikiApp() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedArticleId, setSelectedArticleId] = useState(WIKI_ARTICLES[0].id);
  const [copiedCodeSnippet, setCopiedCodeSnippet] = useState(null);

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

  // Simple Markdown renderer for headings, code blocks, tables, and lists
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
        <div key={`table-${keyIdx++}`} className="overflow-x-auto my-4 rounded-xl border border-[#2b303c] bg-[#12141c]">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#1b1f2b] text-slate-300 border-b border-[#2b303c]">
              <tr>
                {headerRow.map((col, idx) => (
                  <th key={idx} className="px-3.5 py-2.5 font-bold uppercase tracking-wider text-[11px] text-amber-400">
                    {col.trim()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#232733] text-slate-300">
              {bodyRows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-[#181c26] transition-colors">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-3.5 py-2 leading-relaxed">
                      {cell.trim()}
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
        <div key={snippetId} className="relative group my-4 rounded-xl overflow-hidden border border-[#2d3240] bg-[#0c0d12]">
          <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#171922] border-b border-[#2d3240] text-[11px] font-mono text-slate-400">
            <span className="flex items-center gap-1.5 text-slate-400">
              <Terminal className="w-3.5 h-3.5 text-cyan-400" />
              <span>terminal</span>
            </span>
            <button
              onClick={() => handleCopy(fullCode, snippetId)}
              className="flex items-center gap-1 hover:text-cyan-300 transition text-[10px]"
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
          <h1 key={`h1-${keyIdx++}`} className="text-2xl sm:text-3xl font-extrabold text-slate-100 tracking-tight mt-2 mb-4 pb-2 border-b border-[#262a36]">
            {line.replace('# ', '')}
          </h1>
        );
      } else if (line.startsWith('### ')) {
        elements.push(
          <h3 key={`h3-${keyIdx++}`} className="text-lg font-bold text-amber-300 mt-6 mb-2 flex items-center gap-2">
            <Hash className="w-4 h-4 text-amber-500" />
            <span>{line.replace('### ', '')}</span>
          </h3>
        );
      } else if (line.startsWith('#### ')) {
        elements.push(
          <h4 key={`h4-${keyIdx++}`} className="text-sm font-bold text-slate-200 mt-4 mb-1">
            {line.replace('#### ', '')}
          </h4>
        );
      } else if (line.startsWith('> ')) {
        elements.push(
          <div key={`quote-${keyIdx++}`} className="my-3 p-3 rounded-xl bg-amber-500/10 border-l-4 border-amber-500 text-xs text-amber-200 leading-relaxed font-mono">
            {line.replace('> ', '')}
          </div>
        );
      } else if (line.startsWith('- ')) {
        elements.push(
          <li key={`li-${keyIdx++}`} className="text-xs sm:text-sm text-slate-300 ml-4 list-disc mb-1 leading-relaxed">
            {line.replace('- ', '')}
          </li>
        );
      } else if (line.startsWith('1. ') || line.startsWith('2. ') || line.startsWith('3. ') || line.startsWith('4. ') || line.startsWith('5. ')) {
        elements.push(
          <li key={`oli-${keyIdx++}`} className="text-xs sm:text-sm text-slate-300 ml-4 list-decimal mb-1.5 leading-relaxed">
            {line.replace(/^\d+\.\s*/, '')}
          </li>
        );
      } else if (line.trim() === '---') {
        elements.push(<hr key={`hr-${keyIdx++}`} className="my-6 border-[#242835]" />);
      } else if (line.trim().length > 0) {
        elements.push(
          <p key={`p-${keyIdx++}`} className="text-xs sm:text-sm text-slate-300 mb-3 leading-relaxed">
            {line}
          </p>
        );
      }
    }

    flushTable();
    flushCode();

    return elements;
  };

  return (
    <div className="min-h-screen bg-[#07080b] text-slate-200 font-sans antialiased selection:bg-amber-400/30 selection:text-amber-300 flex flex-col">
      {/* Top Banner Navigation */}
      <header className="sticky top-0 z-40 bg-[#0c0e14]/90 backdrop-blur-md border-b border-[#222633] px-4 py-3 sm:px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <a 
              href="../" 
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#161822] hover:bg-[#202433] text-slate-300 hover:text-white border border-[#262a38] text-xs font-mono transition"
              title="Return to Skon's Web Flasher"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Web Flasher</span>
            </a>
            
            <div className="flex items-center gap-2">
              <span className="text-lg">📖</span>
              <h1 className="text-sm sm:text-base font-bold text-slate-100 font-mono tracking-tight flex items-center gap-1.5">
                <span>SKON'S USB TOOL</span>
                <span className="text-amber-400 text-xs px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20">WIKI</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="https://github.com/olosnoks/usb-tool"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#161822] hover:bg-[#202433] text-slate-300 hover:text-white border border-[#262a38] text-xs font-mono transition"
            >
              <Github className="w-3.5 h-3.5 text-slate-400" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Layout Container */}
      <div className="max-w-7xl mx-auto w-full flex-1 flex flex-col md:flex-row gap-6 p-4 sm:p-6">
        {/* Sidebar Navigation */}
        <aside className="w-full md:w-80 shrink-0 space-y-4">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search wiki articles, commands, chips..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#12141c] border border-[#242938] rounded-xl pl-9 pr-3.5 py-2 text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400 transition"
            />
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none text-[11px] font-mono">
            {WIKI_CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-2.5 py-1 rounded-lg border transition whitespace-nowrap text-[11px] ${
                  selectedCategory === cat.id
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-bold'
                    : 'bg-[#12141c] border-[#242938] text-slate-400 hover:text-slate-200'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Article List */}
          <div className="bg-[#0e1017] border border-[#202534] rounded-2xl p-2 space-y-1 overflow-y-auto max-h-[calc(100vh-240px)]">
            <div className="px-2 py-1 text-[10px] font-mono uppercase text-slate-500 tracking-wider font-bold">
              Documentation Index ({filteredArticles.length})
            </div>
            {filteredArticles.map(article => {
              const isSelected = activeArticle?.id === article.id;
              return (
                <button
                  key={article.id}
                  onClick={() => setSelectedArticleId(article.id)}
                  className={`w-full text-left p-2.5 rounded-xl transition flex flex-col gap-1 border ${
                    isSelected
                      ? 'bg-gradient-to-r from-amber-500/15 to-transparent border-amber-500/40 text-amber-200'
                      : 'hover:bg-[#151822] border-transparent text-slate-300 hover:text-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold leading-snug line-clamp-1">
                      {article.title}
                    </span>
                    <span className="text-[9px] font-mono text-slate-500 whitespace-nowrap">
                      {article.readTime}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                    {article.summary}
                  </p>
                </button>
              );
            })}
            {filteredArticles.length === 0 && (
              <div className="p-6 text-center text-xs text-slate-500 font-mono">
                No matching articles found for "{searchQuery}".
              </div>
            )}
          </div>
        </aside>

        {/* Article Reader Pane */}
        <main className="flex-1 bg-[#0e1017] border border-[#202534] rounded-2xl p-5 sm:p-8 overflow-hidden shadow-xl shadow-black/40">
          {activeArticle ? (
            <article className="space-y-4 max-w-4xl">
              {/* Article Meta Bar */}
              <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-[#202433]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold uppercase border border-amber-500/30">
                    {activeArticle.category}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {activeArticle.readTime}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {activeArticle.tags.map((tag, tIdx) => (
                    <span key={tIdx} className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#171a24] text-slate-400 border border-[#262c3d]">
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Rendered Markdown Body */}
              <div className="prose prose-invert max-w-none text-slate-200">
                {renderMarkdown(activeArticle.content)}
              </div>

              {/* Bottom Quick Help Card */}
              <div className="mt-8 pt-4 border-t border-[#202433] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-mono text-slate-400">
                <span>Want to test this firmware now?</span>
                <a
                  href="../"
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold transition flex items-center gap-1.5 shadow-md shadow-amber-500/10"
                >
                  <span>Launch Web Flasher</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </article>
          ) : (
            <div className="text-center py-20 text-slate-500 font-mono text-xs">
              Select an article from the sidebar to begin reading.
            </div>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-[#1c202c] bg-[#08090d] px-6 py-4 text-center text-xs font-mono text-slate-500">
        Skon's USB Tool & Web Flasher Documentation • Built with React & Vite • Open-Source Hardware Toolkit
      </footer>
    </div>
  );
}
