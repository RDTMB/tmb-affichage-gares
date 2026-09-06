-- =============================================================================
-- TMB — Onglets visibles par rôle, réglables depuis la supervision
--
-- À EXÉCUTER À LA MAIN par l'exploitant, dans l'éditeur SQL Supabase, sur une
-- base DÉJÀ EN SERVICE. D'ABORD la base de TEST, puis la production.
-- Intégré à supabase/schema.sql : une base NEUVE n'a rien à jouer ici.
--
-- REJOUABLE. Chaque objet est créé « if not exists » ou supprimé puis recréé,
-- et le seed est en `on conflict do nothing` : rejouer ce script sur une base
-- déjà à jour ne change rien et ne réécrit AUCUN réglage que l'exploitant
-- aurait modifié depuis.
--
-- ⚠ INVARIANT, le seul point à retenir de ce script : cette table ne peut que
-- RETRANCHER, jamais ÉTENDRE. La matrice droit × rôle (src/core/roles.ts) et
-- les politiques RLS restent le PLAFOND. Le front intersecte ce qu'il lit ici
-- avec ce que les droits ouvrent (`ongletsVisibles()`), si bien qu'une ligne
-- forgée accordant « circulations » à la caisse ne produit RIEN.
--
-- CE N'EST DONC PAS UNE BARRIÈRE DE SÉCURITÉ, c'est du rangement d'interface.
-- Aucune écriture nouvelle ne devient possible ; RLS refuse exactement ce
-- qu'elle refusait avant. Ne jamais s'en servir pour accorder quoi que ce soit.
--
-- CE QUE CE SCRIPT CHANGE POUR DE BON, une seule chose : l'onglet Horaires
-- est masqué pour le rôle CAISSE, décision de l'exploitant du 06/09/2026.
-- Tout le reste est la photographie EXACTE du comportement actuel.
--
-- ⚠ L'ÉDITEUR SQL DE SUPABASE N'AFFICHE PAS LES MESSAGES `notice`.
--    « Success. No rows returned » est le résultat NORMAL d'une migration
--    réussie. La vérification se fait par les requêtes du §5.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. REFUS D'EXÉCUTION si l'état de départ n'est pas celui attendu.
--
--    Le piège du 05/09 : un `create ... if not exists` suivi d'un `insert` qui
--    suppose le schéma complet n'est PAS idempotent — il crée une coquille
--    vide puis échoue au milieu, en laissant la base à moitié migrée. On
--    contrôle donc TOUT ce dont la suite dépend, avant de créer quoi que ce
--    soit : le catalogue des rôles, les quatre codes attendus, la fonction
--    d'identité et la fonction de journal.
-- -----------------------------------------------------------------------------
do $verrou$
declare
  manquants text;
begin
  if to_regclass('public.roles') is null then
    raise exception
      'Migration refusée : la table public.roles est absente. '
      'Jouer d''abord supabase/migrations/2026-09-roles-multiples.sql.';
  end if;

  select string_agg(code, ', ' order by code) into manquants
    from unnest(array['technique','admin','supervision','caisse']) as v(code)
   where not exists (select 1 from public.roles r where r.code = v.code);
  if manquants is not null then
    raise exception
      'Migration refusée : rôles absents du catalogue : %. '
      'Le seed ci-dessous échouerait sur sa clé étrangère.', manquants;
  end if;

  if to_regprocedure('private.email_appelant()') is null then
    raise exception
      'Migration refusée : private.email_appelant() est absente — '
      'l''auteur d''un réglage ne pourrait pas être tracé.';
  end if;

  if to_regprocedure('private.tracer_ecriture()') is null then
    raise exception
      'Migration refusée : private.tracer_ecriture() est absente. '
      'Jouer d''abord supabase/ajout-journal-exploitation.sql : sans elle, '
      'les réglages d''onglets ne laisseraient aucune trace.';
  end if;

  if to_regprocedure('private.interdire_truncate_roles()') is null then
    raise exception
      'Migration refusée : private.interdire_truncate_roles() est absente. '
      'Jouer d''abord supabase/migrations/2026-09-roles-multiples.sql.';
  end if;
