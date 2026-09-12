-- ===========================================================================
-- ACCÈS D'UNE COURSE — public / privé / mixte (docs/01 §2.12)
-- Décision de l'exploitant du 12/09/2026.
-- ===========================================================================
--
-- ORDRE DE MISE EN SERVICE — NON NÉGOCIABLE :
--
--   1. ce script sur la base de TEST
--   2. déploiement du front
--   3. vérifier LES SIX ÉCRANS DE GARE **et** la supervision
--   4. ce script en PRODUCTION
--   5. **puis** fusionner la branche
--
-- La production passe AVANT la fusion parce que le front déployé demandera
-- `acces` NOMMÉMENT dans son `select`, et que PostgREST refuse la requête
-- ENTIÈRE quand une colonne manque — pas la colonne, la requête. C'est
-- exactement ce qui a éteint les six gares le 11/09/2026.
--
-- MIGRATION ADDITIVE : elle n'enlève rien. Une colonne s'ajoute, un
-- `grant select` s'ajoute, une fonction s'ajoute. Aucun `revoke`, donc aucune
-- fenêtre pendant laquelle un écran encore servi par l'ancien bundle perdrait
-- ses droits. L'ancien front continue de fonctionner après ce script.
--
-- POURQUOI UNE COLONNE ET PAS UNE DÉDUCTION. « Privé » était jusqu'ici
-- déduit de `nature = 'special'`. Un spécial était donc forcément privé, et
-- un privé forcément spécial — or l'exploitation connaît les deux autres
-- cas : un spécial dont une partie de la rame reste en vente, et un TRAIN 11
-- de GRILLE affrété pour la journée. Le second était même impossible à
-- représenter : `circulations_nature_numero` borne `special` aux numéros
-- ≥ 201, et cette plage porte le sens depuis le 11/09/2026. Elle n'est pas
-- relâchée ici.

begin;

-- ---------------------------------------------------------------------------
-- 1. La colonne
-- ---------------------------------------------------------------------------
-- `default 'public'` : les lignes existantes gardent EXACTEMENT le
-- comportement qu'elles ont aujourd'hui. Un champ à trois états et non deux
-- booléens — même raison que `nature` : deux booléens rendraient
-- représentable « privé ET mixte », qui n'existe pas en exploitation.
alter table circulations
  add column if not exists acces text not null default 'public';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'circulations_acces') then
    alter table circulations add constraint circulations_acces
      check (acces in ('public', 'prive', 'mixte'));
  end if;
end $$;

comment on column circulations.acces is
  'Accès de la course : public | prive | mixte (docs/01 §2.12). AXE INDÉPENDANT de nature — un train de GRILLE peut être affrété. C''est lui, et jamais nature, qui décide de la pastille « Privé / Private » en gare et de la présence au guichet.';

-- ---------------------------------------------------------------------------
-- 2. LES SPÉCIAUX DÉJÀ EN BASE — repris en `prive`, délibérément
-- ---------------------------------------------------------------------------
-- Ces lignes affichaient la pastille « Privé / Private » par DÉDUCTION et
-- étaient exclues de l'onglet Places sur le même critère. Les laisser
-- `public` changerait leur comportement sans que personne ne l'ait demandé :
-- un train annoncé « privé » en gare hier deviendrait public aujourd'hui, et
-- — c'est le point qui tranche — il REPARAÎTRAIT au guichet, où l'on
-- pourrait vendre des places sur une rame affrétée. Le défaut ne se verrait
-- que le jour de la course.
--
-- On reprend donc l'état existant tel quel. `mixte` n'est attribué à
-- personne : il n'a jamais été saisi, et le déduire serait inventer.
--
-- Idempotent : ne touche que les lignes restées au défaut.
update circulations set acces = 'prive'
 where nature = 'special' and acces = 'public';

-- ---------------------------------------------------------------------------
-- 3. Lecture par `anon` — la pastille s'affiche en gare
-- ---------------------------------------------------------------------------
-- `grant select (colonne)` qui S'AJOUTE, sans en révoquer aucun : la liste
-- déjà accordée reste entière. `commanditaire` reste FERMÉ à `anon`, et
-- src/data/commanditaire.test.ts continue de le prouver.
grant select (acces) on circulations to anon;

