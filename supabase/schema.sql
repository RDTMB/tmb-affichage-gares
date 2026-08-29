-- =============================================================================
-- TMB — Affichage voyageurs : schéma Supabase (phase 1) — docs/02 §2
-- À exécuter dans l'éditeur SQL du projet Supabase, puis seed.sql.
-- Sécurité : lecture publique (clé « publishable », RLS SELECT anon) ;
-- écritures réservées aux profils actifs selon leur rôle (private.role_courant()).
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
  maj timestamptz not null default now(),
  unique (date, numero)
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
  role text not null default 'supervision' check (role in ('admin','supervision','caisse')),
  actif boolean not null default true
);

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

-- ------------------------------------------------- rôle courant + triggers
-- Les fonctions SECURITY DEFINER vivent dans `private`, schéma NON exposé
-- par PostgREST : elles ne sont pas appelables en RPC depuis le front, tout
-- en restant utilisables par les politiques et les triggers. search_path
-- vide + noms pleinement qualifiés (advisors Supabase).
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.role_courant()
returns text language sql stable security definer set search_path = '' as $fn$
  select role from public.profils where user_id = auth.uid() and actif
$fn$;
revoke all on function private.role_courant() from public;
-- INDISPENSABLE : les politiques l'évaluent au nom de l'utilisateur
-- connecté — sans ce GRANT, toute écriture serait refusée.
grant execute on function private.role_courant() to authenticated;

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
alter table modeles_messages enable row level security;
alter table params enable row level security;
alter table profils enable row level security;
alter table ecrans enable row level security;
alter table publications enable row level security;

-- Lecture publique (les écrans lisent sans compte)
create policy "lecture publique" on jours for select using (true);
create policy "lecture publique" on circulations for select using (true);
create policy "lecture publique" on messages for select using (true);
create policy "lecture publique" on medias for select using (true);
create policy "lecture publique" on machines for select using (true);
create policy "lecture publique" on motifs for select using (true);
create policy "lecture publique" on params for select using (true);
create policy "lecture publique" on ecrans for select using (true);

-- Écritures : admin + supervision (exploitation)
create policy "exploitation" on jours for all to authenticated
  using (private.role_courant() in ('admin','supervision'))
  with check (private.role_courant() in ('admin','supervision'));
create policy "exploitation" on circulations for all to authenticated
  using (private.role_courant() in ('admin','supervision'))
  with check (private.role_courant() in ('admin','supervision'));
create policy "exploitation" on medias for all to authenticated
  using (private.role_courant() in ('admin','supervision'))
  with check (private.role_courant() in ('admin','supervision'));

-- Messages : tous les rôles actifs (la caisse ne gère QUE les messages)
create policy "messages tous roles" on messages for all to authenticated
  using (private.role_courant() in ('admin','supervision','caisse'))
  with check (private.role_courant() in ('admin','supervision','caisse'));

-- Paramétrage : admin uniquement
create policy "admin" on machines for all to authenticated
  using (private.role_courant() = 'admin') with check (private.role_courant() = 'admin');
create policy "admin" on motifs for all to authenticated
  using (private.role_courant() = 'admin') with check (private.role_courant() = 'admin');
-- Params : les clés d'AFFICHAGE (onglet Bandeau) sont le quotidien de la
-- caisse — elle doit pouvoir changer une température sans un administrateur.
-- Les deux politiques permissives se cumulent en OU.
create policy "affichage tous roles" on params for all to authenticated
  using (
    cle in ('meteo_sommet', 'vitesse_ticker_px_s')
    and private.role_courant() in ('admin', 'supervision', 'caisse')
  )
  with check (
    cle in ('meteo_sommet', 'vitesse_ticker_px_s')
    and private.role_courant() in ('admin', 'supervision', 'caisse')
  );
create policy "params admin" on params for all to authenticated
  using (private.role_courant() = 'admin') with check (private.role_courant() = 'admin');

-- Bibliothèque de messages : lecture pour tout compte connecté (le
-- formulaire Messages est ouvert à tous les rôles), écriture admin seule.
create policy "lecture connectes" on modeles_messages for select to authenticated
  using (private.role_courant() in ('admin','supervision','caisse'));
create policy "admin" on modeles_messages for all to authenticated
  using (private.role_courant() = 'admin') with check (private.role_courant() = 'admin');

-- Profils : chacun lit son profil ; l'admin lit et gère tout
create policy "lire son profil" on profils for select to authenticated
  using (user_id = auth.uid() or private.role_courant() = 'admin');
create policy "gerer profils" on profils for all to authenticated
  using (private.role_courant() = 'admin') with check (private.role_courant() = 'admin');

-- Écrans : PRÉ-DÉCLARÉS par un administrateur (id, gare, type). L'écran ne
-- fait que donner signe de vie — jamais d'INSERT anonyme, et les colonnes
-- qu'il peut toucher sont verrouillées par des GRANT de colonnes.
revoke insert, update, delete, truncate on ecrans from anon;
grant update (derniere_vue, donnees_maj, date_affichee, version_app, reseau)
  on ecrans to anon;
grant select, insert, update, delete on ecrans to authenticated;

create policy "signal de vie" on ecrans for update to anon
  using (true) with check (true);
create policy "declarer ecran" on ecrans for insert to authenticated
  with check (private.role_courant() = 'admin');
create policy "commande ecran" on ecrans for update to authenticated
  using (private.role_courant() in ('admin','supervision'))
  with check (private.role_courant() in ('admin','supervision'));
-- Retrait d'un poste obsolète : exploitation authentifiée uniquement
create policy "oublier ecran" on ecrans for delete to authenticated
  using (private.role_courant() in ('admin','supervision'));

-- Publications : journal — écrit par tout rôle actif, lu par les connectés
create policy "journal insert" on publications for insert to authenticated
  with check (private.role_courant() in ('admin','supervision','caisse'));
create policy "journal select" on publications for select to authenticated
  using (private.role_courant() in ('admin','supervision','caisse'));

-- ---------------------------------------------------------------- realtime
alter publication supabase_realtime add table jours, circulations, messages,
  medias, params, machines, motifs, modeles_messages, ecrans;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('medias', 'medias', true, 20971520,
        array['image/jpeg','image/png','video/mp4'])
on conflict (id) do nothing;

-- Le bucket reste public : les écrans passent par l'URL publique, qui ne
-- traverse pas RLS. La lecture RLS n'est donc utile qu'à l'exploitation
-- (la suppression d'un fichier a besoin de voir l'objet).
create policy "medias lecture exploitation" on storage.objects for select to authenticated
  using (bucket_id = 'medias' and private.role_courant() in ('admin','supervision'));
create policy "medias ecriture exploitation" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'medias' and private.role_courant() in ('admin','supervision'));
create policy "medias suppression exploitation" on storage.objects
  for delete to authenticated
  using (bucket_id = 'medias' and private.role_courant() in ('admin','supervision'));
