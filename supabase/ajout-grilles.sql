-- =============================================================================
-- TMB — Grilles horaires en BASE (table `grilles`) — chantier « import des
-- horaires depuis l'Excel exploitation », étape 1.
-- À exécuter dans l'éditeur SQL d'une base DÉJÀ en service : idempotent,
-- rejouable, n'écrase aucune grille existante. Intégré à supabase/schema.sql
-- pour les nouvelles installations. À passer APRÈS securite-advisors.sql
-- (schéma `private`) et ajout-journal-exploitation.sql (déclencheur du
-- journal) — voir docs/mise-en-service.md §B.
--
-- POURQUOI. Les grilles étaient deux fichiers JSON du dépôt que seul un
-- développeur pouvait changer. Elles deviennent des DONNÉES : un agent
-- d'exploitation charge une nouvelle grille depuis l'Excel exploitation, dans
-- la Supervision, avec aperçu et retour arrière. Une seule source de vérité :
-- cette table. Les JSON restent dans le dépôt comme référence historique.
--
-- RÈGLES (docs/01 §2.1, src/core/horaires.ts serviceActif) :
--   - une grille ne s'applique qu'à ses périodes (bornes incluses) ;
--   - seules les grilles ACTIVES comptent ; désactiver = retour arrière ;
--   - si deux grilles actives couvrent la même date, la plus RÉCEMMENT créée
--     (cree_le) l'emporte ;
--   - une version n'est JAMAIS réécrite : réimporter crée « …-v2 ».
-- =============================================================================

-- Transactionnel : un échec en cours de route ne doit jamais laisser une
-- table sans politique d'écriture (les politiques sont supprimées avant
-- d'être recréées).
begin;

create table if not exists grilles (
  version text primary key,               -- ex : 2026-ete-grand-service, 2026-2027-hiver
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

alter table grilles enable row level security;

-- Lecture pour tous : les écrans lisent sans compte.
drop policy if exists "lecture publique" on grilles;
create policy "lecture publique" on grilles for select using (true);
-- Écriture : technique, admin et supervision (import, activation) — jamais la
-- caisse. Les grilles sont PARTAGÉES entre l'informatique et l'exploitation :
-- un horaire corrigé un matin de service ne doit pas attendre le prestataire
-- (supabase/migrations/2026-09-roles-multiples.sql).
drop policy if exists "roles: grilles" on grilles;
create policy "roles: grilles" on grilles for all to authenticated
  using ((select private.a_un_des_roles(array['technique','admin','supervision'])))
  with check ((select private.a_un_des_roles(array['technique','admin','supervision'])));

-- Temps réel : une activation doit atteindre les écrans en quelques secondes.
do $$
begin
  alter publication supabase_realtime add table grilles;
exception
  when duplicate_object then null;
end $$;

-- Journal d'exploitation : import (INSERT) et activation/désactivation
-- (UPDATE de actif) laissent une trace par champ. Le contenu (des milliers de
-- caractères) n'est volontairement PAS surveillé.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname = 'tracer_ecriture'
  ) then
    drop trigger if exists trg_journal_grilles on grilles;
    create trigger trg_journal_grilles
      after insert or update or delete on grilles
      for each row execute function private.tracer_ecriture(
        'version', '', 'actif', 'libelle', 'periodes', 'commentaire'
      );
  end if;
end $$;