end
$verrou$;

begin;

-- -----------------------------------------------------------------------------
-- 2. LA TABLE.
--    Table de LIAISON (une ligne = un rôle × un onglet), et non une colonne
--    `text[]` : RLS s'évalue ligne à ligne, et le journal doit recevoir une
--    ligne par onglet accordé ou masqué.
--
--    AUCUNE LIGNE POUR UN RÔLE = aucun réglage, donc repli sur la matrice du
--    code — et NON « ce rôle ne voit rien ». Sans ce repli, un rôle créé plus
--    tard naîtrait aveugle, et la personne capable de le rouvrir pourrait être
--    justement celle qui le porte.
-- -----------------------------------------------------------------------------
create table if not exists onglets_par_role (
  role text not null references roles(code) on delete cascade,
  onglet text not null check (onglet in (
    'circulations','horaires','bandeau','medias','ecrans',
    'parametres','utilisateurs','journal')),
  regle_le timestamptz not null default now(),
  -- Adresse de l'agent, FORCÉE par déclencheur depuis son jeton.
  regle_par text,
  primary key (role, onglet)
);

alter table onglets_par_role enable row level security;

-- On révoque TOUT, puis on ne rend que le strict nécessaire : Supabase accorde
-- tous les droits de table à anon/authenticated sur une table neuve.
-- Pas d'UPDATE — accorder et masquer sont deux gestes, deux contrôles, deux
-- lignes de journal. `regle_par` n'est pas dans le GRANT d'INSERT : le client
-- ne peut pas la fournir, le déclencheur la pose.
revoke all on onglets_par_role from anon, authenticated;
grant select, delete on onglets_par_role to authenticated;
grant insert (role, onglet) on onglets_par_role to authenticated;

-- -----------------------------------------------------------------------------
-- 3. POLITIQUES.
--    Lecture pour tout compte connecté : chacun a besoin de savoir ce que SES
--    rôles lui montrent, et la table ne dit rien de confidentiel — quels
--    onglets un rôle affiche, pas ce qu'il peut écrire.
--    Écriture au seul rôle technique, comme la veille de nuit globale ou la
--    purge du journal : c'est un réglage d'infrastructure.
-- -----------------------------------------------------------------------------
drop policy if exists "onglets: lecture" on onglets_par_role;
create policy "onglets: lecture" on onglets_par_role for select to authenticated
  using (true);

drop policy if exists "onglets: reglage" on onglets_par_role;
create policy "onglets: reglage" on onglets_par_role for insert to authenticated
  with check ((select private.a_le_role('technique')));

drop policy if exists "onglets: masquage" on onglets_par_role;
create policy "onglets: masquage" on onglets_par_role for delete to authenticated
  using ((select private.a_le_role('technique')));

-- -----------------------------------------------------------------------------
-- 4. GARDE-FOUS — en BASE, et pas seulement dans l'écran : ni RLS ni
--    l'interface ne couvrent `service_role` ni le tableau de bord Supabase.
-- -----------------------------------------------------------------------------

-- (a) IDENTITÉ DE L'AUTEUR, prise dans le jeton. Contrairement à
--     `profils_roles`, une écriture « sans visage » n'a pas à être REVENDIQUÉE
--     par un `set local` : cette table n'accorde aucun droit, elle range une
--     barre de navigation. Exiger le rituel ici serait de la friction sans
--     contrepartie — et le seed du §5 en pâtirait sans rien gagner.
create or replace function private.marquer_reglage_onglet()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  new.regle_par := coalesce(private.email_appelant(), 'script');
  new.regle_le := now();
  return new;
end $fn$;
revoke all on function private.marquer_reglage_onglet() from public;

drop trigger if exists trg_onglets_auteur on onglets_par_role;
create trigger trg_onglets_auteur before insert on onglets_par_role
  for each row execute function private.marquer_reglage_onglet();

