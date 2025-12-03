import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";
import { traeBadgePlugin } from 'vite-plugin-trae-solo-badge';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
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
          ws: true,
          rewrite: (path) => path.replace(/^\/openspeech/, '')
        },
        '/sauc': {
          target: 'https://openspeech.bytedance.com',
          changeOrigin: true,
          secure: false,
          ws: true,
          rewrite: (path) => path.replace(/^\/sauc\//, '/'),
          headers: {
            'X-Api-App-Key': env.VITE_VOLC_ASR_APP_KEY || env.VITE_VOLC_TTS_APP_ID || '',
            'X-Api-Access-Key': env.VITE_VOLC_ASR_ACCESS_KEY || env.VITE_VOLC_TTS_TOKEN || '',
            'X-Api-Resource-Id': env.VITE_VOLC_ASR_SAUC_RESOURCE_ID || 'volc.seedasr.sauc.duration',
            'Origin': 'https://openspeech.bytedance.com',
          },
          configure: (proxy) => {
            proxy.on('proxyReqWs', (proxyReq, req) => {
              try {
                proxyReq.setHeader('Origin', 'https://openspeech.bytedance.com')
                const cid = (globalThis.crypto && (globalThis.crypto as any).randomUUID) ? (globalThis.crypto as any).randomUUID() : `cid-${Date.now()}-${Math.random().toString(36).slice(2)}`
                proxyReq.setHeader('X-Api-Connect-Id', cid)
              } catch { }
            })
          }
        },
        '/asr': {
          target: 'https://openspeech.bytedance.com',
          changeOrigin: true,
          secure: false,
          ws: true,
          rewrite: (path) => path.replace(/^\/asr/, ''),
          headers: {
            'Authorization': `Bearer ${env.VITE_VOLC_ASR_ACCESS_KEY || env.VITE_VOLC_TTS_TOKEN || ''}`,
            'X-Api-App-Key': env.VITE_VOLC_ASR_APP_KEY || env.VITE_VOLC_TTS_APP_ID || '',
            'X-Api-Access-Key': env.VITE_VOLC_ASR_ACCESS_KEY || env.VITE_VOLC_TTS_TOKEN || '',
            'X-Api-Resource-Id': env.VITE_VOLC_ASR_SAUC_RESOURCE_ID || 'volc.seedasr.sauc.duration',
          },
          configure: (proxy) => {
            proxy.on('proxyReqWs', (proxyReq, req) => {
              try {
                proxyReq.setHeader('Authorization', `Bearer ${env.VITE_VOLC_ASR_ACCESS_KEY || env.VITE_VOLC_TTS_TOKEN || ''}`)
                proxyReq.setHeader('X-Api-App-Key', env.VITE_VOLC_ASR_APP_KEY || env.VITE_VOLC_TTS_APP_ID || '')
                proxyReq.setHeader('X-Api-Access-Key', env.VITE_VOLC_ASR_ACCESS_KEY || env.VITE_VOLC_TTS_TOKEN || '')
                proxyReq.setHeader('X-Api-Resource-Id', env.VITE_VOLC_ASR_SAUC_RESOURCE_ID || 'volc.seedasr.sauc.duration')
                const cid = (globalThis.crypto && (globalThis.crypto as any).randomUUID) ? (globalThis.crypto as any).randomUUID() : `cid-${Date.now()}-${Math.random().toString(36).slice(2)}`
                proxyReq.setHeader('X-Api-Connect-Id', cid)
              } catch { }
            })
          }
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
  }
})
