-- Oscar Blends — envoi personnalisé des liens de connexion client
-- Stockage technique anti-abus : aucun e-mail en clair n'est enregistré ici.
create table if not exists public.account_login_requests (
  email_hash text primary key,
  last_sent_at timestamptz not null default now(),
  window_started_at timestamptz not null default now(),
  sent_count integer not null default 1,
  constraint account_login_requests_sent_count_check check (sent_count between 0 and 100)
);

alter table public.account_login_requests enable row level security;

-- Aucune policy publique : cette table n'est utilisée que par l'API serveur avec la clé service role.
