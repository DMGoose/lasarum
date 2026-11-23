insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('speech-cache','speech-cache',false,26214400,array['audio/wav']) on conflict(id) do nothing;
create policy own_speech_download on storage.objects for select to authenticated using(bucket_id='speech-cache' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.is_app_member()));
