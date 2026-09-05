-- =============================================================================
-- TMB — Affichage voyageurs : schéma Supabase (phase 1) — docs/02 §2
-- À exécuter dans l'éditeur SQL du projet Supabase, puis seed.sql.
-- Sécurité : lecture publique (clé « publishable », RLS SELECT anon) ;
-- écritures réservées aux profils actifs selon leurs RÔLES, multiples et
-- cumulables (private.roles_courants(), private.a_le_role()).
-- =============================================================================

-- ---------------------------------------------------------------- tables
create table if not exists jours (
  date date primary key,
  grille_version text not null,                 -- ex : 2026-ete-grand-service
  -- Bascule « Terminus Bellevue à partir du TRAIN N » (docs/01 §2.3) :
  -- numéro de MONTÉE (impair, pair normalisé N-1) ; null = pas de bascule ;
  -- 1 = journée entière (régime hiver). La colonne `terminus` de chaque
  -- circulation reste l'unique source de vérité pour l'affichage.
  terminus_bellevue_a_partir_du_train int,
  genere_le timestamptz default now()
);

create table if not exists circulations (
  id uuid primary key default gen_random_uuid(),
  date date not null references jours(date) on delete cascade,
  numero int not null,
  sens text not null check (sens in ('montee','descente')),
  express boolean not null default false,
  facultatif boolean not null default false,
  facultatif_actif boolean not null default false,
  velos boolean not null default false,
  rame text not null,             -- portée par la MONTÉE ; la descente appariée (numero+1) hérite
  terminus text not null default 'nid-daigle' check (terminus in ('nid-daigle','bellevue')),
                                  -- porté par la MONTÉE : « bellevue » = rotation limitée
                                  -- (montée express : jamais tronquée, signalée « à traiter »)
  statut text not null default 'ok' check (statut in ('ok','retard','supprime')),
  retard_min int not null default 0 check (retard_min >= 0),
  sans_voyageurs boolean not null default false,
                                  -- course à vide : conservée en exploitation,
                                  -- JAMAIS affichée aux voyageurs
  motif text,
  -- TRAIN SUPPLÉMENTAIRE : train de renfort absent de toute grille. Il porte
  -- donc SES PROPRES passages, au format des grilles JSON — sans quoi il
  -- serait invisible partout (docs/01 §2.7).
  supplementaire boolean not null default false,
  passages jsonb,
  maj timestamptz not null default now(),
  unique (date, numero),
  -- Un train sup a forcément ses passages ; un train de grille n'en a jamais.
  constraint circulations_sup_passages
    check ((supplementaire and passages is not null) or (not supplementaire and passages is null))
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  texte_fr text not null,
  texte_en text not null default '',
  cible_type text not null default 'toutes' check (cible_type in ('toutes','gares','train')),
  gares text[],
  train_numero int,
  priorite text not null default 'normale' check (priorite in ('normale','importante')),
  actif boolean not null default true,
  expire_at timestamptz,
  cree_par text,
  cree_le timestamptz not null default now()
);

create table if not exists medias (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  type text not null check (type in ('image','video')),
  chemin text not null,                          -- clé Supabase Storage (bucket 'medias')
  duree_s int not null default 8 check (duree_s between 3 and 120),
  ordre int not null default 100,                -- ordre de passage croissant, cree_le à égalité
  gares text[],                                  -- null = toutes
  actif boolean not null default true,
  expire_at timestamptz,
  cree_par text,
  cree_le timestamptz default now()
);

create table if not exists machines (
  nom text primary key,
  couleur text not null,
  cercle text,                                   -- couleur d'anneau (Marguerite)
  en_service boolean not null default true
);

create table if not exists motifs (
  fr text primary key,
  en text not null default ''
);

-- États du ciel proposés dans le sélecteur météo (liste, plus de texte libre)
-- Ajout sur base existante : supabase/ajout-ciels.sql
create table if not exists ciels (
  fr text primary key,
  en text not null default '',
  ordre int not null default 0                   -- ordre d'affichage dans la liste
);

-- Bibliothèque de messages préenregistrés bilingues (docs/01 §2.4)
create table if not exists modeles_messages (
  id uuid primary key default gen_random_uuid(),
  titre text not null,
  texte_fr text not null,
  texte_en text not null default '',
  categorie text not null default 'Général',
  ordre int not null default 0,
  actif boolean not null default true
);
create unique index if not exists modeles_messages_titre_unique on modeles_messages (titre);

create table if not exists params (
  cle text primary key,
  valeur jsonb not null,
  maj timestamptz default now()
);
-- clés : meteo_sommet {t,ciel_fr,ciel_en}, veille_nuit {debut,fin},
--        duree_horaires_s, duree_cache_min

create table if not exists profils (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nom text not null,
  email text,
  actif boolean not null default true
);

-- RÔLES MULTIPLES ET CUMULABLES (docs/01 §5.5, docs/02 §5). Une personne porte
-- un ENSEMBLE de rôles ; un droit est accordé si AU MOINS UN de ses rôles le
-- donne (union, jamais héritage). Aucun rôle n'en implique un autre :
-- « technique » (informatique) ne donne pas l'exploitation, et réciproquement.
-- Ajout sur base existante : supabase/migrations/2026-09-roles-multiples.sql
create table if not exists roles (
  code text primary key,
  libelle text not null,
  -- true : il doit TOUJOURS rester au moins un compte actif portant ce rôle.
  protege boolean not null default false,
  -- Rôles dont la détention permet d'attribuer (et de retirer) celui-ci : la
  -- règle est une DONNÉE lisible d'un simple SELECT, pas du code enfoui.
  attribuable_par text[] not null,
  ordre int not null default 0,
  -- Accroche SSO (Entra ID) : groupe qui portera ce rôle. NULL tant que le SSO
  -- n'est pas en service — voir docs/02 §7.
  groupe_entra text
);

-- Une ligne = une personne × un rôle. Une table de liaison plutôt qu'une
-- colonne `text[]` parce que RLS s'évalue LIGNE à ligne : « l'appelant peut-il
-- attribuer CE rôle ? » s'écrit alors directement dans la politique, et le
-- journal reçoit une ligne par rôle accordé ou retiré.
create table if not exists profils_roles (
  user_id uuid not null references profils(user_id) on delete cascade,
  role text not null references roles(code),
  -- 'manuel' : attribué en supervision ; 'entra' : dérivé d'un groupe du SSO.
  source text not null default 'manuel' check (source in ('manuel','entra')),
  attribue_le timestamptz not null default now(),
  -- Adresse de l'agent qui a accordé le rôle, FORCÉE par déclencheur depuis
  -- son jeton : jamais une valeur fournie par le client.
  attribue_par text,
  primary key (user_id, role)
);
create index if not exists idx_profils_roles_role on profils_roles (role);

