# Mise en service (phase 1 — GitHub Pages + Supabase)

Guide pas à pas pour non-développeur. Durée totale : ~45 minutes.
À la fin : les 4 pages sont en ligne, la supervision pilote les écrans.

## A. Le dépôt GitHub (déjà en place)

1. Dépôt public `tmb-affichage-gares` sous l'organisation de la Régie
   (`RDTMB`). Le code y est poussé ; chaque poussée sur `main` lance les
   tests puis le déploiement (un test rouge = PAS de mise en ligne).

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
10. Menu **Storage** : vérifier que le bucket `medias` existe (créé par le
   schéma), public, limite 20 Mo.
11. Menu **Database → Replication** (ou **Realtime**) : vérifier que la
   publication `supabase_realtime` contient bien les tables (fait par le
   schéma).
12. Menu **Project Settings → API keys** : noter
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
4. Sans variables, le site se déploie en **mode démonstration** (mock).

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
