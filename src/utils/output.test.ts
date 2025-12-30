import { describe, it, expect } from 'vitest';
import { formatOutputsAsMarkdown, CellOutput } from './output';

describe('formatOutputsAsMarkdown', () => {
  it('formats text output with code block', () => {
    const outputs: CellOutput[] = [
      { type: 'text', text: 'Hello, World!' }
    ];
    
    const result = formatOutputsAsMarkdown(outputs);
    
    expect(result).toBe('```\nHello, World!\n```');
  });

  it('formats error output with name and message', () => {
    const outputs: CellOutput[] = [
      { type: 'error', name: 'TypeError', message: 'undefined is not a function', stack: '' }
    ];
    
    const result = formatOutputsAsMarkdown(outputs);
    
    expect(result).toBe('**Error**: TypeError: undefined is not a function');
  });

  it('formats error output with stack trace', () => {
    const outputs: CellOutput[] = [
      { 
        type: 'error', 
        name: 'ValueError', 
        message: 'invalid value', 
        stack: 'at line 1\nat line 2' 
      }
    ];
    
    const result = formatOutputsAsMarkdown(outputs);
    
    expect(result).toContain('**Error**: ValueError: invalid value');
    expect(result).toContain('```\nat line 1\nat line 2\n```');
  });

  it('formats image output as placeholder', () => {
    const outputs: CellOutput[] = [
      { type: 'image', data: 'base64data', mimeType: 'image/png' }
    ];
    
    const result = formatOutputsAsMarkdown(outputs);
    
    expect(result).toBe('[Image output: image/png]');
  });

  it('handles multiple outputs', () => {
    const outputs: CellOutput[] = [
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' }
    ];
    
    const result = formatOutputsAsMarkdown(outputs);
    
    expect(result).toBe('```\nfirst\n```\n```\nsecond\n```');
  });

  it('returns empty string for no outputs', () => {
    const result = formatOutputsAsMarkdown([]);
    
    expect(result).toBe('');
  });
});

