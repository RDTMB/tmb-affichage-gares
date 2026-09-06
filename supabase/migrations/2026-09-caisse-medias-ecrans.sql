-- =============================================================================
-- TMB — Le rôle `caisse` gagne les médias et la commande d'écran
--
-- À EXÉCUTER À LA MAIN par l'exploitant, dans l'éditeur SQL Supabase, sur une
-- base DÉJÀ EN SERVICE. D'ABORD la base de TEST, puis la production.
-- Intégré à supabase/schema.sql : une base NEUVE n'a rien à jouer ici.
--
-- REJOUABLE : chaque politique est supprimée puis recréée à l'identique.
-- Le rejouer sur une base déjà à jour ne change rien et ne lève rien.
--
-- POURQUOI. Décision du 06/09/2026, dans la continuité du 05/09 : l'agent de
-- caisse est souvent seul en gare le matin. Recharger son écran après une mise
-- en ligne, le sortir de veille, retirer une affiche périmée — rien de tout
-- cela ne doit dépendre d'un appel à l'exploitation.
--
-- AUCUN DROIT NOUVEAU n'est créé. `medias` et `ecrans.commander` existent déjà
-- et sont portés par d'autres rôles ; la caisse les rejoint, c'est tout.
--
-- CE QUE LA CAISSE NE GAGNE PAS, et qu'il faut vérifier après coup (§4) :
--   - circulations, journées, terminus, trains supplémentaires ;
--   - machines, motifs, états du ciel, délai « à quai » ;
--   - DÉCLARER ou OUBLIER un écran, en changer la gare ou le type ;
--   - comptes, rôles, purge du journal.
--
-- ⚠ L'ÉDITEUR SQL DE SUPABASE N'AFFICHE PAS LES MESSAGES `notice`.
--    « Success. No rows returned » est le résultat NORMAL d'une migration
--    réussie. La vérification se fait par les requêtes du §4, pas par
--    l'absence de message.
--
-- ⚠ SCRIPTS À REJOUER APRÈS CELUI-CI, JAMAIS AVANT. Quatre fichiers du dépôt
--    recréent ces mêmes politiques ; tous ont été mis à jour en même temps que
--    cette migration, mais une COPIE ANCIENNE annulerait l'élargissement sans
--    un mot :
--      supabase/schema.sql
--      supabase/securite-advisors.sql
--      supabase/ajout-bandeau-veille.sql
--      supabase/migrations/2026-09-roles-multiples.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. REFUS D'EXÉCUTION si l'état de départ n'est pas celui attendu.
--
--    Une migration qui s'exécute sur une base qu'elle n'a pas comprise fait
--    plus de dégâts qu'une migration qui refuse. On exige donc :
--      a. le modèle à rôles MULTIPLES en place (fonction + catalogue) ;
--      b. le rôle `caisse` présent au catalogue ;
--      c. les six politiques visées EXISTANTES — si l'une manque, la base
--         n'est pas dans l'état décrit par le dépôt, et un `create policy`
--         aveugle poserait une règle dans un ensemble inconnu.
--
--    Ces contrôles passent aussi bien AVANT qu'APRÈS l'élargissement : c'est
--    ce qui rend le script rejouable.
-- -----------------------------------------------------------------------------
do $verrou$
declare
  manquantes text;
