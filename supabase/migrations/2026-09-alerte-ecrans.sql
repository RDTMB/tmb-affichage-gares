-- =============================================================================
-- LE GUETTEUR — alerter quand un écran cesse de donner signe de vie
--
-- À EXÉCUTER À LA MAIN par l'exploitant, dans l'éditeur SQL Supabase, sur le
-- projet de TEST d'abord. Rejouable. Recopié dans supabase/schema.sql pour les
-- nouvelles installations ; src/data/scripts-sql.test.ts compare les deux.
--
-- CE QUI S'EST PASSÉ. Le samedi 19/09/2026, l'écran de Saint-Gervais a affiché
-- « Informations momentanément indisponibles » pendant plus de trois heures.
-- La cause était extérieure au logiciel : la clé du Wi-Fi `TramwayMB` avait
-- changé, le Raspberry n'a pas pu se réassocier, et sans réseau ses données
-- ont péri puis son horloge a dérivé. La base AVAIT l'information — plus aucun
-- `derniere_vue` sur `saint-gervais-ecran-1` à partir de 10 h 40 — et rien ne
-- la regardait. C'est un agent en gare qui l'a découvert.
--
-- CE QUE CE SCRIPT POSE. Une colonne (`ecrans.surveille`), deux tables d'état
-- (`alertes_ecran`, `surveillance_etat`), une clé de réglage
-- (`params.alertes_destinataires`), et la tâche `pg_cron` qui appelle l'Edge
-- Function `alerte-ecrans` toutes les cinq minutes par `pg_net`.
--
-- CE QU'IL NE POSE PAS. Ni la règle de défaut, ni la fenêtre de veille : elles
-- vivent en TypeScript (`src/core/surveillance-ecrans.ts`) et la fonction les
-- applique. Les réécrire ici en ferait une SECONDE énonciation de la même
-- règle, et ce dépôt a déjà payé trois fois pour l'avoir fait. Le SQL ne sait
-- rien de la veille de nuit ; il ne fait que conserver l'état.
--
-- ORDRE DE DÉPLOIEMENT (leçon du 11/09, qui a coûté l'extinction des six
-- écrans le temps de jouer une migration) :
--   1. ce script sur TEST, sections 1 à 6 ;
--   2. les secrets de la fonction, puis son déploiement sur TEST ;
--   3. le coffre et la tâche (sections 7 et 8) sur TEST ;
--   4. la recette (section 9) ;
--   5. seulement ensuite, la fusion de la branche, puis les mêmes étapes en
--      production.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. MESURE PRÉALABLE — LECTURE SEULE. Rien de ce qui suit n'est supposé.
--
--    Les quatre requêtes répondent aux questions dont dépend la suite. Les
--    lancer AVANT le reste et lire les réponses : `pg_cron` et `pg_net` ne
--    sont utilisés nulle part ailleurs dans ce projet, ce script serait le
--    premier.
-- -----------------------------------------------------------------------------

-- a) Les trois extensions nécessaires sont-elles DISPONIBLES, et installées ?
--    `installed_version` à NULL = disponible mais pas encore activée : la
--    section 7 s'en charge. Absente de la liste = le projet ne peut pas les
--    avoir, et tout le mécanisme de déclenchement est à revoir (voir la note
--    en fin de fichier).
select name, default_version, installed_version
from pg_available_extensions
where name in ('pg_cron', 'pg_net', 'supabase_vault')
order by name;

-- b) L'état RÉEL de la table des écrans : combien de postes, combien n'ont
--    JAMAIS donné signe de vie, depuis quand les autres se taisent. C'est ce
--    relevé qui dit si la règle « jamais vu = jamais d'alerte » suffit, ou
--    s'il existe des postes vivants qu'il faudra décocher à la main.
select
  id,
  gare,
  type,
  derniere_vue,
  case
    when derniere_vue is null then 'jamais vu'
    else 'muet depuis ' || date_trunc('second', now() - derniere_vue)::text
  end as silence
from ecrans
order by derniere_vue nulls first;

-- c) La veille de nuit en vigueur : c'est la fenêtre pendant laquelle aucune
--    alerte ne partira.
select valeur from params where cle = 'veille_nuit';

-- d) Une tâche du même nom existe-t-elle déjà ? (Rejouer ce script ne doit pas
--    créer un doublon qui enverrait tout en double.)
select jobid, jobname, schedule, active
from cron.job
where jobname = 'surveillance-ecrans';

