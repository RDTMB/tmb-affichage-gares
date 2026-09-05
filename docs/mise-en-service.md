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

14. Nouvelle requête → coller
    `supabase/migrations/2026-09-roles-multiples.sql` → **Run** (rôles
    multiples et cumulables : catalogue `roles`, table `profils_roles`,
    garde-fous). À passer **en dernier** : il recrée les politiques de tous
    les scripts précédents. Sur une base NEUVE, `schema.sql` contient déjà
    tout : le script n'a alors rien à reprendre et le signale.

    ⚠ **Avant de l'exécuter**, deux gestes :

    1. Passer `supabase/diagnostic-roles.sql` — LECTURE SEULE, il n'écrit
       rien — et lire son VERDICT en dernière ligne. Il dit exactement où en
       est la base : tables et colonnes présentes, fonctions, déclencheurs,
       politiques restées sur l'ancien modèle, et surtout les tables qui se
       retrouveraient SANS politique d'écriture.
    2. Vérifier le §0 en tête du fichier de migration : il porte l'adresse du
       compte qui recevra le rôle « technique ». Sur le projet de test,
       remplacer par l'adresse d'un compte qui y existe RÉELLEMENT. Si
       l'adresse est introuvable, le script s'annule tout entier plutôt que de
       laisser une base sans aucun compte technique — que plus personne ne
       pourrait alors débloquer depuis l'application.

    **Si le diagnostic annonce « ÉTAT PARTIEL »**, c'est qu'une exécution
    précédente s'est interrompue. Deux voies :

    - **rejouer simplement la migration** : elle sait repartir d'un état
      partiel. Chaque table est créée PUIS alignée colonne par colonne, les
      fonctions sont supprimées avant d'être recréées, et les rôles déjà
      attribués ne sont jamais réattribués. C'est la voie normale, et la SEULE
      en production ;
    - **repartir de zéro**, réservé à la base de TEST :
      `supabase/migrations/2026-09-roles-multiples-remise-a-zero.sql` puis, SANS
      RIEN FAIRE ENTRE LES DEUX, la migration. Le premier script efface les
      politiques d'écriture sans les remplacer : entre les deux, la base
      n'accepte plus aucune écriture d'exploitation. Il refuse de s'exécuter
      tant qu'on n'a pas décommenté sa ligne de confirmation.

    Le rejeu de la migration est lui-même un contrôle : relancée en entier,
    elle doit se terminer sans erreur et annoncer « Reprise ignorée ».

    ⚠ **L'éditeur SQL de Supabase ne garantit pas la transaction.** Constaté le
    05/09/2026 : il valide les instructions une à une, de sorte qu'un `begin;`
    ne protège pas le script d'un échec en cours de route (c'est ce qui avait
    laissé la base de test à moitié migrée au premier essai, et ce qui fait
    disparaître une table temporaire d'une instruction à l'autre). Deux
    conséquences pratiques :

    - les scripts du chantier n'utilisent AUCUNE table temporaire et placent
      leurs refus AVANT la moindre modification : quand ils s'arrêtent, ils
      n'ont rien changé ;
    - en cas d'interruption malgré tout, **relancer le script entier** est la
      bonne réaction : il est idempotent, il reprend là où il en est. Le
      diagnostic dira ce qu'il en est avant et après.

    Enchaîner avec le bloc VÉRIFICATION en fin de fichier, puis, sur le projet
    de test uniquement, avec `supabase/tests/roles-rls.sql` : cette recette
    rejoue toute la matrice des droits et se termine par un `rollback`, elle
    ne laisse donc aucune trace.

    Les deux autres scripts du dossier `supabase/migrations/`
    (`2026-08-signal-de-vie-serveur.sql`, `2026-08-train-supplementaire.sql`)
    sont déjà intégrés à `schema.sql` : inutiles sur une base neuve,
    rejouables sans risque sur une base ancienne. Ordre vérifié par relecture
    des scripts le 02/09/2026 ; le projet de test (§H) sert à le confirmer
    avant toute production.

    ⚠ **Ne jamais rejouer une copie ANTÉRIEURE à septembre 2026** de
    `securite-advisors.sql` ou d'un `ajout-*.sql` : elle réinstallerait le
    modèle à rôle unique. Les scripts du dépôt à jour, eux, sont rejouables.

15. Menu **Storage** : vérifier que le bucket `medias` existe (créé par le
    schéma), public, limite 20 Mo.
16. Menu **Database → Replication** (ou **Realtime**) : vérifier que la
    publication `supabase_realtime` contient bien les tables (fait par le
    schéma).
17. Menu **Project Settings → API keys** : noter
   - l'**URL du projet** (https://xxxx.supabase.co) ;
   - la clé **publishable** (`sb_publishable_…`) — PUBLIQUE par conception,
     la sécurité repose sur RLS ;
   - ⚠ la clé **secret** (`sb_secret_…`) ne doit JAMAIS être copiée dans le
     dépôt ni dans le front (voir `supabase/INFOS-PROJET.md`).

