-- Populate allowed_emails privately in the dashboard; never put an owner's email in source.
create table public.allowed_emails(email text primary key check(email=lower(email)),created_at timestamptz not null default now());
alter table public.allowed_emails enable row level security;
revoke all on public.allowed_emails from anon,authenticated;
create function public.enrol_google_owner() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.email_confirmed_at is not null and new.raw_app_meta_data->'providers' ? 'google'
   and exists(select 1 from public.allowed_emails where email=lower(new.email)) then
   insert into public.app_members(user_id) values(new.id) on conflict do nothing;
 end if;
 return new;
end$$;
revoke all on function public.enrol_google_owner() from public;
create trigger enrol_google_owner after insert or update of email,email_confirmed_at,raw_app_meta_data on auth.users for each row execute function public.enrol_google_owner();
