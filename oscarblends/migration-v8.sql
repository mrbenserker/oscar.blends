-- Oscar Blends — V8
-- Finalisation des fonctions réservation : gestion client, statistiques, liste d'attente,
-- ouvertures exceptionnelles, limites de réservation, battement et rappels.

create extension if not exists pgcrypto;

alter type public.appointment_status add value if not exists 'completed';
alter type public.appointment_status add value if not exists 'no_show';

alter table public.services
  add column if not exists buffer_after_minutes integer not null default 0;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname='services_buffer_after_minutes_check'
  ) then
    alter table public.services
      add constraint services_buffer_after_minutes_check
      check (buffer_after_minutes between 0 and 120);
  end if;
end $$;

alter table public.booking_settings
  add column if not exists min_notice_minutes integer not null default 15,
  add column if not exists max_advance_days integer not null default 60;

alter table public.appointments
  add column if not exists management_token uuid not null default gen_random_uuid(),
  add column if not exists blocked_until timestamptz,
  add column if not exists reminder_email_sent_at timestamptz;

update public.appointments
set blocked_until=ends_at
where blocked_until is null;

alter table public.appointments
  alter column blocked_until set not null;

create unique index if not exists appointments_management_token_uidx
  on public.appointments(management_token);

alter table public.appointments drop constraint if exists no_active_appointment_overlap;
alter table public.appointments add constraint no_active_appointment_overlap
  exclude using gist (tstzrange(starts_at, blocked_until, '[)') with &&)
  where (status in ('pending','confirmed'));

create table if not exists public.exceptional_openings (
  id uuid primary key default gen_random_uuid(),
  open_date date not null,
  start_time time not null,
  end_time time not null,
  label text,
  created_at timestamptz not null default now(),
  constraint exceptional_opening_range check (end_time > start_time)
);

create index if not exists exceptional_openings_date_idx
  on public.exceptional_openings(open_date);

create table if not exists public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  desired_date date not null,
  customer_name text not null check (char_length(customer_name) between 2 and 120),
  phone text not null check (char_length(phone) between 6 and 40),
  email text not null,
  status text not null default 'waiting'
    check (status in ('waiting','contacted','booked','cancelled')),
  notify_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists waitlist_entries_date_status_idx
  on public.waitlist_entries(desired_date,status);

alter table public.exceptional_openings enable row level security;
alter table public.waitlist_entries enable row level security;

drop policy if exists "admin exceptional openings" on public.exceptional_openings;
create policy "admin exceptional openings" on public.exceptional_openings
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin waitlist" on public.waitlist_entries;
create policy "admin waitlist" on public.waitlist_entries
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.get_public_booking_rules()
returns table(min_notice_minutes integer,max_advance_days integer)
language sql stable security definer set search_path=public as $$
  select
    coalesce(bs.min_notice_minutes,15),
    coalesce(bs.max_advance_days,60)
  from public.booking_settings bs
  where bs.id=1
$$;
grant execute on function public.get_public_booking_rules() to anon,authenticated;

