# Demand Contract System

Web system for managing medical-device spare-part **demand contracts** (HTMS):
contracts and line items, engineer requests, supervisor approval, clinical-engineer
release, tracking, goods receipt, reports, notifications and audit log.

- **Frontend:** React + Vite + Tailwind (`src/`)
- **Backend:** Supabase — Postgres, Auth, Storage, Row Level Security (`supabase/schema.sql`)
- **Hosting:** GitHub Pages through GitHub Actions (`.github/workflows/deploy.yml`)

## 1. Connect Supabase (once)

1. Create a new project at https://supabase.com (a dedicated project for this system).
2. **SQL Editor** → paste the whole of `supabase/schema.sql` → **Run**.
3. **Authentication → Sign In / Providers → Email** → turn **Confirm email** off
   (accounts are activated by the admin inside the app instead).
4. **Project Settings → API** → copy the *Project URL* and the *anon / publishable* key.
5. Copy `.env.example` to `.env` and paste the two values.

## 2. Run locally

    npm install
    npm run dev

Open the printed link (usually http://localhost:5173).
**The first account that signs up becomes the Admin.** Every later account stays
inactive until the Admin activates it and sets its role in **Admin → Users**.

## 3. Connect GitHub

    git init
    git add .
    git commit -m "Demand Contract System - Supabase version"
    git branch -M main
    git remote add origin https://github.com/YOUR-USER/demand-contract-system.git
    git push -u origin main

Then in the repository on GitHub:

- **Settings → Pages → Source:** GitHub Actions
- **Settings → Secrets and variables → Actions:** add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`

Every push to `main` now builds and publishes the site automatically.
`.env` is in `.gitignore` and is never uploaded.

## Roles

| Role | What it does |
|---|---|
| Engineer | Submits requests to one of his supervisors |
| Supervisor | Approves / rejects / returns his team's requests; manages contracts; his own requests go straight to clinical |
| Clinical engineer | Shared pool; completes approved requests with a release number and promise date |
| Admin | Users, roles, teams, settings; can do everything |

## Request flow

`pending` → supervisor approves → `pending_clinical` → clinical engineer adds release
number + promise date → `in_process` → marked `approved` → all items received → `closed` → archive.
Side paths: `returned` (edit and resubmit), `rejected`, `cancelled`.

Contract balance = total − previously consumed − all requests from `pending_clinical` onward.
A request that would exceed the remaining balance is refused.

## Project layout

    src/                 React app (pages, ui, lib)
    src/lib/supabase.js  Supabase client (reads .env)
    supabase/schema.sql  Database: tables, RLS, functions, storage bucket
    .github/workflows/   GitHub Pages deployment
