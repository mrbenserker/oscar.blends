-- Oscar Blends — réservation possible à partir du prochain quart d'heure disponible
update public.booking_settings
set min_notice_minutes = 15,
    updated_at = now()
where id = 1;