## C. Les premiers comptes (~10 min)

Les rôles sont MULTIPLES et CUMULABLES (docs/01 §5.5) : une même personne peut
être à la fois chef d'exploitation et responsable informatique, une autre l'un
sans l'autre.

1. Menu **Authentication → Users → Add user → Create new user**, avec les
   adresses réelles des agents et des mots de passe provisoires (cocher
   « Auto Confirm User »). Au minimum : le compte qui portera **technique +
   admin**, un compte **supervision**, un compte **caisse**.
2. **SQL Editor** — créer les profils, puis leur attribuer leurs rôles.
   Une attribution faite depuis l'éditeur SQL doit être REVENDIQUÉE
   (`tmb.attribution_systeme`) : c'est ce qui empêche une écriture sans
   utilisateur connecté d'accorder un rôle en douce. Remplacer les adresses,
   puis exécuter d'un seul bloc :

```sql
begin;
  set local tmb.attribution_systeme = 'secours';

  -- Les profils (le nom s'affiche dans l'en-tête de la supervision)
  insert into profils (user_id, nom, email)
  select id, 'Prénom Nom', email from auth.users
    where email in ('prenom.nom@exemple.fr', 'supervision@exemple.fr', 'caisse@exemple.fr')
  on conflict (user_id) do update set actif = true;

  -- Les rôles, un par ligne : le premier compte en cumule trois
  insert into profils_roles (user_id, role)
  select p.user_id, r.role
    from profils p
    join auth.users u on u.id = p.user_id
    join (values
      ('prenom.nom@exemple.fr',   'technique'),
      ('prenom.nom@exemple.fr',   'admin'),
      ('prenom.nom@exemple.fr',   'supervision'),
      ('supervision@exemple.fr',  'supervision'),
      ('caisse@exemple.fr',       'caisse')
    ) as r(email, role) on lower(r.email) = lower(u.email)
  on conflict do nothing;
commit;

-- Contrôle : qui porte quoi
select p.email, p.actif, array_agg(pr.role order by pr.role) as roles
  from profils p left join profils_roles pr using (user_id)
 group by p.email, p.actif order by p.email;
```

   ⚠ Il doit TOUJOURS rester au moins un compte actif « technique » et un
   compte actif « admin » : la base refuse de retirer, de désactiver ou de
   supprimer le dernier, y compris depuis le tableau de bord. Procédure de
   secours si cela arrivait quand même (compte banni, départ non préparé) :
   `docs/securite.md` §2, qui donne la commande exacte.

3. (Option, plus tard) Créer les suivants directement depuis
   Supervision → Paramètres → « + Ajouter un utilisateur » — nécessite le
   déploiement des Edge Functions (étape E) **et** les adresses de retour
   du point 4 ci-dessous.
4. **Authentication → URL Configuration** — indispensable pour que les
   liens reçus par e-mail (invitation, « mot de passe oublié ») ramènent
   sur la supervision et non sur une page 404 :
   - **Site URL** : `https://<organisation>.github.io/tmb-affichage-gares/supervision.html`
   - **Redirect URLs** (une ligne chacune) :
     `https://<organisation>.github.io/tmb-affichage-gares/**` et
     `http://localhost:5173/**` (poste de développement, §H).

   La personne invitée clique sur le lien, arrive sur la supervision qui lui
   fait **choisir son mot de passe** (12 caractères minimum, comme l'annonce
   `docs/securite.md` §4), puis entre
   directement. Elle se connectera ensuite avec e-mail + mot de passe. Le
   bouton « Réinitialiser le mot de passe » de l'onglet Paramètres suit le
   même chemin.

   > Lien « expiré ou déjà utilisé » alors que la personne vient de le
   > recevoir : sa messagerie (Outlook / Microsoft 365 « Liens fiables »,
   > antivirus) a probablement pré-ouvert le lien à sa place, ce qui
   > consomme le jeton à usage unique. Renvoyer une invitation et ouvrir le
   > lien directement depuis le message (pas depuis un aperçu) ; si le
   > problème persiste, définir un mot de passe provisoire depuis
   > Authentication → Users et le transmettre par un autre canal.
   > Rappel : sans SMTP personnalisé, Supabase n'envoie que **2 e-mails par
   > heure** (Authentication → Emails → SMTP Settings pour relever la limite).

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

## E. Edge Functions (traduction + invitations) (~10 min)

⚠ **Ne pas installer la CLI avec `npm i -g supabase`** : Supabase refuse cette
installation globale (« Installing Supabase CLI as a global module is not
supported »). On la lance sans rien installer durablement, avec `npx`.

