-- Auto-activation is intentionally separate from payment review: a correctly
-- formatted sender number grants immediate temporary access, while the admin
-- can later confirm or reject the real wallet transfer without losing audit data.
alter table public.local_payment_orders
  add column if not exists payment_review_status text not null default 'pending_review',
  add column if not exists payment_reviewed_at timestamptz,
  add column if not exists payment_reviewed_by text,
  add column if not exists auto_activated_at timestamptz;

update public.local_payment_orders
set payment_review_status = case
  when status = 'approved' then 'reviewed'
  when status = 'rejected' then 'rejected'
  else 'pending_review'
end
where payment_review_status is null or payment_review_status = 'pending_review';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'local_payment_orders_payment_review_status_check'
      and conrelid = 'public.local_payment_orders'::regclass
  ) then
    alter table public.local_payment_orders
      add constraint local_payment_orders_payment_review_status_check
      check (payment_review_status in ('pending_review', 'reviewed', 'rejected'));
  end if;
end $$;

create index if not exists local_payment_orders_review_queue_idx
  on public.local_payment_orders (payment_review_status, created_at desc);