insert into roles (code, libelle, protege, attribuable_par, ordre) values
  ('technique',   'Technique',      true,  array['technique'], 10),
  ('admin',       'Administrateur', true,  array['admin'],     20),
  ('supervision', 'Supervision',    false, array['admin'],     30),
  ('caisse',      'Caisse',         false, array['admin'],     40)
on conflict (code) do update set
  libelle = excluded.libelle,
  protege = excluded.protege,
  attribuable_par = excluded.attribuable_par,
  ordre = excluded.ordre;

create table if not exists ecrans (
  id text primary key,
  gare text not null,
  type text,
  derniere_vue timestamptz,               -- signal de vie : la MACHINE tourne
  donnees_maj timestamptz,                -- dernière synchro RÉUSSIE : les DONNÉES sont fraîches
  date_affichee date,                     -- journée d'exploitation affichée
  version_app text,
  reseau text,
  -- Ordre de rechargement : un HORODATAGE, pas un booléen. L'écran compare
  -- la demande à sa propre heure de chargement — il n'a donc rien à
  -- réécrire (l'écriture anonyme lui est refusée) et ne boucle jamais.
  recharger_demande_at timestamptz,
  -- Veille de nuit propre à ce poste ; nulles = suit params.veille_nuit
  veille_debut time,
  veille_fin time
);

create table if not exists publications (
  id bigint generated always as identity primary key,
  quand timestamptz not null default now(),
  qui text,
  resume text not null
);

-- GRILLES HORAIRES EN BASE (docs/01 §2.1, docs/import-grilles.md). Les grilles
-- sont des DONNÉES, chargées depuis l'Excel exploitation dans la Supervision →
-- onglet Horaires, avec aperçu et retour arrière ; les JSON de
-- docs/grilles-historique/ ne sont plus qu'une référence.
-- RÈGLES : une grille ne s'applique qu'à ses périodes (bornes incluses) ;
-- seules les ACTIVES comptent ; à égalité, la plus récemment chargée l'emporte ;
-- une version n'est jamais réécrite (recharger crée « …-v2 »).
-- Les textes de la bibliothèque et les deux grilles été 2026 restent dans
-- supabase/ajout-grilles.sql, à exécuter ensuite (docs/mise-en-service.md §B).
create table if not exists grilles (
  version text primary key,               -- ex : 2026-ete-grand-service
  libelle text not null,                  -- « Grand service — été 2026 »
  source text,                            -- fichier d'origine + date de mise à jour
  contenu jsonb not null,                 -- l'objet Grille complet (src/core/types.ts)
  periodes jsonb not null default '[]'::jsonb,  -- recopie de contenu.periodes, pour requêter
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  cree_par text,                          -- email de l'agent (ou nom du script)
  commentaire text
);

-- Forme minimale du contenu (seconde barrière, cf. migrations/2026-08-params-forme.sql).
-- L'opérateur ? teste la PRÉSENCE : jsonb_typeof(NULL) vaudrait NULL et la
-- contrainte, ni vraie ni fausse, laisserait passer.
alter table grilles drop constraint if exists grilles_contenu_forme;
alter table grilles add constraint grilles_contenu_forme check (
  jsonb_typeof(contenu) = 'object'
  and (contenu ? 'montees') and jsonb_typeof(contenu -> 'montees') = 'array'
  and (contenu ? 'descentes') and jsonb_typeof(contenu -> 'descentes') = 'array'
  and (contenu ? 'gares') and jsonb_typeof(contenu -> 'gares') = 'array'
  and (contenu ? 'periodes') and jsonb_typeof(contenu -> 'periodes') = 'array'
  and jsonb_typeof(periodes) = 'array'
);

-- --------------------------------------------- rôles de l'appelant + triggers
-- Les fonctions SECURITY DEFINER vivent dans `private`, schéma NON exposé
-- par PostgREST : elles ne sont pas appelables en RPC depuis le front, tout
-- en restant utilisables par les politiques et les triggers. search_path
-- vide + noms pleinement qualifiés (advisors Supabase).
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- Rôles de l'appelant. Tableau VIDE si le profil est absent ou inactif : une
-- personne désactivée perd tout, immédiatement, sans autre réglage.
create or replace function private.roles_courants()
returns text[] language sql stable security definer set search_path = '' as $fn$
  select coalesce(array_agg(pr.role order by pr.role), array[]::text[])
    from public.profils_roles pr
    join public.profils p on p.user_id = pr.user_id
   where pr.user_id = auth.uid() and p.actif
$fn$;
revoke all on function private.roles_courants() from public;
-- INDISPENSABLE : les politiques l'évaluent au nom de l'utilisateur
-- connecté — sans ce GRANT, toute écriture serait refusée.
grant execute on function private.roles_courants() to authenticated;

create or replace function private.a_le_role(p_role text)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select p_role = any (private.roles_courants())
$fn$;
revoke all on function private.a_le_role(text) from public;
grant execute on function private.a_le_role(text) to authenticated;

-- UNION : vrai dès qu'un seul des rôles demandés est détenu.
create or replace function private.a_un_des_roles(p_roles text[])
returns boolean language sql stable security definer set search_path = '' as $fn$
  select private.roles_courants() && p_roles
$fn$;
revoke all on function private.a_un_des_roles(text[]) from public;
grant execute on function private.a_un_des_roles(text[]) to authenticated;

-- L'appelant peut-il accorder (ou retirer) CE rôle ? La règle vient du
-- catalogue : technique attribue technique, admin attribue les rôles
-- d'exploitation, personne d'autre n'attribue rien.
create or replace function private.peut_attribuer(p_role text)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.roles r
     where r.code = p_role and private.roles_courants() && r.attribuable_par
  )
$fn$;
revoke all on function private.peut_attribuer(text) from public;
grant execute on function private.peut_attribuer(text) to authenticated;