Sur le poste de développement, node vit dans un dossier portable absent du
PATH. Plutôt que de modifier le PATH — ce qui ne vaut que pour la fenêtre
courante et se perd d'une session à l'autre —, on appelle `npx` par son
CHEMIN COMPLET : la commande marche alors partout, tout le temps.

À coller dans **PowerShell**, une commande à la fois. La première n'est qu'un
raccourci pour ne pas répéter le chemin :

```powershell
$npx = "$env:LOCALAPPDATA\nodejs-portable\node-v24.19.0-win-x64\npx.cmd"
& $npx supabase login
& $npx supabase link --project-ref <ref-du-projet>
& $npx supabase functions deploy traduire
& $npx supabase functions deploy inviter-utilisateur
& $npx supabase functions deploy supprimer-utilisateur
& $npx supabase secrets set DEEPL_API_KEY=<clé DeepL Free>
```

⚠ Les six lignes doivent être tapées dans **la même fenêtre** : `$npx` ne
survit pas à sa fermeture. Si PowerShell répond « le terme npx n'est pas
reconnu », c'est que la première ligne n'a pas été jouée dans cette fenêtre-là.
Pour lever le doute :

```powershell
& "$env:LOCALAPPDATA\nodejs-portable\node-v24.19.0-win-x64\npx.cmd" --version
```

Un numéro de version s'affiche : tout est en place. Sinon, c'est que node
portable n'est pas là où on le croit.

`npx` propose d'abord de télécharger la CLI : répondre oui. `login` ouvre le
navigateur pour autoriser le poste. `link` demande le mot de passe de la base,
celui du coffre.

Une fonction se déploie **une par une** : `functions deploy` sans nom déploie
tout le dossier d'un coup, ce qui est plus rapide mais moins lisible en cas
d'erreur. Les TROIS doivent y passer — `supprimer-utilisateur` était absente
de cette procédure alors que la supervision l'appelle depuis toujours.

**Sans CLI du tout** : le tableau de bord Supabase sait aussi déployer une
fonction (menu Edge Functions → *Deploy a new function* → *Via editor*), en
collant le contenu du fichier `supabase/functions/<nom>/index.ts`. C'est
fastidieux pour trois fonctions, et à refaire à chaque modification, mais cela
dépanne.

**Et si on ne les déploie pas maintenant ?** La supervision fonctionne quand
même : la traduction replie sur le dictionnaire local, et la création comme la
suppression de comptes se font depuis le tableau de bord (étape C). Seules
l'invitation par e-mail et la suppression définitive depuis l'interface
attendent ces fonctions. Toute la mécanique des rôles — badges, cases à
cocher, attribution, garde-fous — s'éprouve sans elles.

## F. Vérifications finales

- [ ] `…/index.html` : portail, 6 gares listées.
- [ ] `…/ecran.html?gare=saint-gervais` : horaires réels, horloge à l'heure.
- [ ] `…/grille.html?gare=saint-gervais` : tableaux montée/descente.
- [ ] `…/supervision.html` : connexion admin OK ; retarder un train →
      l'écran l'affiche en ≤ 2 s.
- [ ] Pastille de l'en-tête : « PRODUCTION » en rouge sur le vrai projet,
      « BASE DE TEST » en jaune sur le projet d'essai (§H).
- [ ] Compte caisse : seuls les onglets Bandeau et Horaires sont visibles, et
      les horaires en lecture (aucun bouton « Charger un fichier Excel »).
- [ ] Compte supervision : Circulations, Horaires, Bandeau, Médias, Écrans —
      mais ni « Déclarer un poste », ni la veille de nuit globale.
- [ ] Compte technique : Horaires, Écrans, Paramètres ; il voit la carte
      Utilisateurs mais ni Machines, ni Motifs, ni États du ciel.
- [ ] Paramètres → Utilisateurs : une ligne porte autant de badges que de
      rôles ; sur SA PROPRE ligne, toutes les cases sont grisées ; un
      administrateur ne peut pas cocher « Technique ».
- [ ] Matrice complète des droits, sur le projet de test :
      `supabase/tests/roles-rls.sql` (se termine par un rollback).
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
2. **Edge Functions**, si la pull request en modifie une, DANS LA FOULÉE du
   SQL — l'intégration continue ne les déploie pas :
   `supabase functions deploy <nom>`. Entre le SQL et ce déploiement,
   l'ancienne version tourne sur le nouveau schéma : c'est court, mais c'est
   le moment le plus fragile du rituel.
3. **Fusion de la pull request** sur GitHub, tests verts obligatoires.
4. **Déploiement automatique** : onglet Actions, workflow « Tests et
   déploiement GitHub Pages ». À la fin, l'URL de production sert la
   nouvelle version.
5. **Ctrl+F5 sur la Supervision** (rechargement complet, sans cache), puis
   vérification : connexion, onglet concerné par l'évolution, une
   modification d'essai annulée aussitôt.
6. **« Recharger » les écrans** depuis Supervision → Écrans, à un moment
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
