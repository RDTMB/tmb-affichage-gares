# Relecture adversariale — zone 5 : régressions entre lots et affirmations écrites

Worktree `wt-reg` au commit `0739500` (= `main`). État de référence reproduit avant toute mutation : `npm run build` OK ; `TZ=UTC npx vitest run` = 79 fichiers / 2 334 tests verts (`zone-reg/vitest-utc.log`). Tailles gzip mesurées : ecran 223 478 o, grille 231 503 o, supervision 206 459 o, chunk supabase 57 186 o, supervision-logique 29 798 o, preversion 15 086 o.

## 1. Périmètre couvert

- **Fusions instruites** (invariant identifié, code actuel relu, tests éprouvés par mutation) : #7, #17, #18, #19, #20, #21/#22/#23 (affluence, par le GRANT anon), #29 (par la contrainte `acces`, lecture seule), #30, #31 (lecture), #33, #40, #41 (regles-deplacees), #43, #44, #45, #46. Effleurées : #3/#8 (politique `caisse` mutée), #16 (titres des tests relus, non mutés).
- **Non couvertes** : #1, #2, #4–#6, #9–#15, #24–#28, #32, #34–#39, #42 — lots d'interface (pages ou supervision) sans garde-fou de sécurité ou d'affichage inter-fichiers ; ils relèvent des zones voisines.
- **Documents relus contre le code** : `CLAUDE.md` ligne à ligne ; `docs/03`, `docs/tests-manuels.md`, `docs/mise-en-service.md` (§B, E, F, G, I), `docs/kiosque.md` (§1, §12, §13, URL d'autostart), `README.md`, `.github/workflows/deploy.yml`, `.claude/launch.json`, `.claude/commands/*.md`, `.github/pull_request_template.md`, `package.json`, `.prettierignore`, `.gitattributes`, `outils/deployer-edge-functions.{ps1,cmd}`, `.claude/regles-affichage.md`. Non relus : `docs/01`, `docs/02` (sauf §8 et titres), `import-grilles.md`, `format-excel-horaires.md`, `securite.md` (titres seulement), les trois autres `.claude/regles-*`.
- **Mutations** : 45 distinctes, en cinq groupes (`zone-reg/g1.log` … `g5.log`), chaque groupe restauré par `git checkout -- <fichiers>` et `git status --porcelain` vide vérifié après chacun. 39 tuées, 6 survivantes (→ Z5-03 à Z5-08).

## 2. Constats

### Z5-01 — La recette de l'écran neutre (`&cache=0.05`) ne fonctionne plus depuis PR #7
- **Famille** : 1 (régression d'une procédure écrite)
- **Où** : `docs/tests-manuels.md:18-19` (écrit en `8be8be8`, 24/08/2026) ; `src/pages/affichage-commun.ts:730-741` (`dureeCacheMinutes`, posé par `3f13e4f`, PR #7 du 06/09/2026)
- **Preuve** : `dureeCacheMinutes('0.05', base)` → `0.05 < CACHE_MIN_MINUTES (3)` → retombe sur `base ?? 15`. `affichage-commun.test.ts:229` (« ?cache=0 retombe sur la base ») verrouille exactement ce comportement ; le document n'a pas suivi.
- **Coût** : qui suit la recette attend 15 min au lieu de 3 s et conclut à tort que la bascule ne vient pas. `README.md:17` renvoie à `&cache=N` sans dire les bornes.
- **Catégorie** : Ouvert — **Pour** : Thomas (recette), Myosotis — **Confiance** : haute

### Z5-02 — « L'écran retentera automatiquement » : promesse sans mécanisme
- **Famille** : 1
- **Où** : `src/pages/ecran.ts:943-948`, `src/pages/grille.ts:626-631` (`3f13e4f`, PR #7) ; `afficheErreur` (`ecran.ts:629-632`, `grille.ts:392-395`) ne programme rien.
- **Preuve** : `grep -n reload src/pages/ecran.ts src/pages/grille.ts` → deux occurrences, toutes deux dans `afficheNeutrePermanent` (`ecran.ts:657`, `grille.ts:424`). Le test `demarrage-ecrans.test.ts:149-151` ne vérifie que la présence de `void demarre().catch(`.
- **Coût** : un démarrage qui lève (config.js malformé, `createClient` qui refuse l'URL) fige le poste sur « Écran indisponible » jusqu'au reboot de 04:30 ; « Recharger » depuis la supervision est inopérant, le signal de vie n'étant pas armé sur ce chemin. Chemin rare, texte faux.
- **Catégorie** : Ouvert — **Pour** : Myosotis — **Confiance** : haute

### Z5-03 — Les colonnes du signal de vie côté front ne sont comparées à aucun GRANT (mutant survivant M43)
- **Famille** : 2
- **Où** : `src/data/supabase.ts:617-627` (UPDATE : `derniere_vue, donnees_maj, date_affichee, version_app, reseau`) ; `supabase/schema.sql:1058-1060` (`grant update (…) on ecrans to anon`) ; `src/data/securite.test.ts:454-472` ne verrouille que la liste SQL.
- **Preuve** : ajout de `gare: e.gare,` dans l'UPDATE → `securite`, `affichage-sans-ecriture`, `service-worker`, `demarrage-ecrans`, `jour-simule`, `horaires`, `deploiement`, `prochain-depart`, `affichage-commun` : verts (`g4.log`).
- **Coût** : une colonne de plus côté front = « permission denied for column » → PostgREST refuse l'UPDATE entier → les six postes passent muets en supervision et le guetteur annonce une panne générale (même classe que l'incident du 11/09/2026 cité par le gabarit de PR).
- **Catégorie** : Ouvert — **Pour** : Myosotis — **Confiance** : haute

### Z5-04 — L'identifiant de poste peut retomber sur la gare sans qu'un test tombe (M20)
- **Famille** : 2 (garde-fou de PR #43 `c277a70` / `9298f2d` non éprouvé au câblage)
- **Où** : `src/pages/ecran.ts:153` ; tests existants : `demarrage-ecrans.test.ts:71-77` (ne vérifie que `if (idEcran) document.body.dataset.ecran = idEcran;`), `affichage-sans-ecriture.test.ts:142`, `supervision-logique.test.ts:163` (fonction pure seule).
- **Preuve** : `const idEcran = identifiantEcran(url.get('ecran')) ?? gareParam;` → 0 test rouge (`g3.log`).
- **Coût** : c'est exactement la régression du 19/09/2026 (onglet de bureau battant à la place du Raspberry, alerte étouffée) ; elle peut revenir par une ligne sans faire rougir la suite.
- **Catégorie** : Ouvert — **Pour** : Myosotis — **Confiance** : haute

### Z5-05 — La mesure d'écart d'horloge (PR #19 §B) peut être neutralisée sans qu'un test tombe (M13)
- **Famille** : 2
- **Où** : `src/data/supabase.ts:184-199` (`fetch` enveloppé → `ecartMs` → `ecartHorlogeMs()`) ; `src/core/horloge.test.ts:138-175` vérifie les pages par texte et supabase.ts par le mot `headers.get('date')`.
- **Preuve** : `ecartHorlogeMs() { return null; }` → `horloge.test.ts` vert (`g2.log`). Le cœur pur (`ecartDepuisEntete`, `etatHorloge`) est bien testé ; le câblage ne l'est pas.
- **Coût** : l'écran neutre à 30 s d'écart et le bandeau à 5 s peuvent cesser de se déclencher ; un écran affiche « PARTI » pour un train encore à quai (le scénario nommé par `horloge.ts:34-38`).
- **Catégorie** : Ouvert — **Pour** : Myosotis — **Confiance** : haute

### Z5-06 — Les secondes de `?simule=HH:MM:SS` peuvent être ignorées sans qu'un test tombe (M46)
- **Famille** : 2
- **Où** : `src/pages/horloge-source.ts:79-83` ; affirmation `CLAUDE.md:59-61` (« les secondes servent aux états À QUAI / DÉPART IMMINENT »).
- **Preuve** : `decalage = h * 3600 + m * 60 - secondesParis();` → `jour-simule`, `prochain-depart`, `demarrage-ecrans`, `affichage-commun` verts (`g4.log`).
- **Coût** : la recette des états à 30 s (`?simule=10:17:40`) peut cesser de viser la fenêtre sans qu'on le sache ; la seule affirmation de CLAUDE.md sur ce point n'est tenue que par relecture.
- **Catégorie** : Ouvert — **Pour** : Myosotis — **Confiance** : haute

### Z5-07 — Cadence pg_cron (5 min) et seuil « À L'ARRÊT » (15 min) : deux constantes sans lien éprouvé (M23)
- **Famille** : 2
- **Où** : `supabase/migrations/2026-09-alerte-ecrans.sql:341-343` (`'*/5 * * * *'`) ; `src/pages/supervision-logique.ts:295` (`SEUIL_GUETTEUR_MUET_MS = 15 min`) ; `CLAUDE.md:97` (« toutes les 5 min »).
- **Preuve** : `'*/6 * * * *'` → `alerte-ecrans.test.ts`, `securite.test.ts`, `scripts-sql.test.ts` verts (`g3.log`).
- **Coût** : une cadence relevée au-delà de 15 min fait dire « À L'ARRÊT » à un guetteur sain ; rien n'écrit que l'une borne l'autre.
- **Catégorie** : Ouvert (faible) — **Pour** : Myosotis — **Confiance** : moyenne

### Z5-08 — « re-rendu 1×/s max » et « pas de fuite mémoire (18 h/jour) » : tenus par aucun test ni aucune mesure (M64)
- **Famille** : 2
- **Où** : `CLAUDE.md:44-45` ; `src/pages/ecran.ts:934-937`.
- **Preuve** : intervalle de rendu à `500` ms → les 48 fichiers de `src/pages` verts (`g5.log`). Aucun test du dépôt ne mesure la mémoire ; le seul verrou est le commentaire de `avecDelai` (« minuteur toujours nettoyé », testé) et l'arrêt de `horlogeSecours` (testé par texte).
- **Coût** : les deux contraintes de la section « Stack et contraintes » ne sont que des intentions ; une régression se verrait en gare, après 18 h.
- **Catégorie** : Ouvert pour le 1×/s (un test de texte suffit) ; **Ne se corrige pas ici** pour la fuite (mesure en gare, `chrome://memory`) — **Pour** : Myosotis — **Confiance** : haute (1×/s), moyenne (mémoire)

### Z5-09 — « Les deux autres scripts du dossier migrations » : il y en a 21, 13 ne sont cités nulle part
- **Famille** : 1
- **Où** : `docs/mise-en-service.md:126-131` ; `§I:653-654` promet « les nouveaux scripts sont aussi ajoutés au §B ».
- **Preuve** : `ls supabase/migrations` = 21 fichiers ; cités dans le document : medias-ordre, params-forme, roles-multiples, roles-multiples-remise-a-zero, affluence, alerte-ecrans (6). Absents : acces-course, caisse-medias-ecrans, depart-reel, libelle-admin, libelle-course, maj-honnete, onglet-affluence, onglets-par-role, purge-journal-bornee, roles-multiples-nettoyage, section-exploitee, train-special-A, train-special-B, vitesse-par-ecran.
- **Coût** : pour une base ANCIENNE (la production), l'ordre d'application n'existe plus que dans des PR fermées ; le repreneur n'a pas la liste. (Pour une base neuve, `schema.sql` est censé tout porter — non vérifié ici, zone données.)
- **Catégorie** : Ouvert — **Pour** : Thomas, Myosotis — **Confiance** : haute

### Z5-10 — La checklist de recette des rôles (§F) et le plan (étape 6) décrivent des onglets d'avant le lot 2
- **Famille** : 1
- **Où** : `docs/mise-en-service.md:551-558` ; `docs/03-plan-de-developpement.md:133-134` ; contre `docs/01:1127` (« la caisse ne voit plus l'onglet Horaires »), `supabase/schema.sql:413-440` (seed : technique = horaires, ecrans, utilisateurs, journal ; supervision = + affluence, journal ; caisse = affluence, bandeau, medias, ecrans, journal), `roles.test.ts` « Lot 2 : Horaires masqué pour la caisse ».
- **Preuve** : lecture croisée ci-dessus. Trois lignes fausses : caisse « Bandeau et Horaires » (Horaires retiré, Places/Écrans/Journal absents) ; supervision sans Places ni Journal ; technique « Paramètres… carte Utilisateurs » (Utilisateurs est un onglet, Paramètres n'est pas dans son seed).
- **Coût** : la recette fait chercher des onglets dont l'absence est le comportement voulu, et valide un état qui n'est plus celui livré.
- **Catégorie** : Ouvert — **Pour** : Thomas — **Confiance** : haute

### Z5-11 — « 71 attributs style="" en supervision » : 79 aujourd'hui, 72 le jour où la phrase a été écrite
- **Famille** : 1
- **Où** : `CLAUDE.md:107` (posé en `3f13e4f`).
- **Preuve** : `grep -o 'style="' supervision.html | wc -l` = 79 (+ 15 dans `supervision.ts`) ; à `3f13e4f` : 72. Les écrans construisent aussi des `style=""` (`styleRame`, `ecran.ts:284`) : la justification « en supervision » est incomplète.
- **Coût** : nul ; mais c'est la justification chiffrée d'`'unsafe-inline'` dans la section « règles absolues », et elle n'a jamais été exacte.
- **Catégorie** : Ouvert (trivial) — **Pour** : Myosotis — **Confiance** : haute

### Z5-12 — « Écrans en lecture seule » : l'écran écrit (UPDATE anonyme du signal de vie)
- **Famille** : 1 (imprécision dans « Sécurité — règles absolues »)
- **Où** : `CLAUDE.md:83` ; `src/data/supabase.ts:608-627` ; `schema.sql:1058-1060` (grant), `:1090` (politique « signal de vie »).
- **Preuve** : lecture. Une seule écriture, bornée à cinq colonnes par GRANT — mais une écriture.
- **Coût** : un repreneur qui audite depuis la règle absolue ne cherche pas la politique anonyme d'UPDATE, et ne comprend pas Z5-03.
- **Catégorie** : Ouvert (reformulation) — **Pour** : Myosotis — **Confiance** : haute

### Z5-13 — `.gitattributes` : « La copie de travail reste en CRLF sous Windows » — faux, elle est en LF
- **Famille** : 1
- **Où** : `.gitattributes:11-13`.
- **Preuve** : `eol=lf` impose LF à l'extraction ; mesuré : `tr -cd '\r' < src/pages/ecran.ts | wc -c` = 0 dans le worktree ET dans `C:\Dev\tmb-affichage-gares` ; `git ls-files --eol` → `i/lf w/lf` ; seul le `.cmd` est en CRLF (21 CR, attribut `eol=crlf`).
- **Coût** : la mémoire de session « poste en CRLF » est périmée ; les normalisations `\r\n` des tests sont devenues inertes (sans nuire) ; un futur lot pourrait « corriger » un problème qui n'existe plus.
- **Catégorie** : Ouvert (commentaire + note mémoire) — **Pour** : Thomas — **Confiance** : haute

### Z5-14 — L'aide du script de déploiement annonce trois fonctions, le défaut en déploie quatre
- **Famille** : 1
- **Où** : `outils/deployer-edge-functions.ps1:6-7`, `:26-27` (« Par défaut les trois du projet ») contre `:66` (quatre, dont `alerte-ecrans`, PR #40).
- **Coût** : qui lit `Get-Help` ne s'attend pas au déploiement du guetteur, ni au `--no-verify-jwt` qui l'accompagne.
- **Catégorie** : Ouvert (trivial) — **Pour** : Myosotis — **Confiance** : haute

### Z5-15 — `docs/03` cite des fichiers absents et des cadences périmées, sans se dater comme historique
- **Famille** : 1
- **Où** : `docs/03:8-10` (`PROMPT-DE-DEMARRAGE.md` : inexistant), `:17-18` (`public/grilles/*.json` : dossier absent, grilles en base + `docs/grilles-historique/`), `:100-101` (« Heartbeat 30 s » ; code et `docs/01:1326` disent 60 s), `:191-193` (kiosque « Raspberry Pi OS Lite … via systemd », contredit par `docs/kiosque.md:10-21`).
- **Coût** : `CLAUDE.md` renvoie à ce document pour « ce qui reste à faire, et à quoi on reconnaît qu'une étape est finie » ; ses critères ne décrivent plus le système.
- **Catégorie** : Ouvert (un chapeau « prompts d'origine, figés » suffirait) — **Pour** : Thomas — **Confiance** : haute

### Z5-16 — `.prettierignore` protège `public/grilles/`, qui n'existe plus
- **Famille** : 3
- **Où** : `.prettierignore:14-15` (« Horaires OFFICIELS : ne jamais reformater »).
- **Preuve** : `ls public/` → `logos`, `sw.js`.
- **Coût** : nul ; une ligne morte qui affirme protéger des horaires absents.
- **Catégorie** : Ouvert (trivial) — **Pour** : Myosotis — **Confiance** : haute

### Z5-17 — Le service worker précache quatre logos qu'aucune page ne demande plus
- **Famille** : 3 (et 2 par ricochet : le test verrouille la charge morte)
- **Où** : `public/sw.js:93-96` ; `vite.config.ts:41-47` (logos inlinés en `data:` par `define`) ; `grep -rn "logos/" src --include=*.ts` → 0 ; `service-worker.test.ts:448` exige « les quatre logos ».
- **Coût** : ≈ 290 Ko non compressés téléchargés à chaque installation de service worker (donc à chaque déploiement, la version changeant) pour rien ; `cache.addAll` échoue en bloc si l'un manquait.
- **Catégorie** : Ouvert (faible) — **Pour** : Myosotis — **Confiance** : haute

### Z5-18 — Logos dupliqués dans les bundles : −35 % de gzip sur l'écran, −38 % sur la grille
- **Famille** : 4 (mesuré)
- **Où** : `vite.config.ts:41-47` (`define` substitue le littéral à chaque site) ; `ecran.ts:161, 459, 471, 751` (`__LOGO_ROND_BLANC__` ×4) ; `grille.ts:288, 355` (`__MOTRICE_BLANC__` ×2).
- **Preuve** : `ecran-*.js` 478 992 o / gzip 223 478 o ; même fichier avec les 3 doublons de 68 554 caractères remplacés par un jeton : 273 354 o / gzip 145 673 o. `grille-*.js` 394 384 / 231 503 → 144 213 o gzip. gzip ne dédoublonne pas un motif de 68 Ko (fenêtre de 32 Ko).
- **Coût** : ≈ 78 Ko gzip par chargement d'écran, ≈ 87 Ko sur la grille, sur un Raspberry derrière un réseau de montagne. Correctif : une constante de module par logo (`const LOGO_ROND_BLANC = __LOGO_ROND_BLANC__;`). Le budget « < 400 Ko » reste tenu (ecran + chunks partagés ≈ 327 Ko).
- **Catégorie** : Ouvert — **Pour** : Myosotis — **Confiance** : haute

### Z5-19 — Le verrou des couleurs (PR #17, F-08) a un périmètre figé à trois fichiers
- **Famille** : 2
- **Où** : `src/pages/couleurs-rames.test.ts:110` (`FICHIERS = ecran.ts, grille.ts, supervision.ts`) ; fichiers de pages créés depuis : `onglet-horaires.ts`, `horaires-onglet.ts`, `correction-grille.ts`, `preversion.ts`, `voir-comme.ts`, `mot-de-passe-oublie.ts`.
- **Preuve** : `grep -n '\.couleur}' …` sur ces fichiers → 0 aujourd'hui (aucun contournement vivant) ; un `${m.couleur}` ajouté dans `onglet-horaires.ts` passerait.
- **Coût** : la « huitième construction ajoutée demain » que le test dit attraper ne le serait pas hors des trois fichiers.
- **Catégorie** : Ouvert (faible) — **Pour** : Myosotis — **Confiance** : moyenne

### Z5-20 — `/verif` : ses `allowed-tools` n'autorisent pas ce que son texte demande sous PowerShell
- **Famille** : 2
- **Où** : `.claude/commands/verif.md:3` (`Bash(npm run build:*)`, `Bash(npx vitest run:*)`, `Bash(npx prettier --check:*)`, `Bash(git status:*)`) contre `:22-24` (« écris `npm.cmd` et `npx.cmd` » sous PowerShell).
- **Preuve** : lecture ; `npm.cmd run build` ne matche pas `Bash(npm run build:*)`, et l'outil PowerShell n'est pas couvert par un motif `Bash(...)`.
- **Coût** : sous PowerShell, chaque contrôle demande une permission ou échoue ; l'objet de la commande (quatre verdicts sans bruit) est perdu.
- **Catégorie** : Ouvert — **Pour** : Thomas — **Confiance** : moyenne (non exécuté sous PowerShell ici)

### Z5-21 — Petites affirmations périmées, regroupées
- **Famille** : 1
- **Où / preuve** : `docs/tests-manuels.md:56` et `:75` — deux sections « ## 5. » ; `README.md:35` « `npm test` # moteur horaires » — c'est toute la suite (79 fichiers) ; `README.md:16` « `?simule=HH:MM` » sans `[:SS]` (`CLAUDE.md:58`, `horloge-source.ts:79`) ; `CLAUDE.md:131` « Les deux copies doivent rester identiques » — `securite.test.ts:1035-1052` compare depuis le 19/09 `schema.sql` à l'UNION des migrations (inclusion, plus égalité).
- **Coût** : faible ; du bruit pour le repreneur.
- **Catégorie** : Ouvert (trivial) — **Pour** : Myosotis — **Confiance** : haute

## 3. Affirmations vérifiées vraies et suspects acquittés

| Affirmation ou test | Ce qui a été fait | Verdict |
| --- | --- | --- |
| C-03 âge borné à zéro (PR #7) | mutation `Math.max` retiré → `resilience.test.ts` | rouge, tué |
| C-03 instantané postdaté rejeté | mutation `if (false)` → `resilience.test.ts` | rouge, tué |
| `?cache=` borné 3..60 (M-14) | mutation `n <= 99999` → `affichage-commun.test.ts` | rouge, tué |
| première synchro bornée (`avecDelai`) | mutation `await sync.demarre()` dans grille.ts → `demarrage-ecrans` | rouge, tué |
| bandeau « heure simulée » (C-05) | ligne `mode-simule` supprimée dans grille.ts → `demarrage-ecrans` | rouge, tué |
| CSP identique sur les quatre pages | diff caractère par caractère des quatre `<meta>` ; mutation `ws:` dans grille.html → « MÊME politique » | identiques ; rouge, tué |
| CSP « verrouillée par demarrage-ecrans.test.ts », position | `<link>` inséré avant la balise dans supervision.html → « rien d'analysable avant elle » | rouge, tué |
| CSP, contenu | `'unsafe-inline'` dans script-src (ecran.html) ; `base-uri 'self'` (index.html) | rouge ×2, tués |
| `img-src data:` utilisé | logos en `data:image/svg+xml` dans les bundles (6 dans ecran) | vrai |
| `font-src data:` utilisé | `dist/assets/ecran-*.css` : 1 `url(data:font/woff` (lato-latin-ext, 3,8 Ko < 4 Ko inlinée) ; les `.woff` latin de 17–20 Ko sont émis en fichiers | vrai (nuance : seuls les sous-ensembles latin-ext sont inlinés) |
| `media-src`/`img-src *.supabase.co`, `connect-src https:+wss:` | `getPublicUrl` (`supabase.ts:534`), realtime | vrai |
| aucune origine utilisée manque à la CSP | grep `blob:`, `createObjectURL`, `<form`, `<iframe`, `new Worker`, `fetch(` : `createObjectURL` ne sert qu'à des `<a download>` (non régi) ; aucun `<form>` ; aucun `fetch` externe hors Edge | vrai |
| « AUCUN appel Supabase hors de src/data/ » | `grep "from '@supabase"` → `src/data/supabase.ts:5` seul | vrai (aucun test ne le tient) |
| « jamais Date.now() dans src/core/ » | grep → commentaires seuls ; gardé par `horaires.test.ts:712` | vrai, tenu |
| lecture-xlsx jamais dans les bundles des écrans | `npm run build` : `unzipSync`/`lireClasseur`/`fflate` = 0 dans `ecran-*.js` et `grille-*.js`, `import()` dynamiques dans `supervision-*.js` ; mutation import statique → `ecrans-sans-outillage-grilles` | vrai ; rouge, tué |
| bundle < 400 Ko gzip hors polices | ecran 223 + supabase 57 + supervision-logique 30 + preversion 15 + train-sup 2 + resilience 1 ≈ 328 Ko par page | vrai (voir Z5-18) |
| une seule définition de l'ordre des gares | `ORDRE_GARES` dans `types.ts:11` seul ; `import-grille.ts:81` (`GARES_LIGNE`) et `index.ts:19` portent noms/altitudes, pas un second ordre | vrai |
| secondes conservées dans les calculs | mutation `heureVersSecondes` sans `ss` → `horaires.test.ts` (6 tests) | rouge, tué |
| `?simule=HH:MM[:SS]` accepté | regex `horloge-source.ts:79` | vrai (mais Z5-06) |
| `?jour=` posé sur les deux pages | mutation grille.ts sans `jourSimule` → `jour-simule.test.ts` | rouge, tué |
| contraintes de forme `params`, bornes identiques | mutation `between 1 and 60` → `securite.test.ts` | rouge, tué |
| `trg_onglets_quorum` différé + verrou consultatif | `deferrable initially deferred` → `deferrable` ; ligne `pg_advisory_xact_lock` supprimée → `securite.test.ts` | rouge ×2, tués |
| liste SQL des rouvreurs = `ROLES_QUI_ROUVRENT` | `array['technique', 'admin']` dans schema.sql ET dans la migration | rouge ×2, tués |
| onglet de secours = `ONGLET_DE_SECOURS` | `'journal'` → `securite.test.ts` | rouge, tué |
| `ongletsVisibles()` ne peut que retrancher ; deux replis vers la matrice | `: []` (repli vers rien) et `regles` (confiance à la table) → `roles.test.ts` | rouge ×2, tués |
| caisse élargie partout ou nulle part (#8) | `'caisse'` retiré de « roles: medias » → `securite.test.ts` | rouge, tué |
| guetteur : `CLE_GUETTEUR` comparée avant toute lecture | en-tête `x-cle-guetteur` renommée → `alerte-ecrans.test.ts` (17 tests) | rouge, tué |
| guetteur : seuil 10 min, copie Deno confrontée à l'originale | `SEUIL_DEFAUT_MS = 11 min` → `surveillance-ecrans.test.ts` + `alerte-ecrans.test.ts` | rouge, tué |
| `surveillance_etat` lu et affiché | `supabase.ts:1400-1417` → `supervision.ts:3957-3977` (`bandeauGuetteur`) | vrai |
| `--no-verify-jwt` réservé à `alerte-ecrans` | `ps1:476-488` : deux appels séparés | vrai |
| ref de production unique | `sed` de deploy.yml exécuté → `csstkdcqdzaiibfqrscv` ; `ps1:84` identique ; `securite.test.ts:820` | vrai, tenu |
| deploy.yml : grep d'artefact et étape de test | `if false; then` sur le grep → `deploiement.test.ts` ; ligne `npm test` supprimée → `deploiement.test.ts` | rouge ×2, tués |
| deploy.yml : `npm test` avant `build` | aucun test ne lit `dist/` (grep) | sans effet |
| coureur UTC | `TZ=UTC npx vitest run` | 79/2 334 verts |
| version du service worker dérivée du build (#19 §A) | `VERSION_CACHE = 'tmb-v2'` → `service-worker.test.ts` | rouge, tué |
| précache des quatre pages | `./grille.html` retiré → `service-worker.test.ts` | rouge, tué |
| `signOut` local, pages d'affichage sans session (#19 §C) | `scope: 'global'` ; `creeProviderReel` sans `true` → `session-et-purge.test.ts` | rouge ×2, tués |
| surfaces d'affichage sans création de journée (#18 §C) | `!== false` dans getJour ; `{ creerSiAbsent: true }` dans ecran.ts → `affichage-sans-ecriture` | rouge ×2, tués |
| bloc de clés identique dans les 4 fonctions (#18 §B) | mutation dans `traduire/index.ts:81` → `cles-edge-functions` | rouge, tué |
| `?apercu=1` coupe le signal de vie | `=== '2'` → `affichage-sans-ecriture` | rouge, tué |
| `identifiantEcran` : blancs = absence (#43) | `trim()` retiré → `supervision-logique.test.ts` | rouge, tué |
| URL d'autostart cohérente avec `identifiantEcran` | `kiosque.md:45` `&ecran=${GARE}-ecran-1` = `identifiantEcranDeclare('ecran', gare, 1)` ; §12 existe | vrai |
| « voir comme » : `signOut` seule sortie (#33) | `SORTIE = []` → `voir-comme.test.ts` | rouge, tué |
| délai de réessai 60 s (#20) | `30` → `mot-de-passe-oublie.test.ts` | rouge, tué |
| préversion = dernier segment `/preview/` (#45) | `return false` → `preversion.test.ts` | rouge, tué |
| déménagement de CLAUDE.md sans perte (#41) | première puce de `regles-affichage.md` supprimée → `regles-deplacees.test.ts` | rouge, tué |
| couleurs de rame validées partout (#17 F-08) | grep `styleRame`/`couleurSure` : tous les sites des trois pages ; aucune interpolation `.couleur}` ailleurs | vrai (voir Z5-19) |
| seuil hors ligne 2,5 cycles | `3.5` → `fraicheur.test.ts` | rouge, tué |
| commandes `/lot` et `/verif` existent ; `roles-rls.sql` existe ; fichiers SQL cités par mise-en-service.md existent | `ls` | vrai |
| `.claude/launch.json` : chemin node portable | `ls` depuis cet outil → existe (92 Mo, node v24.19.0) ; `node` du PATH = `C:\Program Files\nodejs` | vrai vu d'ici (voir §4) |
| `docs/01` + `docs/02` ≈ 33 000 tokens | 84 048 + 53 208 octets ÷ 4 ≈ 34 300 | vrai |
| CSP `politique()` : ordre des attributs | une balise `content=… http-equiv=…` serait comptée comme absente (rouge, pas vert) | faux positif seulement, acquitté |

## 4. Non vérifiable ici

- `launch.json` : le chemin `…\AppData\Local\nodejs-portable\…` vu depuis le terminal de l'utilisateur (redirection MSIX documentée dans `ps1:122-137`) — il manquerait un `ls` lancé hors de l'application.
- `supabase/tests/roles-rls.sql` passe sur le projet de test ; `pg_cron` tourne ; secrets Brevo/DeepL/`CLE_GUETTEUR` posés ; état déployé des quatre fonctions — il manquerait un accès à la base et au tableau de bord.
- CSP au navigateur (aucune erreur console sur les quatre pages) — vérifiée statiquement seulement (origines relevées, polices inlinées confirmées dans `dist/`).
- « TTI < 3 s sur Pi », fuite mémoire sur 18 h, re-rendu réel à 1 Hz — il manquerait un Raspberry et un profil.
- `/verif` sous PowerShell (Z5-20) — non exécuté.
- Que `schema.sql` porte bien tout ce que les 21 migrations ajoutent (corollaire de Z5-09) — zone données.

## 5. Compte

- **Constats** : 21 — famille 1 : 10 (Z5-01, 02, 09, 10, 11, 12, 13, 14, 15, 21) ; famille 2 : 8 (Z5-03, 04, 05, 06, 07, 08, 19, 20) ; famille 3 : 2 (Z5-16, 17) ; famille 4 : 1 (Z5-18). Catégories : Ouvert 21 (Z5-08 pour moitié « ne se corrige pas ici »). Pour Thomas : Z5-01, 10, 13, 15, 20 (+09) ; pour Myosotis : les autres.
- **Mutations** : 45 distinctes (5 groupes), 39 tuées, 6 survivantes (M13 → Z5-05, M20 → Z5-04, M23 → Z5-07, M43 → Z5-03, M46 → Z5-06, M64 → Z5-08). Taux de survie 13 %.
- **Affirmations vérifiées vraies / suspects acquittés** : 52 lignes au tableau §3.
- **Vérifications de bout en bout** : `npm run build` OK ; `TZ=UTC npx vitest run` 79 fichiers / 2 334 tests verts.
- **`git status --porcelain` final** (worktree `wt-reg`, relancé en dernier) : vide. `dist/` est ignoré.
