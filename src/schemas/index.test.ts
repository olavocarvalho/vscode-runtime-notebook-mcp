import { describe, expect, it } from 'vitest';
import {
  CellIndexSchema,
  CodeSchema,
  ListCellsInputSchema,
  ResponseFormat,
  ResponseFormatSchema
} from './index';

describe('ResponseFormatSchema', () => {
  it('accepts markdown format', () => {
    const result = ResponseFormatSchema.parse('markdown');
    expect(result).toBe(ResponseFormat.MARKDOWN);
  });

  it('accepts json format', () => {
    const result = ResponseFormatSchema.parse('json');
    expect(result).toBe(ResponseFormat.JSON);
  });

  it('defaults to markdown when undefined', () => {
    const result = ResponseFormatSchema.parse(undefined);
    expect(result).toBe(ResponseFormat.MARKDOWN);
  });

  it('rejects invalid format', () => {
    expect(() => ResponseFormatSchema.parse('xml')).toThrow();
  });
});

describe('CellIndexSchema', () => {
  it('accepts valid index', () => {
    expect(CellIndexSchema.parse(0)).toBe(0);
    expect(CellIndexSchema.parse(5)).toBe(5);
  });

  it('rejects negative index', () => {
    expect(() => CellIndexSchema.parse(-1)).toThrow();
  });

  it('rejects non-integer', () => {
    expect(() => CellIndexSchema.parse(1.5)).toThrow();
  });
});

describe('CodeSchema', () => {
  it('accepts valid code', () => {
    expect(CodeSchema.parse('print("hello")')).toBe('print("hello")');
  });

  it('rejects empty string', () => {
    expect(() => CodeSchema.parse('')).toThrow();
  });
});

describe('ListCellsInputSchema', () => {
  it('parses empty object with defaults', () => {
    const result = ListCellsInputSchema.parse({});
    expect(result.response_format).toBe(ResponseFormat.MARKDOWN);
  });

  it('parses with explicit format', () => {
    const result = ListCellsInputSchema.parse({ response_format: 'json' });
    expect(result.response_format).toBe(ResponseFormat.JSON);
  });

  it('rejects unknown properties', () => {
    expect(() => ListCellsInputSchema.parse({ unknown: 'value' })).toThrow();
  });
});

