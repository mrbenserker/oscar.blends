-- V7 — administration avancée : création manuelle et déplacement sécurisé
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
language plpgsql
security definer
set search_path=public
as $$
declare
  v_service public.services%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Accès administrateur requis';
  end if;

  select * into v_service
  from public.services
  where slug=p_service_slug and active=true;

  if v_service.id is null then
    raise exception 'Prestation introuvable';
  end if;

  if p_customer_name is null or char_length(trim(p_customer_name))<2 then
    raise exception 'Nom client invalide';
  end if;
  if p_phone is null or char_length(trim(p_phone))<6 then
    raise exception 'Téléphone invalide';
  end if;
  if p_email is null or position('@' in trim(p_email))<=1 then
    raise exception 'E-mail invalide';
  end if;

  v_start := ((p_date + p_time::time) at time zone 'Europe/Paris');
  v_end := v_start + make_interval(mins=>v_service.duration_minutes);

  insert into public.appointments(
    service_id,starts_at,ends_at,customer_name,phone,email,notes,status,expires_at,confirmed_at
  ) values(
    v_service.id,v_start,v_end,trim(p_customer_name),trim(p_phone),lower(trim(p_email)),
    nullif(trim(coalesce(p_notes,'')),''),'confirmed',null,now()
  ) returning id into v_id;

  return v_id;
exception
  when exclusion_violation then
    raise exception 'Ce créneau chevauche déjà un autre rendez-vous.';
end $$;

grant execute on function public.admin_create_appointment(text,date,text,text,text,text,text) to authenticated;

drop function if exists public.admin_move_appointment(uuid,date,text);
create function public.admin_move_appointment(
  p_id uuid,
  p_date date,
  p_time text
) returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_duration integer;
  v_status public.appointment_status;
  v_start timestamptz;
  v_end timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Accès administrateur requis';
  end if;

  select s.duration_minutes,a.status
    into v_duration,v_status
  from public.appointments a
  join public.services s on s.id=a.service_id
  where a.id=p_id
  for update;

  if v_duration is null then
    raise exception 'Rendez-vous introuvable';
  end if;
  if v_status not in ('pending','confirmed') then
    raise exception 'Ce rendez-vous ne peut plus être déplacé';
  end if;

  v_start := ((p_date + p_time::time) at time zone 'Europe/Paris');
  v_end := v_start + make_interval(mins=>v_duration);

  update public.appointments
  set starts_at=v_start,
      ends_at=v_end,
      confirmation_email_sent_at=null,
      confirmation_email_id=null,
      confirmation_email_error=null
  where id=p_id;
exception
  when exclusion_violation then
    raise exception 'Ce nouveau créneau chevauche déjà un autre rendez-vous.';
end $$;

grant execute on function public.admin_move_appointment(uuid,date,text) to authenticated;
