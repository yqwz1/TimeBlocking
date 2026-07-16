import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.TB_API_PORT || 4141}`,
        changeOrigin: true,
      },
    },
  },
});
