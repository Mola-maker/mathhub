import { StreamLanguage, type StringStream } from '@codemirror/language';

export const tikzStreamLanguage = StreamLanguage.define<{ inCalc: boolean }>({
  name: 'tikz',
  startState: () => ({ inCalc: false }),
  token(stream: StringStream, state) {
    if (stream.match(/%.*/)) return 'lineComment';
    if (stream.match(/\\[a-zA-Z]+/)) return 'keyword';
    if (stream.match(/\\./)) return 'keyword';
    if (stream.match(/\d+(?:\.\d+)?/)) return 'number';
    if (stream.match(/--/)) return 'operator';
    if (stream.match(/[{}[\]()]/)) return 'bracket';
    if (stream.match(/[+\-*/=,:;!]/)) return 'operator';
    if (stream.eat('$')) {
      state.inCalc = !state.inCalc;
      return 'atom';
    }
    if (stream.match(/[A-Za-z][A-Za-z0-9_-]*/)) {
      return state.inCalc ? 'variableName' : 'propertyName';
    }
    stream.next();
    return null;
  },
});

