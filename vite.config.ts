import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";
import { traeBadgePlugin } from 'vite-plugin-trae-solo-badge';

// https://vite.dev/config/
export default defineConfig({
  build: {
    sourcemap: 'hidden',
  },
  server: {
    proxy: {
      '/openrouter': {
        target: 'https://openrouter.ai',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/openrouter/, '')
      },
      '/openspeech': {
        target: 'https://openspeech.bytedance.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/openspeech/, '')
      },
    },
  },
  plugins: [
    react({
      babel: {
        plugins: [
          'react-dev-locator',
        ],
      },
    }),
    traeBadgePlugin({
      variant: 'dark',
      position: 'bottom-right',
      prodOnly: true,
      clickable: true,
      clickUrl: 'https://www.trae.ai/solo?showJoin=1',
      autoTheme: true,
      autoThemeTarget: '#root'
    }), 
    tsconfigPaths()
  ],
})