-- -----------------------------------------------------------------------------
-- 1. `ecrans.surveille` — la seule façon de dire « ce poste n'est pas censé
--    tourner »
--
--    Sans elle, le Nid d'Aigle — exploité l'été seulement — alerterait chaque
--    jour pendant six mois, et l'alerte cesserait d'être lue. La table ne
--    portait aucune autre colonne capable de l'exprimer : ni `type`, ni
--    `reseau` ne disent si un poste est en service.
--
--    Vrai par défaut : un poste déclaré est un poste qu'on attend. Un défaut à
--    `false` aurait installé la surveillance ÉTEINTE sur toute la flotte
--    existante, ce qui est exactement la situation qu'on répare.
-- -----------------------------------------------------------------------------
alter table ecrans add column if not exists surveille boolean not null default true;

comment on column ecrans.surveille is
  'Faux = poste retiré du service (hors-saison, déposé, en atelier) : le guetteur ne l''alerte plus. Réglable dans Supervision → Écrans.';

-- -----------------------------------------------------------------------------
-- 2. `alertes_ecran` — la mémoire d'un ÉPISODE de panne
--
--    Une ligne par poste actuellement en défaut, et rien d'autre. C'est elle
--    qui empêche la répétition : la tâche tourne toutes les cinq minutes, elle
--    aurait envoyé trente-six courriels pendant la panne de samedi. La ligne
--    disparaît au rétablissement, si bien qu'une seconde panne du même poste
--    est bien une NOUVELLE alerte.
-- -----------------------------------------------------------------------------
create table if not exists alertes_ecran (
  ecran_id text primary key references ecrans (id) on delete cascade,
  -- Dernier signal de vie connu au moment de la détection : c'est l'heure que
  -- le courriel annonce, et la clé qui distingue deux épisodes.
  depuis timestamptz not null,
  detectee_at timestamptz not null default now(),
  -- Envois TENTÉS pour cet épisode. Borné côté fonction (3) : un échec qui se
  -- rejoue toutes les cinq minutes est un journal qui déborde, pas une alerte.
  envois_tentes int not null default 0,
  -- Horodatage de l'envoi RÉUSSI ; NULL = détectée mais jamais dite. C'est ce
  -- qui interdit d'annoncer un rétablissement dont personne n'a connu la panne.
  envoyee_at timestamptz,
  -- Raison COURTE du dernier échec d'envoi, affichée en supervision. Jamais un
  -- corps de réponse brut : il pourrait porter un jeton.
  dernier_echec text
);

alter table alertes_ecran enable row level security;

-- Lecture pour ceux qui voient l'onglet Écrans ; AUCUNE écriture par l'API.
-- Le guetteur écrit avec la clé secrète, qui contourne RLS : il n'a donc
-- besoin d'aucune politique, et n'en avoir aucune ferme la table à tout le
-- reste. Une alerte qu'un compte connecté pourrait effacer ne vaudrait rien.
drop policy if exists "roles: alertes lecture" on alertes_ecran;
create policy "roles: alertes lecture" on alertes_ecran for select to authenticated
  using ((select private.a_un_des_roles(array['technique','admin','supervision','caisse'])));

revoke all on alertes_ecran from anon, authenticated;
grant select on alertes_ecran to authenticated;

-- -----------------------------------------------------------------------------
-- 3. `surveillance_etat` — la preuve que le guetteur a tourné
--
--    UNE ligne, jamais plus (contrainte `check (id)` sur une clé booléenne).
--
--    POURQUOI CETTE TABLE EXISTE. Un `pg_cron` qui ne se déclenche pas
--    ressemble trait pour trait à une flotte en bonne santé : aucun courriel,
--    aucune pastille, rien. C'est le défaut nommé six fois en trois semaines,
--    dont une le 19/09 même — un `corrige-horloge.timer` visait un service
--    `Type=oneshot` avec `RemainAfterExit=yes`, que systemd ne relance jamais :
--    colonne NEXT vide, timer inerte, aucun message.
--
--    Le guetteur écrit ici à CHAQUE passage, qu'il ait ou non quelque chose à
--    dire, et la supervision affiche l'heure. Un contrôle qui ne s'exécute pas
--    ne se distingue pas d'un contrôle qui passe — sauf si on le lui demande.
-- -----------------------------------------------------------------------------
create table if not exists surveillance_etat (
  id boolean primary key default true constraint surveillance_etat_une_ligne check (id),
  derniere_execution timestamptz,
  dernier_resultat text
);

