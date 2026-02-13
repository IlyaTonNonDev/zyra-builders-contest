import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: [
      'providence-most-instructional-investments.trycloudflare.com',
      'floral-expenses-sons-flavor.trycloudflare.com',
      'panels-pros-andy-nelson.trycloudflare.com',
    ],
  },
})
