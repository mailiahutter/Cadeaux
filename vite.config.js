import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base "./" : l'application fonctionne quel que soit le sous-dossier
// d'hébergement (GitHub Pages, Netlify, ...).
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { environment: 'node' },
});