drop function if exists public.get_available_slots(date,text);
create function public.get_available_slots(p_date date, p_service_slug text)
returns table(slot text, recommended boolean)
language plpgsql volatile security definer set search_path=public as $$
begin
  perform public.expire_pending_appointments();

  return query
  with service_settings as (
    select
      s.duration_minutes,
      coalesce(s.buffer_after_minutes,0) as buffer_after_minutes,
      s.duration_minutes + coalesce(s.buffer_after_minutes,0) as effective_minutes
    from public.services s
    where s.slug=p_service_slug and s.active=true
  ), rules as (
    select
      coalesce(bs.min_notice_minutes,15) as min_notice_minutes,
      coalesce(bs.max_advance_days,60) as max_advance_days
    from public.booking_settings bs
    where bs.id=1
  ), sessions as (
    select
      oh.id::text as session_id,
      ss.duration_minutes,
      ss.effective_minutes,
      greatest(5,least(coalesce(oh.slot_interval_minutes,15),15)) as base_interval,
      (p_date + oh.start_time)::timestamp as open_at,
      case
        when oh.latest_start_time is not null then (p_date + oh.latest_start_time)::timestamp
        else (p_date + oh.end_time)::timestamp - make_interval(mins=>ss.effective_minutes)
      end as max_start_at,
      case
        when oh.latest_start_time is not null then (p_date + oh.latest_start_time)::timestamp + make_interval(mins=>ss.effective_minutes)
        else (p_date + oh.end_time)::timestamp
      end as close_at
    from public.opening_hours oh
    cross join service_settings ss
    cross join rules r
    where oh.weekday=extract(dow from p_date)::int
      and oh.active=true
      and p_date>=current_date
      and p_date<=current_date+r.max_advance_days
      and not exists(
        select 1 from public.closures c
        where c.closed_date=p_date and c.start_time is null
      )

    union all

    select
      ('exception-'||eo.id::text) as session_id,
      ss.duration_minutes,
      ss.effective_minutes,
      15 as base_interval,
      (p_date + eo.start_time)::timestamp as open_at,
      (p_date + eo.end_time)::timestamp - make_interval(mins=>ss.effective_minutes) as max_start_at,
      (p_date + eo.end_time)::timestamp as close_at
    from public.exceptional_openings eo
    cross join service_settings ss
    cross join rules r
    where eo.open_date=p_date
      and p_date>=current_date
      and p_date<=current_date+r.max_advance_days
      and not exists(
        select 1 from public.closures c
        where c.closed_date=p_date and c.start_time is null
      )
  ), occupied as (
    select
      (a.starts_at at time zone 'Europe/Paris')::timestamp as busy_start,
      (coalesce(a.blocked_until,a.ends_at) at time zone 'Europe/Paris')::timestamp as busy_end
    from public.appointments a
    where a.status in ('pending','confirmed')
      and (a.starts_at at time zone 'Europe/Paris')::date=p_date

    union all

    select
      (p_date + c.start_time)::timestamp,
      (p_date + c.end_time)::timestamp
    from public.closures c
    where c.closed_date=p_date
      and c.start_time is not null
      and c.end_time is not null
  ), base_candidates as (
    select
      s.session_id,
      s.duration_minutes,
      s.effective_minutes,
      s.open_at,
      s.close_at,
      gs::timestamp as candidate_start
    from sessions s
    cross join lateral generate_series(
      s.open_at,
      s.max_start_at,
      make_interval(mins=>s.base_interval)
    ) gs
    where s.max_start_at>=s.open_at
  ), packing_candidates as (
    select s.session_id,s.duration_minutes,s.effective_minutes,s.open_at,s.close_at,s.open_at as candidate_start
    from sessions s
    union
    select s.session_id,s.duration_minutes,s.effective_minutes,s.open_at,s.close_at,s.max_start_at
    from sessions s
    where s.max_start_at>=s.open_at
    union
    select s.session_id,s.duration_minutes,s.effective_minutes,s.open_at,s.close_at,o.busy_end
    from sessions s
    cross join occupied o
    where o.busy_end between s.open_at and s.max_start_at
    union
    select s.session_id,s.duration_minutes,s.effective_minutes,s.open_at,s.close_at,
           o.busy_start-make_interval(mins=>s.effective_minutes)
    from sessions s
    cross join occupied o
    where o.busy_start-make_interval(mins=>s.effective_minutes) between s.open_at and s.max_start_at
  ), candidates as (
    select distinct * from (
      select * from base_candidates
      union all
      select * from packing_candidates
    ) q
  ), valid as (
    select
      c.*,
      c.candidate_start + make_interval(mins=>c.effective_minutes) as blocked_end,
      (
        c.candidate_start=c.open_at
        or c.candidate_start + make_interval(mins=>c.effective_minutes)=c.close_at
        or exists(select 1 from occupied o where o.busy_end=c.candidate_start)
        or exists(select 1 from occupied o where o.busy_start=c.candidate_start+make_interval(mins=>c.effective_minutes))
      ) as is_recommended
    from candidates c
    cross join rules r
    where c.candidate_start>=c.open_at
      and c.candidate_start + make_interval(mins=>c.effective_minutes)<=c.close_at
      and (c.candidate_start at time zone 'Europe/Paris') >= now()+make_interval(mins=>r.min_notice_minutes)
      and not exists(
        select 1 from occupied o
        where tstzrange(
          c.candidate_start at time zone 'Europe/Paris',
          (c.candidate_start + make_interval(mins=>c.effective_minutes)) at time zone 'Europe/Paris',
          '[)'
        ) && tstzrange(
          o.busy_start at time zone 'Europe/Paris',
          o.busy_end at time zone 'Europe/Paris',
          '[)'
        )
      )
  )
  select
    to_char(v.candidate_start,'HH24:MI') as slot,
    bool_or(v.is_recommended) as recommended
  from valid v
  group by v.candidate_start
  order by bool_or(v.is_recommended) desc,v.candidate_start;
