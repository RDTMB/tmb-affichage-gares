-- =============================================================================
-- AFFLUENCE — « Complet » et « Dernières places » par train et par jour
--
-- À EXÉCUTER À LA MAIN par l'exploitant, dans l'éditeur SQL Supabase, sur le
-- projet de TEST d'abord. Rejouable. Déjà recopié dans supabase/schema.sql
-- pour les nouvelles installations.
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
  using ((select private.a_un_des_roles(array['admin', 'supervision', 'caisse'])))
  with check ((select private.a_un_des_roles(array['admin', 'supervision', 'caisse'])));

-- Supabase accorde par défaut TOUS les droits de table à anon et
-- authenticated : on retire tout, puis on ne rend que le nécessaire. Les deux
-- colonnes de signature sont posées par le déclencheur ci-dessous et ne sont
-- accordées à personne — même stance que `profils_roles.attribue_par`.
-- Pas d'UPDATE sur (date, numero) non plus : changer l'un des deux désignerait
-- un AUTRE train, ce qui est une suppression suivie d'une déclaration.
revoke all on affluence from anon, authenticated;
grant select on affluence to anon, authenticated;
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
