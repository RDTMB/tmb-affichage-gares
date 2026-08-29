# Spécification technique v2 — Affichage voyageurs TMB

Version 2.0 — 24 août 2026.

## 1. Architecture

Application web statique unique (Vite + TypeScript vanilla), servie par
GitHub Pages (phase 1) puis par la tour Windows Server 2019 (phase 2).
Toutes les données passent par l'interface `DataProvider` :

```ts
// src/data/provider.ts
export interface DataProvider {
  getGrilles(): Promise<Grille[]>;                       // JSON statiques versionnés
  getJour(date: string): Promise<Jour>;                  // circulations + drapeaux (terminus…)
  getMessages(gare: string): Promise<Message[]>;
  getMedias(gare: string): Promise<Media[]>;             // URLs + durées
  getParams(): Promise<Params>;                          // météo, veille, durées, motifs, machines
  onChange(cb: () => void): () => void;                  // temps réel (unsubscribe retourné)
  heartbeat(e: EcranInfo): Promise<void>;
  // — supervision (session requise) —
  signIn(email: string, mdp: string): Promise<Session>;
  getRole(): Promise<"admin"|"supervision"|"caisse">;
  genererJour(date: string): Promise<void>;
  saveCirculation(c: Circulation): Promise<void>;
  saveCirculations(cs: Circulation[]): Promise<void>;     // action groupée : 1 écriture, lignes écrites contrôlées
  setTerminusBellevue(date: string, v: TerminusFlag): Promise<void>;
  saveMessage(m: Message): Promise<void>; deleteMessage(id: string): Promise<void>;
  uploadMedia(file: File, meta: MediaMeta): Promise<void>; saveMedia(m: Media): Promise<void>; deleteMedia(id: string): Promise<void>;
  saveParams(p: Partial<Params>): Promise<void>;
  saveMachine(m: Machine): Promise<void>; saveMotif(...): Promise<void>;
  listUsers(): Promise<User[]>; saveUser(u: User): Promise<void>;   // admin
  logPublication(resume: string): Promise<void>;
  dernierePublication(): Promise<string | null>;        // référence commune à tous les postes
  listJournal(f: FiltreJournal): Promise<EntreeJournal[]>;  // lecture seule
  listEcrans(): Promise<EcranInfo[]>; demanderRechargement(id: string): Promise<void>;
}
```

`SupabaseProvider` (phase 1) / `ApiProvider` (phase 2), choisis par
`window.TMB_CONFIG` (`public/config.js` généré au build ; `mock` si vide).

## 2. Schéma de données (Supabase / Postgres)

