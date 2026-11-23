-- Supabase also grants functions directly to API roles by default. Revoking
-- PUBLIC alone does not remove those grants. Only the two authenticated RPCs
-- are callable by app users; the enrolment trigger is never an API endpoint.
revoke all on function public.is_app_member() from public,anon,authenticated;
grant execute on function public.is_app_member() to authenticated;
revoke all on function public.apply_sync_change(text,text,bigint,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.apply_sync_change(text,text,bigint,jsonb,uuid) to authenticated;
revoke all on function public.enrol_google_owner() from public,anon,authenticated;
revoke all on public.app_members from anon,authenticated;
grant select on public.app_members to authenticated;