insert into surveillance_etat (id) values (true) on conflict (id) do nothing;

alter table surveillance_etat enable row level security;

drop policy if exists "roles: surveillance lecture" on surveillance_etat;
create policy "roles: surveillance lecture" on surveillance_etat for select to authenticated
  using ((select private.a_un_des_roles(array['technique','admin','supervision','caisse'])));

revoke all on surveillance_etat from anon, authenticated;
grant select on surveillance_etat to authenticated;

-- -----------------------------------------------------------------------------
-- 4. `params.alertes_destinataires` — où va le courriel
--
--    UNE SEULE adresse pour commencer, mais surtout PAS écrite dans le code :
--    « une seule personne sait faire tourner le système » est le risque de
--    fond de ce projet, et une adresse en dur dans un dépôt public le grave
--    dans le marbre. C'est un réglage, il vit donc dans `params` — la seconde
--    adresse s'ajoutera par un `update`, sans refonte et sans déploiement.
--
--    DROITS : aucune politique n'est ajoutée. Les clés inconnues de `params`
--    ne sont ouvertes qu'au rôle `technique` (« roles: params technique »),
--    ce qui est exactement la bonne réponse — la caisse écrit la météo, elle
--    n'a pas à rediriger les alertes de la Régie.
-- -----------------------------------------------------------------------------

