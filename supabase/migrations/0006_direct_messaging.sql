-- ============================================================================
-- NR Industries — 0006_direct_messaging.sql
-- Direct "Messages" tab (spec §4) — separate from the existing per-project
-- chat. Any-to-any between all non-Head-Admin roles, text + voice notes,
-- hard-deleted 60h after the last message by the hourly cleanup job
-- (0007_cron_cleanup.sql + supabase/functions/cleanup-direct-messages).
-- ============================================================================

create table if not exists public.direct_conversations (
  id              uuid primary key default gen_random_uuid(),
  user_a          uuid not null references public.profiles(id) on delete cascade,
  user_b          uuid not null references public.profiles(id) on delete cascade,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  check (user_a < user_b),
  unique (user_a, user_b)
);
create index if not exists direct_conversations_last_msg_idx
  on public.direct_conversations(last_message_at);
alter table public.direct_conversations enable row level security;

create table if not exists public.direct_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete cascade,
  kind            text not null check (kind in ('text', 'voice')),
  body            text,
  voice_path      text,
  created_at      timestamptz not null default now(),
  check (
    (kind = 'text' and body is not null and char_length(body) between 1 and 4000)
    or (kind = 'voice' and voice_path is not null)
  )
);
create index if not exists direct_messages_conversation_idx
  on public.direct_messages(conversation_id, created_at);
alter table public.direct_messages enable row level security;

-- ---------------------------------------------------------------------------
-- get_or_create_direct_conversation: any two active, non-Head-Admin users.
-- Head Admin is never reachable through this path (spec §4/§1 invisibility).
-- ---------------------------------------------------------------------------
create or replace function public.get_or_create_direct_conversation(other uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  me      public.profiles%rowtype;
  them    public.profiles%rowtype;
  lo      uuid;
  hi      uuid;
  conv_id uuid;
begin
  if other = auth.uid() then
    raise exception 'cannot message yourself';
  end if;

  select * into me from public.profiles where id = auth.uid();
  select * into them from public.profiles where id = other;

  if me.id is null or me.status <> 'active' or me.role = 'head_admin' then
    raise exception 'not authorised';
  end if;
  if them.id is null or them.status <> 'active' or them.role = 'head_admin' then
    raise exception 'that user is not reachable';
  end if;

  lo := least(auth.uid(), other);
  hi := greatest(auth.uid(), other);

  insert into public.direct_conversations (user_a, user_b)
  values (lo, hi)
  on conflict (user_a, user_b) do nothing;

  select id into conv_id from public.direct_conversations where user_a = lo and user_b = hi;
  return conv_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- New direct message -> bump last_message_at + notify the other participant.
-- ---------------------------------------------------------------------------
create or replace function public.on_new_direct_message()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  conv     public.direct_conversations%rowtype;
  other    uuid;
  sender   public.profiles%rowtype;
  preview  text;
begin
  select * into conv from public.direct_conversations where id = new.conversation_id;
  update public.direct_conversations set last_message_at = now() where id = new.conversation_id;

  other := case when conv.user_a = new.sender_id then conv.user_b else conv.user_a end;
  select * into sender from public.profiles where id = new.sender_id;
  preview := case when new.kind = 'voice' then '🎤 Voice note' else left(new.body, 120) end;

  insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
  values (other, 'message', coalesce(sender.full_name, 'New message'), preview,
          'direct_conversation', new.conversation_id);

  return new;
end;
$$;

drop trigger if exists new_direct_message on public.direct_messages;
create trigger new_direct_message after insert on public.direct_messages
  for each row execute function public.on_new_direct_message();

-- ---------------------------------------------------------------------------
-- Contact directory: listContacts() reads public.profiles directly, but the
-- pre-existing policies only cover admin-tier, project-teammates, and
-- manager-staffing visibility — none of which hold between two arbitrary
-- non-privileged roles with no shared project (e.g. maker <-> maker, or a
-- maker viewing a manager). Without this, listContacts() silently returned
-- nothing for most users, even though this file's own header promises
-- "any-to-any between all non-Head-Admin roles".
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_messaging on public.profiles;
create policy profiles_select_messaging on public.profiles
  for select using (
    public.is_active() and status = 'active' and role <> 'head_admin'
  );

-- ---------------------------------------------------------------------------
-- RLS: participants only. No update/delete for regular users — the 60h
-- cleanup job (service role, RLS-exempt) is the only deletion path.
-- ---------------------------------------------------------------------------
drop policy if exists direct_conversations_select on public.direct_conversations;
create policy direct_conversations_select on public.direct_conversations
  for select using (user_a = auth.uid() or user_b = auth.uid());

drop policy if exists direct_messages_select on public.direct_messages;
create policy direct_messages_select on public.direct_messages
  for select using (
    exists (
      select 1 from public.direct_conversations c
      where c.id = conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

drop policy if exists direct_messages_insert on public.direct_messages;
create policy direct_messages_insert on public.direct_messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.direct_conversations c
      where c.id = conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Cleanup RPCs — SECURITY DEFINER, not granted to `authenticated`. Only the
-- service-role key (used exclusively by the Edge Function) can call these.
-- ---------------------------------------------------------------------------
create or replace function public.expired_direct_conversations()
returns setof public.direct_conversations
language sql stable security definer set search_path = public
as $$
  select * from public.direct_conversations
  where last_message_at < now() - interval '60 hours';
$$;
-- REVOKE ALL strips the implicit PUBLIC grant from every role, including
-- service_role — re-grant it explicitly so the cleanup Edge Function (which
-- calls this as service_role) keeps access while anon/authenticated do not.
revoke all on function public.expired_direct_conversations() from public;
grant execute on function public.expired_direct_conversations() to service_role;

create or replace function public.purge_direct_conversation(target uuid)
returns void
language sql security definer set search_path = public
as $$
  delete from public.direct_conversations where id = target;
$$;
revoke all on function public.purge_direct_conversation(uuid) from public;
grant execute on function public.purge_direct_conversation(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for voice notes, signed-URL access only.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('voice-notes', 'voice-notes', false)
on conflict (id) do nothing;

drop policy if exists voice_notes_select on storage.objects;
create policy voice_notes_select on storage.objects
  for select using (
    bucket_id = 'voice-notes'
    and exists (
      select 1 from public.direct_conversations c
      where c.id::text = (storage.foldername(name))[1]
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

drop policy if exists voice_notes_insert on storage.objects;
create policy voice_notes_insert on storage.objects
  for insert with check (
    bucket_id = 'voice-notes'
    and exists (
      select 1 from public.direct_conversations c
      where c.id::text = (storage.foldername(name))[1]
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );
-- No update/delete policy: only the service-role cleanup job removes objects.

-- ---------------------------------------------------------------------------
-- Realtime publication
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'alter publication supabase_realtime add table public.direct_conversations';
  execute 'alter publication supabase_realtime add table public.direct_messages';
exception when duplicate_object then null;
end $$;
