-- Oscar Blends — V6
-- Planning optimisé + demandes bloquantes + agenda pro + indisponibilités + expiration configurable
-- À exécuter dans Supabase > SQL Editor.

create extension if not exists pgcrypto;

do $$ begin
  create type public.appointment_status as enum ('pending','confirmed','rejected','cancelled');
exception when duplicate_object then null;
end $$;


create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text not null,
  price_cents integer not null check (price_cents >= 0),
  duration_minutes integer not null check (duration_minutes > 0),
  display_duration text not null,
  active boolean not null default true,
  sort_order integer not null default 0
);

create table if not exists public.opening_hours (
  id uuid primary key default gen_random_uuid(),
  weekday integer not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  slot_interval_minutes integer not null default 15,
  active boolean not null default true,
  latest_start_time time,
  unique(weekday,start_time,end_time)
);

create table if not exists public.closures (
  id uuid primary key default gen_random_uuid(),
  closed_date date not null,
  start_time time,
  end_time time,
  reason text,
  created_at timestamptz not null default now(),
  constraint closure_time_range check (
    (start_time is null and end_time is null)
    or (start_time is not null and end_time is not null and end_time > start_time)
  )
);

create table if not exists public.booking_settings (
  id smallint primary key default 1 check (id = 1),
  pending_hold_minutes integer not null default 1440 check (pending_hold_minutes between 30 and 4320),
  updated_at timestamptz not null default now()
);
insert into public.booking_settings(id,pending_hold_minutes)
values(1,1440)
on conflict (id) do nothing;

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  customer_name text not null check (char_length(customer_name) between 2 and 120),
  phone text not null check (char_length(phone) between 6 and 40),
  email text,
  notes text,
  status public.appointment_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  confirmed_at timestamptz,
  confirmation_email_sent_at timestamptz,
  confirmation_email_id text,
  confirmation_email_error text,
  cancellation_reason text,
  constraint valid_appointment_range check (ends_at > starts_at)
);

alter table public.appointments add column if not exists expires_at timestamptz;
alter table public.appointments add column if not exists confirmed_at timestamptz;
alter table public.appointments add column if not exists confirmation_email_sent_at timestamptz;
alter table public.appointments add column if not exists confirmation_email_id text;
alter table public.appointments add column if not exists confirmation_email_error text;
alter table public.appointments add column if not exists cancellation_reason text;

alter table public.appointments drop constraint if exists appointment_email_required;
alter table public.appointments add constraint appointment_email_required
  check (email is not null and char_length(trim(email)) >= 5 and position('@' in email) > 1) not valid;

-- Les demandes pending bloquent autant que les rendez-vous confirmés.
alter table public.appointments drop constraint if exists no_active_appointment_overlap;
alter table public.appointments add constraint no_active_appointment_overlap
  exclude using gist (tstzrange(starts_at, ends_at, '[)') with &&)
  where (status in ('pending','confirmed'));

create index if not exists appointments_status_expires_idx on public.appointments(status,expires_at);
create index if not exists appointments_starts_at_idx on public.appointments(starts_at);
create index if not exists closures_date_idx on public.closures(closed_date);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists appointments_set_updated_at on public.appointments;
create trigger appointments_set_updated_at
before update on public.appointments
for each row execute function public.set_updated_at();

drop trigger if exists booking_settings_set_updated_at on public.booking_settings;
create trigger booking_settings_set_updated_at
before update on public.booking_settings
for each row execute function public.set_updated_at();

insert into public.services(slug,name,description,price_cents,duration_minutes,display_duration,sort_order)
values
('classique','Le Classique','Coupe signature adaptée au coiffage, conseils personnalisés et finition produit.',2200,50,'30–50 min',1),
('barbe-clean','Barbe Clean','Taille de barbe à la tondeuse avec finitions nettes et conseils d’entretien.',1500,30,'30 min',2),
('barbe-old-school','Barbe Old School','Taille de barbe + rasage à l’ancienne, serviettes chaudes.',2300,50,'30–50 min',3),
('ptit-blend','Le P''tit Blend','Coupe garçon de 2 à 12 ans, adaptée à l’âge et finitions naturelles.',1500,40,'30–40 min',4),
('rituel-royal','Le Rituel Royal','Coupe signature + taille de barbe + rasage à l’ancienne à la serviette chaude.',3800,75,'1 h 15',5),
('gentleman','Le Gentleman','Coupe signature + taille de barbe, mise en forme complète.',3200,65,'45–65 min',6),
('mise-a-zero','La Mise à Zéro','Rasage intégral avec soins apaisants et finition nette.',1900,30,'30 min',7)
on conflict (slug) do update set
  name=excluded.name,
  description=excluded.description,
  price_cents=excluded.price_cents,
  duration_minutes=excluded.duration_minutes,
  display_duration=excluded.display_duration,
  sort_order=excluded.sort_order;