-- ---------------------------------------------------------------------------
-- 4. L'ÉCRITURE — une fonction, aucune politique RLS nouvelle
-- ---------------------------------------------------------------------------
-- C'EST LE POINT DE SÉCURITÉ DU LOT.
--
-- `admin` doit pouvoir privatiser un train de GRILLE. Il possède
-- `circulations.special` mais PAS `circulations`, et cette séparation est
-- délibérée (docs/01 §5.5). Les trois politiques du 11/09 sont bornées à
-- `nature = 'special'` : aucune ne couvre un TRAIN 11.
--
-- Deux mécanismes existaient, et AUCUN des deux ne convient :
--
--  - les DROITS DE COLONNE ne savent pas viser un rôle applicatif. `admin`,
--    `supervision` et `caisse` sont le MÊME rôle PostgreSQL, `authenticated` ;
--    la distinction vit dans `profils_roles` et `private.a_le_role()`. Seul
--    `anon` se sépare par droit de colonne — c'est pour cela que la technique
--    marche sur `commanditaire` et ne marcherait pas ici ;
--
--  - une POLITIQUE RLS filtre des LIGNES, jamais des COLONNES. « admin peut
--    modifier une circulation de grille » lui ouvrirait du même coup
--    `statut`, `retard_min`, `terminus` et `passages` — c'est-à-dire les
--    horaires affichés dans les six gares.
--
-- Un DÉCLENCHEUR qui refuserait toute colonne autre que `acces` aurait
-- fonctionné, mais il doit ÉNUMÉRER les colonnes interdites : en oublier une,
-- ou en ajouter une plus tard sans y penser, ouvre le trou en silence. C'est
-- exactement le mode de panne de la liste de `grant select`.
--
-- D'où cette fonction SECURITY DEFINER : elle vérifie elle-même le rôle
-- applicatif et n'écrit que DEUX colonnes. `admin` ne gagne AUCUNE ligne de
-- plus sous RLS — un UPDATE direct de sa part sur une circulation de grille
-- reste refusé, et c'est ce que vérifie la recette (roles-rls.sql).
--
-- La supervision passe par la même porte alors qu'elle pourrait écrire
-- directement : deux chemins pour la même commande, ce sont deux règles à
-- tenir d'accord, et l'une des deux finit par dériver.
create or replace function public.definir_acces(
  p_date date,
  p_numero int,
  p_acces text,
  p_commanditaire text default null
)
returns int language plpgsql security definer set search_path = '' as $fn$
declare
  v_touchees int;
begin
  -- Le rôle applicatif est vérifié ICI : la fonction s'exécute avec les
  -- droits de son propriétaire, donc RLS ne la protège plus.
  if not private.a_un_des_roles(array['admin', 'supervision']) then
    raise exception 'permission denied: definir_acces'
      using errcode = '42501';
  end if;
  if p_acces not in ('public', 'prive', 'mixte') then
    raise exception 'acces invalide: %', p_acces using errcode = '22023';
  end if;

  -- UNE SEULE LIGNE. La montée et la descente se privatisent séparément
  -- (décision du 12/09/2026) : propager à `numero + 1` retirerait justement
  -- le cas qui motive le lot — « affrété à la montée seulement ».
  --
  -- DEUX COLONNES, et c'est la borne entière. Le commanditaire accompagne
  -- l'accès parce qu'il répond à la même question (« pour qui roule ce
  -- train ») et se saisit dans le même geste, y compris sur un train de
  -- grille.
  update public.circulations
     set acces = p_acces,
         commanditaire = p_commanditaire
   where date = p_date and numero = p_numero;

  get diagnostics v_touchees = row_count;
  -- Le nombre de lignes est RENDU : zéro n'est pas un succès silencieux. Le
  -- front le vérifie et refuse d'annoncer « privatisé » sur une ligne que
  -- personne n'a écrite (leçon du 25/08/2026).
  return v_touchees;
end $fn$;

