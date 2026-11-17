import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import BurpProxyWorkbench from '../src/components/tools/BurpProxyWorkbench.jsx';
import ApiClientWorkbench from '../src/components/tools/ApiClientWorkbench.jsx';
import WebAnalyzerWorkbench from '../src/components/tools/WebAnalyzerWorkbench.jsx';

describe('NET-5/7 components render', () => {
  it('Repeater shows timeout, history controls and Copy as', () => {
    const html = renderToString(<BurpProxyWorkbench hideProxyConfig />);
    expect(html).toContain('Copy as');
    expect(html).toContain('Timeout');
    expect(html).toContain('Export HAR');
    expect(html).toContain('Clear');
  });
  it('API client and Web Analyzer render', () => {
    expect(renderToString(<ApiClientWorkbench hideProxyConfig />)).toContain('Load spec');
    expect(renderToString(<WebAnalyzerWorkbench />)).toContain('Export (.json)');
  });
});
