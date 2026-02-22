-- 1. Create a public storage bucket for audio recordings
insert into storage.buckets (id, name, public)
values ('session-audio', 'session-audio', true)
on conflict (id) do nothing;

-- 2. Add full access policies for authenticated users to the bucket
create policy "Users can upload audio"
on storage.objects for insert to authenticated
with check ( bucket_id = 'session-audio' );

create policy "Users can update their audio"
on storage.objects for update to authenticated
with check ( bucket_id = 'session-audio' );

create policy "Anyone can read audio"
on storage.objects for select
using ( bucket_id = 'session-audio' );

create policy "Users can delete their audio"
on storage.objects for delete to authenticated
using ( bucket_id = 'session-audio' );

-- 3. Add audio_url column to the sessions table
alter table public.sessions
add column if not exists audio_url text;
