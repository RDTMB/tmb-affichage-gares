-- =============================================================================
-- TMB — graine de démonstration (après schema.sql)
-- Machines, motifs, paramètres + jour de démonstration du 2026-08-24
-- (grand service ; état de la maquette validée : facultatifs 3/4/9/10/17/18
-- activés, TRAIN 11 retardé +10 min Météo, descente 16 supprimée Météo).
-- =============================================================================

insert into machines (nom, couleur, cercle, en_service) values
  ('Marie',      '#2E74B5', null,      true),
  ('Anne',       '#7FA51E', null,      true),
  ('Jeanne',     '#C2447A', null,      true),
  ('Marguerite', '#FFFFFF', '#E52A23', true)
on conflict (nom) do nothing;

insert into motifs (fr, en) values
  ('Météo', 'Weather'),
  ('Croisement', 'Crossing'),
  ('Technique', 'Technical issue'),
  ('Affluence', 'High demand'),
  ('Exploitation', 'Operations')
on conflict (fr) do nothing;

insert into params (cle, valeur) values
  ('meteo_sommet', '{"t": 9, "ciel_fr": "Dégagé", "ciel_en": "Clear", "heure_releve": "08:00"}'),
  ('veille_nuit',  '{"debut": "21:00", "fin": "06:00"}'),
  ('duree_horaires_s', '20'),
  ('duree_cache_min',  '15'),
  ('vitesse_ticker_px_s', '90'),  -- Lent 60 · Normal 90 · Rapide 130 · Très rapide 180
  -- Gares d'origine (pas d'heure d'arrivée) : « À QUAI » ce délai avant le départ
  ('a_quai_origine_s', '300')
on conflict (cle) do nothing;

-- ⚠ Bibliothèque de messages préenregistrés : exécuter ENSUITE le script
-- supabase/ajout-modeles.sql (il crée la table si besoin, ses policies et les
-- 11 modèles validés par l'exploitant). Il est idempotent et fonctionne aussi
-- sur une base déjà en service.

-- ------------------------------------------------ jour de démonstration
insert into jours (date, grille_version) values ('2026-08-24', '2026-ete-grand-service')
on conflict (date) do nothing;

-- Rames par défaut en cycle sur les montées (Marie, Anne, Jeanne, Marguerite),
-- héritées par la descente appariée (numero + 1).
insert into circulations
  (date, numero, sens, express, facultatif, facultatif_actif, velos, rame, statut, retard_min, motif)
values
  ('2026-08-24',  1, 'montee',   false, false, false, true,  'Marie',      'ok', 0, null),
  ('2026-08-24',  2, 'descente', false, false, false, false, 'Marie',      'ok', 0, null),
  ('2026-08-24',  3, 'montee',   false, true,  true,  true,  'Anne',       'ok', 0, null),
  ('2026-08-24',  4, 'descente', false, true,  true,  false, 'Anne',       'ok', 0, null),
  ('2026-08-24',  5, 'montee',   false, false, false, false, 'Jeanne',     'ok', 0, null),
  ('2026-08-24',  6, 'descente', false, false, false, false, 'Jeanne',     'ok', 0, null),
  ('2026-08-24',  7, 'montee',   false, false, false, false, 'Marguerite', 'ok', 0, null),
  ('2026-08-24',  8, 'descente', false, false, false, false, 'Marguerite', 'ok', 0, null),
  ('2026-08-24',  9, 'montee',   true,  true,  true,  false, 'Marie',      'ok', 0, null),
  ('2026-08-24', 10, 'descente', true,  true,  true,  false, 'Marie',      'ok', 0, null),
  ('2026-08-24', 11, 'montee',   false, false, false, false, 'Anne',       'retard', 10, 'Météo'),
  ('2026-08-24', 12, 'descente', false, false, false, false, 'Anne',       'ok', 0, null),
  ('2026-08-24', 13, 'montee',   false, false, false, false, 'Jeanne',     'ok', 0, null),
  ('2026-08-24', 14, 'descente', false, false, false, false, 'Jeanne',     'ok', 0, null),
  ('2026-08-24', 15, 'montee',   false, false, false, false, 'Marguerite', 'ok', 0, null),
  ('2026-08-24', 16, 'descente', false, false, false, false, 'Marguerite', 'supprime', 0, 'Météo'),
  ('2026-08-24', 17, 'montee',   true,  true,  true,  false, 'Marie',      'ok', 0, null),
  ('2026-08-24', 18, 'descente', true,  true,  true,  false, 'Marie',      'ok', 0, null),
  ('2026-08-24', 19, 'montee',   false, false, false, false, 'Anne',       'ok', 0, null),
  ('2026-08-24', 20, 'descente', false, false, false, false, 'Anne',       'ok', 0, null),
  ('2026-08-24', 21, 'montee',   false, false, false, true,  'Jeanne',     'ok', 0, null),
  ('2026-08-24', 22, 'descente', false, false, false, false, 'Jeanne',     'ok', 0, null),
  ('2026-08-24', 23, 'montee',   true,  true,  false, false, 'Marguerite', 'ok', 0, null),
  ('2026-08-24', 24, 'descente', false, true,  false, false, 'Marguerite', 'ok', 0, null),
  ('2026-08-24', 25, 'montee',   false, false, false, true,  'Marie',      'ok', 0, null),
  ('2026-08-24', 26, 'descente', false, false, false, false, 'Marie',      'ok', 0, null)
on conflict (date, numero) do nothing;