end $$;

grant execute on function public.get_available_slots(date,text) to anon,authenticated;

drop function if exists public.request_appointment(text,date,text,text,text,text,text);
create function public.request_appointment(
  p_service_slug text,
  p_date date,
  p_time text,
  p_customer_name text,
  p_phone text,
  p_email text,
  p_notes text
) returns uuid
language plpgsql volatile security definer set search_path=public as $$
declare
  v_service public.services%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_blocked_until timestamptz;
  v_hold integer;
  v_expires timestamptz;
  v_token uuid;
begin
  perform public.expire_pending_appointments();

  select * into v_service
  from public.services
  where slug=p_service_slug and active=true;

  if v_service.id is null then raise exception 'Prestation introuvable'; end if;
  if p_customer_name is null or char_length(trim(p_customer_name))<2 then raise exception 'Nom invalide'; end if;
  if p_phone is null or char_length(trim(p_phone))<6 then raise exception 'Téléphone invalide'; end if;
  if p_email is null or position('@' in trim(p_email))<=1 then raise exception 'E-mail invalide'; end if;

  if not exists(
    select 1 from public.get_available_slots(p_date,p_service_slug) s
    where s.slot=left(p_time,5)
  ) then
    raise exception 'Ce créneau n’est plus disponible';
  end if;

  v_start := ((p_date + p_time::time) at time zone 'Europe/Paris');
  v_end := v_start + make_interval(mins=>v_service.duration_minutes);
  v_blocked_until := v_end + make_interval(mins=>coalesce(v_service.buffer_after_minutes,0));

  select pending_hold_minutes into v_hold
  from public.booking_settings where id=1;
  v_hold := coalesce(v_hold,1440);
  v_expires := least(v_start,now()+make_interval(mins=>v_hold));

  insert into public.appointments(
    service_id,starts_at,ends_at,blocked_until,customer_name,phone,email,notes,status,expires_at
  ) values(
    v_service.id,v_start,v_end,v_blocked_until,trim(p_customer_name),trim(p_phone),lower(trim(p_email)),
    nullif(trim(coalesce(p_notes,'')),''),'pending',v_expires
  ) returning management_token into v_token;

  return v_token;
exception
  when exclusion_violation then
    raise exception 'Ce créneau vient d’être demandé par un autre client. Choisis-en un autre.';
end $$;

grant execute on function public.request_appointment(text,date,text,text,text,text,text) to anon,authenticated;

