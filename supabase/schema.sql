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

-- Lecture : tout compte connecté et actif. Aucune écriture depuis les
-- clients — seul le déclencheur écrit, en SECURITY DEFINER.
drop policy if exists "journal exploitation lecture" on journal_exploitation;
create policy "journal exploitation lecture" on journal_exploitation for select to authenticated
  using (private.role_courant() in ('admin', 'supervision', 'caisse'));

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
  select p.email into v_qui from public.profils p where p.user_id = auth.uid();

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

drop trigger if exists trg_journal_modeles on modeles_messages;
create trigger trg_journal_modeles
  after insert or update or delete on modeles_messages
  for each row execute function private.tracer_ecriture('id', '');

-- ÉCRANS : uniquement ce qui relève de l'exploitation. Le déclencheur est
-- restreint par `update of` ET par la liste de colonnes — les signaux de vie
-- (derniere_vue, donnees_maj, version_app, reseau) ne déclenchent RIEN et ne
-- sont jamais consignés.
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
create or replace function private.purge_journal_exploitation(mois int default 12)
returns bigint language plpgsql security definer set search_path = '' as $fn$
declare
  supprimees bigint;
begin
  delete from public.journal_exploitation
    where quand < now() - make_interval(months => mois);
  get diagnostics supprimees = row_count;
  return supprimees;
end $fn$;

revoke all on function private.purge_journal_exploitation(int) from public;
grant execute on function private.purge_journal_exploitation(int) to authenticated;

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
