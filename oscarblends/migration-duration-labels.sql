-- Oscar Blends — durées finales des prestations
-- À exécuter une fois dans Supabase > SQL Editor sur la base déjà en production.
update public.services
set
  duration_minutes = case slug
    when 'classique' then 40
    when 'barbe-clean' then 30
    when 'barbe-old-school' then 40
    when 'ptit-blend' then 30
    when 'rituel-royal' then 65
    when 'gentleman' then 50
    when 'mise-a-zero' then 30
    else duration_minutes
  end,
  display_duration = case slug
    when 'classique' then '40 min'
    when 'barbe-clean' then '30 min'
    when 'barbe-old-school' then '40 min'
    when 'ptit-blend' then '30 min'
    when 'rituel-royal' then '65 min'
    when 'gentleman' then '50 min'
    when 'mise-a-zero' then '30 min'
    else display_duration
  end
where slug in (
  'classique',
  'barbe-clean',
  'barbe-old-school',
  'ptit-blend',
  'rituel-royal',
  'gentleman',
  'mise-a-zero'
);
