import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const SERVER_TARGET = process.env.VITE_SERVER_URL ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: SERVER_TARGET, changeOrigin: true },
      '/ws': { target: SERVER_TARGET, ws: true },
    },
  },
})
