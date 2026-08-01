import { describe, expect, it } from 'vitest';
import { chromeVisible, isTuiChrome, stripChrome } from '../src/chrome';

describe('stripChrome', () => {
  it('peels rounded composer box', () => {
    const lines = [
      'real output',
      '╭──────────────╮',
      '│ prompt here  │',
      '╰──────────────╯',
      'esc to interrupt',
    ];
    expect(stripChrome(lines)).toBe(1);
  });

  it('keeps sharp-corner table rows', () => {
    const lines = [
      '┌────┬────┐',
      '│ a  │ b  │',
      '└────┴────┘',
      'esc to interrupt',
    ];
    // peels only the interrupt line; table (sharp) stops the peel
    expect(stripChrome(lines)).toBe(3);
  });
});

describe('isTuiChrome', () => {
  it('flags spinner and shortcuts', () => {
    expect(isTuiChrome('? for shortcuts')).toBe(true);
    expect(isTuiChrome('✻ Thinking')).toBe(true);
    expect(isTuiChrome('real code here')).toBe(false);
  });
});

describe('chromeVisible', () => {
  it('detects chrome in tail', () => {
    expect(chromeVisible('foo\nbar\n? for shortcuts')).toBe(true);
    expect(chromeVisible('just text\nmore text\nstill text')).toBe(false);
  });
});
