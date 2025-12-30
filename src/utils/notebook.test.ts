import { describe, it, expect } from 'vitest';
import { generateCellId } from './notebook';

describe('generateCellId', () => {
  it('generates a string ID', () => {
    const id = generateCellId();
    
    expect(typeof id).toBe('string');
  });

  it('generates non-empty IDs', () => {
    const id = generateCellId();
    
    expect(id.length).toBeGreaterThan(0);
  });

  it('generates unique IDs', () => {
    const ids = new Set<string>();
    
    for (let i = 0; i < 100; i++) {
      ids.add(generateCellId());
    }
    
    expect(ids.size).toBe(100);
  });

  it('generates alphanumeric IDs', () => {
    const id = generateCellId();
    
    expect(id).toMatch(/^[a-z0-9]+$/);
  });
});

