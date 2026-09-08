-- =============================================================================
-- Colonnes `maj` HONNÊTES — `params.maj` et `circulations.maj`
--
-- À EXÉCUTER À LA MAIN par l'exploitant, dans l'éditeur SQL Supabase.
-- Rejouable. Déjà recopié dans supabase/schema.sql pour les nouvelles
-- installations (garde-fous des rôles, bloc « (e) ») ;
-- src/data/securite.test.ts compare les deux copies.
--
-- POURQUOI. Les deux colonnes sont déclarées `default now()`, or un défaut ne
-- s'applique qu'à l'INSERT. `saveParams` fait un upsert sans jamais toucher
-- `maj`, et aucun déclencheur ne la remontait : les deux restaient donc FIGÉES
-- à la date de création de la ligne, alors que leur nom promet la dernière
-- écriture. `circulations` est le cas le plus gênant — c'est la table réécrite
-- à chaque publication, statut, retard, terminus.
--
-- Ce n'est pas cosmétique. Mesuré en production le 07/09/2026 : `params.maj`
-- de la clé `meteo_sommet` valait le 24/08 alors que la météo avait été saisie
-- le matin même, et la conclusion tirée de cette lecture (« météo de quatorze
-- jours ») a été annoncée à tort en gare. Une colonne nommée « maj » qui ne
-- bouge pas invite à croire périmée une donnée fraîche.
--
-- POURQUOI UN DÉCLENCHEUR ET NON UN `drop column`. Le geste est ADDITIF et
-- réversible, là où la suppression d'une colonne ne l'est pas en production.
-- `params` a UNE ligne par clé, donc `params.maj` de la ligne `meteo_sommet`
-- date réellement la météo — ce que `heure_releve`, saisi à la main sans date,
-- ne dira jamais seul. Et le journal d'exploitation ne rend pas ces colonnes
-- redondantes : il ne consigne que les valeurs CHANGÉES, donc une ligne
-- réécrite à l'identique n'y laisse aucune trace, là où `maj` la datera.
--
-- AUCUN EFFET DE BORD ATTENDU. Les deux déclencheurs de trace passent une
-- LISTE explicite de colonnes surveillées, dont `maj` ne fait pas partie :
-- cette remontée ne créera aucune ligne de journal.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. CONTRÔLE PRÉALABLE — LECTURE SEULE, à lancer AVANT l'étape 2.
--
--    Il montre l'ampleur du mensonge avant correction : l'écart entre `maj` et
--    la dernière écriture RÉELLE, celle que le journal d'exploitation date
--    correctement. Rien n'y est bloquant, aucune ligne n'est à corriger — c'est
--    un constat, à relire après l'étape 2 pour voir la différence.
-- -----------------------------------------------------------------------------
select
  p.cle as ligne,
  p.maj as maj_pretendue,
  max(j.quand) as derniere_ecriture_journal,
  max(j.quand) - p.maj as retard_de_maj
from params p
left join journal_exploitation j
  on j.table_cible = 'params' and j.cle = p.cle
group by p.cle, p.maj
order by retard_de_maj desc nulls last;

-- -----------------------------------------------------------------------------
-- 2. LA FONCTION ET LES DEUX DÉCLENCHEURS. Rejouable.
--
--    Ni `security definer` ni GRANT : la fonction ne touche que NEW, et
--    EXECUTE d'une fonction de déclencheur est vérifié à la création du
--    déclencheur, pas à chaque appel. `now()` reste résolu avec un
--    `search_path` vide, il vit dans `pg_catalog`.
-- -----------------------------------------------------------------------------
create or replace function private.remonte_maj()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  new.maj := now();
  return new;
end $fn$;
revoke all on function private.remonte_maj() from public;

drop trigger if exists trg_maj_params on params;
create trigger trg_maj_params before update on params
  for each row execute function private.remonte_maj();

drop trigger if exists trg_maj_circulations on circulations;
create trigger trg_maj_circulations before update on circulations
  for each row execute function private.remonte_maj();

-- -----------------------------------------------------------------------------
-- 3. VÉRIFICATION APRÈS — lecture seule. TROIS lignes attendues : les deux
--    déclencheurs, et la fonction une seule fois dans le schéma `private`.
-- -----------------------------------------------------------------------------
select 'declencheur' as objet, t.tgname as nom, c.relname as porte_sur
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
 where t.tgname in ('trg_maj_params', 'trg_maj_circulations')
union all
select 'fonction', p.proname, n.nspname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'private' and p.proname = 'remonte_maj';

-- -----------------------------------------------------------------------------
-- 4. ESSAI — sur le projet de TEST uniquement, lignes à décommenter.
--
--    Réécrire une valeur À L'IDENTIQUE doit tout de même remonter `maj`. Le
--    journal, lui, ne consignera rien puisque aucune valeur ne change : c'est
--    précisément l'écart que cette colonne comble, et la raison pour laquelle
--    le journal ne la rend pas redondante.
-- -----------------------------------------------------------------------------
-- select cle, maj from params where cle = 'duree_cache_min';
-- update params set valeur = valeur where cle = 'duree_cache_min';
-- select cle, maj from params where cle = 'duree_cache_min';   -- maj = maintenant
