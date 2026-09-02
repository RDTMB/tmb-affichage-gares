# Mise en service (phase 1 — GitHub Pages + Supabase)

Guide pas à pas pour non-développeur. Durée totale : ~45 minutes.
À la fin : les 4 pages sont en ligne, la supervision pilote les écrans.

## A. Le dépôt GitHub (déjà en place)

1. Dépôt public `tmb-affichage-gares` sous l'organisation de la Régie
   (`RDTMB`). Les tests tournent à chaque poussée, sur toutes les branches ;
   seule la branche `main` est mise en ligne (un test rouge = PAS de mise en
   ligne). Une évolution arrive sur `main` par pull request : voir §I.

## B. Créer le projet Supabase (~15 min)

1. https://supabase.com → « New project » : organisation de la Régie,
   nom `tmb-affichage`, mot de passe base de données FORT (à conserver au
   coffre), région **West EU (Paris/Frankfurt)**.
2. Menu **SQL Editor** → « New query » → coller TOUT le contenu de
   `supabase/schema.sql` → **Run**. Aucune erreur attendue.
3. Nouvelle requête → coller `supabase/seed.sql` → **Run** (machines,
   motifs, paramètres, jour de démonstration).
4. Nouvelle requête → coller `supabase/ajout-preuve-maj.sql` → **Run**
   (colonnes de preuve de fraîcheur des écrans — idempotent).
5. Nouvelle requête → coller `supabase/ajout-sans-voyageurs.sql` → **Run**
   (drapeau des courses à vide — idempotent).
6. Nouvelle requête → coller `supabase/securite-advisors.sql` → **Run**
   (correctifs des Security Advisors : schéma `private`, écrans
   pré-déclarés, bucket `medias` refermé — rejouable). Enchaîner avec le
   bloc **VÉRIFICATION** en fin de fichier.
