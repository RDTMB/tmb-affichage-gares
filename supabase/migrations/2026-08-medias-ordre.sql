-- =============================================================================
-- TMB — Ordre de passage des médias + mode du cycle d'affichage
-- À exécuter dans l'éditeur SQL. Rejouable.
--
-- `ordre` : ordre de passage croissant, `cree_le` départageant les égalités.
-- `mode_medias` : « alterne » (horaires entre chaque média, comportement
-- historique) ou « serie » (tous les médias à la suite, puis horaires).
--
-- Aucune policy à toucher : « exploitation » sur medias est `for all`.
-- =============================================================================

alter table medias add column if not exists ordre int not null default 100;

insert into params (cle, valeur) values ('mode_medias', '"alterne"')
  on conflict (cle) do nothing;