-- Horaires standards demandés : lundi à samedi.
-- Le dimanche (weekday=0) reste fermé par défaut mais peut être activé depuis l'espace pro.
-- Matin : 09:30 -> 12:30, la prestation doit être terminée à 12:30.
-- Après-midi : reprise à 14:00, dernier départ possible à 19:00.
-- Les horaires peuvent ensuite être modifiés depuis l'espace pro.
insert into public.opening_hours(weekday,start_time,end_time,latest_start_time,slot_interval_minutes,active)
select d,'09:30','12:30',null,15,true from generate_series(1,6) d
where not exists(select 1 from public.opening_hours h where h.weekday=d and h.start_time='09:30'::time)
on conflict do nothing;

insert into public.opening_hours(weekday,start_time,end_time,latest_start_time,slot_interval_minutes,active)
select d,'14:00','20:15','19:00',15,true from generate_series(1,6) d
where not exists(select 1 from public.opening_hours h where h.weekday=d and h.start_time='14:00'::time)
on conflict do nothing;

-- Dimanche : mêmes valeurs proposées dans l'éditeur, mais fermé par défaut.
insert into public.opening_hours(weekday,start_time,end_time,latest_start_time,slot_interval_minutes,active)
select 0,'09:30','12:30',null,15,false
where not exists(select 1 from public.opening_hours h where h.weekday=0 and h.start_time='09:30'::time)
on conflict do nothing;

insert into public.opening_hours(weekday,start_time,end_time,latest_start_time,slot_interval_minutes,active)
select 0,'14:00','20:15','19:00',15,false
where not exists(select 1 from public.opening_hours h where h.weekday=0 and h.start_time='14:00'::time)
on conflict do nothing;

-- Expire les demandes qui n'ont pas été validées dans le délai choisi.
create or replace function public.expire_pending_appointments()
returns integer
language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  update public.appointments
  set status='cancelled', cancellation_reason='Délai de confirmation dépassé'
  where status='pending'
    and expires_at is not null
    and expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

grant execute on function public.expire_pending_appointments() to anon, authenticated;

-- Créneaux intelligents :
-- - durée complète obligatoire ;
-- - pending + confirmed occupent le planning ;
-- - indisponibilités prises en compte ;
-- - les créneaux qui collent aux rendez-vous existants sont recommandés ;
-- - les créneaux moins optimaux restent visibles pour ne pas perdre un client.
drop function if exists public.get_available_slots(date,text);
create function public.get_available_slots(p_date date, p_service_slug text)
returns table(slot text, recommended boolean)
language plpgsql volatile security definer set search_path=public as $$
begin
  perform public.expire_pending_appointments();

  return query
  with service_settings as (
    select s.duration_minutes
    from public.services s
    where s.slug=p_service_slug and s.active=true
  ), sessions as (
    select
      oh.id as session_id,
      ss.duration_minutes,
      greatest(5,least(coalesce(oh.slot_interval_minutes,15),15)) as base_interval,
      (p_date + oh.start_time)::timestamp as open_at,
      case
        when oh.latest_start_time is not null then (p_date + oh.latest_start_time)::timestamp
        else (p_date + oh.end_time)::timestamp - make_interval(mins=>ss.duration_minutes)
      end as max_start_at,
      case
        when oh.latest_start_time is not null then (p_date + oh.latest_start_time)::timestamp + make_interval(mins=>ss.duration_minutes)
        else (p_date + oh.end_time)::timestamp
      end as close_at
    from public.opening_hours oh
    cross join service_settings ss
    where oh.weekday=extract(dow from p_date)::int
      and oh.active=true
      and not exists(
        select 1 from public.closures c
        where c.closed_date=p_date and c.start_time is null
      )
  ), occupied as (
    select
      (a.starts_at at time zone 'Europe/Paris')::timestamp as busy_start,
      (a.ends_at at time zone 'Europe/Paris')::timestamp as busy_end
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
    select s.session_id, gs::timestamp as candidate_start
    from sessions s
    cross join lateral generate_series(s.open_at,s.max_start_at,make_interval(mins=>s.base_interval)) gs
    where s.max_start_at>=s.open_at
  ), packing_candidates as (
    select s.session_id,s.open_at as candidate_start from sessions s
    union
    select s.session_id,s.max_start_at from sessions s where s.max_start_at>=s.open_at
    union
    select s.session_id,o.busy_end from sessions s cross join occupied o
      where o.busy_end between s.open_at and s.max_start_at
    union
    select s.session_id,o.busy_start-make_interval(mins=>s.duration_minutes)
      from sessions s cross join occupied o
      where o.busy_start-make_interval(mins=>s.duration_minutes) between s.open_at and s.max_start_at
  ), candidates as (
    select * from base_candidates
    union
    select * from packing_candidates
  ), feasible as (
    select
      s.session_id,
      c.candidate_start,
      c.candidate_start+make_interval(mins=>s.duration_minutes) as candidate_end,
      s.open_at,
      s.close_at,
      s.duration_minutes
    from candidates c
    join sessions s using(session_id)
    where c.candidate_start between s.open_at and s.max_start_at
      and c.candidate_start+make_interval(mins=>s.duration_minutes)<=s.close_at
      and c.candidate_start>(now() at time zone 'Europe/Paris')
      and not exists(
        select 1 from occupied o
        where tsrange(o.busy_start,o.busy_end,'[)') &&
              tsrange(c.candidate_start,c.candidate_start+make_interval(mins=>s.duration_minutes),'[)')
      )
  ), gaps as (
    select
      f.*,
      extract(epoch from (
        f.candidate_start-greatest(
          f.open_at,
          coalesce((select max(o.busy_end) from occupied o where o.busy_end<=f.candidate_start),f.open_at)
        )
      ))/60.0 as gap_before,
      extract(epoch from (
        least(
          f.close_at,
          coalesce((select min(o.busy_start) from occupied o where o.busy_start>=f.candidate_end),f.close_at)
        )-f.candidate_end
      ))/60.0 as gap_after
    from feasible f
  ), scored as (
    select
      candidate_start,
      (gap_before=0 or gap_after=0) as is_recommended,
      (case when gap_before=0 then 150 else 0 end)
      +(case when gap_after=0 then 150 else 0 end)
      -(gap_before+gap_after)/20.0 as score
    from gaps
  )
  select to_char(candidate_start,'HH24:MI') as slot,is_recommended as recommended
  from scored
  order by is_recommended desc,score desc,candidate_start asc;