-- Peut-on renommer, désactiver ou supprimer CE compte ? Règle STRICTE : il
-- faut pouvoir attribuer TOUS les rôles de la cible — un administrateur ne
-- touche donc pas au compte du prestataire informatique, et réciproquement.
-- Son PROPRE compte est toujours exclu : personne ne se modifie soi-même.
create or replace function private.peut_gerer_profil(p_cible uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select p_cible is distinct from auth.uid()
     and exists (select 1 from public.roles r where private.peut_attribuer(r.code))
     and not exists (
       select 1 from public.profils_roles pr
        where pr.user_id = p_cible and not private.peut_attribuer(pr.role)
     )
$fn$;
revoke all on function private.peut_gerer_profil(uuid) from public;
grant execute on function private.peut_gerer_profil(uuid) to authenticated;

-- Combien de comptes RÉELLEMENT utilisables portent ce rôle ? Un profil actif
-- dont le compte Auth est banni ou supprimé ne peut plus se connecter : le
-- compter satisferait l'invariant avec un fantôme. Les colonnes de auth.users
-- varient selon la version de GoTrue, d'où la construction dynamique.
do $$
declare
  filtre text := '';
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'auth' and table_name = 'users'
                and column_name = 'banned_until') then
    filtre := filtre || ' and (u.banned_until is null or u.banned_until <= now())';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'auth' and table_name = 'users'
                and column_name = 'deleted_at') then
    filtre := filtre || ' and u.deleted_at is null';
  end if;
  execute format($corps$
create or replace function private.nb_detenteurs_actifs(p_role text)
returns int language sql stable security definer set search_path = '' as $fn$
  select count(*)::int
    from public.profils_roles pr
    join public.profils p on p.user_id = pr.user_id
    join auth.users u on u.id = pr.user_id
   where pr.role = p_role and p.actif %s
$fn$;
  $corps$, filtre);
end $$;
revoke all on function private.nb_detenteurs_actifs(text) from public;
grant execute on function private.nb_detenteurs_actifs(text) to authenticated;

-- Adresse de l'agent connecté, telle qu'elle figure dans SON JETON : une
-- identité que personne ne peut réécrire dans `profils` pour se faire passer
-- pour un collègue au journal.
create or replace function private.email_appelant()
returns text language sql stable security definer set search_path = '' as $fn$
  select coalesce(
    -- Les revendications du jeton, lues directement plutôt que par auth.jwt() :
    -- même source, sans dépendre d'une fonction du schéma auth dont la
    -- présence varie selon la version de GoTrue.
    nullif(
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'email',
      ''
    ),
    (select p.email from public.profils p where p.user_id = auth.uid())
  )
$fn$;
revoke all on function private.email_appelant() from public;
grant execute on function private.email_appelant() to authenticated;

-- Rotation : la rame d'une montée est recopiée sur sa descente appariée
-- (numero + 1) pour les exports — l'affichage la dérive déjà par jointure.
create or replace function private.sync_rame_descente()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if new.sens = 'montee' then
    update public.circulations set rame = new.rame
      where date = new.date and numero = new.numero + 1 and rame is distinct from new.rame;
  end if;
  return new;
end $fn$;
revoke all on function private.sync_rame_descente() from public;
-- Pas de GRANT : EXECUTE d'une fonction de trigger est vérifié à la
-- CRÉATION du trigger, jamais à son déclenchement.

drop trigger if exists trg_sync_rame on circulations;
create trigger trg_sync_rame after insert or update of rame on circulations
  for each row execute function private.sync_rame_descente();

-- ---------------------------------------------------------------- RLS
alter table jours enable row level security;
alter table circulations enable row level security;
alter table messages enable row level security;
alter table medias enable row level security;
alter table machines enable row level security;
alter table motifs enable row level security;
alter table ciels enable row level security;
alter table modeles_messages enable row level security;
alter table params enable row level security;
alter table profils enable row level security;
alter table roles enable row level security;
alter table profils_roles enable row level security;
alter table ecrans enable row level security;
alter table publications enable row level security;
alter table grilles enable row level security;

-- Supabase accorde par défaut TOUS les droits de table à anon et
-- authenticated : sur les deux tables qui portent les habilitations, on retire
-- tout, puis on ne rend que le strict nécessaire. Sans cela, n'importe quel
-- compte connecté pourrait réécrire la matrice « qui attribue quoi » et
-- s'habiliter lui-même.
revoke all on roles from anon, authenticated;
grant select on roles to authenticated;
revoke all on profils_roles from anon, authenticated;
-- Pas d'UPDATE : une attribution est IMMUABLE — on retire un rôle, on en
-- attribue un autre, et chacun des deux gestes passe par sa politique et par
-- le journal. Les autres colonnes (source, attribue_par) sont posées par
-- déclencheur, jamais par le client.
grant select, delete on profils_roles to authenticated;
grant insert (user_id, role) on profils_roles to authenticated;
-- L'annuaire du personnel ne garde QUE les droits dont il a besoin : `anon`
-- n'a rien à y faire (les écrans ne lisent jamais les comptes), et
-- `authenticated` n'écrit ni `role` — le miroir est tenu par un déclencheur —
-- ni `email`, qui sert d'identité au journal.
-- TRUNCATE mérite une mention à part : c'est le SEUL ordre d'écriture que RLS
-- ne filtre PAS. Tant qu'il est accordé, aucune politique ne protège la table
-- de son vidage.
revoke all on profils from anon, authenticated;
grant select, delete on profils to authenticated;
grant insert (user_id, nom, email, actif) on profils to authenticated;
grant update (nom, actif) on profils to authenticated;

-- Lecture publique (les écrans lisent sans compte)
create policy "lecture publique" on jours for select using (true);
create policy "lecture publique" on circulations for select using (true);
create policy "lecture publique" on messages for select using (true);
create policy "lecture publique" on medias for select using (true);
create policy "lecture publique" on machines for select using (true);
create policy "lecture publique" on motifs for select using (true);
create policy "lecture publique" on ciels for select using (true);
create policy "lecture publique" on params for select using (true);
create policy "lecture publique" on ecrans for select using (true);
create policy "lecture publique" on grilles for select using (true);

-- Forme retenue pour toutes les politiques : `(select private.a_le_role(…))`.
-- L'enveloppe `(select …)` fait évaluer la fonction UNE fois par requête et
-- non une fois par ligne ; la liste des rôles reste lisible telle quelle dans
-- `pg_policies`, sans indirection, pour qui reprendra le projet.

-- Journées et circulations : l'exploitation écrit tout. Le technique n'a que
-- la RÉINITIALISATION (supprimer la journée puis la régénérer depuis la
-- grille), jamais le droit de modifier un statut, un retard ou un terminus.
create policy "roles: jours ecriture" on jours for all to authenticated
  using ((select private.a_le_role('supervision')))
  with check ((select private.a_le_role('supervision')));
