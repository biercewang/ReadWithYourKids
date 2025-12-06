import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";

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
            'Authorization': `Bearer; ${env.VITE_VOLC_ASR_ACCESS_KEY || env.VITE_VOLC_TTS_TOKEN || ''}`,
            'X-Api-App-Key': env.VITE_VOLC_ASR_APP_KEY || env.VITE_VOLC_TTS_APP_ID || '',
            'X-Api-Access-Key': env.VITE_VOLC_ASR_ACCESS_KEY || env.VITE_VOLC_TTS_TOKEN || '',
            'X-Api-Resource-Id': env.VITE_VOLC_ASR_SAUC_RESOURCE_ID || 'volc.seedasr.sauc.duration',
            'Origin': 'https://openspeech.bytedance.com',
          },
          configure: (proxy) => {
            proxy.on('proxyReqWs', (proxyReq) => {
              try {
                proxyReq.setHeader('Authorization', `Bearer; ${env.VITE_VOLC_ASR_ACCESS_KEY || env.VITE_VOLC_TTS_TOKEN || ''}`)
                proxyReq.setHeader('Origin', 'https://openspeech.bytedance.com')
                const c = globalThis.crypto as Crypto | undefined
                const cid = c && typeof c.randomUUID === 'function' ? c.randomUUID() : `cid-${Date.now()}-${Math.random().toString(36).slice(2)}`
                proxyReq.setHeader('X-Api-Connect-Id', cid)
              } catch (e) { void e }
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
            'Authorization': `Bearer; ${env.VITE_VOLC_ASR_ACCESS_KEY || env.VITE_VOLC_TTS_TOKEN || ''}`,
            'X-Api-App-Key': env.VITE_VOLC_ASR_APP_KEY || env.VITE_VOLC_TTS_APP_ID || '',
            'X-Api-Access-Key': env.VITE_VOLC_ASR_ACCESS_KEY || env.VITE_VOLC_TTS_TOKEN || '',
            'X-Api-Resource-Id': env.VITE_VOLC_ASR_SAUC_RESOURCE_ID || 'volc.seedasr.sauc.duration',
            'Origin': 'https://openspeech.bytedance.com',
          },
          configure: (proxy) => {
            proxy.on('proxyReqWs', (proxyReq) => {
              try {
                proxyReq.setHeader('Authorization', `Bearer; ${env.VITE_VOLC_ASR_ACCESS_KEY || env.VITE_VOLC_TTS_TOKEN || ''}`)
                proxyReq.setHeader('X-Api-App-Key', env.VITE_VOLC_ASR_APP_KEY || env.VITE_VOLC_TTS_APP_ID || '')
                proxyReq.setHeader('X-Api-Access-Key', env.VITE_VOLC_ASR_ACCESS_KEY || env.VITE_VOLC_TTS_TOKEN || '')
                proxyReq.setHeader('X-Api-Resource-Id', env.VITE_VOLC_ASR_SAUC_RESOURCE_ID || 'volc.seedasr.sauc.duration')
                proxyReq.setHeader('Origin', 'https://openspeech.bytedance.com')
                const c = globalThis.crypto as Crypto | undefined
                const cid = c && typeof c.randomUUID === 'function' ? c.randomUUID() : `cid-${Date.now()}-${Math.random().toString(36).slice(2)}`
                proxyReq.setHeader('X-Api-Connect-Id', cid)
              } catch (e) { void e }
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
      tsconfigPaths()
    ],
  }
})