-- ------------------------------------------------ grilles été 2026
-- Générées depuis public/grilles/*.json (eux-mêmes issus du document
-- d'exploitation du 05/06/2026). `on conflict do nothing` : relancer le
-- script ne touche pas une grille déjà présente, même désactivée.

insert into grilles (version, libelle, source, periodes, contenu, actif, cree_par, commentaire)
values (
  '2026-ete-grand-service',
  'Grand service — été 2026',
  'Horaires été 2026 — version EXPLOITATION (arrivées et départs), mise à jour du 05/06/2026',
  $json$[{"du":"2026-07-04","au":"2026-08-30"}]$json$::jsonb,
  $json${"version":"2026-ete-grand-service","libelle":"Grand service — été 2026","source":"Horaires été 2026 — version EXPLOITATION (arrivées et départs), mise à jour du 05/06/2026","periodes":[{"du":"2026-07-04","au":"2026-08-30"}],"gares":[{"id":"le-fayet","nom":"Le Fayet","altitude_m":580},{"id":"saint-gervais","nom":"Saint-Gervais","altitude_m":786},{"id":"motivon","nom":"Motivon","altitude_m":1375},{"id":"col-de-voza","nom":"Col de Voza","altitude_m":1653},{"id":"bellevue","nom":"Bellevue","altitude_m":1794},{"id":"nid-daigle","nom":"Nid d'Aigle","altitude_m":2412}],"arret_intermediaire_s":60,"note_arrets":"Les arrivées viennent désormais du document d'exploitation. arret_intermediaire_s ne sert que de repli si une arrivée manque.","regles":{"express":"ne dessert ni col-de-voza ni bellevue (passages absents) ; picto motrice + mention bilingue","facultatif":"opéré selon météo et affluence, confirmé au plus tard la veille au soir ; n'apparaît sur les écrans que s'il est activé en supervision","velos":"train accessible aux vélos (5 max, selon affluence)","mont-lachat":"halte de SERVICE non desservie : volontairement absente des grilles et des écrans"},"montees":[{"numero":1,"express":false,"facultatif":false,"velos":true,"passages":[{"gare":"le-fayet","d":"07:00:00"},{"gare":"saint-gervais","a":"07:10:00","d":"07:15:00"},{"gare":"motivon","a":"07:26:30","d":"07:27:30"},{"gare":"col-de-voza","a":"07:40:30","d":"07:42:30"},{"gare":"bellevue","a":"07:47:30","d":"07:49:30"},{"gare":"nid-daigle","a":"08:05:30"}]},{"numero":3,"express":false,"facultatif":true,"velos":true,"passages":[{"gare":"le-fayet","d":"08:00:00"},{"gare":"saint-gervais","a":"08:10:00","d":"08:15:00"},{"gare":"motivon","a":"08:26:30","d":"08:27:30"},{"gare":"col-de-voza","a":"08:40:30","d":"08:42:30"},{"gare":"bellevue","a":"08:47:30","d":"08:49:30"},{"gare":"nid-daigle","a":"09:05:30"}]},{"numero":5,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"le-fayet","d":"09:00:00"},{"gare":"saint-gervais","a":"09:10:00","d":"09:15:00"},{"gare":"motivon","a":"09:26:30","d":"09:27:30"},{"gare":"col-de-voza","a":"09:40:30","d":"09:42:30"},{"gare":"bellevue","a":"09:47:30","d":"09:49:30"},{"gare":"nid-daigle","a":"10:05:30"}]},{"numero":7,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"le-fayet","d":"10:00:00"},{"gare":"saint-gervais","a":"10:10:00","d":"10:15:00"},{"gare":"motivon","a":"10:26:30","d":"10:27:30"},{"gare":"col-de-voza","a":"10:40:30","d":"10:42:30"},{"gare":"bellevue","a":"10:47:30","d":"10:49:30"},{"gare":"nid-daigle","a":"11:05:30"}]},{"numero":9,"express":true,"facultatif":true,"velos":false,"passages":[{"gare":"le-fayet","d":"10:30:00"},{"gare":"saint-gervais","a":"10:40:00","d":"10:45:00"},{"gare":"motivon","a":"10:56:30","d":"10:57:30"},{"gare":"nid-daigle","a":"11:30:30"}]},{"numero":11,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"le-fayet","d":"11:00:00"},{"gare":"saint-gervais","a":"11:10:00","d":"11:15:00"},{"gare":"motivon","a":"11:26:30","d":"11:27:30"},{"gare":"col-de-voza","a":"11:40:30","d":"11:42:30"},{"gare":"bellevue","a":"11:47:30","d":"11:49:30"},{"gare":"nid-daigle","a":"12:05:30"}]},{"numero":13,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"le-fayet","d":"12:00:00"},{"gare":"saint-gervais","a":"12:10:00","d":"12:15:00"},{"gare":"motivon","a":"12:26:30","d":"12:27:30"},{"gare":"col-de-voza","a":"12:40:30","d":"12:42:30"},{"gare":"bellevue","a":"12:47:30","d":"12:49:30"},{"gare":"nid-daigle","a":"13:05:30"}]},{"numero":15,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"le-fayet","d":"13:00:00"},{"gare":"saint-gervais","a":"13:10:00","d":"13:15:00"},{"gare":"motivon","a":"13:26:30","d":"13:27:30"},{"gare":"col-de-voza","a":"13:40:30","d":"13:42:30"},{"gare":"bellevue","a":"13:47:30","d":"13:49:30"},{"gare":"nid-daigle","a":"14:05:30"}]},{"numero":17,"express":true,"facultatif":true,"velos":false,"passages":[{"gare":"le-fayet","d":"13:30:00"},{"gare":"saint-gervais","a":"13:40:00","d":"13:45:00"},{"gare":"motivon","a":"13:56:30","d":"13:57:30"},{"gare":"nid-daigle","a":"14:30:30"}]},{"numero":19,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"le-fayet","d":"14:00:00"},{"gare":"saint-gervais","a":"14:10:00","d":"14:15:00"},{"gare":"motivon","a":"14:26:30","d":"14:27:30"},{"gare":"col-de-voza","a":"14:40:30","d":"14:42:30"},{"gare":"bellevue","a":"14:47:30","d":"14:49:30"},{"gare":"nid-daigle","a":"15:05:30"}]},{"numero":21,"express":false,"facultatif":false,"velos":true,"passages":[{"gare":"le-fayet","d":"15:00:00"},{"gare":"saint-gervais","a":"15:10:00","d":"15:15:00"},{"gare":"motivon","a":"15:26:30","d":"15:27:30"},{"gare":"col-de-voza","a":"15:40:30","d":"15:42:30"},{"gare":"bellevue","a":"15:47:30","d":"15:49:30"},{"gare":"nid-daigle","a":"16:05:30"}]},{"numero":23,"express":true,"facultatif":true,"velos":false,"passages":[{"gare":"le-fayet","d":"15:30:00"},{"gare":"saint-gervais","a":"15:40:00","d":"15:45:00"},{"gare":"motivon","a":"15:56:30","d":"15:57:30"},{"gare":"nid-daigle","a":"16:30:30"}]},{"numero":25,"express":false,"facultatif":false,"velos":true,"passages":[{"gare":"le-fayet","d":"16:00:00"},{"gare":"saint-gervais","a":"16:10:00","d":"16:15:00"},{"gare":"motivon","a":"16:26:30","d":"16:27:30"},{"gare":"col-de-voza","a":"16:40:30","d":"16:42:30"},{"gare":"bellevue","a":"16:47:30","d":"16:49:30"},{"gare":"nid-daigle","a":"17:05:30"}]}],"descentes":[{"numero":2,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"nid-daigle","d":"08:13:30"},{"gare":"bellevue","a":"08:31:30","d":"08:33:30"},{"gare":"col-de-voza","a":"08:39:30","d":"08:41:30"},{"gare":"motivon","a":"08:56:30","d":"08:57:30"},{"gare":"saint-gervais","a":"09:11:30","d":"09:13:30"},{"gare":"le-fayet","a":"09:24:30"}]},{"numero":4,"express":false,"facultatif":true,"velos":false,"passages":[{"gare":"nid-daigle","d":"09:13:30"},{"gare":"bellevue","a":"09:31:30","d":"09:33:30"},{"gare":"col-de-voza","a":"09:39:30","d":"09:41:30"},{"gare":"motivon","a":"09:56:30","d":"09:57:30"},{"gare":"saint-gervais","a":"10:11:30","d":"10:13:30"},{"gare":"le-fayet","a":"10:24:30"}]},{"numero":6,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"nid-daigle","d":"10:13:30"},{"gare":"bellevue","a":"10:31:30","d":"10:33:30"},{"gare":"col-de-voza","a":"10:39:30","d":"10:41:30"},{"gare":"motivon","a":"10:56:30","d":"10:57:30"},{"gare":"saint-gervais","a":"11:11:30","d":"11:13:30"},{"gare":"le-fayet","a":"11:24:30"}]},{"numero":8,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"nid-daigle","d":"11:13:30"},{"gare":"bellevue","a":"11:31:30","d":"11:33:30"},{"gare":"col-de-voza","a":"11:39:30","d":"11:41:30"},{"gare":"motivon","a":"11:56:30","d":"11:57:30"},{"gare":"saint-gervais","a":"12:11:30","d":"12:13:30"},{"gare":"le-fayet","a":"12:24:30"}]},{"numero":10,"express":true,"facultatif":true,"velos":false,"passages":[{"gare":"nid-daigle","d":"11:48:30"},{"gare":"motivon","a":"12:27:30","d":"12:28:30"},{"gare":"saint-gervais","a":"12:42:30","d":"12:44:30"},{"gare":"le-fayet","a":"12:55:30"}]},{"numero":12,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"nid-daigle","d":"12:13:30"},{"gare":"bellevue","a":"12:31:30","d":"12:33:30"},{"gare":"col-de-voza","a":"12:39:30","d":"12:41:30"},{"gare":"motivon","a":"12:56:30","d":"12:57:30"},{"gare":"saint-gervais","a":"13:11:30","d":"13:13:30"},{"gare":"le-fayet","a":"13:24:30"}]},{"numero":14,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"nid-daigle","d":"13:13:30"},{"gare":"bellevue","a":"13:31:30","d":"13:33:30"},{"gare":"col-de-voza","a":"13:39:30","d":"13:41:30"},{"gare":"motivon","a":"13:56:30","d":"13:57:30"},{"gare":"saint-gervais","a":"14:11:30","d":"14:13:30"},{"gare":"le-fayet","a":"14:24:30"}]},{"numero":16,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"nid-daigle","d":"14:13:30"},{"gare":"bellevue","a":"14:31:30","d":"14:33:30"},{"gare":"col-de-voza","a":"14:39:30","d":"14:41:30"},{"gare":"motivon","a":"14:56:30","d":"14:57:30"},{"gare":"saint-gervais","a":"15:11:30","d":"15:13:30"},{"gare":"le-fayet","a":"15:24:30"}]},{"numero":18,"express":true,"facultatif":true,"velos":false,"passages":[{"gare":"nid-daigle","d":"14:48:30"},{"gare":"motivon","a":"15:27:30","d":"15:28:30"},{"gare":"saint-gervais","a":"15:42:30","d":"15:44:30"},{"gare":"le-fayet","a":"15:55:30"}]},{"numero":20,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"nid-daigle","d":"15:13:30"},{"gare":"bellevue","a":"15:31:30","d":"15:33:30"},{"gare":"col-de-voza","a":"15:39:30","d":"15:41:30"},{"gare":"motivon","a":"15:56:30","d":"15:57:30"},{"gare":"saint-gervais","a":"16:11:30","d":"16:13:30"},{"gare":"le-fayet","a":"16:24:30"}]},{"numero":22,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"nid-daigle","d":"16:13:30"},{"gare":"bellevue","a":"16:31:30","d":"16:33:30"},{"gare":"col-de-voza","a":"16:39:30","d":"16:41:30"},{"gare":"motivon","a":"16:56:30","d":"16:57:30"},{"gare":"saint-gervais","a":"17:11:30","d":"17:13:30"},{"gare":"le-fayet","a":"17:24:30"}]},{"numero":24,"express":false,"facultatif":true,"velos":false,"passages":[{"gare":"nid-daigle","d":"16:48:30"},{"gare":"bellevue","a":"17:06:30","d":"17:08:30"},{"gare":"col-de-voza","a":"17:14:30","d":"17:16:30"},{"gare":"motivon","a":"17:31:30","d":"17:32:30"},{"gare":"saint-gervais","a":"17:46:30","d":"17:48:30"},{"gare":"le-fayet","a":"17:59:30"}]},{"numero":26,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"nid-daigle","d":"17:13:30"},{"gare":"bellevue","a":"17:31:30","d":"17:33:30"},{"gare":"col-de-voza","a":"17:39:30","d":"17:41:30"},{"gare":"motivon","a":"17:56:30","d":"17:57:30"},{"gare":"saint-gervais","a":"18:11:30","d":"18:13:30"},{"gare":"le-fayet","a":"18:24:30"}]}]}$json$::jsonb,
  true,
  'ajout-grilles.sql (import initial)',
  'Grille officielle été 2026, reprise du fichier JSON du dépôt (docs/grilles-historique/).'
)
on conflict (version) do nothing;

insert into grilles (version, libelle, source, periodes, contenu, actif, cree_par, commentaire)
values (
  '2026-ete-petit-service',
  'Petit service — été 2026',
  'Horaires été 2026 — version EXPLOITATION (arrivées et départs), mise à jour du 05/06/2026',
  $json$[{"du":"2026-06-13","au":"2026-07-03"},{"du":"2026-08-31","au":"2026-09-27"}]$json$::jsonb,
  $json${"version":"2026-ete-petit-service","libelle":"Petit service — été 2026","source":"Horaires été 2026 — version EXPLOITATION (arrivées et départs), mise à jour du 05/06/2026","periodes":[{"du":"2026-06-13","au":"2026-07-03"},{"du":"2026-08-31","au":"2026-09-27"}],"gares":[{"id":"le-fayet","nom":"Le Fayet","altitude_m":580},{"id":"saint-gervais","nom":"Saint-Gervais","altitude_m":786},{"id":"motivon","nom":"Motivon","altitude_m":1375},{"id":"col-de-voza","nom":"Col de Voza","altitude_m":1653},{"id":"bellevue","nom":"Bellevue","altitude_m":1794},{"id":"nid-daigle","nom":"Nid d'Aigle","altitude_m":2412}],"arret_intermediaire_s":60,"note_arrets":"Les arrivées viennent désormais du document d'exploitation. arret_intermediaire_s ne sert que de repli si une arrivée manque.","regles":{"express":"ne dessert ni col-de-voza ni bellevue (passages absents) ; picto motrice + mention bilingue","facultatif":"opéré selon météo et affluence, confirmé au plus tard la veille au soir ; n'apparaît sur les écrans que s'il est activé en supervision","velos":"train accessible aux vélos (5 max, selon affluence)","mont-lachat":"halte de SERVICE non desservie : volontairement absente des grilles et des écrans"},"montees":[{"numero":1,"express":false,"facultatif":false,"velos":true,"passages":[{"gare":"le-fayet","d":"07:00:00"},{"gare":"saint-gervais","a":"07:10:00","d":"07:15:00"},{"gare":"motivon","a":"07:26:30","d":"07:27:30"},{"gare":"col-de-voza","a":"07:40:30","d":"07:42:30"},{"gare":"bellevue","a":"07:47:30","d":"07:49:30"},{"gare":"nid-daigle","a":"08:05:30"}]},{"numero":5,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"le-fayet","d":"09:00:00"},{"gare":"saint-gervais","a":"09:10:00","d":"09:15:00"},{"gare":"motivon","a":"09:26:30","d":"09:27:30"},{"gare":"col-de-voza","a":"09:40:30","d":"09:42:30"},{"gare":"bellevue","a":"09:47:30","d":"09:49:30"},{"gare":"nid-daigle","a":"10:05:30"}]},{"numero":7,"express":false,"facultatif":true,"velos":false,"passages":[{"gare":"le-fayet","d":"10:00:00"},{"gare":"saint-gervais","a":"10:10:00","d":"10:15:00"},{"gare":"motivon","a":"10:26:30","d":"10:27:30"},{"gare":"col-de-voza","a":"10:40:30","d":"10:42:30"},{"gare":"bellevue","a":"10:47:30","d":"10:49:30"},{"gare":"nid-daigle","a":"11:05:30"}]},{"numero":11,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"le-fayet","d":"11:00:00"},{"gare":"saint-gervais","a":"11:10:00","d":"11:15:00"},{"gare":"motivon","a":"11:26:30","d":"11:27:30"},{"gare":"col-de-voza","a":"11:40:30","d":"11:42:30"},{"gare":"bellevue","a":"11:47:30","d":"11:49:30"},{"gare":"nid-daigle","a":"12:05:30"}]},{"numero":13,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"le-fayet","d":"12:00:00"},{"gare":"saint-gervais","a":"12:10:00","d":"12:15:00"},{"gare":"motivon","a":"12:26:30","d":"12:27:30"},{"gare":"col-de-voza","a":"12:40:30","d":"12:42:30"},{"gare":"bellevue","a":"12:47:30","d":"12:49:30"},{"gare":"nid-daigle","a":"13:05:30"}]},{"numero":15,"express":false,"facultatif":true,"velos":false,"passages":[{"gare":"le-fayet","d":"13:00:00"},{"gare":"saint-gervais","a":"13:10:00","d":"13:15:00"},{"gare":"motivon","a":"13:26:30","d":"13:27:30"},{"gare":"col-de-voza","a":"13:40:30","d":"13:42:30"},{"gare":"bellevue","a":"13:47:30","d":"13:49:30"},{"gare":"nid-daigle","a":"14:05:30"}]},{"numero":19,"express":false,"facultatif":false,"velos":true,"passages":[{"gare":"le-fayet","d":"14:00:00"},{"gare":"saint-gervais","a":"14:10:00","d":"14:15:00"},{"gare":"motivon","a":"14:26:30","d":"14:27:30"},{"gare":"col-de-voza","a":"14:40:30","d":"14:42:30"},{"gare":"bellevue","a":"14:47:30","d":"14:49:30"},{"gare":"nid-daigle","a":"15:05:30"}]},{"numero":21,"express":false,"facultatif":false,"velos":true,"passages":[{"gare":"le-fayet","d":"15:00:00"},{"gare":"saint-gervais","a":"15:10:00","d":"15:15:00"},{"gare":"motivon","a":"15:26:30","d":"15:27:30"},{"gare":"col-de-voza","a":"15:40:30","d":"15:42:30"},{"gare":"bellevue","a":"15:47:30","d":"15:49:30"},{"gare":"nid-daigle","a":"16:05:30"}]}],"descentes":[{"numero":2,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"nid-daigle","d":"08:13:30"},{"gare":"bellevue","a":"08:31:30","d":"08:33:30"},{"gare":"col-de-voza","a":"08:39:30","d":"08:41:30"},{"gare":"motivon","a":"08:56:30","d":"08:57:30"},{"gare":"saint-gervais","a":"09:11:30","d":"09:13:30"},{"gare":"le-fayet","a":"09:24:30"}]},{"numero":6,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"nid-daigle","d":"10:13:30"},{"gare":"bellevue","a":"10:31:30","d":"10:33:30"},{"gare":"col-de-voza","a":"10:39:30","d":"10:41:30"},{"gare":"motivon","a":"10:56:30","d":"10:57:30"},{"gare":"saint-gervais","a":"11:11:30","d":"11:13:30"},{"gare":"le-fayet","a":"11:24:30"}]},{"numero":8,"express":false,"facultatif":true,"velos":false,"passages":[{"gare":"nid-daigle","d":"11:13:30"},{"gare":"bellevue","a":"11:31:30","d":"11:33:30"},{"gare":"col-de-voza","a":"11:39:30","d":"11:41:30"},{"gare":"motivon","a":"11:56:30","d":"11:57:30"},{"gare":"saint-gervais","a":"12:11:30","d":"12:13:30"},{"gare":"le-fayet","a":"12:24:30"}]},{"numero":12,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"nid-daigle","d":"12:13:30"},{"gare":"bellevue","a":"12:31:30","d":"12:33:30"},{"gare":"col-de-voza","a":"12:39:30","d":"12:41:30"},{"gare":"motivon","a":"12:56:30","d":"12:57:30"},{"gare":"saint-gervais","a":"13:11:30","d":"13:13:30"},{"gare":"le-fayet","a":"13:24:30"}]},{"numero":14,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"nid-daigle","d":"13:13:30"},{"gare":"bellevue","a":"13:31:30","d":"13:33:30"},{"gare":"col-de-voza","a":"13:39:30","d":"13:41:30"},{"gare":"motivon","a":"13:56:30","d":"13:57:30"},{"gare":"saint-gervais","a":"14:11:30","d":"14:13:30"},{"gare":"le-fayet","a":"14:24:30"}]},{"numero":16,"express":false,"facultatif":true,"velos":false,"passages":[{"gare":"nid-daigle","d":"14:13:30"},{"gare":"bellevue","a":"14:31:30","d":"14:33:30"},{"gare":"col-de-voza","a":"14:39:30","d":"14:41:30"},{"gare":"motivon","a":"14:56:30","d":"14:57:30"},{"gare":"saint-gervais","a":"15:11:30","d":"15:13:30"},{"gare":"le-fayet","a":"15:24:30"}]},{"numero":20,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"nid-daigle","d":"15:13:30"},{"gare":"bellevue","a":"15:31:30","d":"15:33:30"},{"gare":"col-de-voza","a":"15:39:30","d":"15:41:30"},{"gare":"motivon","a":"15:56:30","d":"15:57:30"},{"gare":"saint-gervais","a":"16:11:30","d":"16:13:30"},{"gare":"le-fayet","a":"16:24:30"}]},{"numero":22,"express":false,"facultatif":false,"velos":false,"passages":[{"gare":"nid-daigle","d":"16:13:30"},{"gare":"bellevue","a":"16:31:30","d":"16:33:30"},{"gare":"col-de-voza","a":"16:39:30","d":"16:41:30"},{"gare":"motivon","a":"16:56:30","d":"16:57:30"},{"gare":"saint-gervais","a":"17:11:30","d":"17:13:30"},{"gare":"le-fayet","a":"17:24:30"}]}]}$json$::jsonb,
  true,
  'ajout-grilles.sql (import initial)',
  'Grille officielle été 2026, reprise du fichier JSON du dépôt (docs/grilles-historique/).'
)
on conflict (version) do nothing;

commit;

-- =============================================================================
-- VÉRIFICATION — à exécuter APRÈS le script.
-- =============================================================================
--
-- (a) Les deux grilles sont là, actives, avec leurs périodes :
--     select version, libelle, actif, periodes, cree_le from grilles order by cree_le;
--
-- (b) Le contenu est complet (13 + 13 trains en grand service, 8 + 8 en petit) :
--     select version,
--            jsonb_array_length(contenu -> 'montees')   as montees,
--            jsonb_array_length(contenu -> 'descentes') as descentes
--       from grilles;
--
-- (c) Un anonyme lit, n'écrit pas :
--     set local role anon;
--     select count(*) from grilles;                               -- 2
--     update grilles set actif = false where version like '2026-%'; -- 0 ligne (RLS)
--     reset role;
--
-- (d) Le journal trace une désactivation puis une réactivation (admin) :
--     update grilles set actif = false where version = '2026-ete-petit-service';
--     update grilles set actif = true  where version = '2026-ete-petit-service';
--     select quand, table_cible, cle, champ, avant, apres
--       from journal_exploitation where table_cible = 'grilles' order by quand desc limit 4;
--
-- (e) Un contenu mal formé est refusé :
--     insert into grilles (version, libelle, contenu) values ('test', 'x', '{}'::jsonb);
--     -> violation de grilles_contenu_forme
