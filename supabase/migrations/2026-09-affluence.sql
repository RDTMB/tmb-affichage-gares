-- =============================================================================
-- AFFLUENCE — « Complet » et « Dernières places » par train et par jour
--
-- À EXÉCUTER À LA MAIN par l'exploitant, dans l'éditeur SQL Supabase, sur la
-- base de TEST d'abord. Rejouable. Déjà recopié dans supabase/schema.sql pour
-- les nouvelles installations ; src/data/securite.test.ts compare les deux
-- copies.
--
-- ⚠ L'éditeur SQL de Supabase n'affiche pas les `notice` : « Success. No rows
-- returned » est le résultat NORMAL d'une migration réussie, et ne prouve
-- rien à lui seul. Le bloc VÉRIFICATION en fin de script, lui, prouve.
--
-- POURQUOI UNE TABLE À PART, ET NON UNE COLONNE SUR `circulations`.
-- Deux raisons, et la seconde est la vraie.
--
-- 1. Ce n'est pas la même nature de donnée. `circulations` dit ce que
--    l'exploitation ferroviaire sait du train — sa rame, son terminus, son
--    retard, s'il circule. Le remplissage est un fait COMMERCIAL, constaté au
--    guichet. Les deux axes sont indépendants : un train à l'heure peut être
--    complet, un train en retard peut être vide. C'est aussi pourquoi la
--    pastille voyageurs ne vit pas dans la colonne Statut de l'écran.
--
-- 2. Ce n'est pas la même main. `circulations` est fermée à la caisse par
--    « roles: circulations ecriture » (supervision seule), et il n'est pas
--    question de l'ouvrir : c'est la table la plus sensible du projet, celle
--    d'où sortent tous les horaires affichés en gare. Ajouter une colonne
--    aurait obligé soit à ouvrir la table entière au guichet, soit à inventer
--    une politique par colonne — deux mauvaises réponses à une question qui
--    n'a pas à se poser. Une table dédiée s'ouvre à la caisse comme le sont
--    déjà `messages` et `medias`, sans toucher à rien d'autre.
--
-- L'API de réservation, à terme, remplira CETTE table telle quelle : la forme
-- (date, numéro, niveau) est celle qu'elle rendra, et rien du reste du projet
-- n'aura à bouger le jour où elle arrivera.
--
-- L'ABSENCE DE LIGNE VAUT « places disponibles ». Il n'y a donc pas de
-- troisième niveau 'ok' : remettre un train à la normale est un `delete`, et
-- une journée sans affluence est une table vide. Un niveau explicite aurait
-- laissé traîner des lignes sans information, à distinguer de leur absence.
-- =============================================================================

create table if not exists affluence (
  date date not null,
  numero smallint not null,
  niveau text not null check (niveau in ('limite', 'complet')),
  -- Renseigné par le déclencheur ci-dessous, JAMAIS par le client : une
  -- adresse écrite par le navigateur serait une signature qu'on peut forger.
  maj_par text,
  maj_le timestamptz not null default now(),
  primary key (date, numero),
  -- La circulation fait foi : on ne déclare complet qu'un train qui existe.
  -- `circulations` porte bien `unique (date, numero)`, ce qui rend cette
  -- référence possible sans colonne technique supplémentaire.
  --
  -- `on delete cascade` : réinitialiser une journée (suppression puis
  -- régénération depuis la grille) efface donc AUSSI son affluence. C'est
  -- voulu — les trains régénérés sont de nouvelles lignes, et reconduire un
  -- « complet » sur un train qu'on vient de recréer serait affirmer un fait
  -- commercial que personne n'a constaté depuis.
  constraint affluence_circulation_fk
    foreign key (date, numero) references circulations (date, numero) on delete cascade
);

comment on table affluence is
  'Remplissage constaté par train et par jour. Absence de ligne = places disponibles.';

alter table affluence enable row level security;

-- Les écrans lisent sans compte, comme pour toutes les tables d'affichage.
drop policy if exists "lecture publique" on affluence;
create policy "lecture publique" on affluence for select using (true);

-- Écriture : guichet ET exploitation. La caisse constate au comptoir qu'elle
-- ne vend plus ; la supervision doit pouvoir en faire autant sans dépendre
-- du guichet. Forme identique à « roles: messages » et « roles: medias ».
drop policy if exists "roles: affluence" on affluence;
create policy "roles: affluence" on affluence for all to authenticated
  using ((select private.a_un_des_roles(array['admin','supervision','caisse'])))
  with check ((select private.a_un_des_roles(array['admin','supervision','caisse'])));

