import { describe, expect, it } from 'vitest';
import {
  orderedTikzOptionValues,
  parseTikzOptionSequence,
  TIKZ_OPTION_SEQUENCE_SCHEMA,
} from './option-sequence';

describe('lossless TikZ option sequence', () => {
  it('preserves nested comma languages, duplicate keys, order, and ranges', () => {
    const raw = String.raw`red,postaction={decorate,decoration={markings,mark=at position .5 with {\node{A,B};}}},red`;
    const sequence = parseTikzOptionSequence(raw, 17);

    expect(sequence.schema).toBe(TIKZ_OPTION_SEQUENCE_SCHEMA);
    expect(sequence.balanced).toBe(true);
    expect(sequence.entries.map((entry) => entry.raw)).toEqual([
      'red',
      String.raw`postaction={decorate,decoration={markings,mark=at position .5 with {\node{A,B};}}}`,
      'red',
    ]);
    expect(sequence.entries.map((entry) => entry.key)).toEqual([
      'red',
      'postaction',
      'red',
    ]);
    expect(sequence.entries[1]?.value).toBe(
      String.raw`{decorate,decoration={markings,mark=at position .5 with {\node{A,B};}}}`,
    );
    expect(sequence.entries[0]?.range).toEqual({ start: 17, end: 20 });
    expect(sequence.entries[1]?.range.start).toBe(21);
    expect(sequence.entries[2]?.range.end).toBe(17 + raw.length);
  });

  it('does not split escaped delimiters or math and quote payloads', () => {
    const raw = String.raw`label="A,B",execute at begin node={\def\x{1,2}},$x,y$,blue`;

    expect(orderedTikzOptionValues(raw)).toEqual([
      'label="A,B"',
      String.raw`execute at begin node={\def\x{1,2}}`,
      '$x,y$',
      'blue',
    ]);
  });

  it('fails closed to one opaque entry when delimiters are unbalanced', () => {
    const raw = 'red,postaction={decorate,blue';
    const sequence = parseTikzOptionSequence(raw);

    expect(sequence.balanced).toBe(false);
    expect(sequence.entries).toHaveLength(1);
    expect(sequence.entries[0]?.raw).toBe(raw);
    expect(sequence.entries[0]?.value).toBeNull();
  });

  it('preserves comments while exposing the following option under standard catcodes', () => {
    const raw = 'red,% keep, this comma\r\n  thick,blue';
    const sequence = parseTikzOptionSequence(raw);

    expect(sequence.entries.map((entry) => entry.raw)).toEqual([
      'red',
      '% keep, this comma\r\n  thick',
      'blue',
    ]);
    expect(sequence.entries.map((entry) => entry.interpreted)).toEqual([
      'red',
      'thick',
      'blue',
    ]);
    expect(sequence.entries[1]?.interpretedKey).toBe('thick');
    expect(sequence.entries[1]?.interpretedValue).toBeNull();
    expect(orderedTikzOptionValues(raw)).toEqual(['red', 'thick', 'blue']);
    expect(sequence.entries[1]?.interpretedRange).toEqual({
      start: raw.indexOf('thick'),
      end: raw.indexOf('thick') + 'thick'.length,
    });
  });
});