-- Une CHECK ne peut pas contenir de sous-requête : la validation passe donc
-- par une fonction IMMUTABLE, seule façon de parcourir un tableau jsonb.
create or replace function private.adresses_alerte_valides(v jsonb)
returns boolean language sql immutable set search_path = '' as $fn$
  select jsonb_typeof(v) = 'array'
     and jsonb_array_length(v) <= 5
     and not exists (
       select 1 from jsonb_array_elements(v) e
       where jsonb_typeof(e) <> 'string'
          or (e #>> '{}') !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
     );
$fn$;

alter table params drop constraint if exists params_alertes_destinataires_forme;
alter table params add constraint params_alertes_destinataires_forme check (
  cle <> 'alertes_destinataires' or private.adresses_alerte_valides(valeur)
);

-- La clé est créée VIDE. L'adresse se pose à la main, juste en dessous : elle
-- n'a pas sa place dans un dépôt public.
insert into params (cle, valeur) values ('alertes_destinataires', '[]'::jsonb)
on conflict (cle) do nothing;

-- À LANCER, en remplaçant l'adresse :
-- update params set valeur = '["ADRESSE-A-REMPLACER@tramwaydumontblanc.fr"]'::jsonb, maj = now()
--   where cle = 'alertes_destinataires';
--
-- Tant que la liste est vide, le guetteur fonctionne et la pastille aussi ;
-- il l'écrit dans `surveillance_etat.dernier_resultat`, que la supervision
-- affiche. L'oubli est donc VISIBLE, il n'est pas silencieux.

-- -----------------------------------------------------------------------------
-- 5. Journal d'exploitation : tracer le RETRAIT d'un poste, pas son silence
--
--    `journal_exploitation` ne consigne que des valeurs changées, et le
--    déclencheur d'`ecrans` énumère les colonnes à surveiller précisément pour
--    ne pas s'y noyer (6 écrans × 60 s = ~8 600 signaux de vie par jour).
--
--    Une ALERTE n'a donc rien à y faire : ce n'est pas une écriture d'agent,
--    c'est une observation de machine, elle vivrait mal à côté de « untel a
--    supprimé le TRAIN 9 ». Elle a sa table.
--    Le RETRAIT d'un poste du service, lui, EST une décision d'agent, et il
--    éteint une surveillance : il rejoint les colonnes déjà tracées.
-- -----------------------------------------------------------------------------
-- Le déclencheur est REMPLACÉ, pas complété : PostgreSQL ne sait pas ajouter
-- une colonne à la liste d'un `update of`. Les six colonnes déjà suivies sont
-- donc recopiées telles quelles — en oublier une la retirerait du journal
-- sans que rien ne le dise.
drop trigger if exists trg_journal_ecrans on public.ecrans;
create trigger trg_journal_ecrans
  after insert or delete or
    update of veille_debut, veille_fin, vitesse_ticker_px_s, gare, type,
      recharger_demande_at, surveille
  on public.ecrans
  for each row execute function private.tracer_ecriture(
    'id', '', 'veille_debut', 'veille_fin', 'vitesse_ticker_px_s', 'gare', 'type',
    'recharger_demande_at', 'surveille'
  );

-- -----------------------------------------------------------------------------
-- 6. VÉRIFICATION des sections 1 à 5 — lecture seule
-- -----------------------------------------------------------------------------
-- select count(*) filter (where surveille) as surveilles, count(*) as total from ecrans;
-- select * from surveillance_etat;
-- select valeur from params where cle = 'alertes_destinataires';
-- -- Les trois refus attendus (à lancer UN PAR UN, chacun doit ÉCHOUER) :
-- update params set valeur = '"pas-un-tableau"'::jsonb where cle = 'alertes_destinataires';
-- update params set valeur = '["sans-arobase"]'::jsonb where cle = 'alertes_destinataires';
-- update params set valeur = '[1, 2]'::jsonb where cle = 'alertes_destinataires';

-- =============================================================================
-- APRÈS LE DÉPLOIEMENT DE L'EDGE FUNCTION SEULEMENT
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 7. Les extensions et le coffre
--
--    `pg_cron` ne vit que dans la base `postgres` d'un projet Supabase ; les
--    lancer depuis l'éditeur SQL du tableau de bord convient.
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- L'URL de la fonction et le secret partagé vivent dans le COFFRE, pas dans ce
-- fichier : l'URL diffère entre le projet de test et la production, et le
-- secret n'a rien à faire dans un dépôt public. Ce script est donc identique
-- sur les deux projets, et c'est le coffre qui les distingue.
--
-- À LANCER UNE FOIS PAR PROJET, en remplaçant les deux valeurs :
-- select vault.create_secret(
--   'https://VOTRE-REF.supabase.co/functions/v1/alerte-ecrans', 'url_alerte_ecrans');
-- select vault.create_secret('LE-MEME-SECRET-QUE-CLE_GUETTEUR', 'cle_guetteur');
--
-- Le second doit valoir EXACTEMENT le secret `CLE_GUETTEUR` posé côté Edge
-- Function (Tableau de bord → Edge Functions → Secrets). C'est le seul verrou
-- de la fonction, qui est déployée sans vérification de jeton : la base n'a
-- pas de session utilisateur à présenter.
--
-- Pour le remplacer plus tard : vault.update_secret(id, nouvelle_valeur).

-- -----------------------------------------------------------------------------
-- 8. Le déclencheur, puis la tâche
--
--    La logique vit dans une FONCTION et non dans la commande de la tâche :
--    corriger un `create or replace` est simple, réécrire une planification
--    l'est moins, et une commande longue dans `cron.job` se relit mal.
--
--    Elle LÈVE si un secret manque. C'est voulu : la levée fait apparaître la
--    tâche en échec dans `cron.job_run_details`, avec son message. Un `return`
--    silencieux aurait donné une tâche verte qui ne fait rien — l'exacte panne
--    muette que ce chantier répare.
-- -----------------------------------------------------------------------------
create or replace function private.declenche_surveillance_ecrans()
returns bigint language plpgsql security definer set search_path = '' as $fn$
declare
  v_url text;
  v_cle text;
  v_requete bigint;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'url_alerte_ecrans';
  select decrypted_secret into v_cle
    from vault.decrypted_secrets where name = 'cle_guetteur';
  if v_url is null or v_cle is null then
    raise exception 'Guetteur : secret absent du coffre (url_alerte_ecrans / cle_guetteur).'
      using errcode = 'invalid_parameter_value',
            hint = 'Voir la section 7 de supabase/migrations/2026-09-alerte-ecrans.sql';
  end if;
  -- `pg_net` est ASYNCHRONE : cet appel rend un identifiant de requête, pas
  -- une réponse. La réponse atterrit dans `net._http_response`. La tâche est
  -- donc « réussie » dès que la requête est mise en file — d'où l'importance
  -- de `surveillance_etat`, que la FONCTION écrit : c'est la seule preuve que
  -- la chaîne entière a marché, et non seulement son premier maillon.
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cle-guetteur', v_cle
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  ) into v_requete;
  return v_requete;
end $fn$;

revoke all on function private.declenche_surveillance_ecrans() from public;

