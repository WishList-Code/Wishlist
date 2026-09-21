# Heavenly View Wishlist — setup notes

A group gift wishlist site for family & friends: people sign in, join or
create a "group" (e.g. a family), and add items to their own wishlist that
other group members can see (but not their own -- no spoiling surprises).

## How the pieces fit together

- **`index.html` / `style.css` / `app.js` / `config.js`** — the whole
  front end. It's plain HTML/CSS/JS (no build step, no framework), hosted
  as a static site.
- **`supabase-schema.sql`** — the database schema (tables + row-level
  security policies). Run once, in Supabase's SQL Editor, against a new
  project.
- **`config.js`** — holds the Supabase project's public URL and
  publishable key. Safe to be public in the repo (see the comments in the
  file) since real access control is enforced by the row-level security
  policies in `supabase-schema.sql`, not by keeping this key secret.
- **`api/scrape.js`, `api/chat.js`** — small serverless functions. These
  can't run on GitHub Pages (it only serves static files) — they need
  **Vercel**, which is why the site is deployed there too.

## Where things are hosted

- **GitHub repo:** `WishList-Code/Wishlist`
- **Static site (GitHub Pages):** `https://wishlist-code.github.io/Wishlist/`
  — good for quickly checking the UI, but the AI assistant and the
  link-preview scraper won't work here (no serverless functions).
- **Full site with working API routes (Vercel):** set up by connecting
  the same GitHub repo to a new Vercel project. See "Vercel setup" below.
- **Database (Supabase):** project "Heavenly View Wishlist", org "Star
  INC.", project ref `fobobmhfuevqdgvvyxxm`.

## Supabase setup (already done once, kept here for reference)

1. Create a Supabase project.
2. Open **SQL Editor → New query**, paste in the contents of
   `supabase-schema.sql`, and run it. This creates four tables
   (`profiles`, `groups`, `group_members`, `wishlist_items`) with row-level
   security policies, plus a trigger that auto-creates a `profiles` row
   whenever someone signs up.
3. Open **Project Settings → Data API** for the Project URL, and
   **Project Settings → API Keys** for the publishable (formerly "anon
   public") key. Put both into `config.js`:
   ```js
   const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
   const SUPABASE_ANON_KEY = "YOUR-PUBLISHABLE-KEY";
   ```
4. By default, Supabase requires email confirmation on sign-up (the new
   user gets a "confirm your email" message instead of being logged in
   right away). That can be turned off in **Authentication → Providers →
   Email** if you'd rather people get in immediately, which may suit a
   small family app better.

## Vercel setup

The `api/` folder only runs on Vercel, not on GitHub Pages. To get it live:

1. In Vercel, "Add New Project" and import the `WishList-Code/Wishlist`
   GitHub repo.
2. No build settings are needed — it's a static site with serverless
   functions, so the defaults work (leave "Framework Preset" as Other /
   None, no build command needed).
3. Before or after the first deploy, add an environment variable:
   - **Name:** `GEMINI_API_KEY`
   - **Value:** your own Google Gemini API key (get one at
     [aistudio.google.com/apikey](https://aistudio.google.com/apikey))
   - This is what lets `api/chat.js` (the gift-idea assistant) work. It's
     never used client-side, so it's safe to store as a normal (not
     client-exposed) env var.
4. Deploy. Vercel gives you a URL like
   `https://wishlist-<something>.vercel.app` — that's the one to actually
   use day-to-day, since it's the only place both API routes work.
5. To sanity-check the deploy:
   - `https://<your-vercel-url>/api/scrape` should respond (not 404) to a
     POST with `{"url": "https://example.com"}`.
   - `https://<your-vercel-url>/api/chat` should respond (not 404) to a
     POST with `{"message": "my mom loves gardening"}` — assuming
     `GEMINI_API_KEY` is set, it should return `{"reply": "..."}`.

## Known gaps / things to revisit

- **`assets/` casing:** the logo currently lives at `Assets/logo.png`
  (capital A) because of how it was first uploaded. GitHub's web editor
  can only rename/move a file within its current folder, so moving it
  into a lowercase `assets/` folder needs to be done either by dragging it
  in GitHub's file browser, or by uploading a fresh copy to `assets/` and
  deleting the old one.
- **`assets/logo-full.jpg`** — not yet added; add it the same way if/when
  there's a wordmark version of the logo to use.
- Email/password is the only sign-in method right now (no magic links, no
  social sign-in) — intentional, to keep the first version simple.
