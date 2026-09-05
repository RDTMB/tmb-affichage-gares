-- =============================================================================
-- TMB — AJOUT de la table `ciels` (états du ciel proposés pour la météo)
-- À exécuter dans l'éditeur SQL d'une base DÉJÀ en service : idempotent,
-- n'écrase aucune donnée existante (un état déjà présent est conservé tel
-- quel). Intégré à supabase/schema.sql pour les nouvelles installations.
--
-- POURQUOI. Depuis le 31/08/2026 (« l'état du ciel devient une LISTE, plus du
-- texte libre »), le front lit et écrit la table `ciels` — getParams() pour
-- les écrans et la supervision, onglet Paramètres pour l'administrateur —
-- mais aucun script SQL du dépôt ne la créait. Un projet monté en suivant
-- docs/mise-en-service.md n'avait donc pas la table, et getParams() échouait
-- (« relation ciels does not exist ») : écran neutre partout. Constaté le
-- 02/09/2026 en préparant le projet Supabase de test.
--
-- Même modèle que `motifs` : lecture publique (les écrans affichent l'état du
-- ciel), écriture réservée à l'administrateur, temps réel, journal
-- d'exploitation.
-- =============================================================================

-- Transactionnel : un échec en cours de route ne doit jamais laisser une
-- table sans politique d'écriture (les politiques sont supprimées avant
-- d'être recréées).
begin;

create table if not exists ciels (
  fr text primary key,
  en text not null default '',
  ordre int not null default 0          -- ordre d'affichage dans la liste
);

alter table ciels enable row level security;

-- Politiques (rejouables) — toujours qualifiées `private.`, jamais un appel nu
-- (la fonction publique a été retirée par securite-advisors.sql). Depuis le
-- chantier « rôles multiples », l'habilitation se lit avec
-- `private.a_le_role()` : voir supabase/migrations/2026-09-roles-multiples.sql.
drop policy if exists "lecture publique" on ciels;
create policy "lecture publique" on ciels for select using (true);
drop policy if exists "roles: ciels" on ciels;
create policy "roles: ciels" on ciels for all to authenticated
  using ((select private.a_le_role('admin'))) with check ((select private.a_le_role('admin')));

-- Temps réel (ajout idempotent : ignore l'erreur si la table y est déjà)
do $$
begin
  alter publication supabase_realtime add table ciels;
exception
  when duplicate_object then null;
end $$;

-- Journal d'exploitation : une ligne par champ modifié, comme les motifs.
-- Posé seulement si le déclencheur existe (base passée par
-- ajout-journal-exploitation.sql ou par le schema.sql complet).
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname = 'tracer_ecriture'
  ) then
    drop trigger if exists trg_journal_ciels on ciels;
    create trigger trg_journal_ciels
      after insert or update or delete on ciels
      for each row execute function private.tracer_ecriture('fr', '');
  end if;
end $$;

-- Liste initiale, identique à la démonstration (src/data/mock.ts) : les
-- états déjà retouchés en supervision ne sont pas modifiés.
insert into ciels (fr, en, ordre) values
  ('Dégagé',     'Clear',    10),
  ('Ensoleillé', 'Sunny',    20),
  ('Nuageux',    'Cloudy',   30),
  ('Couvert',    'Overcast', 40),
  ('Pluie',      'Rain',     50),
  ('Neige',      'Snow',     60),
  ('Brouillard', 'Fog',      70)
on conflict (fr) do nothing;

commit;

-- =============================================================================
-- VÉRIFICATION — à exécuter APRÈS le script.
-- =============================================================================
--
-- (a) La liste est là, dans l'ordre :
--     select fr, en, ordre from ciels order by ordre;      -- 7 lignes
--
-- (b) Les écrans lisent, un compte non administrateur n'écrit pas :
--     set local role anon;
--     select count(*) from ciels;                            -- 7
--     insert into ciels (fr, en) values ('Grêle', 'Hail');   -- refusé (RLS)
--     reset role;
--
-- (c) Dans la supervision, onglet Bandeau : le sélecteur « Ciel » propose
--     les sept états ; onglet Paramètres (admin) : ajout d'un état, qui
--     apparaît aussitôt dans le sélecteur.
