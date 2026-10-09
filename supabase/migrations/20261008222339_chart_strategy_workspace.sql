create table if not exists public.chart_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace jsonb not null check (jsonb_typeof(workspace) = 'object' and octet_length(workspace::text) <= 32000),
  updated_at timestamptz not null default now()
);
alter table public.chart_workspaces enable row level security;
revoke all on public.chart_workspaces from anon, authenticated;
grant select, insert, update on public.chart_workspaces to authenticated;
create policy "Read own chart workspace" on public.chart_workspaces for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own chart workspace" on public.chart_workspaces for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own chart workspace" on public.chart_workspaces for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
