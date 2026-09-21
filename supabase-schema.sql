-- Wishlist database schema for Supabase
-- Run this once in the Supabase SQL Editor (Database > SQL Editor > New query),
-- against a brand-new project, before filling in config.js.
--
-- IMPORTANT ORDERING NOTE: every table below must exist before any
-- row-level security (RLS) policy is created, because a policy on one
-- table can reference another table. This file is already ordered
-- correctly -- run it top to bottom in one go.

-- ============================================================
-- 1. Extensions
-- ============================================================
create extension if not exists "pgcrypto";

-- ============================================================
-- 2. Tables
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default substr(md5(random()::text), 1, 8),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  nickname text,
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create table if not exists public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  description text,
  link text,
  image_url text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 3. Helper functions (SECURITY DEFINER, used by policies below)
-- ============================================================
--
-- Several policies below need to know "which groups is the current user
-- a member of". Querying public.group_members directly from inside a
-- policy on public.group_members itself (or from a policy on a table
-- that then queries group_members, which has its own RLS-protected
-- self-referencing policy) makes Postgres detect a recursive loop and
-- refuse with "infinite recursion detected in policy for relation
-- \"group_members\"". Wrapping the lookup in a SECURITY DEFINER function
-- avoids this: the function runs with its owner's privileges (the table
-- owner), so the query inside it is not subject to row-level security,
-- and the loop never happens.

create or replace function public.get_my_group_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select group_id from public.group_members where user_id = auth.uid();
$$;

create or replace function public.get_my_groupmate_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select distinct user_id from public.group_members
  where group_id in (select group_id from public.group_members where user_id = auth.uid());
$$;

-- ============================================================
-- 4. Row-level security (created AFTER every table above exists)
-- ============================================================
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.wishlist_items enable row level security;

create policy "profiles are visible to groupmates"
  on public.profiles for select
  using (
    id = auth.uid()
    or id in (select public.get_my_groupmate_ids())
  );

create policy "users can update their own profile"
  on public.profiles for update
  using (id = auth.uid());

-- Any signed-in user can view the groups table (id, name, invite_code,
-- created_by, created_at). This is intentional, not an oversight: joining
-- a group works by looking a group up by its invite code before you are
-- a member of it (the "Have an invite code?" box on the dashboard), so
-- membership-gated visibility here would make joining impossible. The
-- invite code itself -- not row-level security on this table -- is what
-- actually gates who can join a group. The sensitive data (who's in a
-- group, and what's on their wishlist) stays properly restricted to
-- members only, in the policies below.
create policy "authenticated users can view groups"
  on public.groups for select
  using (auth.uid() is not null);

create policy "any signed-in user can create a group"
  on public.groups for insert
  with check (auth.uid() is not null);

create policy "members can view their groups' membership"
  on public.group_members for select
  using (
    group_id in (select public.get_my_group_ids())
  );

create policy "a user can add themselves to a group (join by invite code)"
  on public.group_members for insert
  with check (user_id = auth.uid());

create policy "a user can remove themselves from a group (leave)"
  on public.group_members for delete
  using (user_id = auth.uid());

create policy "members can view items in their groups"
  on public.wishlist_items for select
  using (
    group_id in (select public.get_my_group_ids())
  );

create policy "a member can add items to their own wishlist"
  on public.wishlist_items for insert
  with check (
    user_id = auth.uid()
    and group_id in (select public.get_my_group_ids())
  );

create policy "a member can edit their own items"
  on public.wishlist_items for update
  using (user_id = auth.uid());

create policy "a member can delete their own items"
  on public.wishlist_items for delete
  using (user_id = auth.uid());

-- ============================================================
-- 5. Auto-create a profile row whenever someone signs up
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