```sql
create table jours (
  date date primary key,
  grille_version text not null,                 -- ex : 2026-ete-grand-service
  terminus_bellevue_a_partir_du_train int,      -- bascule PAR ROTATION (docs/01 §2.3) :
                                                -- numéro de MONTÉE (impair, pair normalisé N−1) ;
                                                -- null = pas de bascule ; 1 = journée entière (hiver)
  genere_le timestamptz default now()
);

create table circulations (
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
                                  -- porté par la MONTÉE : UNIQUE source de vérité pour l'affichage
                                  -- (pré-rempli par la bascule, prioritaire et ajustable) ;
                                  -- descente appariée : départ de Bellevue ; montée express :
                                  -- jamais tronquée, signalée « à traiter » (docs/01 §2.2)
  sans_voyageurs boolean not null default false,
                                  -- course à vide : le train reste piloté en
                                  -- supervision (rame, rotation, terminus) mais
                                  -- n'apparaît sur AUCUN écran (docs/01 §2.2)
  statut text not null default 'ok' check (statut in ('ok','retard','supprime')),
  retard_min int not null default 0 check (retard_min >= 0),
  motif text,
  maj timestamptz not null default now(),
  unique (date, numero)
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  texte_fr text not null,
  texte_en text not null default '',
  cible_type text not null default 'toutes' check (cible_type in ('toutes','gares','train')),
  gares text[],                                  -- si cible_type='gares'
  train_numero int,                              -- si cible_type='train'
  priorite text not null default 'normale' check (priorite in ('normale','importante')),
  actif boolean not null default true,
  expire_at timestamptz,
  cree_par text, cree_le timestamptz not null default now()
);

create table medias (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  type text not null check (type in ('image','video')),
  chemin text not null,                          -- clé Supabase Storage (bucket 'medias')
  duree_s int not null default 8 check (duree_s between 3 and 120),
  gares text[],                                  -- null = toutes
  actif boolean not null default true,
  expire_at timestamptz,
  cree_par text, cree_le timestamptz default now()
);

create table machines (
  nom text primary key, couleur text not null,
  cercle text,                                   -- couleur d'anneau (Marguerite)
  en_service boolean not null default true
);

create table motifs (
  fr text primary key, en text not null default ''
);

create table params (cle text primary key, valeur jsonb not null, maj timestamptz default now());
-- clés : meteo_sommet {t,ciel_fr,ciel_en}, veille_nuit {debut,fin},
--        duree_horaires_s, duree_cache_min,
--        vitesse_ticker_px_s (défilement des messages, en px/s — la durée de
--        l'animation vaut largeur du texte / vitesse ; repli 90 si absente
--        ou aberrante ; niveaux proposés : 60 / 90 / 130 / 180)

-- Bibliothèque de messages préenregistrés bilingues (docs/01 §2.4).
-- Lecture : tout compte connecté ; écriture : admin (comme machines/motifs).
-- Script d'ajout sur base existante : supabase/ajout-modeles.sql (idempotent).
create table modeles_messages (
  id uuid primary key default gen_random_uuid(),
  titre text not null,                          -- unique (index)
  texte_fr text not null,
  texte_en text not null default '',            -- peut rester vide
  categorie text not null default 'Général',
  ordre int not null default 0,
  actif boolean not null default true
);

create table profils (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nom text not null,
  role text not null default 'supervision' check (role in ('admin','supervision','caisse')),
  actif boolean not null default true
);

create table ecrans (
  id text primary key, gare text not null, type text,
  derniere_vue timestamptz,        -- signal de vie : la MACHINE répond
  donnees_maj timestamptz,         -- dernière synchro RÉUSSIE : les DONNÉES affichées sont fraîches
  date_affichee date,              -- journée d'exploitation montrée
  version_app text, reseau text,
  recharger_demande_at timestamptz, -- ordre de rechargement : un HORODATAGE
  veille_debut time, veille_fin time -- nulles = suit params.veille_nuit
);
-- Postes PRÉ-DÉCLARÉS par un admin (id, gare, type) : plus d'INSERT anonyme.
-- L'écran ne fait qu'UPDATE, et seulement sur les colonnes du signal de vie :
--   revoke insert, update, delete, truncate on ecrans from anon;
--   grant update (derniere_vue, donnees_maj, date_affichee, version_app, reseau)
--     on ecrans to anon;
-- Pourquoi un horodatage et non un booléen : un booléen devait être remis à
-- false PAR L'ÉCRAN — écriture désormais refusée, donc rechargement en
-- boucle. L'écran compare la demande à sa propre heure de chargement.
-- Ajouts sur base existante : supabase/ajout-preuve-maj.sql puis
-- supabase/securite-advisors.sql (tous deux rejouables).

create table publications (            -- journal des PUBLICATIONS (résumés)
  id bigint generated always as identity primary key,
  quand timestamptz not null default now(), qui text, resume text not null
);

create table journal_exploitation (    -- journal des ÉCRITURES (champ par champ)
  id bigint generated always as identity primary key,
  quand timestamptz not null default now(),
  qui text,                            -- email de l'agent, résolu depuis profils
  table_cible text not null,
  cle text not null,                   -- id de la ligne, ou « date numéro » de train
  champ text not null,
  avant text, apres text,
  date_service date                    -- journée d'exploitation concernée
);
create index idx_journal_quand on journal_exploitation (quand desc);
create index idx_journal_date_service on journal_exploitation (date_service);
-- Ajout sur base existante : supabase/ajout-journal-exploitation.sql
```

