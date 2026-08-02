import { LRLanguage } from '@codemirror/language';
import { styleTags, tags } from '@lezer/highlight';
import { parser } from './tikz-parser';

export const tikzLanguage = LRLanguage.define({
  name: 'tikz',
  parser: parser.configure({
    props: [
      styleTags({
        Command: tags.keyword,
        Comment: tags.lineComment,
        Atom: tags.content,
        BeginTikz: tags.controlKeyword,
        EndTikz: tags.controlKeyword,
        BeginScope: tags.controlKeyword,
        EndScope: tags.controlKeyword,
      }),
    ],
  }),
  languageData: {
    commentTokens: { line: '%' },
    closeBrackets: { brackets: ['(', '[', '{', '$'] },
  },
});

// Compatibility export for the existing editor seam. This is now a generated
// Lezer LRLanguage, not the former line-oriented StreamLanguage.
export const tikzStreamLanguage = tikzLanguage;
