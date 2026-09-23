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
    nullif(trim(coalesce(p_notes,'')),''),'pending',v_expires,
    case
      when auth.uid() is not null
       and lower(trim(coalesce(auth.jwt()->>'email','')))=lower(trim(p_email))
      then auth.uid()
      else null
    end
  ) returning management_token into v_token;

  return v_token;
exception
  when exclusion_violation then
    raise exception 'Ce créneau vient d’être demandé par un autre client. Choisis-en un autre.';
end $$;

grant execute on function public.request_appointment(text,date,text,text,text,text,text) to anon,authenticated;