### Journal d'exploitation — alimenté par DÉCLENCHEURS

Le compteur de la barre de publication compare l'état courant à un état de
référence : une valeur posée puis retirée n'y laisse aucune trace (c'est le
bon comportement pour « reste-t-il quelque chose à publier ? »). Mais dès
qu'une écriture a atteint la base, les écrans l'ont affichée — d'où ce
second journal, distinct de `publications`.

`private.tracer_ecriture()` (SECURITY DEFINER, `search_path` vide) est
posée AFTER INSERT/UPDATE/DELETE et écrit **une ligne par champ réellement
modifié** (comparaison OLD/NEW). Rien n'y échappe, pas même une correction
faite directement en SQL depuis le tableau de bord Supabase. Les arguments du
déclencheur portent la clé métier, la colonne de date de service, puis les
colonnes à surveiller.

Tables suivies : `circulations`, `jours` (terminus), `messages`,
`medias`, `params`, `machines`, `motifs`, `modeles_messages`, et
`ecrans` **uniquement** pour `veille_debut`, `veille_fin`, `gare`,
`type` et `recharger_demande_at` — surtout PAS `derniere_vue`,
`donnees_maj`, `version_app` ni `reseau` : 6 écrans × un signal toutes
les 60 s feraient ~8 600 lignes par jour et noieraient le journal.

Cas particulier de `params` : la colonne `valeur` est un JSON, le
déclencheur descend donc d'un cran pour consigner « t 8 → 12 » plutôt que
l'objet météo entier.

RLS : lecture pour tout compte connecté (admin, supervision, caisse) ;
INSERT/UPDATE/DELETE révoqués pour `anon` ET `authenticated` — seul le
déclencheur écrit.

Rétention : `select private.purge_journal_exploitation();` supprime les
entrées de plus de 12 mois (paramètre optionnel : nombre de mois) et retourne
le nombre de lignes supprimées. À lancer à la main ; le volume attendu est de
quelques dizaines de lignes par jour, sans effet sur l'offre gratuite.

### RLS (résumé — livrer le SQL complet dans `supabase/schema.sql`)

- SELECT public (anon) sur : jours, circulations, messages, medias,
  machines, motifs, params, ecrans (les écrans lisent sans compte).
- INSERT/UPDATE/DELETE : `authenticated` avec profil `actif`, en respectant
  le rôle — `caisse` : messages uniquement ; `supervision` : tout sauf
  machines/motifs/params/profils ; `admin` : tout. Implémentation par
  fonction SQL `private.role_courant()` (lit `profils`) utilisée dans les
  policies.
- **Schéma `private`** : les fonctions SECURITY DEFINER
  (`role_courant()`, `sync_rame_descente()`) y vivent, hors des schémas
  exposés par PostgREST — elles ne sont donc PAS appelables en RPC depuis le
  front. `search_path` verrouillé à vide + noms pleinement qualifiés.
  `revoke all … from public`, mais `grant execute … to authenticated` :
  les policies évaluent la fonction AU NOM de l'utilisateur connecté, sans ce
  GRANT toutes les écritures seraient refusées. La fonction de trigger n'a
  besoin d'aucun GRANT (EXECUTE est vérifié à la création du trigger).
- `params` : DEUX politiques permissives, qui se cumulent en OU. Les clés
  d'AFFICHAGE (`meteo_sommet`, `vitesse_ticker_px_s` — onglet Bandeau) sont
  écrivables par admin, supervision ET caisse ; toutes les autres
  (`veille_nuit`, durées, `a_quai_origine_s`…) restent réservées à l'admin.
  Ajout sur base existante : `supabase/ajout-bandeau-veille.sql`.
- `ecrans` : plus aucune écriture anonyme non restreinte. INSERT réservé à
  l'admin (déclaration préalable depuis l'onglet Écrans) ; UPDATE anonyme
  possible mais borné aux colonnes du signal de vie par des GRANT de
  colonnes — `recharger_demande_at`, `id`, `gare` et `type` sont hors
  d'atteinte. Un écran non déclaré n'écrit nulle part.
