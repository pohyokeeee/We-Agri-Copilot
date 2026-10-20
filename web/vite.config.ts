import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Phase 1: UI only with mock data. Phase 2 adds the /api proxy to the FastAPI backend on :8000.
export default defineConfig({
  plugins: [react(), tailwindcss()],
})
