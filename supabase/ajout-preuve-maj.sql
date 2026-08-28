-- =============================================================================
-- TMB — AJOUT de la preuve de mise à jour par écran
-- À exécuter dans l'éditeur SQL d'une base DÉJÀ en service : idempotent,
-- n'altère aucune donnée existante. Intégré à supabase/schema.sql pour les
-- nouvelles installations.
--
-- Pourquoi : `derniere_vue` ne prouve que la présence de la MACHINE. Un
-- Raspberry Pi allumé peut afficher un instantané périmé (réseau coupé côté
-- données). `donnees_maj` date la dernière synchronisation RÉUSSIE de ce qui
-- est réellement à l'écran ; `date_affichee` dit quelle journée il montre.
-- =============================================================================

alter table ecrans add column if not exists donnees_maj timestamptz;
alter table ecrans add column if not exists date_affichee date;
