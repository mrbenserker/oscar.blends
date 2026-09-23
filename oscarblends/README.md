# Oscar Blends — V6 Planning

Cette version ne contient **aucun paiement en ligne**. Le site sert uniquement à demander, organiser et confirmer les rendez-vous.

## Nouveautés V6

- Agenda pro mobile : **Aujourd’hui / Demain / 7 jours**.
- Onglet **Demandes** pour traiter rapidement les rendez-vous en attente.
- Une demande `pending` bloque immédiatement toute la durée de la prestation.
- Expiration automatique configurable des demandes en attente : 2 h, 4 h, 8 h, 12 h, 24 h ou 48 h.
- Vue du temps restant avant expiration dans l’espace pro.
- Gestion des **indisponibilités** : journée entière ou plage horaire.
- Horaires habituels modifiables depuis l’espace pro, jour par jour.
- Base par défaut : **09h30–12h30**, reprise **14h00**, dernier départ **19h00**, lundi à samedi. **Dimanche fermé par défaut mais activable depuis l’espace pro.**
- Algorithme de créneaux : les horaires qui remplissent le mieux la journée sont affichés en **Créneaux conseillés**.
- Les autres créneaux possibles restent accessibles : on optimise sans empêcher un client de réserver un horaire moins parfait.
- Le lien « Espace pro » a été retiré du site public.
- Mention de confidentialité ajoutée au formulaire client.
- L’e-mail automatique reste optionnel : un rendez-vous peut être confirmé même si Gmail n’est pas encore configuré.

## Mise à jour Supabase

1. Ouvrir le projet Supabase.
2. Aller dans **SQL Editor**.
3. Coller tout le contenu de `schema.sql`.
4. Cliquer sur **Run**.

Le script est prévu pour mettre à niveau la base existante V5 sans supprimer les rendez-vous déjà enregistrés.

### Compte administrateur

Le compte Supabase Auth doit toujours être présent dans `public.admins` :

```sql
insert into public.admins(user_id)
values ('UUID_DU_COMPTE_ADMIN')
on conflict do nothing;
```

## Variables Vercel obligatoires

Dans **Vercel > Project > Settings > Environment Variables** :

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`

Puis redéployer.

## Gmail — facultatif pour le moment

Le planning fonctionne sans Gmail. Si les variables suivantes sont absentes, le bouton **Confirmer** confirme simplement le rendez-vous sans tenter d’envoyer un mail :

- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`

Quand elles seront ajoutées plus tard, l’e-mail automatique pourra être réactivé sans refaire le planning.

## Fonctionnement des demandes en attente

Une demande en attente est considérée comme occupée exactement comme un rendez-vous confirmé. Elle bloque donc les créneaux qui chevauchent sa durée.

Par défaut, une demande expire après **24 heures**, ou au plus tard au début du rendez-vous si celui-ci arrive avant. Le délai peut être modifié depuis **Espace pro > Réglages**.

À l’expiration, le statut passe à `cancelled` avec le motif `Délai de confirmation dépassé`, ce qui libère immédiatement le créneau pour les prochains calculs.

## Indisponibilités

Dans **Espace pro > Indisponibilités** :

- journée entière ;
- ou période précise, par exemple 10h30 → 11h30 ;
- motif facultatif.

Ces blocages sont pris en compte par `get_available_slots` au même titre qu’un rendez-vous.

## Horaires habituels

Dans **Espace pro > Réglages**, chaque jour du lundi au dimanche peut être activé/désactivé et configuré avec. Le dimanche reste désactivé par défaut :

- début matin ;
- fin matin : la prestation doit être terminée avant cette heure ;
- reprise après-midi ;
- dernier départ autorisé.

## Déploiement Vercel

Le ZIP V6 peut être redéployé sur le même projet Vercel. Après le déploiement, exécuter également le nouveau `schema.sql` dans Supabase pour activer toutes les fonctions V6.


## V6.1
Routage Vercel renforcé : `/admin` et `/admin.html` ouvrent tous les deux l’espace professionnel.


## V6.2
- Ajout du **dimanche** dans les horaires habituels.
- Le dimanche est **désactivé par défaut**.
- Il peut être activé à la demande depuis **Espace pro > Réglages > Horaires habituels**, avec ses propres horaires.
- Aucun changement SQL obligatoire pour une base V6 existante : l’activation crée les lignes d’horaires du dimanche au premier enregistrement.


## V6.3 — vue planning 7 jours
- Le bouton **7 jours** reste disponible dans l'admin.
- La vue semaine affiche désormais les 7 journées, même lorsqu'elles sont vides.
- Les journées libres, fermées ou bloquées toute la journée sont identifiées clairement.


## V6.4 — identité visuelle officielle
- Intégration des **logos officiels fournis** par Oscar Blends.
- Logo complet dans l’en-tête, le pied de page et la connexion admin.
- Symbole rond utilisé dans l’espace admin et pour les icônes du site.
- Ajout d’une icône navigateur / raccourci mobile et d’un manifest.
- Palette principale ajustée au vert `#3B7061` et au crème `#FAFAE7` des logos.
- Aucun changement Supabase n’est nécessaire pour cette mise à jour visuelle.


## V7 — Admin avancé

Cette version ajoute :
- un tableau de bord quotidien avec prochain client, demandes en attente et CA théorique confirmé ;
- l'ajout manuel d'un rendez-vous depuis l'admin ;
- le déplacement d'un rendez-vous avec contrôle anti-chevauchement ;
- un annuaire clients construit automatiquement à partir des réservations ;
- une fiche historique par client ;
- la vue Agenda Aujourd'hui / Demain / 7 jours conservée.

### Migration Supabase V7
Après le déploiement, exécuter une seule fois `migration-v7.sql` dans Supabase > SQL Editor.
Cette migration crée uniquement les fonctions administrateur nécessaires à l'ajout manuel et au déplacement des rendez-vous.


## V8 — Finalisation des 15 améliorations

La V8 complète les fonctions restantes :
- lien privé client pour déplacer ou annuler un rendez-vous ;
- rappel automatique la veille et alerte de liste d'attente dès que l'e-mail est configuré ;
- bouton pour reprendre la même prestation ;
- vraie vue planning verticale avec blocs proportionnels aux durées ;
- statuts Terminé et Absent ;
- statistiques d'activité ;
- liste d'attente ;
- ouvertures exceptionnelles par date ;
- délai minimum et nombre de jours maximum de réservation ;
- temps de battement configurable par prestation ;
- page de confirmation avec lien de gestion ;
- ajout au calendrier depuis la page de gestion.

### Mise à jour Supabase
Exécuter une seule fois `migration-v8.sql` dans Supabase > SQL Editor après le déploiement.

### Automatisations e-mail
Le code est prêt dans `api/automation.js`. Les envois restent volontairement inactifs tant que la messagerie n'est pas configurée.
Variables Vercel nécessaires pour les activer avec Gmail :
- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`
- `CRON_SECRET` (une valeur longue et aléatoire)
- facultatif : `SITE_URL` si une URL personnalisée doit remplacer l'URL de production Vercel.
- facultatif : `EMAIL_FROM` et `EMAIL_REPLY_TO`.

Le cron Vercel est planifié chaque soir à 18:00 UTC.
