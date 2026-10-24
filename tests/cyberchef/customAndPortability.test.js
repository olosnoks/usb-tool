import { describe, it, expect } from 'vitest';
import { Chef, Dish, registry } from '../../src/utils/cyberchef/index.js';
import { CustomScript } from '../../src/utils/cyberchef/operations/Custom.js';
import { generateStandaloneHtml, escapeHtml } from '../../src/utils/cyberchef/exportStandalone.js';

describe('CyberChef Custom Script Operation (Custom.js)', () => {
  it('executes user JavaScript code and transforms input string', async () => {
    const customOp = new CustomScript();
    const dish = new Dish('CyberChef', 'string');
    const result = await customOp.execute(dish, {
      code: "return input.split('').reverse().join('');"
    });
    expect(result.toString()).toBe('fehCrebyC');
  });

  it('supports complex data formatting scripts', async () => {
    const customOp = new CustomScript();
    const dish = new Dish('alice,bob,carol', 'string');
    const result = await customOp.execute(dish, {
      code: "return input.split(',').map(name => name.toUpperCase()).join(' | ');"
    });
    expect(result.toString()).toBe('ALICE | BOB | CAROL');
  });

  it('handles runtime exceptions and throws descriptive error', async () => {
    const customOp = new CustomScript();
    const dish = new Dish('test data', 'string');
    await expect(
      customOp.execute(dish, {
        code: "const nonExistent = null; return nonExistent.foo.bar;"
      })
    ).rejects.toThrow(/Custom Script Execution Error/);
  });

  it('works seamlessly inside Chef.bake() recipes', async () => {
    const chef = new Chef();
    const recipe = [
      { op: 'To Base64', args: {} },
      { op: 'Custom Script', args: { code: 'return "PRE_" + input + "_POST";' } }
    ];
    const out = await chef.bake('SecretToken', recipe);
    expect(out.toString()).toBe('PRE_U2VjcmV0VG9rZW4=_POST');
  });
});

describe('Recipe Portability & JSON Export/Import', () => {
  it('serializes and deserializes recipe configs with identical execution output', async () => {
    const chef = new Chef();
    const originalRecipe = [
      { op: 'To Hex', args: { delimiter: ' ' } },
      { op: 'From Hex', args: { delimiter: ' ' } },
      { op: 'To Base64', args: {} }
    ];

    const inputData = 'Portability Test Payload 123';
    const output1 = await chef.bake(inputData, originalRecipe);

    // Simulate JSON Export (serialization)
    const exportedJson = JSON.stringify(originalRecipe.map(s => ({ op: s.op, args: s.args })));

    // Simulate JSON Import (deserialization)
    const importedRecipe = JSON.parse(exportedJson);
    const output2 = await chef.bake(inputData, importedRecipe);

    expect(output1.toString()).toBe(output2.toString());
    expect(output2.toString()).toBe(btoa(inputData));
  });
});

describe('Standalone HTML Exporter (exportStandalone.js)', () => {
  it('generates a valid offline-compatible HTML report document', () => {
    const session = {
      title: 'Incident Response Decryption',
      input: 'U2tvbnMgVVNCIFRvb2w=',
      recipe: [
        { op: 'From Base64', args: {} }
      ],
      output: "Skon's USB Tool",
      outputHex: '53 6B 6F 6E 27 73 20 55 53 42 20 54 6F 6F 6C',
      durationMs: 4.2
    };

    const html = generateStandaloneHtml(session);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Incident Response Decryption');
    expect(html).toContain('From Base64');
    expect(html).toContain("Skon&#039;s USB Tool"); // properly HTML-escaped output
    expect(html).toContain('U2tvbnMgVVNCIFRvb2w=');
    expect(html).toContain('Standalone Session');
  });

  it('escapes dangerous HTML characters to prevent XSS in exported reports', () => {
    const dangerous = '<script>alert("XSS")</script>&foo=\'bar\'';
    const clean = escapeHtml(dangerous);
    expect(clean).not.toContain('<script>');
    expect(clean).toContain('&lt;script&gt;');
    expect(clean).toContain('&amp;');
    expect(clean).toContain('&quot;');
    expect(clean).toContain('&#039;');
  });
});