7. Nouvelle requête → coller `supabase/ajout-bandeau-veille.sql` → **Run**
   (veille par écran + droits de l'onglet Bandeau — rejouable). À passer
   APRÈS `securite-advisors.sql`, dont il remplace la politique `params`.
8. Nouvelle requête → coller `supabase/ajout-journal-exploitation.sql` →
   **Run** (journal d'exploitation : table, déclencheurs, RLS, purge —
   rejouable). À passer APRÈS `securite-advisors.sql`, dont il réutilise le
   schéma `private`.
9. Nouvelle requête → coller `supabase/ajout-modeles.sql` → **Run**
   (bibliothèque de messages préenregistrés). Ce script est **idempotent** :
   il peut aussi être exécuté seul, plus tard, sur une base déjà en service,
   sans rejouer le reste ni écraser les modèles retouchés en supervision.
10. Nouvelle requête → coller `supabase/migrations/2026-08-medias-ordre.sql`
    → **Run** (paramètre `mode_medias` — rejouable ; la colonne `ordre` est
    déjà dans le schéma).
11. Nouvelle requête → coller `supabase/migrations/2026-08-params-forme.sql`
    → **Run** (contraintes de forme sur `params`, correctif C-01 —
    rejouable). Le script commence par des requêtes de vérification qui
    doivent renvoyer 0 ligne : sur une base neuve alimentée par `seed.sql`,
    c'est le cas.
12. Nouvelle requête → coller `supabase/ajout-ciels.sql` → **Run** (états du
    ciel du sélecteur météo — idempotent). Sans lui, la table `ciels` manque
    et TOUS les écrans restent neutres (la table avait été créée à la main en
    production le 31/08/2026, sans script dans le dépôt).
13. Nouvelle requête → coller `supabase/ajout-grilles.sql` → **Run**
    (grilles horaires en base, avec les deux grilles été 2026 — idempotent).
    À passer en DERNIER : il s'appuie sur le schéma `private` et sur le
    journal d'exploitation.

    Les deux autres scripts du dossier `supabase/migrations/`
    (`2026-08-signal-de-vie-serveur.sql`, `2026-08-train-supplementaire.sql`)
    sont déjà intégrés à `schema.sql` : inutiles sur une base neuve,
    rejouables sans risque sur une base ancienne. Ordre vérifié par relecture
    des scripts le 02/09/2026 ; le projet de test (§H) sert à le confirmer
    avant toute production.

14. Menu **Storage** : vérifier que le bucket `medias` existe (créé par le
    schéma), public, limite 20 Mo.
15. Menu **Database → Replication** (ou **Realtime**) : vérifier que la
    publication `supabase_realtime` contient bien les tables (fait par le
    schéma).
16. Menu **Project Settings → API keys** : noter
   - l'**URL du projet** (https://xxxx.supabase.co) ;
   - la clé **publishable** (`sb_publishable_…`) — PUBLIQUE par conception,
     la sécurité repose sur RLS ;
   - ⚠ la clé **secret** (`sb_secret_…`) ne doit JAMAIS être copiée dans le
     dépôt ni dans le front (voir `supabase/INFOS-PROJET.md`).

## C. Les trois comptes (~10 min)

1. Menu **Authentication → Users → Add user → Create new user** (trois
   fois), avec les adresses réelles des agents : `prenom.nom@exemple.fr`
   (administrateur), `<compte-supervision>`, `<compte-caisse>`,
   avec mots de passe provisoires (cocher « Auto Confirm User »).
2. **SQL Editor** — relier les comptes aux rôles :

```sql
insert into profils (user_id, nom, email, role)
select id, 'Prénom Nom', email, 'admin' from auth.users
  where email = 'prenom.nom@exemple.fr'
on conflict (user_id) do update set role = 'admin', actif = true;
-- répéter avec role = 'supervision' puis role = 'caisse' pour les 2 autres
```

3. (Option, plus tard) Créer les suivants directement depuis
   Supervision → Paramètres → « + Ajouter un utilisateur » — nécessite le
   déploiement des Edge Functions (étape E).

## D. Brancher le site sur Supabase (~5 min)

1. GitHub → dépôt → **Settings → Secrets and variables → Actions →
   Variables** → « New repository variable » :
   - `VITE_SUPABASE_URL` = l'URL du projet ;
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = la clé `sb_publishable_…`.
2. GitHub → **Settings → Pages** → Source : **GitHub Actions**.
3. Onglet **Actions** → relancer le workflow « Déploiement GitHub Pages »
   (bouton « Run workflow »). À la fin, l'URL est affichée :
   `https://<organisation>.github.io/tmb-affichage-gares/`.
4. Sans variables, le déploiement est **refusé** par le workflow : un écran
   de gare sans source de données afficherait des horaires fictifs (le mode
   démonstration n'existe que sur le poste de développement, §H).

## E. Edge Functions (traduction + invitations) (~10 min, poste avec la CLI)

```bash
npm i -g supabase
supabase login
supabase link --project-ref <ref-du-projet>
supabase functions deploy traduire
supabase functions deploy inviter-utilisateur
supabase secrets set DEEPL_API_KEY=<clé DeepL Free>
```

Sans ces fonctions, la supervision fonctionne quand même : la traduction
replie sur le dictionnaire local et la création d'utilisateur se fait
depuis le tableau de bord Supabase (étape C).

## F. Vérifications finales

- [ ] `…/index.html` : portail, 6 gares listées.
- [ ] `…/ecran.html?gare=saint-gervais` : horaires réels, horloge à l'heure.
- [ ] `…/grille.html?gare=saint-gervais` : tableaux montée/descente.
- [ ] `…/supervision.html` : connexion admin OK ; retarder un train →
      l'écran l'affiche en ≤ 2 s.
- [ ] Compte caisse : seul l'onglet Messages est visible.
- [ ] Écriture anonyme rejetée : depuis un terminal,
      `curl -X POST "https://xxxx.supabase.co/rest/v1/messages" -H "apikey: sb_publishable_…" -H "Content-Type: application/json" -d "{\"texte_fr\":\"test\"}"`
      doit répondre **401/403** (RLS).
- [ ] `git grep sb_secret` ne renvoie rien.
- [ ] **Écrans déclarés** : Supervision → Écrans → déclarer chaque poste
      (gare + type) AVANT de le mettre en service. Un écran non déclaré
      affiche correctement les horaires mais reste invisible en supervision.
- [ ] **Security Advisors** (Supabase → Advisors) : plus aucun avertissement
      « anonymous write », « SECURITY DEFINER » ni « function search path ».
- [ ] Débrancher le réseau d'un écran 3 min : badge « données de HH:MM » ;
      voir aussi `docs/tests-manuels.md`.

## G. Écrans en gare

Suivre `docs/kiosque.md` (Raspberry Pi, kiosque Chromium, échange standard).

## H. Poste de développement et projet Supabase de test

Un second projet Supabase (par exemple `tmb-affichage-test`) sert à rejouer
les scripts et à essayer une évolution avant la production. On le monte
exactement comme en §B et §C : mêmes scripts, même ordre, des comptes de
test. Sur le poste de développement, `public/config.js` désigne ce projet :

```js
// public/config.js — poste de développement, projet Supabase de TEST.
// Fichier IGNORÉ par git (.gitignore) : ne JAMAIS le committer ni le copier
// dans le dépôt. Il ne contient que la clé « publishable » (publique par
// conception), jamais la clé « secret ».
window.TMB_CONFIG = {
  supabaseUrl: 'https://<ref-du-projet-de-test>.supabase.co',
  supabaseKey: 'sb_publishable_<clé publishable du projet de test>',
};
```

`npm run dev` sert alors les quatre pages branchées sur la base de test ;
sans ce fichier, tout tourne en mode démonstration (mock, sans réseau). Avant
chaque commit, `git status` ne doit jamais lister `public/config.js`.

## I. Mise en ligne d'une évolution

Une évolution se prépare sur une branche (`chantier-…`), se teste sur le
projet de test (§H), puis arrive sur `main` par pull request. Le rituel,
toujours dans cet ordre :

1. **Scripts SQL sur la base de production**, dans l'ordre indiqué par la
   pull request (les nouveaux scripts sont aussi ajoutés au §B). Toujours
   AVANT le code : l'ancien front ignore une table qu'il ne connaît pas,
   alors que le nouveau front échouerait sans elle. Enchaîner avec le bloc
   VÉRIFICATION de chaque script.
2. **Fusion de la pull request** sur GitHub, tests verts obligatoires.
3. **Déploiement automatique** : onglet Actions, workflow « Tests et
   déploiement GitHub Pages ». À la fin, l'URL de production sert la
   nouvelle version.
4. **Ctrl+F5 sur la Supervision** (rechargement complet, sans cache), puis
   vérification : connexion, onglet concerné par l'évolution, une
   modification d'essai annulée aussitôt.
5. **« Recharger » les écrans** depuis Supervision → Écrans, à un moment
   calme (aucun départ dans les cinq minutes) : chaque poste recharge la
   nouvelle version à son prochain signal de vie (moins d'une minute). Sans
   cette étape, les écrans gardent l'ancienne version jusqu'au redémarrage
   de 4 h 30.

### Protection de la branche `main`

GitHub → dépôt → **Settings → Rules → Rulesets → New branch ruleset** (ou
Settings → Branches → règle classique) sur `main` :

- **Require a pull request before merging** : la PR est obligatoire, même
  pour un administrateur (0 approbation tant que l'équipe est réduite,
  1 dès qu'un second développeur existe) ;
- **Require status checks to pass** : le job `build` du workflow, avec
  **Require branches to be up to date before merging** ;
- **Block force pushes** et **Restrict deletions** ;
- ne pas cocher « Allow bypass » pour les administrateurs : la règle vaut
  pour tout le monde.
