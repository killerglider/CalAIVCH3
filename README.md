# Vinayak Procurement Agent Demo

A Next.js 14 App Router skeleton for a procurement-agent workflow. It provides strict shared TypeScript contracts, deterministic mock API responses, placeholder workflow views, schema-scoped Supabase clients, an Anthropic boundary stub, and an initial PostgreSQL migration so frontend and backend work can proceed independently.

## Run locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server:
   ```bash
   npm run dev
   ```
3. Open [http://localhost:3000](http://localhost:3000).

The mock views and API routes work without environment variables or a database. When connecting services, copy `.env.example` to `.env.local` and provide the required values. API routes use the Node.js runtime and are ready for Vercel deployment.

## Data handling

`/data` is reserved for confidential Vinayak material and is ignored by Git. Never commit files from that directory; only its `.gitkeep` placeholder belongs in version control.
