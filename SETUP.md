# Heavenly View Wishlist — setup notes

A group gift wishlist site for family & friends: people sign in with their
name, join or create a "group" (e.g. a family), and add items to their own
wishlist that other group members can see (but not their own -- no
spoiling surprises). Group members can mark someone else's item as
already bought, and everyone but the person who wanted it can see that --
so the surprise stays a surprise right up until it's opened.

## How the pieces fit together

- **`index.html` / `style.css` / `app.js` / `config.js`** — the whole
  front end. It's plain HTML/CSS/JS (no build step, no framework), hosted
  as a static site.
- **`supabase-schema.sql`** — the database schema (tables + row-level
  security policies + a couple of helper functions). Run once, in
  Supabase's SQL Editor, against a new project.
- **`config.js`** — holds the Supabase project's public URL and
  publishable key. Safe to be public in the repo (see the comments in the
  file) since real access control is enforced by the row-level security
  policies in `supabase-schema.sql`, not by keeping this key secret.
- **`api/scrape.js`, `api/chat.js`** — small serverless functions. These
  can't run on GitHub Pages (it only serves static files) — they need
  **Vercel**, which is why the site is deployed there too.
- **`assets/logo.png`** — a spare logo/photo asset. Not currently
  referenced by the site (the header logo mark is drawn as inline SVG),
  kept here for future use.

## Where things are hosted

- **GitHub repo:** `WishList-Code/Wishlist`
- **Static site (GitHub Pages):** `https://wishlist-code.github.io/Wishlist/`
  — good for quickly checking the UI, but the AI assistant and the
  link-preview scraper won't work here (no serverless functions).
- **Full site with working API routes (Vercel):** `https://wishlist-wine-kappa.vercel.app`
  — this is the one to actually use day-to-day, since it's the only place
  both `/api/scrape` and `/api/chat` work. Connected to the same GitHub
  repo, so every push to `main` auto-deploys here too.
- **Database (Supabase):** project "Heavenly View Wishlist", org "Star
  INC.", project ref `fobobmhfuevqdgvvyxxm`.

## Supabase setup (already done once, kept here for reference)

1. Create a Supabase project.
2. Open **SQL Editor → New query**, paste in the contents of
   `supabase-schema.sql`, and run it. This creates four tables
   (`profiles`, `groups`, `group_members`, `wishlist_items`) with row-level
   security policies, a trigger that auto-creates a `profiles` row
   (with first/last name) whenever someone signs up, a view
   (`wishlist_items_view`) that hides purchase status from an item's own
   owner, and four helper functions used for marking items bought and for
   the owner-assisted "add by name" joining flow (see "Feature notes"
   below).
3. Open **Project Settings → Data API** for the Project URL, and
   **Project Settings → API Keys** for the publishable (formerly "anon
   public") key. Put both into `config.js`:
   ```js
   const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
   const SUPABASE_ANON_KEY = "YOUR-PUBLISHABLE-KEY";
   ```
4. Email confirmation on sign-up is turned **off** for this project
   (Authentication → Providers → Email), so people get in immediately
   after creating an account rather than having to confirm their email
   first — this suits a small family app better.

## Vercel setup (already done once, kept here for reference)

The `api/` folder only runs on Vercel, not on GitHub Pages.

1. In Vercel, "Add New Project" and import the `WishList-Code/Wishlist`
   GitHub repo.
2. No build settings are needed — it's a static site with serverless
   functions, so the defaults work (Framework Preset "Other", no build
   command).
3. Add an environment variable:
   - **Name:** `GEMINI_API_KEY`
   - **Value:** a Google Gemini API key (get one at
     [aistudio.google.com/apikey](https://aistudio.google.com/apikey))
   - This is what lets `api/chat.js` (the gift-idea assistant) work. It's
     never used client-side, so it's safe to store as a normal (not
     client-exposed) env var.
4. Deploy. Every push to `main` on GitHub auto-redeploys.
5. To sanity-check the deploy, POST to `/api/scrape` with
   `{"url": "https://example.com"}` and to `/api/chat` with
   `{"message": "my mom loves gardening"}` — neither should 404, and
   `/api/chat` should come back with a real `{"reply": "..."}`.
## Feature notes

- **Named accounts.** Sign-up collects a first and last name alongside
  email/password (stored in `profiles.first_name` / `profiles.last_name`
  via the sign-up trigger). Everyone is shown by their real name
  everywhere in the app instead of "You", unless they've set a nickname
  for themselves in a particular group (Settings, inside that group).
- **Opening a group shows people, not items.** Tapping a group card lands
  on an alphabetical list of its members first. Tapping a person then
  shows that person's wishlist. This replaced the old behavior of landing
  straight on your own wishlist.
- **Marking items as bought, hidden from the person it's for.** Any group
  member other than the item's own owner can mark it "bought" from that
  person's wishlist view. Everyone else in the group then sees it's
  bought (and who bought it) — except the person who wanted it, who sees
  their own wishlist exactly as before, with no hint anything changed.
  This is enforced on the database side, not just in the app's UI: reads
  go through a view (`wishlist_items_view`) that always nulls out the
  purchase fields for the item's own owner, no matter how the data is
  queried. Only the person who marked an item bought can undo it
  (`unmark_item_purchased`) — nobody else in the group can un-mark
  someone else's purchase.
- **Two ways to join a group.** The original way still works: share the
  group's invite code, and whoever has it can join themselves. New: a
  group's owner (whoever created it) can instead search for someone by
  name and add them directly, without needing to hand out the invite
  code at all. The search covers everyone with an account, not just
  people already in one of the owner's groups (you have to be able to
  find someone *before* they share a group with you), but only the
  actual owner of a given group can add someone to it this way.

## Known gaps / things to revisit

- **`assets/logo-full.jpg`** — not currently added (no wordmark version of
  the logo exists yet); nothing in the site references it, so this is
  safe to leave out.
- Email/password is the only sign-in method right now (no magic links, no
  social sign-in) — intentional, to keep the first version simple.
- The Gemini model used in `api/chat.js` is `gemini-3.6-flash`. If Google
  deprecates it later, the error message from the API will name the
  replacement model to switch to.
- Accounts created before the named-accounts change have no first/last
  name on file, so they display by nickname or email until they update
  their profile (there's currently no in-app "edit your name" screen for
  an existing account, only at sign-up).