- Storage : bucket `medias` public (les écrans passent par l'URL publique,
  qui ne traverse pas RLS) ; sur `storage.objects`, plus de policy SELECT
  ouverte à tous — SELECT/INSERT/DELETE réservés à l'exploitation
  authentifiée (la lecture RLS reste nécessaire à la suppression de
  fichier). Taille max 20 Mo.
- Realtime activé sur jours, circulations, messages, medias, params,
  machines, motifs, ecrans ; côté client : un canal + rafraîchissement
  complet, repli polling 30 s.

## 3. Moteur horaires (`src/core/horaires.ts`) — pur, testé

Entrées : grille active (JSON), jour (circulations + terminus), gare, heure
injectée. Fonctions : `serviceActif(date)`, `passagesPourGare`,
`prochaineArrivee`, `compteARebours`, `finDeService` (lit la grille du
lendemain), `positionsTrains`, `appliqueTerminusBellevue` (« à partir du
TRAIN N », docs/01 §2.3), `expressATraiter`, `generationJour(grille,date)`.

Tests Vitest exigés : passages réels (T9 express absent à Voza/Bellevue,
présent à Motivon 10:57), arrivées réelles du document d'exploitation
(repli arret_intermediaire_s si une arrivée manque) et « — » à l'origine,
facultatif masqué/affiché selon `facultatif_actif`, retard décalant tous
les passages, suppression visible puis retirée, terminus Bellevue PAR
ROTATION (« à partir du T19 » : rotations ≥ 19 limitées — montées tronquées,
descentes appariées depuis Bellevue — T15/T16 et T17/T18 strictement
normaux ; « à partir du T1 » = journée entière ; express de la plage
signalé « à traiter », jamais tronqué, sa descente non express partant de
Bellevue ; numéro PAIR normalisé vers N−1 ; état « tronçon fermé » du Nid
d'Aigle), rotation rame montée n → descente n+1, fin de
service, passage de minuit, tri multi-sens.

## 4. Front écrans

- Tokens CSS de la charte dans `src/styles/tokens.css` (valeurs de
  CLAUDE.md) ; polices @fontsource (amaranth, lato) ; logos importés depuis
  `public/logos/` (inline base64 au build via Vite pour l'affichage
  hors-ligne).
- Cycle médias : machine à états horaires⇄média pilotée par `getMedias` +
  `duree_horaires_s` ; `<video muted playsinline>` ; jamais pendant un
  « À QUAI » ≤ 2 min avant départ ; préchargement du média suivant.
- Cache hors-ligne : service worker (précache app + logos + polices,
  network-first pour config.js) ; snapshot données en localStorage ; règle
  des 15 min → écran neutre (docs/01 §7).
- Heartbeat 60 s, et un échec n'interrompt JAMAIS l'affichage : trace
  discrète en console (une fois par cause) et réessai au cycle suivant.
  Rechargement à distance : l'écran compare `recharger_demande_at` à sa
  propre heure de chargement — rien à réécrire, donc aucune boucle.
- Veille nuit ; anti-burn-in 1 px/h ; curseur masqué.

## 5. Supervision

- Supabase Auth email+mdp ; à la connexion, lecture du rôle dans `profils` ;
  onglets/actions filtrés par rôle (et re-vérifiés côté RLS).
- Gestion des utilisateurs (admin) : création via API Supabase (invitation
  email) + ligne `profils` ; désactivation = `actif=false`. Le modèle de
  rôles est extensible (colonne texte + table de droits ultérieure) : v1 =
  admin/supervision/caisse, catégories supplémentaires (gestionnaire,
  lecteur…) définies plus tard avec l'exploitant.
- Cohérence des rotations : la rame est stockée sur la montée ; à la
  lecture, la descente n+1 affiche la rame de la montée n (jointure) ; un
  trigger SQL maintient `rame` de la descente synchronisée pour les exports.
- Suppression et rotations (outillage à l'étape 6, aucun impact moteur en
  étape 1) : la suppression d'une MONTÉE propose la suppression de sa
  descente appariée — proposition par défaut Oui, dérogeable par la
  supervision (la descente peut être maintenue, ex. avec une rame de
  remplacement). Express « à traiter » (bascule Terminus Bellevue,
  docs/01 §2.2–§2.3) : requalification manuelle en omnibus limité à
  Bellevue → sa descente appariée part de Bellevue ; suppression → même
  proposition de suppression de la descente appariée.
- **Traduction automatique des messages** : à la saisie du FR (ou si EN
  vide à l'enregistrement), appel au service de traduction — phase 1 : API
  DeepL Free (500 000 caractères/mois, clé stockée en secret de dépôt,
  appelée via une Edge Function Supabase pour ne pas exposer la clé) avec
  repli sur un dictionnaire local des PHRASES TYPES (apparié sur la phrase
  entière : jamais de substitution mot à mot, qui produirait du franglais ;
  si la phrase est inconnue, `texte_en` reste VIDE et l'écran n'affiche que
  le français — aucun faux anglais n'est fabriqué) ; phase 2 : LibreTranslate
  auto-hébergé sur la tour. Le texte EN reste toujours modifiable.
- Navigation par date : `genererJour(date)` idempotent (n'écrase pas les
  lignes modifiées, upsert sur (date,numero) avec garde).
- Échappement HTML systématique ; textes ≤ 200 caractères ; confirmation
  suppression train et retrait média ; toasts de feedback.

## 6. Déploiement phase 1 (GitHub) — pas à pas pour non-développeur

`docs/mise-en-service.md` (à produire à l'étape 9) détaillera, captures à
l'appui : création de l'organisation GitHub et du dépôt public
`tmb-affichage-gares` ; création du projet Supabase (région eu-west),
exécution de `supabase/schema.sql` puis `supabase/seed.sql` dans l'éditeur
SQL ; activation Realtime et du bucket `medias` ; création des trois
comptes (Thomas admin, Supervision, Caisse) ; saisie des deux variables de
dépôt `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (nouvelle
génération de clés Supabase « sb_publishable_… », équivalent public de
l'ancienne clé anon — voir `supabase/INFOS-PROJET.md`) ; activation de GitHub
Pages ; vérification. Workflow Actions : `npm ci && npm test && npm run
build` → Pages ; échec des tests = pas de déploiement.

### Poste écran Raspberry Pi (`docs/kiosque.md`, étape 9)

Pi OS Lite + Chromium `--kiosk` via systemd (URL de la gare en variable),
`unclutter`, NTP, reboot 04:30, luminosité/HDMI gérés, procédure « échange
standard en 10 minutes » (flasher l'image, brancher, renseigner la gare).
Accès distant optionnel (phase 2 : via VPN Fortinet de la Régie).

## 7. Phase 2 — micro-serveur interne (tour Windows Server 2019)

`server/` dans le même dépôt : Node.js LTS + Fastify + better-sqlite3 +
SSE `/api/events` ; routes miroir du DataProvider ; sessions cookie ;
comptes locaux argon2 **ou SSO Active Directory** : authentification LDAP
(module `ldapts`) contre l'AD de la Régie, mapping groupes AD → rôles
(paramétrable) — l'utilisateur se connecte avec son compte Windows. Sert
`dist/` et les médias (`server/medias/`). Installation en service Windows
via `nssm` (doc `docs/phase2-windows.md` : installation, port 8080,
pare-feu intranet, sauvegarde quotidienne SQLite + médias, import depuis
Supabase, bascule des écrans par `config.js`, retour arrière cloud).
Réseau : gares fibrées en direct ; Nid d'Aigle et accès distant par le VPN
Fortinet existant (paramétrage prestataire) ou WireGuard dédié.

## 8. Qualité / performances

JS < 400 Ko gzippé hors polices/logos ; TTI < 3 s sur Pi ; `tsc --noEmit`
propre ; dépendances front limitées à `@supabase/supabase-js` ;
Chromium ≥ 100 (écrans), navigateurs récents (supervision).
