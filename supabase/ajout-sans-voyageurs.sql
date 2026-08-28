-- =============================================================================
-- TMB — AJOUT du drapeau « sans voyageurs » (courses à vide)
-- À exécuter dans l'éditeur SQL d'une base DÉJÀ en service : idempotent,
-- n'altère aucune donnée existante. Intégré à supabase/schema.sql pour les
-- nouvelles installations.
--
-- Pourquoi : une montée comme une descente peut circuler pour les seuls
-- besoins de l'exploitation (repositionnement d'une rame, essai, service).
-- Ces courses gardent leur rame, leur rotation et leur terminus en
-- supervision, mais ne doivent apparaître sur AUCUN écran voyageurs.
-- =============================================================================

alter table circulations
  add column if not exists sans_voyageurs boolean not null default false;