drop function if exists public.admin_create_appointment(text,date,text,text,text,text,text);
create function public.admin_create_appointment(
  p_service_slug text,
  p_date date,
  p_time text,
  p_customer_name text,
  p_phone text,
  p_email text,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_service public.services%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_blocked_until timestamptz;
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'Accès administrateur requis'; end if;

  select * into v_service from public.services where slug=p_service_slug and active=true;
  if v_service.id is null then raise exception 'Prestation introuvable'; end if;

  v_start := ((p_date+p_time::time) at time zone 'Europe/Paris');
  v_end := v_start+make_interval(mins=>v_service.duration_minutes);
  v_blocked_until := v_end+make_interval(mins=>coalesce(v_service.buffer_after_minutes,0));

  insert into public.appointments(
    service_id,starts_at,ends_at,blocked_until,customer_name,phone,email,notes,status,expires_at,confirmed_at
  ) values(
    v_service.id,v_start,v_end,v_blocked_until,trim(p_customer_name),trim(p_phone),lower(trim(p_email)),
    nullif(trim(coalesce(p_notes,'')),''),'confirmed',null,now()
  ) returning id into v_id;

  return v_id;
exception when exclusion_violation then
  raise exception 'Ce créneau chevauche déjà un autre rendez-vous.';
end $$;
grant execute on function public.admin_create_appointment(text,date,text,text,text,text,text) to authenticated;

drop function if exists public.admin_move_appointment(uuid,date,text);
create function public.admin_move_appointment(p_id uuid,p_date date,p_time text)
returns void
language plpgsql security definer set search_path=public as $$
declare
  v_duration integer;
  v_buffer integer;
  v_start timestamptz;
  v_end timestamptz;
  v_blocked_until timestamptz;
  v_local_start timestamp;
  v_local_end timestamp;
  v_status public.appointment_status;
begin
  if not public.is_admin() then raise exception 'Accès administrateur requis'; end if;

  select s.duration_minutes,coalesce(s.buffer_after_minutes,0),a.status
  into v_duration,v_buffer,v_status
  from public.appointments a
  join public.services s on s.id=a.service_id
  where a.id=p_id
  for update;

  if v_duration is null then raise exception 'Rendez-vous introuvable'; end if;
  if v_status not in ('pending','confirmed') then raise exception 'Ce rendez-vous ne peut plus être déplacé'; end if;

  v_local_start := p_date+p_time::time;
  v_local_end := v_local_start+make_interval(mins=>v_duration+v_buffer);

  if exists(
    select 1 from public.closures c
    where c.closed_date=p_date
      and (
        (c.start_time is null and c.end_time is null)
        or (
          c.start_time is not null and c.end_time is not null
          and tsrange(v_local_start,v_local_end,'[)') &&
              tsrange(p_date+c.start_time,p_date+c.end_time,'[)')
        )
      )
  ) then raise exception 'Ce créneau est indisponible'; end if;

  if not (
    exists(
      select 1 from public.opening_hours oh
      where oh.weekday=extract(dow from p_date)::int and oh.active=true
        and v_local_start>=p_date+oh.start_time
        and (
          (oh.latest_start_time is not null and v_local_start<=p_date+oh.latest_start_time)
          or
          (oh.latest_start_time is null and v_local_end<=p_date+oh.end_time)
        )
    )
    or exists(
      select 1 from public.exceptional_openings eo
      where eo.open_date=p_date
        and v_local_start>=p_date+eo.start_time
        and v_local_end<=p_date+eo.end_time
    )
  ) then raise exception 'Ce créneau est en dehors des horaires ouverts'; end if;

  v_start := v_local_start at time zone 'Europe/Paris';
  v_end := v_start+make_interval(mins=>v_duration);
  v_blocked_until := v_end+make_interval(mins=>v_buffer);

  if exists(
    select 1 from public.appointments a
    where a.id<>p_id
      and a.status in ('pending','confirmed')
      and tstzrange(a.starts_at,coalesce(a.blocked_until,a.ends_at),'[)') &&
          tstzrange(v_start,v_blocked_until,'[)')
  ) then raise exception 'Ce nouveau créneau chevauche déjà un autre rendez-vous'; end if;

  update public.appointments
  set starts_at=v_start,
      ends_at=v_end,
      blocked_until=v_blocked_until,
      confirmation_email_sent_at=null,
      confirmation_email_id=null,
      confirmation_email_error=null,
      reminder_email_sent_at=null
  where id=p_id;
end $$;
grant execute on function public.admin_move_appointment(uuid,date,text) to authenticated;

create or replace function public.client_move_appointment(
  p_token uuid,
  p_date date,
  p_time text
) returns void
language plpgsql security definer set search_path=public as $$
declare
  v_id uuid;
  v_service_id uuid;
  v_duration integer;
  v_buffer integer;
  v_status public.appointment_status;
  v_start timestamptz;
  v_end timestamptz;
  v_blocked_until timestamptz;
  v_local_start timestamp;
  v_local_end timestamp;
  v_min_notice integer;
  v_max_days integer;
  v_hold integer;
begin
  perform public.expire_pending_appointments();

  select a.id,a.service_id,s.duration_minutes,coalesce(s.buffer_after_minutes,0),a.status
  into v_id,v_service_id,v_duration,v_buffer,v_status
  from public.appointments a
  join public.services s on s.id=a.service_id
  where a.management_token=p_token
  for update;

  if v_id is null then raise exception 'Rendez-vous introuvable'; end if;
  if v_status not in ('pending','confirmed') then raise exception 'Ce rendez-vous ne peut plus être déplacé'; end if;

  select coalesce(min_notice_minutes,15),coalesce(max_advance_days,60),coalesce(pending_hold_minutes,1440)
  into v_min_notice,v_max_days,v_hold
  from public.booking_settings where id=1;

  if p_date<current_date or p_date>current_date+v_max_days then
    raise exception 'Date de réservation non autorisée';
  end if;

  v_local_start := p_date+p_time::time;
  v_local_end := v_local_start+make_interval(mins=>v_duration+v_buffer);
  v_start := v_local_start at time zone 'Europe/Paris';

  if v_start<now()+make_interval(mins=>v_min_notice) then
    raise exception 'Ce créneau est trop proche';
  end if;

  if exists(
    select 1 from public.closures c
    where c.closed_date=p_date
      and (
        (c.start_time is null and c.end_time is null)
        or (
          c.start_time is not null and c.end_time is not null
          and tsrange(v_local_start,v_local_end,'[)') &&
              tsrange(p_date+c.start_time,p_date+c.end_time,'[)')
        )
      )
  ) then raise exception 'Ce créneau est indisponible'; end if;

  if not (
    exists(
      select 1 from public.opening_hours oh
      where oh.weekday=extract(dow from p_date)::int and oh.active=true
        and v_local_start>=p_date+oh.start_time
        and (
          (oh.latest_start_time is not null and v_local_start<=p_date+oh.latest_start_time)
          or
          (oh.latest_start_time is null and v_local_end<=p_date+oh.end_time)
        )
    )
    or exists(
      select 1 from public.exceptional_openings eo
      where eo.open_date=p_date
        and v_local_start>=p_date+eo.start_time
        and v_local_end<=p_date+eo.end_time
    )
  ) then raise exception 'Ce créneau est en dehors des horaires ouverts'; end if;

  v_end := v_start+make_interval(mins=>v_duration);
  v_blocked_until := v_end+make_interval(mins=>v_buffer);

  if exists(
    select 1 from public.appointments a
    where a.id<>v_id
      and a.status in ('pending','confirmed')
      and tstzrange(a.starts_at,coalesce(a.blocked_until,a.ends_at),'[)') &&
          tstzrange(v_start,v_blocked_until,'[)')
  ) then raise exception 'Ce créneau vient d’être pris'; end if;

  update public.appointments
  set starts_at=v_start,
      ends_at=v_end,
      blocked_until=v_blocked_until,
      reminder_email_sent_at=null,
      confirmation_email_sent_at=null,
      confirmation_email_id=null,
      confirmation_email_error=null,
      expires_at=case when status='pending' then least(v_start,now()+make_interval(mins=>v_hold)) else null end
  where id=v_id;
end $$;
grant execute on function public.client_move_appointment(uuid,date,text) to anon,authenticated;

create or replace function public.client_cancel_appointment(p_token uuid)
returns void
language plpgsql security definer set search_path=public as $$
declare
  v_status public.appointment_status;
begin
  select status into v_status
  from public.appointments
  where management_token=p_token
  for update;

  if v_status is null then raise exception 'Rendez-vous introuvable'; end if;
  if v_status not in ('pending','confirmed') then raise exception 'Ce rendez-vous ne peut plus être annulé'; end if;

  update public.appointments
  set status='cancelled',
      expires_at=null,
      cancellation_reason='Annulé par le client'
  where management_token=p_token;
end $$;
grant execute on function public.client_cancel_appointment(uuid) to anon,authenticated;

create or replace function public.join_waitlist(
  p_service_slug text,
  p_date date,
  p_customer_name text,
  p_phone text,
  p_email text
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_service_id uuid;
  v_id uuid;
  v_max_days integer;
begin
  select id into v_service_id from public.services where slug=p_service_slug and active=true;
  if v_service_id is null then raise exception 'Prestation introuvable'; end if;
  select coalesce(max_advance_days,60) into v_max_days from public.booking_settings where id=1;
  if p_date<current_date or p_date>current_date+v_max_days then raise exception 'Date non autorisée'; end if;
  if char_length(trim(p_customer_name))<2 then raise exception 'Nom invalide'; end if;
  if char_length(trim(p_phone))<6 then raise exception 'Téléphone invalide'; end if;
  if position('@' in trim(p_email))<=1 then raise exception 'E-mail invalide'; end if;

  insert into public.waitlist_entries(service_id,desired_date,customer_name,phone,email)
  values(v_service_id,p_date,trim(p_customer_name),trim(p_phone),lower(trim(p_email)))
  returning id into v_id;

  return v_id;
end $$;
grant execute on function public.join_waitlist(text,date,text,text,text) to anon,authenticated;

create or replace view public.appointments_admin with (security_invoker=true) as
select
  a.id,
  a.starts_at,
  a.ends_at,
  a.customer_name,
  a.phone,
  a.email,
  a.notes,
  a.status,
  a.created_at,
  a.updated_at,
  a.expires_at,
  a.confirmed_at,
  a.confirmation_email_sent_at,
  a.confirmation_email_id,
  a.confirmation_email_error,
  a.cancellation_reason,
  s.slug service_slug,
  s.name service_name,
  s.price_cents,
  s.duration_minutes,
  a.blocked_until,
  a.reminder_email_sent_at,
  s.buffer_after_minutes
from public.appointments a
join public.services s on s.id=a.service_id;

grant select on public.appointments_admin to authenticated;

-- Créneaux disponibles pour le déplacement client.
-- Le rendez-vous lié au token est exclu des occupations afin de ne pas masquer
-- artificiellement les créneaux voisins pendant son propre déplacement.
drop function if exists public.get_client_move_slots(uuid,date);
create function public.get_client_move_slots(p_token uuid,p_date date)
returns table(slot text)
language plpgsql volatile security definer set search_path=public as $$
declare
  v_appointment_id uuid;
  v_service_id uuid;
  v_status public.appointment_status;
begin
  perform public.expire_pending_appointments();

  select a.id,a.service_id,a.status
  into v_appointment_id,v_service_id,v_status
  from public.appointments a
  where a.management_token=p_token
  limit 1;

  if v_appointment_id is null then
    raise exception 'Rendez-vous introuvable';
  end if;
  if v_status not in ('pending','confirmed') then
    raise exception 'Ce rendez-vous ne peut plus être déplacé';
  end if;

  return query
  with service_settings as (
    select
      s.duration_minutes,
      coalesce(s.buffer_after_minutes,0) as buffer_after_minutes,
      s.duration_minutes + coalesce(s.buffer_after_minutes,0) as effective_minutes
    from public.services s
    where s.id=v_service_id and s.active=true
  ), rules as (
    select
      coalesce(bs.min_notice_minutes,15) as min_notice_minutes,
      coalesce(bs.max_advance_days,60) as max_advance_days
    from public.booking_settings bs
    where bs.id=1
  ), sessions as (
    select
      oh.id::text as session_id,
      ss.duration_minutes,
      ss.effective_minutes,
      greatest(5,least(coalesce(oh.slot_interval_minutes,15),15)) as base_interval,
      (p_date + oh.start_time)::timestamp as open_at,
      case
        when oh.latest_start_time is not null then (p_date + oh.latest_start_time)::timestamp
        else (p_date + oh.end_time)::timestamp - make_interval(mins=>ss.effective_minutes)
      end as max_start_at,
      case
        when oh.latest_start_time is not null then (p_date + oh.latest_start_time)::timestamp + make_interval(mins=>ss.effective_minutes)
        else (p_date + oh.end_time)::timestamp
      end as close_at
    from public.opening_hours oh
    cross join service_settings ss
    cross join rules r
    where oh.weekday=extract(dow from p_date)::int
      and oh.active=true
      and p_date>=current_date
      and p_date<=current_date+r.max_advance_days
      and not exists(
        select 1 from public.closures c
        where c.closed_date=p_date and c.start_time is null
      )

    union all

    select
      ('exception-'||eo.id::text) as session_id,
      ss.duration_minutes,
      ss.effective_minutes,
      15 as base_interval,
      (p_date + eo.start_time)::timestamp as open_at,
      (p_date + eo.end_time)::timestamp - make_interval(mins=>ss.effective_minutes) as max_start_at,
      (p_date + eo.end_time)::timestamp as close_at
    from public.exceptional_openings eo
    cross join service_settings ss
    cross join rules r
    where eo.open_date=p_date
      and p_date>=current_date
      and p_date<=current_date+r.max_advance_days
      and not exists(
        select 1 from public.closures c
        where c.closed_date=p_date and c.start_time is null
      )
  ), occupied as (
    select
      (a.starts_at at time zone 'Europe/Paris')::timestamp as busy_start,
      (coalesce(a.blocked_until,a.ends_at) at time zone 'Europe/Paris')::timestamp as busy_end
    from public.appointments a
    where a.id<>v_appointment_id
      and a.status in ('pending','confirmed')
      and (a.starts_at at time zone 'Europe/Paris')::date=p_date

    union all

    select
      (p_date + c.start_time)::timestamp,
      (p_date + c.end_time)::timestamp
    from public.closures c
    where c.closed_date=p_date
      and c.start_time is not null
      and c.end_time is not null
  ), base_candidates as (
    select
      s.session_id,
      s.duration_minutes,
      s.effective_minutes,
      s.open_at,
      s.close_at,
      gs::timestamp as candidate_start
    from sessions s
    cross join lateral generate_series(
      s.open_at,
      s.max_start_at,
      make_interval(mins=>s.base_interval)
    ) gs
    where s.max_start_at>=s.open_at
  ), packing_candidates as (
    select s.session_id,s.duration_minutes,s.effective_minutes,s.open_at,s.close_at,s.open_at as candidate_start
    from sessions s
    union
    select s.session_id,s.duration_minutes,s.effective_minutes,s.open_at,s.close_at,s.max_start_at
    from sessions s
    where s.max_start_at>=s.open_at
    union
    select s.session_id,s.duration_minutes,s.effective_minutes,s.open_at,s.close_at,o.busy_end
    from sessions s
    cross join occupied o
    where o.busy_end between s.open_at and s.max_start_at
    union
    select s.session_id,s.duration_minutes,s.effective_minutes,s.open_at,s.close_at,
           o.busy_start-make_interval(mins=>s.effective_minutes)
    from sessions s
    cross join occupied o
    where o.busy_start-make_interval(mins=>s.effective_minutes) between s.open_at and s.max_start_at
  ), candidates as (
    select distinct * from (
      select * from base_candidates
      union all
      select * from packing_candidates
    ) q
  ), valid as (
    select c.*
    from candidates c
    cross join rules r
    where c.candidate_start>=c.open_at
      and c.candidate_start + make_interval(mins=>c.effective_minutes)<=c.close_at
      and (c.candidate_start at time zone 'Europe/Paris') >= now()+make_interval(mins=>r.min_notice_minutes)
      and not exists(
        select 1 from occupied o
        where tstzrange(
          c.candidate_start at time zone 'Europe/Paris',
          (c.candidate_start + make_interval(mins=>c.effective_minutes)) at time zone 'Europe/Paris',
          '[)'
        ) && tstzrange(
          o.busy_start at time zone 'Europe/Paris',
          o.busy_end at time zone 'Europe/Paris',
          '[)'
        )
      )
  )
  select to_char(v.candidate_start,'HH24:MI') as slot
  from valid v
  group by v.candidate_start
  order by v.candidate_start;
end $$;

grant execute on function public.get_client_move_slots(uuid,date) to anon,authenticated;

-- Oscar Blends — espace client sans mot de passe
alter table public.appointments
  add column if not exists customer_user_id uuid references auth.users(id) on delete set null;

create index if not exists appointments_customer_user_id_idx
  on public.appointments(customer_user_id);

create or replace function public.claim_customer_appointments()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid;
  v_email text;
  v_count integer;
begin
  v_uid := auth.uid();
  v_email := lower(trim(coalesce(auth.jwt()->>'email','')));

  if v_uid is null or v_email='' then
    raise exception 'Connexion client requise';
  end if;

  update public.appointments
  set customer_user_id=v_uid
  where customer_user_id is null
    and email is not null
    and lower(trim(email))=v_email;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.claim_customer_appointments() from public,anon;
grant execute on function public.claim_customer_appointments() to authenticated;

create or replace function public.get_my_appointments()
returns table(
  id uuid,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  customer_name text,
  management_token uuid,
  created_at timestamptz,
  confirmed_at timestamptz,
  service_slug text,
  service_name text,
  price_cents integer,
  duration_minutes integer
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Connexion client requise';
  end if;

  perform public.claim_customer_appointments();

  return query
  select
    a.id,
    a.status::text,
    a.starts_at,
    a.ends_at,
    a.customer_name,
    a.management_token,
    a.created_at,
    a.confirmed_at,
    s.slug,
    s.name,
    s.price_cents,
    s.duration_minutes
  from public.appointments a
  join public.services s on s.id=a.service_id
  where a.customer_user_id=v_uid
  order by a.starts_at desc;
end $$;

revoke all on function public.get_my_appointments() from public,anon;
grant execute on function public.get_my_appointments() to authenticated;

-- Quand le client est déjà connecté pendant une nouvelle réservation,
-- le rendez-vous est automatiquement rattaché à son espace.
create or replace function public.request_appointment(
  p_service_slug text,
  p_date date,
  p_time text,
  p_customer_name text,
  p_phone text,
  p_email text,
  p_notes text
) returns uuid
language plpgsql volatile security definer set search_path=public as $$
declare
  v_service public.services%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_blocked_until timestamptz;
  v_hold integer;
  v_expires timestamptz;
  v_token uuid;
begin
  perform public.expire_pending_appointments();

  select * into v_service
  from public.services
  where slug=p_service_slug and active=true;

  if v_service.id is null then raise exception 'Prestation introuvable'; end if;
  if p_customer_name is null or char_length(trim(p_customer_name))<2 then raise exception 'Nom invalide'; end if;
  if p_phone is null or char_length(trim(p_phone))<6 then raise exception 'Téléphone invalide'; end if;
  if p_email is null or position('@' in trim(p_email))<=1 then raise exception 'E-mail invalide'; end if;

  if not exists(
    select 1 from public.get_available_slots(p_date,p_service_slug) s
    where s.slot=left(p_time,5)
  ) then
    raise exception 'Ce créneau n’est plus disponible';
  end if;

  v_start := ((p_date + p_time::time) at time zone 'Europe/Paris');
  v_end := v_start + make_interval(mins=>v_service.duration_minutes);
  v_blocked_until := v_end + make_interval(mins=>coalesce(v_service.buffer_after_minutes,0));

  select pending_hold_minutes into v_hold
  from public.booking_settings where id=1;
  v_hold := coalesce(v_hold,1440);
  v_expires := least(v_start,now()+make_interval(mins=>v_hold));

  insert into public.appointments(
    service_id,starts_at,ends_at,blocked_until,customer_name,phone,email,notes,status,expires_at,customer_user_id
  ) values(
    v_service.id,v_start,v_end,v_blocked_until,trim(p_customer_name),trim(p_phone),lower(trim(p_email)),
    nullif(trim(coalesce(p_notes,'')),''),'pending',v_expires,auth.uid()
  ) returning management_token into v_token;

  return v_token;
exception
  when exclusion_violation then
    raise exception 'Ce créneau vient d’être demandé par un autre client. Choisis-en un autre.';
end $$;

grant execute on function public.request_appointment(text,date,text,text,text,text,text) to anon,authenticated;