create policy "roles: jours reinitialisation" on jours for insert to authenticated
  with check ((select private.a_le_role('technique')));
create policy "roles: jours reinitialisation retrait" on jours for delete to authenticated
  using ((select private.a_le_role('technique')));

create policy "roles: circulations ecriture" on circulations for all to authenticated
  using ((select private.a_le_role('supervision')))
  with check ((select private.a_le_role('supervision')));
-- Régénération après réinitialisation : la suppression, elle, passe par la
-- cascade de `jours`.
create policy "roles: circulations regeneration" on circulations for insert to authenticated
  with check ((select private.a_le_role('technique')));

create policy "roles: medias" on medias for all to authenticated
  using ((select private.a_un_des_roles(array['admin','supervision'])))
  with check ((select private.a_un_des_roles(array['admin','supervision'])));

-- Bandeau voyageurs : la caisse le tient au quotidien et ne doit dépendre de
-- personne pour corriger un message ou une température.
create policy "roles: messages" on messages for all to authenticated
  using ((select private.a_un_des_roles(array['admin','supervision','caisse'])))
  with check ((select private.a_un_des_roles(array['admin','supervision','caisse'])));

-- Paramétrage d'exploitation : le chef d'exploitation.
create policy "roles: machines" on machines for all to authenticated
  using ((select private.a_le_role('admin'))) with check ((select private.a_le_role('admin')));
create policy "roles: motifs" on motifs for all to authenticated
  using ((select private.a_le_role('admin'))) with check ((select private.a_le_role('admin')));
create policy "roles: ciels" on ciels for all to authenticated
  using ((select private.a_le_role('admin'))) with check ((select private.a_le_role('admin')));

-- Params, clé par clé : quatre politiques PERMISSIVES qui se cumulent en OU.
-- Les clés inconnues ne sont ouvertes qu'au technique — une clé nouvelle est
-- un réglage d'infrastructure jusqu'à preuve du contraire.
create policy "roles: params affichage" on params for all to authenticated
  using (
    cle in ('meteo_sommet', 'vitesse_ticker_px_s')
    and (select private.a_un_des_roles(array['admin','supervision','caisse']))
  )
  with check (
    cle in ('meteo_sommet', 'vitesse_ticker_px_s')
    and (select private.a_un_des_roles(array['admin','supervision','caisse']))
  );
create policy "roles: params medias" on params for all to authenticated
  using (
    cle in ('mode_medias', 'duree_horaires_s')
    and (select private.a_un_des_roles(array['admin','supervision']))
  )
  with check (
    cle in ('mode_medias', 'duree_horaires_s')
    and (select private.a_un_des_roles(array['admin','supervision']))
  );
create policy "roles: params exploitation" on params for all to authenticated
  using (cle in ('a_quai_origine_s') and (select private.a_le_role('admin')))
  with check (cle in ('a_quai_origine_s') and (select private.a_le_role('admin')));
create policy "roles: params technique" on params for all to authenticated
  using ((select private.a_le_role('technique')))
  with check ((select private.a_le_role('technique')));

-- Bibliothèque de messages : proposée à la saisie pour tous, administrée par
-- le chef d'exploitation.
create policy "roles: modeles lecture" on modeles_messages for select to authenticated
  using ((select private.a_un_des_roles(array['technique','admin','supervision','caisse'])));
create policy "roles: modeles ecriture" on modeles_messages for all to authenticated
  using ((select private.a_le_role('admin'))) with check ((select private.a_le_role('admin')));

-- Comptes : chacun lit son profil ; ceux qui gèrent des comptes les lisent tous.
create policy "roles: profils lecture" on profils for select to authenticated
  using (user_id = auth.uid() or (select private.a_un_des_roles(array['technique','admin'])));
create policy "roles: profils creation" on profils for insert to authenticated
  with check ((select private.a_un_des_roles(array['technique','admin'])));
-- Renommer, activer, désactiver : règle STRICTE (tous les rôles de la cible).
create policy "roles: profils gestion" on profils for update to authenticated
  using ((select private.peut_gerer_profil(user_id)))
  with check ((select private.peut_gerer_profil(user_id)));
create policy "roles: profils suppression" on profils for delete to authenticated
  using ((select private.peut_gerer_profil(user_id)));

-- Catalogue des rôles : lisible par tout compte connecté (l'interface a besoin
-- des libellés et de la matrice pour griser les cases), modifiable seulement
-- depuis l'éditeur SQL — aucune politique d'écriture, volontairement.
create policy "roles: catalogue lecture" on roles for select to authenticated using (true);

-- Rôles d'un compte : visibles dès qu'on voit le compte.
create policy "roles: liaison lecture" on profils_roles for select to authenticated
  using (user_id = auth.uid() or (select private.a_un_des_roles(array['technique','admin'])));
-- Attribuer : jamais à soi-même, et seulement un rôle que l'on est habilité à
-- donner. `source = 'manuel'` interdit de déguiser une attribution en SSO.
create policy "roles: liaison attribution" on profils_roles for insert to authenticated
  with check (
    user_id <> auth.uid()
    and source = 'manuel'
    and (select private.peut_attribuer(role))
  );
-- Retirer : mêmes conditions. Le retrait du DERNIER détenteur d'un rôle
-- protégé est refusé par le déclencheur de contrainte (plus bas).
create policy "roles: liaison retrait" on profils_roles for delete to authenticated
  using (
    user_id <> auth.uid()
    and source = 'manuel'
    and (select private.peut_attribuer(role))
  );

-- Grilles horaires : PARTAGÉES entre l'informatique et l'exploitation. Un
-- horaire corrigé un matin de service ne doit pas attendre le prestataire.
create policy "roles: grilles" on grilles for all to authenticated
  using ((select private.a_un_des_roles(array['technique','admin','supervision'])))
  with check ((select private.a_un_des_roles(array['technique','admin','supervision'])));

-- Écrans : PRÉ-DÉCLARÉS par un administrateur (id, gare, type). L'écran ne
-- fait que donner signe de vie — jamais d'INSERT anonyme, et les colonnes
-- qu'il peut toucher sont verrouillées par des GRANT de colonnes.
revoke insert, update, delete, truncate on ecrans from anon;
grant update (derniere_vue, donnees_maj, date_affichee, version_app, reseau)
  on ecrans to anon;
grant select, insert, update, delete on ecrans to authenticated;