-- Supabase accorde par défaut TOUS les droits de table à anon et
-- authenticated : on retire tout, puis on ne rend que le nécessaire. Les deux
-- colonnes de signature sont posées par le déclencheur ci-dessous et ne sont
-- accordées à personne — même stance que `profils_roles.attribue_par`.
-- Pas d'UPDATE sur (date, numero) non plus : changer l'un des deux désignerait
-- un AUTRE train, ce qui est une suppression suivie d'une déclaration.
revoke all on affluence from anon, authenticated;
-- LECTURE ANONYME LIMITÉE À TROIS COLONNES. Les écrans de gare lisent sans
-- compte, et n'ont besoin que de (date, numéro, niveau) pour poser la
-- pastille. `maj_par` porte l'ADRESSE de l'agent qui a déclaré : accordée à
-- `anon`, elle serait lisible par quiconque détient la clé publiable, donc
-- par n'importe qui. Le reste du projet ne l'admet nulle part — `profils` est
-- révoquée à `anon`, et `journal_exploitation`, qui porte la même donnée dans
-- `qui`, n'est accordée qu'à `authenticated`. C'est aussi la fuite qu'on a
-- refusée sur « mot de passe oublié » : le formulaire ne dit pas si une
-- adresse existe, ce serait absurde de la publier ici.
grant select (date, numero, niveau) on affluence to anon;
grant select on affluence to authenticated;
grant delete on affluence to authenticated;
grant insert (date, numero, niveau) on affluence to authenticated;
grant update (niveau) on affluence to authenticated;

-- « Qui » et « quand », posés côté SERVEUR. `private.email_appelant()` lit
-- l'adresse dans le JETON de l'appelant, jamais dans `profils` : personne ne
-- peut faire imputer son écriture à un collègue en renommant un compte.
create or replace function private.affluence_signe()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  new.maj_par := private.email_appelant();
  new.maj_le := now();
  return new;
end $fn$;

drop trigger if exists trg_affluence_signe on affluence;
create trigger trg_affluence_signe
  before insert or update on affluence
  for each row execute function private.affluence_signe();

-- Journal d'exploitation : même signature que `trg_journal_circulations`
-- (clé composée date + numéro, colonne de date de service, colonne suivie).
drop trigger if exists trg_journal_affluence on affluence;
create trigger trg_journal_affluence
  after insert or update or delete on affluence
  for each row execute function private.tracer_ecriture('date,numero', 'date', 'niveau');

-- Temps réel : sans cette ligne, un écran de gare ne verrait le changement
-- qu'au repli de sondage de 30 s. Le guichet déclare complet le train qui
-- part dans trois minutes — trente secondes de retard sont trente secondes
-- de trop. `alter publication` échoue si la table y est déjà : on regarde.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'affluence'
  ) then
    alter publication supabase_realtime add table affluence;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- VÉRIFICATION APRÈS — lecture seule. « Success. No rows returned » plus haut
-- ne prouve rien ; ces trois requêtes, si.
--
-- 1. La table, ses politiques et ses déclencheurs. SIX lignes attendues :
--    la table, les deux politiques, les deux déclencheurs, la publication.
-- -----------------------------------------------------------------------------
select 'table' as objet, c.relname as nom, c.relrowsecurity::text as detail
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'affluence'
union all
select 'politique', p.policyname, p.qual
  from pg_policies p
 where p.schemaname = 'public' and p.tablename = 'affluence'
union all
select 'declencheur', t.tgname, ''
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
 where c.relname = 'affluence' and not t.tgisinternal
union all
select 'temps reel', tablename, 'publie'
  from pg_publication_tables
 where pubname = 'supabase_realtime' and tablename = 'affluence';

-- -----------------------------------------------------------------------------
-- 2. Les droits de COLONNE. Deux lectures, et la première formulation de ce
--    contrôle était fausse — « maj_par ne doit apparaître nulle part » : elle
--    doit apparaître en SELECT pour `authenticated`, c'est la traçabilité.
--    Ce qu'il faut vérifier, ligne par ligne :
--      • `maj_par` / `maj_le` en INSERT ou UPDATE : JAMAIS, pour personne —
--        sinon un client signe à la place d'un collègue ;
--      • `maj_par` / `maj_le` en SELECT pour `anon` : JAMAIS non plus —
--        `anon`, c'est la clé publiable, donc tout Internet.
--    Attendu : anon → SELECT sur date, numero, niveau (trois lignes) ;
--    authenticated → SELECT sur les cinq, INSERT sur trois, UPDATE sur niveau.
-- -----------------------------------------------------------------------------
select grantee, privilege_type, column_name
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'affluence'
   and grantee in ('anon', 'authenticated')
 order by grantee, privilege_type, column_name;

-- -----------------------------------------------------------------------------
-- 3. ESSAI — sur la base de TEST uniquement, lignes à décommenter. Remplacer
--    la date et le numéro par un train qui existe réellement ce jour-là.
--
--    Le résultat attendu : `maj_par` porte l'adresse de l'appelant sans qu'on
--    l'ait écrite, et le journal d'exploitation gagne une ligne.
-- -----------------------------------------------------------------------------
-- insert into affluence (date, numero, niveau) values ('2026-07-15', 9, 'complet');
-- select date, numero, niveau, maj_par, maj_le from affluence where numero = 9;
-- select quand, qui, cle, champ, avant, apres from journal_exploitation
--  where table_cible = 'affluence' order by quand desc limit 5;
-- delete from affluence where date = '2026-07-15' and numero = 9;
