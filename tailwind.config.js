/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        insanus: {
          bg: '#09090b',
          editor: '#0b0d12',
          chrome: '#0e1017',
          panel: '#11131a',
          card: '#161922',
          accent: '#10b981',
        },
      },
    },
  },
  plugins: [],
};
