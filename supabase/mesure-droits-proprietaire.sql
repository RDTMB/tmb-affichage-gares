-- =============================================================================
-- TMB — Un propriétaire DÉDIÉ pour `definir_acces` est-il possible ici ?
-- MESURE EN LECTURE SEULE. À exécuter dans l'éditeur SQL de la base de TEST.
-- Ce script ne crée, ne modifie ni ne supprime aucun objet.
-- =============================================================================
--
-- ⚠ DÉJÀ PASSÉE LE 13/09/2026 SUR LA BASE DE TEST. Résultat :
--
--     rôle courant                     : postgres
--     superutilisateur                 : FALSE   ← la réponse
--     peut créer des rôles             : true
--     contourne RLS lui-même           : true
--     propriétaire de definir_acces    : postgres
--     propriétaire de circulations     : postgres
--     service_role : CREATE sur public : false
--     service_role : contourne RLS     : true
--
-- CONCLUSION : la dette n'est PAS remboursable sur Supabase. `postgres` peut
-- créer des rôles mais n'est pas superutilisateur, donc `BYPASSRLS` est hors
-- de portée. C'est une contrainte de plateforme, écrite en tête de
-- `migrations/2026-09-acces-course.sql` et dans docs/02.
--
-- Ce script reste REJOUABLE : il servira le jour où la plateforme changera, ou
-- sur une autre base. Il n'y a rien à en refaire aujourd'hui.
--
-- POURQUOI CETTE MESURE. `public.definir_acces` est SECURITY DEFINER et
-- appartient à `postgres`, le rôle le plus puissant du projet. C'est le CORPS
-- de la fonction qui borne réellement ce qu'elle peut faire, pas son
-- propriétaire ; un rôle dédié, créé pour elle seule, serait plus étroit.
--
-- Mais la fonction doit écrire dans `circulations` MALGRÉ RLS — aucune
-- politique n'ouvre une circulation de grille à `admin`, et c'est délibéré.
-- Aujourd'hui cela fonctionne parce que le propriétaire est aussi celui de la
-- table, et qu'un propriétaire de table n'est pas soumis à ses propres
-- politiques. Un rôle dédié n'aurait pas cette exemption : il lui faudrait
-- l'attribut BYPASSRLS, que SEUL UN SUPERUTILISATEUR accorde.
--
-- La question se réduit donc à une seule : le rôle qui exécute les scripts
-- est-il superutilisateur ? Tout le reste en découle.
--
-- CE QU'IL NE FAUT PAS FAIRE si la réponse est non — aucun des trois ne
-- rembourse la dette, et chacun rend le système MOINS sûr qu'aujourd'hui :
--   • `create role … superuser` ;
--   • désactiver RLS sur `circulations` ;
--   • ajouter une politique « en attendant ».

select
  'rôle courant' as controle,
  current_user as valeur,
  '' as verdict
union all
select
  'superutilisateur',
  (select rolsuper::text from pg_roles where rolname = current_user),
  case
    when (select rolsuper from pg_roles where rolname = current_user)
      then 'OUI — un rôle dédié BYPASSRLS est possible : voir §1 de la PR'
    else 'NON — la dette n''est PAS remboursable sur cette plateforme'
  end
union all
select
  'peut créer des rôles',
  (select rolcreaterole::text from pg_roles where rolname = current_user),
  'informatif : créer un rôle ne suffit pas, c''est BYPASSRLS qui manque'
union all
select
  'contourne RLS lui-même',
  (select rolbypassrls::text from pg_roles where rolname = current_user),
  'informatif'
union all
-- Ce qui fait marcher la fonction AUJOURD'HUI : son propriétaire est celui de
-- la table, donc il échappe aux politiques de cette table.
select
  'propriétaire de definir_acces',
  (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner
    where p.oid = 'public.definir_acces(date, int, text, text)'::regprocedure),
  'doit être IDENTIQUE à la ligne suivante'
union all
select
  'propriétaire de circulations',
  (select r.rolname from pg_class c join pg_roles r on r.oid = c.relowner
    where c.oid = 'public.circulations'::regclass),
  'l''UNE des deux raisons qui font marcher l''UPDATE ; l''autre est rolbypassrls ci-dessus'
union all
-- Rappel de la tentative du 13/09/2026, pour qu'elle ne se refasse pas.
select
  'service_role : CREATE sur public',
  has_schema_privilege('service_role', 'public', 'create')::text,
  'false attendu — c''est ce qui a fait échouer l''alter du 13/09'
union all
select
  'service_role : contourne RLS',
  (select rolbypassrls::text from pg_roles where rolname = 'service_role'),
  'true attendu — l''attribut n''était PAS le problème';

-- -----------------------------------------------------------------------------
-- COMMENT LIRE LE RÉSULTAT
-- -----------------------------------------------------------------------------
-- Ligne « superutilisateur » :
--
--   false → la dette n'est pas remboursable ici. Ce n'est pas un échec, c'est
--           une CONTRAINTE de la plateforme : elle est écrite comme telle en
--           tête de `migrations/2026-09-acces-course.sql` et dans docs/02, et
--           le sujet est clos. Reporter la date de la mesure dans ces deux
--           endroits.
--
--   true  → un rôle dédié est possible. Le peser avant de le poser :
--           ON GAGNE un propriétaire qui ne possède aucun autre objet — un
--           corps de fonction qui dériverait vers un `drop` ou une lecture de
--           `auth.users` échouerait ;
--           ON PERD un rôle de plus à connaître, à documenter et à TRANSFERER
--           au prestataire lors du chantier 3. Un rôle oublié dans un coin est
--           un risque en soi : s'il est posé, il entre au dossier de reprise.