end $$;

grant execute on function public.get_available_slots(date,text) to anon, authenticated;

-- Crée une demande PENDING après revérification du créneau.
-- La plage est immédiatement bloquée pour les autres clients.
drop function if exists public.request_appointment(text,date,text,text,text,text,text);
create function public.request_appointment(
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
  v_id uuid;
  v_hold integer;
  v_expires timestamptz;
begin
  perform public.expire_pending_appointments();

  if nullif(trim(p_customer_name),'') is null then raise exception 'Nom et prénom obligatoires'; end if;
  if nullif(trim(p_phone),'') is null then raise exception 'Téléphone obligatoire'; end if;
  if nullif(trim(p_email),'') is null or position('@' in p_email)<=1 then raise exception 'E-mail obligatoire'; end if;

  select * into v_service from public.services where slug=p_service_slug and active=true;
  if not found then raise exception 'Prestation indisponible'; end if;

  v_start := (p_date + p_time::time) at time zone 'Europe/Paris';
  v_end := v_start + make_interval(mins=>v_service.duration_minutes);
  if v_start<=now() then raise exception 'Créneau invalide'; end if;

  if not exists(
    select 1 from public.get_available_slots(p_date,p_service_slug) s
    where s.slot=to_char(v_start at time zone 'Europe/Paris','HH24:MI')
  ) then
    raise exception 'Ce créneau n’est plus disponible';
  end if;

  select pending_hold_minutes into v_hold from public.booking_settings where id=1;
  v_hold := coalesce(v_hold,1440);
  v_expires := least(v_start,now()+make_interval(mins=>v_hold));

  insert into public.appointments(
    service_id,starts_at,ends_at,customer_name,phone,email,notes,status,expires_at
  ) values(
    v_service.id,v_start,v_end,trim(p_customer_name),trim(p_phone),lower(trim(p_email)),
    nullif(trim(p_notes),''),'pending',v_expires
  ) returning id into v_id;

  return v_id;
exception
  when exclusion_violation then
    raise exception 'Ce créneau vient d’être demandé par un autre client. Choisis-en un autre.';
end $$;

grant execute on function public.request_appointment(text,date,text,text,text,text,text) to anon, authenticated;

-- Admins : ajoute l'UUID du compte Supabase Auth utilisé pour l'espace pro.
create table if not exists public.admins(user_id uuid primary key references auth.users(id) on delete cascade);
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.admins where user_id=auth.uid())
$$;

alter table public.services enable row level security;
alter table public.opening_hours enable row level security;
alter table public.closures enable row level security;
alter table public.booking_settings enable row level security;
alter table public.appointments enable row level security;
alter table public.admins enable row level security;

drop policy if exists "public read active services" on public.services;
create policy "public read active services" on public.services for select using (active=true);

drop policy if exists "admin all services" on public.services;
create policy "admin all services" on public.services for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin opening hours" on public.opening_hours;
create policy "admin opening hours" on public.opening_hours for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin closures" on public.closures;
create policy "admin closures" on public.closures for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin booking settings" on public.booking_settings;
create policy "admin booking settings" on public.booking_settings for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin appointments" on public.appointments;
create policy "admin appointments" on public.appointments for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin list" on public.admins;
create policy "admin list" on public.admins for select using (public.is_admin());

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
  s.duration_minutes
from public.appointments a
join public.services s on s.id=a.service_id;

grant select on public.appointments_admin to authenticated;
