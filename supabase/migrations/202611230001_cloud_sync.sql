-- Record-level storage. Client writes only through the versioned RPC below.
create table public.app_members(user_id uuid primary key references auth.users(id), created_at timestamptz not null default now());
alter table public.app_members enable row level security;
create function public.is_app_member() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.app_members where user_id=(select auth.uid()))$$;
revoke all on function public.is_app_member() from public;
grant execute on function public.is_app_member() to authenticated;
grant select on public.app_members to authenticated;
create policy own_membership on public.app_members for select to authenticated using(user_id=(select auth.uid()));

create table public.articles(owner_id uuid not null references auth.users(id),id text not null,data jsonb not null default '{}',version bigint not null default 1,updated_at timestamptz not null default now(),primary key(owner_id,id),check(jsonb_typeof(data)='object'),check(length(id) between 1 and 600));
create table public.vocabulary(like public.articles including all);
create table public.reading_progress(like public.articles including all);
create table public.user_settings(like public.articles including all);
alter table public.vocabulary add foreign key(owner_id) references auth.users(id);
alter table public.reading_progress add foreign key(owner_id) references auth.users(id);
alter table public.user_settings add foreign key(owner_id) references auth.users(id);

do $$declare t text;begin foreach t in array array['articles','vocabulary','reading_progress','user_settings'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy own_records on public.%I for select to authenticated using(owner_id=(select auth.uid()) and (select public.is_app_member()))',t);
 execute format('create index %I on public.%I(owner_id,updated_at)',t||'_owner_updated',t);
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then execute format('alter publication supabase_realtime add table public.%I',t);end if;
end loop;end$$;

create table public.sync_operations(owner_id uuid not null references auth.users(id),operation_id uuid not null,request_hash text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(owner_id,operation_id));
alter table public.sync_operations enable row level security;
revoke all on public.sync_operations from anon,authenticated;

create function public.apply_sync_change(p_kind text,p_id text,p_expected_version bigint,p_patch jsonb,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();existing record;receipt record;newdata jsonb;answer jsonb;fingerprint text;
begin
 if uid is null or not public.is_app_member() then raise exception 'Account is not authorized' using errcode='42501';end if;
 if p_kind not in ('articles','vocabulary','reading_progress','user_settings') or p_kind is null then raise exception 'Invalid record kind';end if;
 if p_id is null or length(p_id) not between 1 and 600 or p_expected_version<0 or p_expected_version is null or p_operation_id is null or p_patch is null or jsonb_typeof(p_patch)<>'object' or octet_length(p_patch::text)>450000 then raise exception 'Invalid sync operation';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||p_operation_id::text,0));
 fingerprint:=md5(jsonb_build_array(p_kind,p_id,p_expected_version,p_patch)::text);
 select * into receipt from public.sync_operations where owner_id=uid and operation_id=p_operation_id;
 if found then if receipt.request_hash<>fingerprint then raise exception 'Operation ID was reused with different content';end if;return receipt.result;end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||p_kind||p_id,0));
 execute format('select id,data,version,updated_at from public.%I where owner_id=$1 and id=$2 for update',p_kind) into existing using uid,p_id;
 if existing.id is null then
   if p_expected_version<>0 then return jsonb_build_object('status','conflict','record',null);end if;
   newdata:=p_patch;
 else
   if existing.version<>p_expected_version then return jsonb_build_object('status','conflict','record',to_jsonb(existing));end if;
   newdata:=existing.data||p_patch;
 end if;
 if p_kind='articles' and (coalesce(jsonb_typeof(newdata->'text'),'')<>'string' or length(newdata->>'text') not between 1 and 100000 or coalesce(jsonb_typeof(newdata->'title'),'')<>'string' or length(newdata->>'title')>200 or newdata->>'id' is distinct from p_id) then raise exception 'Invalid article';end if;
 if p_kind='vocabulary' and (coalesce(jsonb_typeof(newdata->'text'),'')<>'string' or length(newdata->>'text') not between 1 and 250 or coalesce(jsonb_typeof(newdata->'context'),'')<>'string' or length(newdata->>'context')>3000 or newdata->>'id' is distinct from p_id or (newdata ? 'note' and jsonb_typeof(newdata->'note')<>'string')) then raise exception 'Invalid vocabulary entry';end if;
 if newdata ? 'deletedAt' and jsonb_typeof(newdata->'deletedAt') not in ('string','null') then raise exception 'Invalid deletion marker';end if;
 execute format('insert into public.%I(owner_id,id,data,version,updated_at) values($1,$2,$3,$4,clock_timestamp()) on conflict(owner_id,id) do update set data=excluded.data,version=excluded.version,updated_at=excluded.updated_at returning id,data,version,updated_at',p_kind) into existing using uid,p_id,newdata,coalesce(existing.version,0)+1;
 answer:=jsonb_build_object('status','applied','record',to_jsonb(existing));
 insert into public.sync_operations(owner_id,operation_id,request_hash,result) values(uid,p_operation_id,fingerprint,answer);
 return answer;
end$$;
revoke all on function public.apply_sync_change(text,text,bigint,jsonb,uuid) from public;
grant execute on function public.apply_sync_change(text,text,bigint,jsonb,uuid) to authenticated;

-- Private, disposable audio cache. Service functions enforce owner and size limits.
create table public.audio_cache(owner_id uuid not null references auth.users(id),hash text not null,path text not null,bytes bigint not null,last_access timestamptz not null default now(),expires_at timestamptz not null default(now()+interval '7 days'),primary key(owner_id,hash));
alter table public.audio_cache enable row level security;
revoke all on public.audio_cache from anon,authenticated;
grant select on public.audio_cache to authenticated;
create policy own_audio on public.audio_cache for select to authenticated using(owner_id=(select auth.uid()) and (select public.is_app_member()));
create index audio_cache_owner_access on public.audio_cache(owner_id,last_access);
