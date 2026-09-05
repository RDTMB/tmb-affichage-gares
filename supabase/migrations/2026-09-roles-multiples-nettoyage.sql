-- =============================================================================
-- TMB — Rôles multiples : NETTOYAGE de la colonne de compatibilité
-- À exécuter dans l'éditeur SQL QUELQUES JOURS APRÈS la fusion de la pull
-- request « rôles multiples », une fois la nouvelle supervision éprouvée.
-- Transactionnel et rejouable.
--
-- POURQUOI UN SECOND SCRIPT. `2026-09-roles-multiples.sql` a conservé
-- `profils.role` comme MIROIR en lecture seule : l'ANCIEN front, encore en
-- ligne entre l'exécution du SQL et la fusion, lit cette colonne pour ouvrir
-- une session (`select nom, email, role, actif`). Une fois la nouvelle version
-- déployée, plus personne ne la lit — elle ne peut plus qu'induire en erreur
-- un lecteur de la base, qui y verrait un « rôle » qui n'en est plus un.
--
-- CE SCRIPT N'OUVRE NI NE FERME AUCUN DROIT : la colonne était déjà sans effet
-- sur les politiques, qui lisent toutes `profils_roles`. Le retour arrière
-- consiste à rejouer le §10 de la migration (miroir), rien de plus.
--
-- AVANT DE LANCER : vérifier que la production sert bien la nouvelle
-- supervision (une ligne utilisateur y montre PLUSIEURS badges de rôle et des
-- cases à cocher, plus un menu déroulant).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Contrôle préalable : le nouveau modèle est bien en place
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.profils_roles') is null then
    raise exception 'NETTOYAGE ANNULÉ : la table profils_roles n''existe pas.'
      using hint = 'Exécuter d''abord supabase/migrations/2026-09-roles-multiples.sql.';
  end if;
  if exists (select 1 from public.profils p
              where p.actif and not exists (
                select 1 from public.profils_roles pr where pr.user_id = p.user_id))
  then
    raise warning 'Des comptes ACTIFS n''ont aucun rôle : ils ne pourront rien faire. Les corriger avant ou après, mais ne pas les oublier.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Retrait du miroir, puis de la colonne
-- ---------------------------------------------------------------------------
drop trigger if exists trg_roles_miroir on profils_roles;
drop function if exists private.miroir_role_principal();

-- La contrainte CHECK et le défaut partent avec la colonne.
alter table profils drop column if exists role;

-- ---------------------------------------------------------------------------
-- 3. Contrôle final, DANS la transaction
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profils'
                and column_name = 'role') then
    raise exception 'NETTOYAGE ANNULÉ : la colonne profils.role est toujours là.';
  end if;
  raise notice 'Colonne de compatibilité retirée. Les rôles vivent uniquement dans profils_roles.';
end $$;

commit;

-- =============================================================================
-- VÉRIFICATION — à exécuter APRÈS le script.
-- =============================================================================
--
-- (a) La colonne a disparu, les rôles sont intacts :
--     select p.email, p.actif, array_agg(pr.role order by pr.role) as roles
--       from profils p left join profils_roles pr using (user_id)
--      group by p.email, p.actif order by p.email;
--
-- (b) La supervision fonctionne toujours : se connecter, ouvrir
--     Paramètres → Utilisateurs, cocher puis décocher un rôle sur un compte
--     de test, et retrouver les deux lignes au journal d'exploitation.
--
-- (c) Aucun objet ne référence plus la colonne :
--     select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'private' and pg_get_functiondef(p.oid) like '%profils.role%';
--     -> 0 ligne attendue.
