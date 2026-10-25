import { loader, Monaco } from '@monaco-editor/react';

let configured = false;
let themeDefined = false;

export function ensureMonacoConfigured() {
  if (configured) return;
  configured = true;
  // Sirve los assets pre-compilados oficiales de Monaco localmente desde /vs (cero CDN externa y build instantáneo)
  loader.config({ paths: { vs: '/vs' } });
}

export function defineInsanusTheme(monaco: Monaco) {
  if (themeDefined) return;
  themeDefined = true;

  monaco.editor.defineTheme('insanus-obsidian', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c084fc' },
      { token: 'string', foreground: '34d399' },
      { token: 'number', foreground: 'fbbf24' },
      { token: 'type', foreground: '38bdf8' },
      { token: 'function', foreground: '60a5fa' },
    ],
    colors: {
      'editor.background': '#09090b',
      'editor.foreground': '#e4e4e7',
      'editorLineNumber.foreground': '#52525b',
      'editorLineNumber.activeForeground': '#a1a1aa',
      'editor.lineHighlightBackground': '#14171f',
      'editor.selectionBackground': '#10b98133',
      'editorCursor.foreground': '#10b981',
      'editorIndentGuide.background1': '#27272a',
      'editorIndentGuide.activeBackground1': '#3f3f46',
      'diffEditor.insertedTextBackground': '#10b98126',
      'diffEditor.removedTextBackground': '#f43f5e26',
    },
  });
}