begin
  if to_regprocedure('private.a_un_des_roles(text[])') is null then
    raise exception
      'Migration refusée : private.a_un_des_roles(text[]) est absente. '
      'Jouer d''abord supabase/migrations/2026-09-roles-multiples.sql.';
  end if;

  if not exists (select 1 from public.roles where code = 'caisse') then
    raise exception
      'Migration refusée : le rôle « caisse » est absent du catalogue public.roles.';
  end if;

  -- Les trois politiques du schéma `public`.
  select string_agg(attendue, ', ' order by attendue) into manquantes
    from (values
      ('medias',  'roles: medias'),
      ('params',  'roles: params medias'),
      ('ecrans',  'roles: ecrans commander')
    ) as v(table_cible, attendue)
   where not exists (
     select 1 from pg_policies
      where schemaname = 'public'
        and tablename = v.table_cible
        and policyname = v.attendue
   );
  if manquantes is not null then
    raise exception
      'Migration refusée : politiques introuvables dans public : %. '
      'La base n''est pas dans l''état décrit par supabase/schema.sql.', manquantes;
  end if;

  -- Les trois politiques de storage.objects.
  select string_agg(attendue, ', ' order by attendue) into manquantes
    from (values
      ('roles: medias lecture'),
      ('roles: medias ecriture'),
      ('roles: medias suppression')
    ) as v(attendue)
   where not exists (
     select 1 from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname = v.attendue
   );
  if manquantes is not null then
    raise exception
      'Migration refusée : politiques introuvables dans storage.objects : %. '
      'Jouer d''abord supabase/securite-advisors.sql.', manquantes;
  end if;
end
$verrou$;

-- -----------------------------------------------------------------------------
-- 2. LES SIX POLITIQUES ÉLARGIES.
--
--    Elles vont ENSEMBLE : la fiche du média, le fichier dans le bucket et le
--    cycle d'affichage sont un seul geste d'exploitation. N'en élargir qu'une
--    partie donnerait une interface qui promet ce que la base refuse — le
--    symptôme exact que ce projet a déjà payé deux fois.
-- -----------------------------------------------------------------------------
begin;

-- (a) Fiche du média : nom, durée, ordre, gares visées, activation.
drop policy if exists "roles: medias" on medias;
create policy "roles: medias" on medias for all to authenticated
  using ((select private.a_un_des_roles(array['admin','supervision','caisse'])))
  with check ((select private.a_un_des_roles(array['admin','supervision','caisse'])));

-- (b) Cycle d'affichage des médias : mode (alterné / série) et durée des
--     horaires entre deux médias. Les autres clés de `params` ne bougent pas :
--     `roles: params affichage` (météo, vitesse du bandeau) donnait déjà la
--     caisse, `roles: params exploitation` reste à l'admin et
--     `roles: params technique` au technique.
drop policy if exists "roles: params medias" on params;
create policy "roles: params medias" on params for all to authenticated
  using (
    cle in ('mode_medias', 'duree_horaires_s')
    and (select private.a_un_des_roles(array['admin','supervision','caisse']))
  )
  with check (
    cle in ('mode_medias', 'duree_horaires_s')
    and (select private.a_un_des_roles(array['admin','supervision','caisse']))
  );

-- (c) COMMANDER un écran : rechargement, veille propre au poste, vitesse du
--     bandeau de ce poste. L'IDENTITÉ (déclarer, oublier, déplacer) reste au
--     technique — « roles: ecrans declarer » et « roles: ecrans oublier » ne
--     sont pas touchées, et le déclencheur `trg_roles_ecrans_identite`
--     verrouille `gare` et `type` en exigeant POSITIVEMENT le rôle technique.
--     Il n'énumère aucun rôle interdit : élargir la politique ci-dessous ne
--     peut donc pas l'affaiblir, et il n'y a rien à y changer.
drop policy if exists "roles: ecrans commander" on ecrans;
create policy "roles: ecrans commander" on ecrans for update to authenticated
  using ((select private.a_un_des_roles(array['technique','supervision','caisse'])))
  with check ((select private.a_un_des_roles(array['technique','supervision','caisse'])));

-- (d) Le FICHIER dans le bucket. Le bucket reste public (les écrans passent
--     par l'URL publique, qui ne traverse pas RLS) : ces trois politiques ne
--     servent qu'à l'exploitation. Le SELECT n'est pas décoratif — sans lui,
--     l'agent voit la fiche mais pas l'objet, et la suppression échoue à
--     mi-chemin en laissant un fichier orphelin dans le bucket.
drop policy if exists "roles: medias lecture" on storage.objects;
create policy "roles: medias lecture" on storage.objects for select to authenticated
  using (bucket_id = 'medias' and (select private.a_un_des_roles(array['admin','supervision','caisse'])));

drop policy if exists "roles: medias ecriture" on storage.objects;
create policy "roles: medias ecriture" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'medias' and (select private.a_un_des_roles(array['admin','supervision','caisse'])));

