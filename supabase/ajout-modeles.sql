-- =============================================================================
-- TMB — AJOUT de la bibliothèque de messages préenregistrés
-- À exécuter dans l'éditeur SQL d'une base DÉJÀ en service : ce script est
-- idempotent et n'altère aucune donnée existante (il peut être relancé).
-- Le contenu est également intégré à supabase/schema.sql pour les nouvelles
-- installations.
-- =============================================================================

create table if not exists modeles_messages (
  id uuid primary key default gen_random_uuid(),
  titre text not null,
  texte_fr text not null,
  texte_en text not null default '',
  categorie text not null default 'Général',
  ordre int not null default 0,
  actif boolean not null default true
);

alter table modeles_messages enable row level security;

-- Lecture : tout compte CONNECTÉ (le formulaire Messages est accessible à
-- tous les rôles, y compris « caisse »). Les écrans publics n'en ont pas besoin.
drop policy if exists "lecture connectes" on modeles_messages;
create policy "lecture connectes" on modeles_messages for select to authenticated
  using (role_courant() in ('admin','supervision','caisse'));

-- Écriture : admin uniquement (même modèle que machines / motifs / params)
drop policy if exists "admin" on modeles_messages;
create policy "admin" on modeles_messages for all to authenticated
  using (role_courant() = 'admin') with check (role_courant() = 'admin');

-- Temps réel (ajout idempotent : ignore l'erreur si la table y est déjà)
do $$
begin
  alter publication supabase_realtime add table modeles_messages;
exception
  when duplicate_object then null;
end $$;

-- ------------------------------------------------ bibliothèque initiale
-- Validée par l'exploitant. `on conflict do nothing` sur (titre) via un index
-- unique : relancer le script ne crée pas de doublon et ne modifie pas les
-- textes déjà retouchés en supervision.
create unique index if not exists modeles_messages_titre_unique on modeles_messages (titre);

insert into modeles_messages (titre, categorie, ordre, texte_fr, texte_en) values
  ('Réservation obligatoire', 'Réservation', 10,
   'Réservation obligatoire pour tous les trajets.',
   'Booking is compulsory for all journeys.'),
  ('Réserver sa descente', 'Réservation', 20,
   'Pensez à réserver votre descente.',
   'Remember to book your descent.'),
  ('Ligne jaune', 'Sécurité', 30,
   'Restez derrière la ligne jaune à l''approche du train.',
   'Please stand behind the yellow line when the tram approaches.'),
  ('Enfants sur les quais', 'Sécurité', 40,
   'Tenez les enfants par la main sur les quais.',
   'Please hold children by the hand on the platforms.'),
  ('Vent fort au sommet', 'Météo', 50,
   'Vent fort au sommet : les circulations peuvent être adaptées.',
   'Strong wind at the summit: services may be adjusted.'),
  ('Tronçon supérieur fermé', 'Météo', 60,
   'Tronçon Bellevue – Nid d''Aigle fermé pour raisons météorologiques.',
   'The Bellevue – Nid d''Aigle section is closed due to weather conditions.'),
  ('Terminus exceptionnel Bellevue', 'Météo', 70,
   'Terminus exceptionnel à Bellevue.',
   'Exceptional terminus at Bellevue.'),
  ('Train complet', 'Exploitation', 80,
   'Train complet : présentez-vous au personnel en gare.',
   'This service is full: please speak to station staff.'),
  ('Vélos', 'Exploitation', 90,
   'Vélos acceptés dans la limite de 5 par train, selon l''affluence.',
   'Bikes carried subject to availability, up to 5 per tram.'),
  ('Vêtements chauds', 'Confort', 100,
   'Prévoyez des vêtements chauds : la température baisse fortement avec l''altitude.',
   'Please bring warm clothing: temperatures drop sharply with altitude.'),
  ('Travaux en gare', 'Travaux', 110,
   'Travaux en gare : suivez la signalisation.',
   'Works in progress: please follow the signs.')
on conflict (titre) do nothing;

-- ------------------------------------------------ vitesse du bandeau
-- Vitesse de défilement des messages, en pixels par seconde (la durée de
-- l'animation est recalculée selon la longueur du texte).
insert into params (cle, valeur) values ('vitesse_ticker_px_s', '90')
on conflict (cle) do nothing;
