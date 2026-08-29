-- =============================================================================
-- TMB — Train supplémentaire (« train sup »)
-- À exécuter dans l'éditeur SQL. Rejouable. Intégré à supabase/schema.sql
-- pour les nouvelles installations.
--
-- POURQUOI. Quand trop de clients doivent redescendre par rapport aux places
-- disponibles, le chef d'exploitation crée un train de renfort. Il part du
-- Fayet à une heure choisie, ne dessert souvent NI Saint-Gervais NI Motivon,
-- s'arrête au Col de Voza pour récupérer les voyageurs, et redescend.
--
-- Ce train n'existe dans AUCUNE grille. Or trainsDuJour() ne sait joindre un
-- état d'exploitation qu'à un train de grille : une circulation sans train
-- correspondant serait invisible partout. Un train sup porte donc ses propres
-- passages, au format des grilles JSON :
--   [{"gare":"le-fayet","d":"17:00:00"},{"gare":"col-de-voza","a":"17:34:30"}]
--
-- La convention impair = montée / pair = descente est CONSERVÉE (numéros à
-- partir de 101) : l'appariement de rame existant — la descente n+1 hérite de
-- la montée n — fonctionne alors sans modification.
--
-- Aucune policy à changer : « exploitation » sur circulations est `for all`.
-- =============================================================================

alter table circulations
  add column if not exists supplementaire boolean not null default false,
  add column if not exists passages jsonb;

alter table circulations drop constraint if exists circulations_sup_passages;
alter table circulations add constraint circulations_sup_passages
  check ((supplementaire and passages is not null) or (not supplementaire and passages is null));

-- =============================================================================
-- VÉRIFICATION — à exécuter APRÈS le script.
-- =============================================================================
--
-- (a) La contrainte refuse un train sup sans passages :
--     insert into circulations (date, numero, sens, rame, supplementaire)
--       values (current_date, 101, 'montee', 'Marie', true);
--     -> violation de circulations_sup_passages
--
-- (b) …et un train de grille qui porterait des passages :
--     update circulations set passages = '[]'::jsonb
--       where date = current_date and numero = 1;
--     -> violation de circulations_sup_passages
--
-- (c) Une rotation sup complète s'insère normalement :
--     insert into circulations (date, numero, sens, rame, supplementaire, passages) values
--       (current_date, 101, 'montee', 'Marie', true,
--        '[{"gare":"le-fayet","d":"17:00:00"},{"gare":"col-de-voza","a":"17:34:30"}]'),
--       (current_date, 102, 'descente', 'Marie', true,
--        '[{"gare":"col-de-voza","d":"17:39:30"},{"gare":"le-fayet","a":"18:19:30"}]');
--
-- (d) Le journal d'exploitation consigne la création : le déclencheur
--     trg_journal_circulations ne surveille que les colonnes d'exploitation,
--     donc un INSERT est bien tracé, mais `passages` n'y figure pas.