drop policy if exists "roles: medias suppression" on storage.objects;
create policy "roles: medias suppression" on storage.objects
  for delete to authenticated
  using (bucket_id = 'medias' and (select private.a_un_des_roles(array['admin','supervision','caisse'])));

commit;

-- -----------------------------------------------------------------------------
-- 3. VÉRIFICATION — LE RÉSULTAT ATTENDU EST 6 LIGNES, toutes « caisse : OUI ».
--    À lancer APRÈS le bloc 2. C'est la SEULE preuve que la migration a pris :
--    « Success. No rows returned » ci-dessus ne dit rien.
-- -----------------------------------------------------------------------------
select
  schemaname || '.' || tablename as objet,
  policyname,
  case when coalesce(qual, '') || coalesce(with_check, '') like '%caisse%'
       then 'caisse : OUI' else 'caisse : NON — À REPRENDRE' end as etat
  from pg_policies
 where (schemaname = 'public' and policyname in (
          'roles: medias', 'roles: params medias', 'roles: ecrans commander'))
    or (schemaname = 'storage' and policyname in (
          'roles: medias lecture', 'roles: medias ecriture', 'roles: medias suppression'))
 order by schemaname, policyname;

-- -----------------------------------------------------------------------------
-- 4. CONTRE-VÉRIFICATION — CE QUE LA CAISSE NE DOIT TOUJOURS PAS POUVOIR.
--    Résultat attendu : 0 ligne. Toute ligne renvoyée est une régression.
--    Les deux moitiés comptent autant : une migration qui ouvre trop est un
--    incident, pas un détail de finition.
-- -----------------------------------------------------------------------------
--    ⚠ La requête CONTRÔLE AUSSI SES PROPRES NOMS. Une politique mal
--    orthographiée ne serait trouvée nulle part, la requête renverrait 0 ligne,
--    et l'absence de résultat se lirait comme un succès — un contrôle qui ne
--    contrôle rien est pire que pas de contrôle.
with attendues(policyname) as (values
  ('roles: circulations ecriture'),   -- circulations : supervision seule
  ('roles: jours ecriture'),          -- journées : supervision seule
  ('roles: machines'),                -- listes d'exploitation : admin
  ('roles: motifs'),
  ('roles: ciels'),
  ('roles: modeles ecriture'),
  ('roles: params exploitation'),     -- délai « à quai » : admin
  ('roles: params technique'),        -- veille globale, cache : technique
  ('roles: ecrans declarer'),         -- identité du poste : technique
  ('roles: ecrans oublier'),
  ('roles: profils creation'),        -- comptes
  ('roles: profils gestion'),
  ('roles: profils suppression'),
  ('roles: liaison attribution'),     -- attribution des rôles
  ('roles: liaison retrait')
)
select a.policyname,
       case
         when p.policyname is null then 'INTROUVABLE — le contrôle est faux'
         else 'OUVERTE À TORT à la caisse'
       end as alerte
  from attendues a
  left join pg_policies p
    on p.policyname = a.policyname
   and coalesce(p.qual, '') || coalesce(p.with_check, '') like '%caisse%'
 where p.policyname is not null
    or not exists (select 1 from pg_policies q where q.policyname = a.policyname)
 order by a.policyname;

-- Le déclencheur qui réserve `gare` et `type` au technique doit toujours être
-- posé sur `ecrans`. Résultat attendu : 1 ligne.
select tgname from pg_trigger
 where tgrelid = 'public.ecrans'::regclass
   and tgname = 'trg_roles_ecrans_identite';

-- -----------------------------------------------------------------------------
-- 5. RECETTE SUR UN VRAI COMPTE — supabase/tests/roles-rls.sql
--    Les requêtes ci-dessus lisent le CATALOGUE ; elles ne prouvent pas qu'un
--    agent de caisse écrit vraiment. La recette, elle, se connecte.
-- -----------------------------------------------------------------------------