-- DÉCISION ASSUMÉE : le signal de vie reste ANONYME, sans identité propre à
-- chaque écran. Un poste en gare n'a pas de secret à protéger et n'aurait de
-- toute façon aucun moyen d'en garder un — la clé publishable est publique
-- par conception. Trois garde-fous encadrent cette ouverture :
--   1. la portée est bornée par les GRANT de COLONNES ci-dessus : un anonyme
--      ne touche que les colonnes du signal de vie, jamais
--      recharger_demande_at (il ne peut donc pas ordonner le rechargement des
--      écrans de la ligne), ni id, gare ou type ;
--   2. l'INSERT lui est interdit : les postes sont pré-déclarés par un
--      administrateur, une ligne inconnue n'écrit nulle part ;
--   3. un signal de vie ne peut être ni antidaté ni postdaté : toute écriture
--      qui MODIFIE derniere_vue voit sa valeur remplacée par now() côté
--      serveur (trg_signal_de_vie). L'horloge du Raspberry n'entre plus dans
--      le calcul de fraîcheur, et une date lointaine ne peut plus rendre un
--      poste « vivant » indéfiniment. Le déclencheur est CONDITIONNEL à
--      dessein : sans cela, une action de supervision (ordre de rechargement,
--      réglage de veille) réécrirait derniere_vue et ferait passer un écran
--      MORT pour vivant — l'inverse exact du but recherché.
--      donnees_maj, elle, n'est pas forcée mais BORNÉE : jamais postérieure à
--      l'instant présent, mais librement antérieure — c'est le cas normal
--      d'un écran vivant dont le réseau est coupé, et c'est cette information
--      qu'il faut préserver. Conséquence assumée : un tiers peut faire
--      paraître des données plus VIEILLES qu'elles ne sont, jamais plus
--      fraîches ; l'erreur possible va donc dans le sens de la fausse alerte,
--      pas du faux « tout va bien ».
-- Fermeture définitive en phase 2 : le micro-serveur interne de la Régie
-- prendra en charge les écritures des écrans et le rôle anon disparaîtra.
create policy "signal de vie" on ecrans for update to anon
  using (true) with check (true);
-- L'IDENTITÉ d'un poste (le déclarer, l'oublier) relève de l'informatique ;
-- le COMMANDER — recharger après une mise en ligne, régler sa veille un soir
-- de nocturne — relève de l'exploitation, qui ne doit jamais attendre le
-- prestataire. RLS ne sait pas quelles COLONNES changent : le déclencheur
-- `trg_roles_ecrans_identite` empêche un superviseur de déplacer un écran.
create policy "roles: ecrans declarer" on ecrans for insert to authenticated
  with check ((select private.a_le_role('technique')));
create policy "roles: ecrans commander" on ecrans for update to authenticated
  using ((select private.a_un_des_roles(array['technique','supervision'])))
  with check ((select private.a_un_des_roles(array['technique','supervision'])));
create policy "roles: ecrans oublier" on ecrans for delete to authenticated
  using ((select private.a_le_role('technique')));

-- LIMITE CONNUE : derniere_vue ne peut plus être remise à NULL par un UPDATE
-- (elle serait horodatée à now()). Un poste repart de NULL à sa déclaration
-- (INSERT, non concerné par le déclencheur) ; aucun usage d'exploitation n'a
-- besoin de cette remise à zéro.
-- Ajout sur base existante : supabase/migrations/2026-08-signal-de-vie-serveur.sql

-- Le serveur horodate le signal de vie : ni l'horloge d'un Raspberry, ni un
-- tiers muni de la clé publique ne décident plus de la fraîcheur d'un écran.
create or replace function private.horodate_signal_de_vie()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  -- Ne s'applique QU'aux écritures qui touchent ces colonnes : une action de
  -- supervision (veille, ordre de rechargement) ne fausse pas la dernière vue.
  if new.derniere_vue is distinct from old.derniere_vue then
    new.derniere_vue := now();
  end if;
  -- La dernière synchro réussie peut être ANTÉRIEURE (réseau coupé) mais
  -- jamais postérieure à maintenant.
  if new.donnees_maj is distinct from old.donnees_maj and new.donnees_maj is not null then
    new.donnees_maj := least(new.donnees_maj, now());
  end if;
  return new;
end;
$fn$;

revoke all on function private.horodate_signal_de_vie() from public;

drop trigger if exists trg_signal_de_vie on public.ecrans;
create trigger trg_signal_de_vie
  before update on public.ecrans
  for each row execute function private.horodate_signal_de_vie();

-- Publications : journal — écrit par tout rôle actif, lu par les connectés
create policy "roles: publications ecriture" on publications for insert to authenticated
  with check ((select private.a_un_des_roles(array['technique','admin','supervision','caisse'])));
create policy "roles: publications lecture" on publications for select to authenticated
  using ((select private.a_un_des_roles(array['technique','admin','supervision','caisse'])));

-- ------------------------------------------------- garde-fous des rôles
-- Ces déclencheurs s'appliquent à TOUS les chemins : l'application, une Edge
-- Function à clé secrète, l'éditeur SQL et la cascade déclenchée par la
-- suppression d'un compte depuis le tableau de bord Supabase. RLS, elle, ne
-- s'applique ni à `service_role` ni au propriétaire des tables — c'est le même
-- principe que le journal d'exploitation : rien ne doit y échapper.

-- (a) Attribution : la matrice du catalogue est REJOUÉE ici, en plus de la
--     politique RLS.
create or replace function private.proteger_profils_roles()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  cible uuid;
  role_vise text;
  contexte text := current_setting('tmb.attribution_systeme', true);
begin
  if tg_op = 'UPDATE' then
    raise exception 'Une attribution de rôle est immuable : retirez le rôle, puis attribuez-le.'
      using errcode = 'check_violation';
  end if;
  -- NEW n'existe pas sur un DELETE (et OLD pas sur un INSERT) : y toucher
  -- lèverait « record new is not assigned yet ».
  if tg_op = 'DELETE' then
    cible := old.user_id;
    role_vise := old.role;
  else
    cible := new.user_id;
    role_vise := new.role;
  end if;

  if auth.uid() is null then
    -- Écriture « sans visage » : installation, synchronisation SSO, dépannage.
    -- Elle doit être REVENDIQUÉE, sinon une Edge Function compromise ou une
    -- fausse manœuvre en SQL passerait pour un geste légitime.
    if contexte is null or contexte not in ('migration', 'entra', 'secours') then
      raise exception 'Attribution de rôle sans utilisateur connecté refusée.'
        using errcode = 'check_violation',
              hint = 'Depuis l''éditeur SQL : set local tmb.attribution_systeme = ''secours'';';
    end if;
    if tg_op = 'INSERT' then
      new.source := case when contexte = 'entra' then 'entra' else 'manuel' end;
      new.attribue_par := coalesce(new.attribue_par, 'script (' || contexte || ')');
      return new;
    end if;
    return old;
  end if;

  if cible = auth.uid() then
    raise exception 'Personne ne modifie ses propres rôles.'
      using errcode = 'check_violation';
  end if;
  if not private.peut_attribuer(role_vise) then
    raise exception 'Le rôle « % » ne fait pas partie de ceux que vous pouvez attribuer.', role_vise
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    new.source := 'manuel';
    new.attribue_par := private.email_appelant();
    return new;
  end if;
  return old;
end $fn$;
revoke all on function private.proteger_profils_roles() from public;

drop trigger if exists trg_roles_proteger on profils_roles;
create trigger trg_roles_proteger before insert or update or delete on profils_roles
  for each row execute function private.proteger_profils_roles();

-- TRUNCATE ne déclenche aucun déclencheur de LIGNE : il lui faut le sien.
create or replace function private.interdire_truncate_roles()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  raise exception 'TRUNCATE interdit sur %.', tg_table_name using errcode = 'check_violation';
end $fn$;
revoke all on function private.interdire_truncate_roles() from public;

drop trigger if exists trg_roles_pas_de_truncate on profils_roles;
create trigger trg_roles_pas_de_truncate before truncate on profils_roles
  for each statement execute function private.interdire_truncate_roles();

-- (b) Quorum : il reste toujours au moins un compte actif « technique » et un
--     « admin ». Sans technique, plus personne ne peut charger une grille ni
--     déclarer un écran ; sans admin, plus personne ne gère les comptes.
--     Déclencheur de CONTRAINTE DIFFÉRÉ, vérifié à la fin de la transaction :
--     depuis l'éditeur SQL, « retirer le rôle à A puis le donner à B » passe
--     dans un même begin/commit. Depuis la supervision (une transaction par
--     requête), il faut DONNER d'abord, RETIRER ensuite — le message le dit.
--     Le verrou consultatif sérialise deux retraits concurrents : sans lui,
--     deux transactions retirant chacune l'un des deux derniers détenteurs
--     réussiraient toutes les deux.
create or replace function private.verifier_quorum_roles()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  r record;
begin
  -- Sur un UPDATE de `profils`, seule la DÉSACTIVATION touche au quorum. Le
  -- test est imbriqué : NEW n'existe pas sur un DELETE, et PL/pgSQL évalue
  -- l'expression entière avant de la court-circuiter.
  if tg_op = 'UPDATE' then
    if not (old.actif and not new.actif) then
      return null;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('tmb.quorum_roles'));

  for r in select code, libelle from public.roles where protege loop
    if private.nb_detenteurs_actifs(r.code) = 0 then
      raise exception 'Refusé : il doit toujours rester au moins un compte actif « % ».', r.libelle
        using errcode = 'check_violation',
              hint = 'Donnez d''abord ce rôle à un autre compte actif, puis recommencez.';
    end if;
  end loop;
  return null;