-- Toutes les cinq minutes. Pas plus souvent : le seuil de défaut est de dix
-- minutes, et une tâche plus rapide ne détecterait rien de plus tôt qu'elle.
-- `cron.unschedule` d'abord : rejouer ce script ne doit pas empiler deux
-- tâches, qui enverraient tout en double.
select cron.unschedule('surveillance-ecrans')
where exists (select 1 from cron.job where jobname = 'surveillance-ecrans');

select cron.schedule(
  'surveillance-ecrans',
  '*/5 * * * *',
  $cron$select private.declenche_surveillance_ecrans()$cron$
);

-- -----------------------------------------------------------------------------
-- 9. RECETTE — à jouer sur le projet de TEST, dans cet ordre
--
--    Elle ne prouve rien tant qu'on n'a pas VU les lignes revenir. « La tâche
--    est déclarée » n'est pas « la tâche s'exécute ».
-- -----------------------------------------------------------------------------

-- 9.a  La tâche s'exécute-t-elle VRAIMENT ? (attendre 5 min après la section 8)
-- select jobid, runid, status, return_message, start_time, end_time
-- from cron.job_run_details
-- where jobid = (select jobid from cron.job where jobname = 'surveillance-ecrans')
-- order by start_time desc limit 10;

-- 9.b  La fonction a-t-elle RÉPONDU ? (la réponse de pg_net, pas la tâche)
-- select id, status_code, content_type, left(content::text, 300) as debut, created
-- from net._http_response order by created desc limit 5;

-- 9.c  La chaîne entière a-t-elle marché ? C'est CETTE ligne qui le dit.
-- select derniere_execution, dernier_resultat, now() - derniere_execution as age
-- from surveillance_etat;

-- 9.d  Provoquer une panne : reculer la dernière vue d'un poste de 20 minutes.
--      `derniere_vue` est protégée par `trg_signal_de_vie`, qui la remplace par
--      now() à toute écriture qui la MODIFIE : il faut donc le désarmer le
--      temps du test, et le réarmer juste après. Ne JAMAIS faire cela en
--      production.
-- alter table ecrans disable trigger trg_signal_de_vie;
-- update ecrans set derniere_vue = now() - interval '20 minutes'
--   where id = 'saint-gervais-ecran-1';
-- alter table ecrans enable trigger trg_signal_de_vie;
--
--      Puis, après le passage suivant du guetteur :
-- select * from alertes_ecran;          -- une ligne, envoyee_at renseignée
--      Attendre DEUX passages de plus et relancer : `envois_tentes` doit
--      valoir 1, pas 3. Un seul courriel doit être arrivé.

-- 9.e  Le rétablissement.
-- update ecrans set derniere_vue = now() where id = 'saint-gervais-ecran-1';
-- select * from alertes_ecran;          -- plus aucune ligne, un second courriel

-- 9.f  La veille : même recul de 20 minutes, mais dans la fenêtre de nuit.
-- update ecrans set veille_debut = '00:00', veille_fin = '23:59'
--   where id = 'saint-gervais-ecran-1';
--      (rejouer 9.d) → aucune ligne dans alertes_ecran, aucun courriel.
-- update ecrans set veille_debut = null, veille_fin = null
--   where id = 'saint-gervais-ecran-1';

-- 9.g  Sans clé Brevo : retirer BREVO_API_KEY des secrets de la fonction et
--      rejouer 9.d. La ligne doit apparaître avec `envoyee_at` à NULL et
--      `dernier_echec = 'BREVO_API_KEY absent'`, la fonction répondre 200, et
--      la pastille de la supervision s'afficher quand même.

-- -----------------------------------------------------------------------------
-- SI `pg_cron` OU `pg_net` N'ÉTAIENT PAS DISPONIBLES (section 0.a)
--
-- Tout le reste de ce script tient : les tables, la colonne, la contrainte et
-- la fonction ne dépendent que de PostgreSQL. Seul le DÉCLENCHEMENT serait à
-- reprendre, et la pastille de la supervision — qui ne lit que `ecrans` —
-- continuerait de fonctionner sans rien changer.
-- Le repli serait alors un appel planifié depuis GitHub Actions, écarté ici
-- parce qu'il demande de déposer le secret du guetteur dans un troisième
-- endroit et qu'il ne part PAS avec la base au transfert du chantier 3.
-- -----------------------------------------------------------------------------
