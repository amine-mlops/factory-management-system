import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Live mode (VITE_USE_MOCK=false, VITE_API_URL=/api) proxies /api to FastAPI (`make api`, default :8000).
// Override with NEXUS_API_PROXY=http://localhost:<port> when 8000 is taken (`make dev PORT=<port>` sets it).
const apiTarget = process.env.NEXUS_API_PROXY ?? 'http://localhost:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': apiTarget },
  },
})
