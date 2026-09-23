-- Oscar Blends — correction des créneaux lors d'un déplacement client
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
