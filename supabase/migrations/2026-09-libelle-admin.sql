-- =============================================================================
-- TMB — Le rôle `admin` s'affiche « Admin » et non « Administrateur »
--
-- À EXÉCUTER À LA MAIN dans l'éditeur SQL Supabase. TEST puis production.
-- Intégré à supabase/schema.sql : une base NEUVE n'a rien à jouer ici.
-- REJOUABLE : un simple update idempotent.
--
-- POURQUOI. Les badges de rôle ont une largeur fixe de 108 px, calée à
-- l'origine sur « ADMIN ». Le libellé était devenu « Administrateur »
-- (14 caractères) sans que la largeur suive : le badge débordait et se faisait
-- couper par le bouton « Quitter », dès 1440 px de fenêtre.
--
-- SANS EFFET SUR LE FONCTIONNEMENT. Le front lit ses libellés dans
-- src/core/roles.ts et ne consulte jamais roles.libelle ; cette ligne existe
-- pour que la base et le code racontent la même chose.
-- =============================================================================

update roles set libelle = 'Admin' where code = 'admin' and libelle <> 'Admin';

-- Vérification (l'éditeur Supabase n'affiche pas les `notice`) :
--   select code, libelle from roles order by ordre;
