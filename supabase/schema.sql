create table if not exists public.gifs (
  id uuid primary key default gen_random_uuid(),
  title text check (char_length(title) <= 120),
  tags text[] check (coalesce(array_length(tags,1),0) <= 20),
  path text not null unique check (path ~ '^[0-9a-f-]{36}\.gif$'),
  width int, height int, frames int,
  size int check (size between 1 and 15728640),
  views int not null default 0, downloads int not null default 0, shares int not null default 0,
  owner_token text not null check (char_length(owner_token) between 32 and 128),
  created_at timestamptz not null default now()
);
create index if not exists gifs_owner_created on public.gifs(owner_token, created_at);
alter table public.gifs enable row level security;
revoke all on public.gifs from anon, authenticated;
grant select (id,title,tags,path,width,height,frames,size,views,downloads,shares,created_at) on public.gifs to anon, authenticated;
grant insert (id,title,tags,path,width,height,frames,size,owner_token) on public.gifs to anon, authenticated;
drop policy if exists gifs_read on public.gifs;
create policy gifs_read on public.gifs for select to anon, authenticated using (true);
drop policy if exists gifs_insert on public.gifs;
create policy gifs_insert on public.gifs for insert to anon, authenticated with check (true);

create or replace function public.gifs_rate_limit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.gifs where owner_token = new.owner_token and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'rate_limit: max 20 uploads per hour';
  end if;
  new.views := 0; new.downloads := 0; new.shares := 0; new.created_at := now();
  return new;
end $$;
drop trigger if exists gifs_rate_limit on public.gifs;
create trigger gifs_rate_limit before insert on public.gifs for each row execute function public.gifs_rate_limit();

create or replace function public.increment_counter(gif_id uuid, counter text) returns void language plpgsql security definer set search_path = public as $$
begin
  if counter = 'views' then update gifs set views = views + 1 where id = gif_id;
  elsif counter = 'downloads' then update gifs set downloads = downloads + 1 where id = gif_id;
  elsif counter = 'shares' then update gifs set shares = shares + 1 where id = gif_id;
  else raise exception 'bad counter'; end if;
end $$;

create or replace function public.delete_gif(gif_id uuid, token text) returns text language plpgsql security definer set search_path = public as $$
declare p text;
begin
  delete from gifs where id = gif_id and owner_token = token returning path into p;
  if p is null then raise exception 'not_owner'; end if;
  return p;
end $$;

create or replace function public.is_mine(gif_ids uuid[], token text) returns setof uuid language sql stable security definer set search_path = public as $$
  select id from gifs where id = any(gif_ids) and owner_token = token;
$$;
revoke all on function public.increment_counter(uuid,text), public.delete_gif(uuid,text), public.is_mine(uuid[],text), public.gifs_rate_limit() from public;
grant execute on function public.increment_counter(uuid,text), public.delete_gif(uuid,text), public.is_mine(uuid[],text) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gifs','gifs',true,15728640,array['image/gif'])
on conflict (id) do update set public=true, file_size_limit=15728640, allowed_mime_types=array['image/gif'];

drop policy if exists "gifs read" on storage.objects;
create policy "gifs read" on storage.objects for select to anon, authenticated using (bucket_id = 'gifs');
drop policy if exists "gifs upload" on storage.objects;
create policy "gifs upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'gifs' and name ~ '^[0-9a-f-]{36}\.gif$');
-- delete only once the owner removed the row via delete_gif (orphan object)
drop policy if exists "gifs delete orphan" on storage.objects;
create policy "gifs delete orphan" on storage.objects for delete to anon, authenticated
  using (bucket_id = 'gifs' and not exists (select 1 from public.gifs g where g.path = storage.objects.name));
notify pgrst, 'reload schema';