end $fn$;
revoke all on function private.verifier_quorum_roles() from public;

drop trigger if exists trg_roles_quorum_liaison on profils_roles;
create constraint trigger trg_roles_quorum_liaison
  after delete on profils_roles
  deferrable initially deferred
  for each row execute function private.verifier_quorum_roles();

-- Sur `profils` : couvre la désactivation, la suppression depuis l'interface,
-- ET la cascade déclenchée par `auth.users` (tableau de bord Supabase,
-- auth.admin.deleteUser) — la clé étrangère contourne RLS, jamais les
-- déclencheurs.
drop trigger if exists trg_roles_quorum_profils on profils;
create constraint trigger trg_roles_quorum_profils
  after update or delete on profils
  deferrable initially deferred
  for each row execute function private.verifier_quorum_roles();

-- (c) On ne se désactive pas soi-même (ceinture et bretelles : la politique
--     « roles: profils gestion » l'interdit déjà par peut_gerer_profil).
create or replace function private.interdire_auto_desactivation()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if auth.uid() is not null and new.user_id = auth.uid()
     and old.actif and not new.actif then
    raise exception 'Vous ne pouvez pas désactiver votre propre compte.'
      using errcode = 'check_violation';
  end if;
  return new;
end $fn$;
revoke all on function private.interdire_auto_desactivation() from public;

drop trigger if exists trg_roles_auto_desactivation on profils;
create trigger trg_roles_auto_desactivation before update of actif on profils
  for each row when (old.actif is distinct from new.actif)
  execute function private.interdire_auto_desactivation();

-- (d) Identité d'un écran : la politique UPDATE ouvre la table au technique ET
--     à l'exploitation, mais RLS ne sait pas quelles COLONNES changent. Seul
--     le technique déplace un poste ou en change le type.
create or replace function private.proteger_identite_ecran()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if (new.gare is distinct from old.gare or new.type is distinct from old.type)
     and auth.uid() is not null and not private.a_le_role('technique') then
    raise exception 'Changer la gare ou le type d''un écran relève du rôle technique.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $fn$;
revoke all on function private.proteger_identite_ecran() from public;

drop trigger if exists trg_roles_ecrans_identite on ecrans;
create trigger trg_roles_ecrans_identite before update of gare, type on ecrans
  for each row execute function private.proteger_identite_ecran();

-- ------------------------------------------- journal d'exploitation
-- Trace permanente de chaque ÉCRITURE, alimentée par DÉCLENCHEURS (rien
-- n'y échappe, pas même une correction faite directement en SQL). Distinct
-- du journal des PUBLICATIONS (table publications).
-- Ajout sur base existante : supabase/ajout-journal-exploitation.sql
-- ---------------------------------------------------------------------------
-- 1. La table
-- ---------------------------------------------------------------------------
create table if not exists journal_exploitation (
  id bigint generated always as identity primary key,
  quand timestamptz not null default now(),
  qui text,                       -- email de l'agent, résolu depuis profils
  table_cible text not null,
  cle text not null,              -- identifiant de la ligne (ou date + n° de train)
  champ text not null,
  avant text,
  apres text,
  date_service date               -- journée d'exploitation concernée, si connue
);

create index if not exists idx_journal_quand on journal_exploitation (quand desc);
create index if not exists idx_journal_date_service on journal_exploitation (date_service);

alter table journal_exploitation enable row level security;

-- Lecture : tout compte connecté et actif… SAUF les lignes qui tracent les
-- comptes et les rôles — l'annuaire des habilitations ne regarde que ceux qui
-- gèrent des comptes. Aucune écriture depuis les clients : seul le déclencheur
-- écrit, en SECURITY DEFINER.
drop policy if exists "roles: journal lecture" on journal_exploitation;
create policy "roles: journal lecture" on journal_exploitation for select to authenticated
  using (
    case
      when table_cible in ('profils', 'profils_roles', 'roles')
        then (select private.a_un_des_roles(array['technique','admin']))
      else (select private.a_un_des_roles(array['technique','admin','supervision','caisse']))
    end
  );

revoke insert, update, delete, truncate on journal_exploitation from anon, authenticated;
grant select on journal_exploitation to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Le déclencheur : une ligne par CHAMP réellement modifié
-- ---------------------------------------------------------------------------
-- Les colonnes à surveiller sont passées en ARGUMENTS du déclencheur : sur
-- `ecrans`, on ne veut surtout pas tracer derniere_vue / donnees_maj /
-- version_app / reseau, sinon les signaux de vie (6 écrans, toutes les 60 s,
-- soit ~8 600 lignes par jour) noieraient le journal.
--
-- TG_ARGV[0] = expression de la clé métier, TG_ARGV[1] = colonne de date de
-- service (ou ''), TG_ARGV[2..] = colonnes à surveiller. Si aucune colonne
-- n'est précisée, toutes les colonnes de la ligne sont comparées.
create or replace function private.tracer_ecriture()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  avant_json jsonb;
  apres_json jsonb;
  colonne text;
  colonnes text[];
  v_avant text;
  v_apres text;
  v_cle text;
  v_date date;
  v_qui text;
begin
  avant_json := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  apres_json := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;

  -- Clé métier lisible : soit l'expression fournie, soit l'id de la ligne.
  v_cle := coalesce(
    (case when tg_op = 'DELETE' then avant_json else apres_json end) ->> tg_argv[0],
    '?'
  );
  -- Une clé composée (date + numéro) est fournie séparée par une virgule.
  if position(',' in tg_argv[0]) > 0 then
    v_cle := '';
    foreach colonne in array string_to_array(tg_argv[0], ',') loop
      v_cle := v_cle
        || case when v_cle = '' then '' else ' ' end
        || coalesce((case when tg_op = 'DELETE' then avant_json else apres_json end) ->> colonne, '?');
    end loop;
  end if;

  if tg_argv[1] <> '' then
    v_date := ((case when tg_op = 'DELETE' then avant_json else apres_json end) ->> tg_argv[1])::date;
  end if;

  -- Email de l'agent : jamais l'uuid brut, qui ne dit rien à l'exploitant.
  -- Il vient de SON JETON, non de `profils` : personne ne peut réécrire une
  -- adresse pour faire imputer ses écritures à un collègue.
  v_qui := private.email_appelant();

  if array_length(tg_argv, 1) > 2 then
    -- TG_ARGV est indexé à partir de 0 : les colonnes surveillées occupent
    -- donc les positions 2 à n-1, pas 3 à n.
    colonnes := tg_argv[2:array_length(tg_argv, 1) - 1];
  else
    colonnes := array(
      select k from jsonb_object_keys(apres_json || avant_json) k
      where k not in ('id', 'maj')
    );
  end if;

  foreach colonne in array colonnes loop
    v_avant := avant_json ->> colonne;
    v_apres := apres_json ->> colonne;
    if v_avant is not distinct from v_apres then
      continue;
    end if;

    -- Valeur JSON (table `params`) : on descend d'un cran pour consigner
    -- « t 8 → 12 » plutôt que l'objet météo entier, illisible au journal.
    if jsonb_typeof(avant_json -> colonne) = 'object'
       or jsonb_typeof(apres_json -> colonne) = 'object' then
      declare
        sous_cle text;
        a_sous text;
        b_sous text;
      begin
        -- On ne concatène que les côtés qui SONT des objets : passer d'un
        -- scalaire à un objet ferait sinon échouer l'opérateur ||.
        foreach sous_cle in array array(
          select k from jsonb_object_keys(
            (case when jsonb_typeof(apres_json -> colonne) = 'object'
                  then apres_json -> colonne else '{}'::jsonb end)
            ||
            (case when jsonb_typeof(avant_json -> colonne) = 'object'
                  then avant_json -> colonne else '{}'::jsonb end)
          ) k
        ) loop
          a_sous := avant_json -> colonne ->> sous_cle;
          b_sous := apres_json -> colonne ->> sous_cle;
          if a_sous is distinct from b_sous then
            insert into public.journal_exploitation
              (qui, table_cible, cle, champ, avant, apres, date_service)
            values (v_qui, tg_table_name, v_cle, sous_cle, a_sous, b_sous, v_date);
          end if;
        end loop;
      end;
    else
      insert into public.journal_exploitation
        (qui, table_cible, cle, champ, avant, apres, date_service)
      values (v_qui, tg_table_name, v_cle, colonne, v_avant, v_apres, v_date);
    end if;
  end loop;

  return null; -- AFTER trigger : la valeur de retour est ignorée
end $fn$;

revoke all on function private.tracer_ecriture() from public;

-- ---------------------------------------------------------------------------
-- 3. Pose des déclencheurs
-- ---------------------------------------------------------------------------
-- Note : tg_argv[0] = clé métier, tg_argv[1] = colonne de date de service,
-- le reste = colonnes surveillées (vide = toutes).

drop trigger if exists trg_journal_circulations on circulations;
create trigger trg_journal_circulations
  after insert or update or delete on circulations
  for each row execute function private.tracer_ecriture(
    'date,numero', 'date',
    'statut', 'retard_min', 'motif', 'rame', 'terminus', 'facultatif_actif', 'sans_voyageurs'
  );

drop trigger if exists trg_journal_jours on jours;
create trigger trg_journal_jours
  after insert or update or delete on jours
  for each row execute function private.tracer_ecriture(
    'date', 'date', 'terminus_bellevue_a_partir_du_train'
  );

drop trigger if exists trg_journal_messages on messages;
create trigger trg_journal_messages
  after insert or update or delete on messages
  for each row execute function private.tracer_ecriture('id', '');

drop trigger if exists trg_journal_medias on medias;
create trigger trg_journal_medias
  after insert or update or delete on medias
  for each row execute function private.tracer_ecriture('id', '');

drop trigger if exists trg_journal_params on params;
create trigger trg_journal_params
  after insert or update or delete on params
  for each row execute function private.tracer_ecriture('cle', '', 'valeur');

drop trigger if exists trg_journal_machines on machines;
create trigger trg_journal_machines
  after insert or update or delete on machines
  for each row execute function private.tracer_ecriture('nom', '');

drop trigger if exists trg_journal_motifs on motifs;
create trigger trg_journal_motifs
  after insert or update or delete on motifs
  for each row execute function private.tracer_ecriture('fr', '');

drop trigger if exists trg_journal_ciels on ciels;
create trigger trg_journal_ciels
  after insert or update or delete on ciels
  for each row execute function private.tracer_ecriture('fr', '');

drop trigger if exists trg_journal_modeles on modeles_messages;
create trigger trg_journal_modeles
  after insert or update or delete on modeles_messages
  for each row execute function private.tracer_ecriture('id', '');

-- ÉCRANS : uniquement ce qui relève de l'exploitation. Le déclencheur est
-- restreint par `update of` ET par la liste de colonnes — les signaux de vie
-- (derniere_vue, donnees_maj, version_app, reseau) ne déclenchent RIEN et ne
-- sont jamais consignés.
-- Grilles : import (INSERT) et activation/désactivation (UPDATE de `actif`).
-- Le contenu — des milliers de caractères — n'est volontairement PAS surveillé.
drop trigger if exists trg_journal_grilles on grilles;
create trigger trg_journal_grilles
  after insert or update or delete on grilles
  for each row execute function private.tracer_ecriture(
    'version', '', 'actif', 'libelle', 'periodes', 'commentaire'
  );

-- COMPTES : nom et activation. La liste des rôles a son propre déclencheur
-- ci-dessous, qui écrit une ligne lisible par rôle accordé ou retiré.
drop trigger if exists trg_journal_profils on profils;
create trigger trg_journal_profils
  after insert or delete or update of nom, actif on profils
  for each row execute function private.tracer_ecriture('email', '', 'nom', 'actif');

-- RÔLES : une ligne par rôle accordé ou retiré, avec l'adresse de la personne
-- concernée en clé — un uuid ne dirait rien à l'exploitant.
create or replace function private.tracer_role()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  cible uuid;
  email_cible text;
  suffixe text := '';
  auteur text;
  role_retire text;
  role_accorde text;
begin
  -- NEW n'est pas assigné sur un DELETE, OLD ne l'est pas sur un INSERT.
  if tg_op = 'DELETE' then
    cible := old.user_id;
    role_retire := old.role;
    auteur := coalesce(private.email_appelant(), 'script');
    if old.source = 'entra' then suffixe := ' (SSO)'; end if;
  else
    cible := new.user_id;
    role_accorde := new.role;
    auteur := coalesce(private.email_appelant(), new.attribue_par, 'script');
    if new.source = 'entra' then suffixe := ' (SSO)'; end if;
  end if;

  select p.email into email_cible from public.profils p where p.user_id = cible;
  insert into public.journal_exploitation (qui, table_cible, cle, champ, avant, apres)
  values (auteur, 'profils_roles', coalesce(email_cible, cible::text),
          'role' || suffixe, role_retire, role_accorde);
  return null;
end $fn$;
revoke all on function private.tracer_role() from public;

drop trigger if exists trg_journal_profils_roles on profils_roles;
create trigger trg_journal_profils_roles after insert or delete on profils_roles
  for each row execute function private.tracer_role();

drop trigger if exists trg_journal_ecrans on ecrans;
create trigger trg_journal_ecrans
  after insert or delete or
    update of veille_debut, veille_fin, gare, type, recharger_demande_at
  on ecrans
  for each row execute function private.tracer_ecriture(
    'id', '', 'veille_debut', 'veille_fin', 'gare', 'type', 'recharger_demande_at'
  );

-- ---------------------------------------------------------------------------
-- 4. Rétention : purge manuelle au-delà de 12 mois
-- ---------------------------------------------------------------------------
-- Volume attendu : quelques dizaines de lignes par jour — sans effet sur
-- l'offre gratuite. À lancer à la main une fois par an :
--     select private.purge_journal_exploitation();          -- 12 mois
--     select private.purge_journal_exploitation(24);        -- 24 mois
-- La fonction retourne le nombre de lignes supprimées.
-- RÉSERVÉE AU RÔLE TECHNIQUE : effacer douze mois de traces n'est pas un geste
-- d'exploitation. Le GRANT EXECUTE reste ouvert (la fonction s'évalue au nom
-- de l'appelant), c'est le corps qui refuse.
create or replace function private.purge_journal_exploitation(mois int default 12)
returns bigint language plpgsql security definer set search_path = '' as $fn$
declare
  supprimees bigint;
begin
  if auth.uid() is not null and not private.a_le_role('technique') then
    raise exception 'La purge du journal est réservée au rôle technique.'
      using errcode = 'insufficient_privilege';
  end if;
  delete from public.journal_exploitation
    where quand < now() - make_interval(months => mois);
  get diagnostics supprimees = row_count;
  return supprimees;
end $fn$;

revoke all on function private.purge_journal_exploitation(int) from public;
grant execute on function private.purge_journal_exploitation(int) to authenticated;

-- ---------------------------------------------------------------- realtime
-- `profils`, `profils_roles` et `roles` restent HORS de la publication :
-- l'annuaire du personnel et ses habilitations n'ont pas à être diffusés.
alter publication supabase_realtime add table jours, circulations, messages,
  medias, params, machines, motifs, ciels, modeles_messages, ecrans, grilles;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('medias', 'medias', true, 20971520,
        array['image/jpeg','image/png','video/mp4'])
on conflict (id) do nothing;

-- Le bucket reste public : les écrans passent par l'URL publique, qui ne
-- traverse pas RLS. La lecture RLS n'est donc utile qu'à l'exploitation
-- (la suppression d'un fichier a besoin de voir l'objet).
create policy "roles: medias lecture" on storage.objects for select to authenticated
  using (bucket_id = 'medias' and (select private.a_un_des_roles(array['admin','supervision'])));
create policy "roles: medias ecriture" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'medias' and (select private.a_un_des_roles(array['admin','supervision'])));
create policy "roles: medias suppression" on storage.objects
  for delete to authenticated
  using (bucket_id = 'medias' and (select private.a_un_des_roles(array['admin','supervision'])));