-- (b) ANTI-ENFERMEMENT. Le risque propre à ce réglage : masquer l'onglet
--     Utilisateurs à tout le monde et perdre le seul chemin qui permet de le
--     rouvrir — la carte « Onglets visibles par rôle » y vit, et elle demande
--     le droit `parametres.technique`.
--
--     RÈGLE MINIMALE : au moins un rôle capable de rouvrir la porte doit
--     continuer à VOIR l'onglet Utilisateurs. « Voir » a ici exactement le sens
--     de `ongletsVisibles()` côté front — un rôle SANS AUCUNE LIGNE retombe sur
--     la matrice du code, donc voit l'onglet : ce cas ne ferme rien et n'a pas
--     à être refusé. Tout supprimer se soigne donc tout seul ; c'est le réglage
--     PARTIEL qui enferme, et c'est lui seul qu'on refuse.
--
--     Un seul onglet protégé, un seul rôle en pratique : le strict nécessaire
--     pour rouvrir la porte. Depuis Utilisateurs, le technique rétablit tout.
--
--     DIFFÉRÉ + VERROU CONSULTATIF, comme le quorum des rôles : différé pour
--     qu'un échange « masquer ici, accorder là » passe dans une même
--     transaction ; verrouillé pour que deux transactions supprimant chacune
--     l'un des deux derniers accès ne réussissent pas toutes les deux.
create or replace function private.verifier_quorum_onglets()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  -- MIROIR de ROLES_QUI_ROUVRENT (src/core/roles.ts) : les rôles portant
  -- `parametres.technique`. Si un rôle gagne ce droit un jour, l'ajouter ici.
  rouvreurs constant text[] := array['technique'];
  onglet_secours constant text := 'utilisateurs';
  restants int;
begin
  perform pg_advisory_xact_lock(hashtext('tmb.quorum_onglets'));

  select count(*) into restants
    from unnest(rouvreurs) as r(code)
   where not exists (
           select 1 from public.onglets_par_role o where o.role = r.code)
      or exists (
           select 1 from public.onglets_par_role o
            where o.role = r.code and o.onglet = onglet_secours);

  if restants = 0 then
    raise exception
      'Refusé : au moins un rôle capable de rouvrir ce réglage doit garder l''onglet Utilisateurs.'
      using errcode = 'check_violation',
            hint = 'Rendez d''abord l''onglet Utilisateurs à un rôle technique, puis recommencez. Pour tout rouvrir depuis l''éditeur SQL : delete from onglets_par_role where role = ''technique'';';
  end if;
  return null;
end $fn$;
revoke all on function private.verifier_quorum_onglets() from public;

drop trigger if exists trg_onglets_quorum on onglets_par_role;
create constraint trigger trg_onglets_quorum
  after insert or delete on onglets_par_role
  deferrable initially deferred
  for each row execute function private.verifier_quorum_onglets();

-- (c) TRUNCATE ne déclenche aucun déclencheur de LIGNE : il lui faut le sien.
--     Vider la table RESTAURE le comportement du code et n'enferme personne,
--     mais le journal ne verrait rien passer.
drop trigger if exists trg_onglets_pas_de_truncate on onglets_par_role;
create trigger trg_onglets_pas_de_truncate before truncate on onglets_par_role
  execute function private.interdire_truncate_roles();

-- (d) JOURNAL : une ligne par onglet accordé ou masqué, au même titre qu'un
--     changement de rôle. La clé métier « technique horaires » se lit sans
--     décodage.
drop trigger if exists trg_journal_onglets on onglets_par_role;
create trigger trg_journal_onglets
  after insert or delete on onglets_par_role
  for each row execute function private.tracer_ecriture('role,onglet', '');