revoke all on function public.definir_acces(date, int, text, text) from public;
revoke all on function public.definir_acces(date, int, text, text) from anon;
grant execute on function public.definir_acces(date, int, text, text) to authenticated;

comment on function public.definir_acces(date, int, text, text) is
  'Pose l''accès (et le commanditaire) d''UNE course. SEULE voie par laquelle admin — qui n''a aucune politique RLS sur une circulation de grille — peut privatiser un train de grille. N''écrit que deux colonnes, par construction.';

-- ---------------------------------------------------------------------------
-- 5. Journal d'exploitation
-- ---------------------------------------------------------------------------
-- Privatiser une course est une décision d'exploitation : on doit pouvoir
-- dire QUI l'a prise. Les colonnes surveillées sont énumérées dans le
-- déclencheur — une colonne absente de cette liste n'est jamais tracée.
drop trigger if exists trg_journal_circulations on circulations;
create trigger trg_journal_circulations
  after insert or update or delete on circulations
  for each row execute function private.tracer_ecriture(
    'date,numero', 'date',
    'statut', 'retard_min', 'motif', 'rame', 'terminus', 'facultatif_actif',
    'sans_voyageurs', 'commanditaire', 'nature', 'libelle', 'acces'
  );

commit;

-- ===========================================================================
-- VÉRIFICATION — à lire, pas à survoler
-- ===========================================================================
-- L'éditeur SQL de Supabase n'affiche PAS les `notice` : « Success. No rows
-- returned » ne prouve rien à lui seul. Ce bloc RETOURNE des lignes.
--
-- Attendu : sept lignes, toutes en « OK ».
with controles as (
  select 'colonne acces' as controle,
         (select count(*) from information_schema.columns
           where table_name = 'circulations' and column_name = 'acces') = 1 as ok
  union all
  select 'contrainte circulations_acces',
         exists (select 1 from pg_constraint where conname = 'circulations_acces')
  union all
  select 'aucune valeur hors des trois états',
         not exists (select 1 from circulations where acces not in ('public','prive','mixte'))
  union all
  -- La colonne doit être LISIBLE par anon, sinon la pastille disparaît des
  -- six écrans.
  select 'anon lit acces',
         exists (
           select 1 from information_schema.column_privileges
            where grantee = 'anon' and table_name = 'circulations'
              and column_name = 'acces' and privilege_type = 'SELECT'
         )
  union all
  -- …et commanditaire doit rester FERMÉ. C'est la moitié du contrôle qu'on
  -- oublie : vérifier ce qui s'ouvre sans vérifier ce qui reste fermé.
  select 'anon ne lit TOUJOURS PAS commanditaire',
         not exists (
           select 1 from information_schema.column_privileges
            where grantee = 'anon' and table_name = 'circulations'
              and column_name = 'commanditaire' and privilege_type = 'SELECT'
         )
  union all
  -- Aucune des colonnes déjà accordées n'a disparu : un `grant select (…)`
  -- mal écrit REMPLACE la liste au lieu de l'étendre.
  select 'les 18 colonnes publiques sont accordées',
         (select count(*) from information_schema.column_privileges
           where grantee = 'anon' and table_name = 'circulations'
             and privilege_type = 'SELECT'
             and column_name in (
               'date','numero','sens','express','facultatif','facultatif_actif',
               'velos','rame','terminus','statut','retard_min','motif',
               'sans_voyageurs','nature','passages','depart_reel','libelle','acces'
             )) = 18
  union all
  select 'definir_acces existe et n''est pas ouverte à anon',
         exists (select 1 from pg_proc where proname = 'definir_acces')
         and not has_function_privilege('anon', 'public.definir_acces(date, int, text, text)', 'execute')
)
select case when ok then 'OK' else '*** ÉCHEC ***' end as resultat, controle
  from controles
 order by ok, controle;

-- Reprise des spéciaux déjà en base : à lire aussi. Attendu — aucun spécial
-- resté `public` si la base en contenait avant ce script.
select nature, acces, count(*) as lignes
  from circulations
 group by nature, acces
 order by nature, acces;
