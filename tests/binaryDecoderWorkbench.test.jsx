import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import BinaryDecoderWorkbench from '../src/components/tools/BinaryDecoderWorkbench.jsx';

// Server render: the workbench loads without a browser and shows its decode view
// for the built-in protobuf example (computed locally, not device data).
describe('BinaryDecoderWorkbench', () => {
  it('renders the decode tab with the built-in example decoded', () => {
    const html = renderToString(<BinaryDecoderWorkbench />);
    expect(html).toContain('Offline, schema-less');
    expect(html).toContain('Decode');
    expect(html).toContain('Encode JSON');
    expect(html).toContain('Struct');
    expect(html).toContain('Framing');
    expect(html).toContain('Protobuf (raw, no schema)');
    expect(html).toContain('testing');
  });
});