-- -----------------------------------------------------------------------------
-- 5. SEED — la photographie EXACTE du comportement au 06/09/2026, à une
--    exception près : l'onglet Horaires est masqué pour la CAISSE.
--
--    Calculé depuis la matrice droit × rôle telle qu'elle est dans le code, de
--    sorte que le jour de la bascule ne change RIEN pour personne d'autre.
--
--    ⚠ Conséquence à connaître : ces lignes FIGENT ce que chaque rôle voit. Si
--    un rôle gagne un droit plus tard, l'onglet correspondant n'apparaîtra pas
--    tout seul — sa case deviendra cochable dans la carte, et c'est là que ça
--    se voit. Aucune livraison n'est nécessaire pour autant.
-- -----------------------------------------------------------------------------
insert into onglets_par_role (role, onglet) values
  ('technique', 'horaires'),
  ('technique', 'ecrans'),
  ('technique', 'utilisateurs'),
  ('technique', 'journal'),
  ('admin', 'horaires'),
  ('admin', 'bandeau'),
  ('admin', 'medias'),
  ('admin', 'parametres'),
  ('admin', 'utilisateurs'),
  ('admin', 'journal'),
  ('supervision', 'circulations'),
  ('supervision', 'horaires'),
  ('supervision', 'bandeau'),
  ('supervision', 'medias'),
  ('supervision', 'ecrans'),
  ('supervision', 'journal'),
  ('caisse', 'bandeau'),
  ('caisse', 'medias'),
  ('caisse', 'ecrans'),
  ('caisse', 'journal')
on conflict (role, onglet) do nothing;

commit;

-- -----------------------------------------------------------------------------
-- 6. VÉRIFICATION — 20 lignes attendues, et la caisse SANS « horaires ».
--    C'est la SEULE preuve que la migration a pris : « Success. No rows
--    returned » ci-dessus ne dit rien.
-- -----------------------------------------------------------------------------
select role, string_agg(onglet, ', ' order by onglet) as onglets, count(*) as nb
  from onglets_par_role
 group by role
 order by role;

-- Attendu : 1 ligne, « caisse | horaires masqué ». Zéro ligne = le seed n'a
-- pas pris, ou quelqu'un a déjà rendu l'onglet à la caisse.
select 'caisse' as role, 'horaires masqué' as etat
 where exists (select 1 from onglets_par_role where role = 'caisse')
   and not exists (
     select 1 from onglets_par_role where role = 'caisse' and onglet = 'horaires');

-- -----------------------------------------------------------------------------
-- 7. CONTRE-VÉRIFICATION — les garde-fous sont-ils bien posés ?
--    Résultat attendu : 4 lignes, une par déclencheur.
-- -----------------------------------------------------------------------------
select tgname from pg_trigger
 where tgrelid = 'public.onglets_par_role'::regclass
   and tgname in ('trg_onglets_auteur', 'trg_onglets_quorum',
                  'trg_onglets_pas_de_truncate', 'trg_journal_onglets')
 order by tgname;

-- Et l'écriture reste-t-elle réservée au technique ? Attendu : 2 lignes
-- (« onglets: reglage » et « onglets: masquage »), toutes deux sur technique.
select policyname, coalesce(qual, with_check) as condition
  from pg_policies
 where schemaname = 'public' and tablename = 'onglets_par_role'
   and cmd in ('INSERT', 'DELETE')
 order by policyname;

-- -----------------------------------------------------------------------------
-- 8. ESSAI DU GARDE-FOU — à lancer À PART, il doit ÉCHOUER.
--    Attendu : « Refusé : au moins un rôle capable de rouvrir ce réglage doit
--    garder l'onglet Utilisateurs. » Si cette commande RÉUSSIT, le déclencheur
--    n'est pas en place — et le prochain réglage maladroit enfermera tout le
--    monde dehors.
-- -----------------------------------------------------------------------------
-- begin;
-- delete from onglets_par_role where role = 'technique' and onglet = 'utilisateurs';
-- commit;  -- c'est ICI que le refus tombe : le déclencheur est DIFFÉRÉ.

-- -----------------------------------------------------------------------------
-- 9. EN CAS DE BLOCAGE — la porte de secours.
--    Si plus personne n'atteint l'onglet Utilisateurs, vider les lignes du
--    rôle technique le fait retomber sur la matrice du code, donc tout revoir.
-- -----------------------------------------------------------------------------
-- delete from onglets_par_role where role = 'technique';
