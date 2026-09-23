-- Oscar Blends — alignement des durées affichées avec les durées réellement bloquées
update public.services
set display_duration = case slug
  when 'classique' then '50 min'
  when 'barbe-clean' then '30 min'
  when 'barbe-old-school' then '50 min'
  when 'ptit-blend' then '40 min'
  when 'rituel-royal' then '1 h 15'
  when 'gentleman' then '65 min'
  when 'mise-a-zero' then '30 min'
  else display_duration
end
where slug in ('classique','barbe-clean','barbe-old-school','ptit-blend','rituel-royal','gentleman','mise-a-zero');
