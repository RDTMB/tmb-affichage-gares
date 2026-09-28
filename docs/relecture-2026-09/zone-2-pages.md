# Relecture adversariale — zone 2 : pages d'affichage (écran de gare, grille du jour, portail, service worker)

Worktree `wt-pages` au commit 0739500 (= `main`), 26/09/2026. Banc de mutation : `scratchpad\zone-pages\mute.mjs` (spécifications `mutations-1/2/3.json`, résultats `*.resultats.json`) ; analyse des ids/classes : `orphelins.mjs` ; notes de travail : `notes.md`.

## 1. Périmètre couvert

**Fichiers lus en entier** : `CLAUDE.md`, `.claude/regles-affichage.md`, `.claude/charte-graphique.md` ; `ecran.html`, `grille.html`, `index.html`, `supervision.html` (en-tête, CSP) ; `public/sw.js` ; `vite.config.ts` ; `src/pages/ecran.ts`, `grille.ts`, `grille-logique.ts`, `affichage-commun.ts`, `resilience.ts`, `horloge-source.ts`, `meteo-ciel.ts`, `favicon.ts`, `index.ts`, `commun.ts`, `preversion.ts` ; `src/styles/ecran.css`, `grille.css`, `tokens.css`, `base.css`, `index.css`, `preversion.css` ; `src/core/horloge.ts` ; `src/data/config.ts`, `src/data/index.ts` ; `src/pages/supervision-logique.ts` (`identifiantEcran`) ; `src/data/supabase.ts` (constructeur/`fetch`, `heartbeat`, l.128-200 et 600-660) ; tests `demarrage-ecrans`, `service-worker`, `resilience`, `media-injoignable` (banc), `ecrans-sans-outillage-grilles`, `ecran-colonnes`, `entete-colonne` (parties texte), `prochain-depart` (l.240-262), `couleurs-rames` (l.100-191), `preversion` (l.96-183), `bandeau-alterne` (l.472-505), `responsive-ecran` (l.23-206), `jour-simule` (l.151-204), `journee-non-confirmee` (l.148-174), `bandeaux-essai` (l.230-270), `grille-derniere-ligne` (l.139-164), `responsive-index` (l.106-148), `src/core/horloge.test.ts` (l.138-185), `src/data/affichage-sans-ecriture.test.ts` (l.120-150). Docs : `docs/01` §3-4 (l.749-865), §6-7 (l.1308-1328) ; `docs/02` §4 (l.610-631), §8 (l.863-fin) ; `docs/kiosque.md` ; `docs/tests-manuels.md` ; `docs/03` l.74-78 et 143-147 ; `.github/workflows/deploy.yml` (chemins de base).

**Tests éprouvés par mutation** : 60 mutations sur 23 fichiers de test (demarrage-ecrans, resilience, service-worker, affichage-sans-ecriture, affichage-commun, supervision-logique, prochain-depart, entete-colonne, ecran-colonnes, couleurs-rames, media-injoignable, preversion, ecrans-sans-outillage-grilles, jetons-css, responsive-ecran, responsive-grille, bandeaux-essai, grille-derniere-ligne, journee-non-confirmee, jour-simule, bandeau-alterne, core/horloge, tolerance-acces). 43 tuées, 17 survivantes.

**Mesures hors mutation** : `vite build` (sans base et avec `--base=/tmb-affichage-gares/`), taille et contenu de `dist/assets/*.js` (blobs base64, chaînes du mock et de fflate), `dureeCacheMinutes('0.05', 15)` évaluée, comparaison hors blancs des fonctions communes ecran.ts / grille.ts, extraction de tous les ids/classes demandés, posés et visés sur les trois pages.

**Non couvert, et pourquoi** : les tests `fraicheur`, `meteo-ciel`, `terminus-cellule`, `facultatifs`, `affluence`, `libelle-course`, `acces-course`, `train-special`, `pieges-desarmes` n'ont été lus que par leurs intitulés et non mutés : ce sont des tests de fonctions pures (ou de la supervision), et la règle partagée qu'ils touchent (`mentionCourse`) a été éprouvée par C1. Tout ce qui demande un rendu réel (navigateur, Raspberry, réseau coupé, GitHub Pages) est en §4.

## 2. Constats

### Z2-01 — Le verrou « horloge armée avant le premier await » vérifie un NOM de variable, pas un minuteur
- Famille : 2
- Où : `src/pages/demarrage-ecrans.test.ts:153-163` ; `src/pages/ecran.ts:808-809` ; `src/pages/grille.ts:506-507`
- Preuve : le test compare `corps.indexOf('horlogeSecours')` à `corps.indexOf('await ')`. Mutation D1 (`ecran.ts:808-809` → `const horlogeSecours = 0;`, plus aucun `setInterval`) : `npx vitest run demarrage-ecrans` **vert, 95/95**. D6 (même chose dans `grille.ts`) : **vert, 95/95**. D3 (suppression d'un `clearInterval(horlogeSecours)`) : rouge — le comptage mord sur une suppression, pas sur un minuteur vidé.
- Coût : un écran figé sur la coquille HTML, heure arrêtée pendant toute la première synchronisation, passe la suite.
- Catégorie : Ouvert
- Pour qui : Myosotis
- Confiance : haute

### Z2-02 — « Un démarrage qui ÉCHOUE bascule sur un écran d'erreur » n'exige qu'un `.catch(`
- Famille : 2
- Où : `src/pages/demarrage-ecrans.test.ts:149-151` ; `src/pages/ecran.ts:943-948` ; `src/pages/grille.ts:626-631`
- Preuve : regex `void demarre\(\)\.catch\(`. Mutation D2 (`ecran.ts:943-948` → `void demarre().catch(() => {});`) : **vert, 95/95**. D5 (catch retiré) : rouge, 1 test tombé.
- Coût : une exception de démarrage avalée laisse le tableau vide — le défaut que le test dit empêcher.
- Catégorie : Ouvert
- Pour qui : Myosotis
- Confiance : haute

### Z2-03 — La borne de 10 s de la première synchronisation n'est verrouillée par rien
- Famille : 2
- Où : `src/pages/demarrage-ecrans.test.ts:141-147` ; `src/pages/affichage-commun.ts:770` ; `src/pages/ecran.ts:888`, `grille.ts:583`
- Preuve : `toContain('DELAI_PREMIERE_SYNCHRO_MS')` est satisfait par la ligne d'import (`codeSeul` garde les imports). Mutation D7 (`ecran.ts:888` → `avecDelai(sync.demarre(), 10_000_000, false)`) : **vert, 95/95** (seul `tsc --noUnusedLocals` verrait l'import inutile, par accident). Mutation A2 (`affichage-commun.ts:770` → `10_000_000`) : **vert, 128/128** (affichage-commun + demarrage-ecrans). Aucun test n'importe la constante.
- Coût : la borne peut dériver vers l'infini sans qu'un test tombe ; l'écran resterait sur un tableau vide pendant une requête qui ne rend pas la main.
- Catégorie : Ouvert
- Pour qui : Myosotis
- Confiance : haute

### Z2-04 — La garde « sans source → écran neutre » est vérifiée par la présence de sa chaîne
- Famille : 2
- Où : `src/pages/demarrage-ecrans.test.ts:47-53` ; `src/pages/ecran.ts:819`, `grille.ts:516`
- Preuve : `code.indexOf("mode === 'aucune'")` + ordre avant `creeProviderReel(`. Mutation D8 (`ecran.ts:819` → `if (mode === 'aucune' && Number.isNaN(0))`, garde qui ne peut plus être vraie) : **vert, 95/95**.
- Coût : sans `config.js`, la page appellerait `creeProviderReel(undefined, undefined)` et finirait sur l'écran d'erreur (sans réessai) au lieu de l'écran neutre qui se répare seul toutes les 5 min.
- Catégorie : Ouvert
- Pour qui : Myosotis
- Confiance : haute

### Z2-05 — Les bandeaux HEURE SIMULÉE et DÉMONSTRATION peuvent être masqués par CSS sans qu'aucun test tombe
- Famille : 2
- Où : `src/pages/demarrage-ecrans.test.ts:93-97` et `:197-204` ; `src/styles/ecran.css:1125-1127` ; `src/styles/grille.css:715-717`
- Preuve : les tests cherchent la chaîne du sélecteur (`body.mode-simule .bandeau-simule`, `body.mode-demo .bandeau-demo`), pas ce qu'il fait. Mutation D9 (`ecran.css:1126` `display: flex` → `display: none`) : **vert, 107/107** (demarrage-ecrans + responsive-ecran). D10 (`grille.css:716`, bandeau démo) : **vert, 119/119** (demarrage-ecrans + bandeaux-essai + responsive-grille). Le correctif d'audit du 06/09 (« bandeau HEURE SIMULÉE non masquable ») n'a donc pas de verrou.
- Coût : le scénario que C-05 nomme le plus coûteux — un tableau crédible à une heure fictive, sans marque — repasse vert.
- Catégorie : Ouvert
- Pour qui : Myosotis
- Confiance : haute

### Z2-06 — `identifiantEcran` (PR #43) : le câblage des pages est verrouillé par une chaîne ; le repli par gare du 19/09 peut revenir
- Famille : 2
- Où : `src/data/affichage-sans-ecriture.test.ts:140-150` ; `src/pages/demarrage-ecrans.test.ts:71-77` ; `src/pages/ecran.ts:153`, `grille.ts:127` ; `src/pages/supervision-logique.ts:192-195`
- Preuve : candidat retenu = A (sans `?ecran=`, aucun signal : `identifiantEcran(null)` → `null`, prouvé par `supervision-logique.test.ts:169-178` sur la fonction pure). Les deux pages l'appellent à l'identique (`identifiantEcran(url.get('ecran'))`). Mais la page n'est tenue que par `toContain("identifiantEcran(url.get('ecran'))")` et `idEcran === null`. Mutation D4 (`ecran.ts:153` → `identifiantEcran(url.get('ecran')) ?? (gareParam ? \`${gareParam}-ecran-1\` : null)`) : **vert, 215/215** sur quatre fichiers (demarrage-ecrans, affichage-sans-ecriture, affichage-commun, supervision-logique).
- Coût : un onglet de bureau ouvert sur `?gare=saint-gervais` battrait à nouveau sous l'identifiant du Raspberry et couvrirait son silence — l'incident de trois heures du 19/09, réintroduit à tests verts.
- Catégorie : Ouvert
- Pour qui : Myosotis
- Confiance : haute

### Z2-07 — `service-worker.test.ts` ne joue jamais le gestionnaire `fetch` : l'aiguillage des stratégies est inerte
- Famille : 2
- Où : `src/pages/service-worker.test.ts:141, 187-195` (le banc n'expose que `cacheDabord`, `reseauDabord`, `VERSION`, `activate`) ; `public/sw.js:128-147`, `:99-106`, `:215-224`
- Preuve : S1 (`sw.js:142`, `config.js` retiré de la branche réseau-d'abord → cache-first) : **vert, 23/23**. S2 (`sw.js:103` `cache.addAll(PRECACHE)` → `cache.addAll([])`, liste conservée) : **vert, 23/23** — le test « le précache garde les quatre pages et les quatre logos » (l.448-460) vérifie la LISTE, pas son usage. S4 (ligne `if (requete.cache === 'no-store') return;` déplacée après le `respondWith` final, inatteignable) : **vert, 23/23** — le test l.473-477 vérifie que la ligne existe. S5 (`sw.js:219`, réseau-d'abord met en cache une réponse non-ok) : **vert, 23/23**, alors que la même mutation sur cache-d'abord (S6) est rouge : la moitié réseau-d'abord de « jamais un échec en cache » n'est pas éprouvée.
- Coût : `config.js` servi depuis le cache (une URL Supabase changée resterait figée), un précache vide, ou une sonde réseau servie par le cache (la coupure ne se détecterait plus) passeraient tous verts.
- Catégorie : Ouvert
- Pour qui : Myosotis
- Confiance : haute

### Z2-08 — « ecran.ts passe `jour` au badge » est satisfait par un `jour,` d'ailleurs
- Famille : 2
- Où : `src/pages/journee-non-confirmee.test.ts:150-158` ; `src/pages/ecran.ts:709`
- Preuve : `expect(src).toMatch(/jour,/)` — `passagesPourGare(grille, jour, gare, maintenant)` (l.760) le satisfait. Mutation N1 (`ecran.ts:709` `jour,` → `jour: null,`) : **vert, 17/17**.
- Coût : le badge F-16 « Horaires théoriques — journée non confirmée » peut disparaître de l'écran de gare sans qu'un test tombe.
- Catégorie : Ouvert
- Pour qui : Myosotis
- Confiance : haute

### Z2-09 — `jour-simule.test.ts` lit la source BRUTE : un commentaire suffit
- Famille : 2
- Où : `src/pages/jour-simule.test.ts:156-169` (utilise `source()`, pas `codeSeul()`) ; `src/pages/ecran.ts:125`
- Preuve : mutation J1 (`ecran.ts:125` → `creeSourceHeure(url.get('simule'), null)` + la chaîne attendue recopiée dans un commentaire) : **vert, 28/28**. Le fichier avertit lui-même de ce piège pour le mot `await` (l.166-169) et l'applique pourtant à toutes ses autres assertions. Mutant volontairement artificiel ; c'est le cas n° 6 de la liste.
- Coût : `?jour=` peut cesser d'agir sans que la suite le dise.
- Catégorie : Ouvert
- Pour qui : Myosotis
- Confiance : haute

### Z2-10 — L'en-tête HTTP `Date` (lot 5) : la mesure est verrouillée, sa remontée jusqu'aux pages ne l'est pas
- Famille : 2
- Où : `src/core/horloge.test.ts:162-170` ; `src/data/supabase.ts:185-190` (mesure dans le `fetch` du client) et `:197-199` (`ecartHorlogeMs()`) ; `src/pages/ecran.ts:721-722`, `grille.ts:454-455`
- Preuve : réponse au point nommé — le code y est : `ecartDepuisEntete(reponse.headers.get('date'), envoi, Date.now())` (`supabase.ts:187`), fonction pure `src/core/horloge.ts:85-97` (repli : en-tête absent/illisible → `null`, la mesure précédente est gardée ; aucune mesure → `etatHorloge(null)` = `juste`, `horloge.ts:61-62`) ; `horloge-source.ts` n'y touche pas (horloge locale seule). Ce qui le tient : `horloge.test.ts:91-136` (pure, comportemental) et `:138-170` (chaînes). Mutation H1 (`supabase.ts:198` `return this.ecartMs;` → `return null;`) : **vert, 40/40** (horloge + tolerance-acces). H2 (`ecran.ts:722` conservé dans une chaîne inerte) : vert, 24/24 (artificiel).
- Coût : la mesure peut être faite et jamais remontée ; les deux seuils du lot 5 seraient morts, tests verts.
- Catégorie : Ouvert
- Pour qui : Myosotis
- Confiance : haute

### Z2-11 — `docs/tests-manuels.md` §2 : `&cache=0.05` est silencieusement ramené à 15 min
- Famille : 1
- Où : `docs/tests-manuels.md:19` ; `src/pages/affichage-commun.ts:721-742` (bornes 3–60, C-04)
- Preuve : `dureeCacheMinutes('0.05', 15)` évaluée sur la source = **15** ; `('3', 15)` = 3. La procédure annonce « 0.05 min = 3 s ».
- Coût : celui qui déroule la recette attend 15 min l'écran neutre et conclut que le mode dégradé ne marche pas. Remplacer par `&cache=3` (3 min, le minimum accepté).
- Catégorie : Ouvert
- Pour qui : Thomas (une ligne de doc)
- Confiance : haute

### Z2-12 — « Précache app + logos + polices » : ni police ni JS/CSS n'est précaché, et le cache est purgé au déploiement avant d'être regarni
- Famille : 1
- Où : `docs/02-spec-technique.md:623`, `docs/03-plan-de-developpement.md:76`, `docs/tests-manuels.md:32-34` ; `public/sw.js:87-97` (PRECACHE), `:103` (`addAll`), `:120` (purge), `:188` (`caches.open(VERSION)`) ; `src/pages/resilience.ts:147-152`
- Preuve (lecture) : PRECACHE = `./`, quatre HTML, quatre logos ; aucun `woff2`, aucun chunk haché (le fichier vit dans `public/`, il ne peut pas connaître leurs noms — `sw.js:14-17`). Les chunks ne sont mis en cache qu'au fil de l'eau (`cacheDabord`, `:146`). Enchaînement lu : (1) l'enregistrement est fait par le module de la page (`resilience.ts:147`), donc APRÈS que ses chunks ont été demandés — à la première visite ils ne passent pas par le SW ; (2) après un déploiement, le premier rechargement charge les nouveaux chunks à travers l'ANCIEN SW, qui les écrit dans SON cache (`:188`), puis le nouveau JS enregistre `sw.js?v=neuf`, le nouveau SW s'installe et son `activate` purge l'ancien nom (`:120` — S7 prouve que cette purge fonctionne) : les chunks tout juste chargés disparaissent. Le démarrage hors ligne ne redevient possible qu'au DEUXIÈME rechargement en ligne (reboot 04:30 du surlendemain). En prime : `logo-rond-blanc.svg` et les deux motrices (51 + 93 + 93 Ko) sont précachés alors qu'aucune page ne les référence (toutes inlinent des data URI ; seul `index.html:51` lit `/logos/logo-rond.svg`), et `addAll` est atomique : un seul 404 et un Pi neuf n'a aucun service worker.
- Coût : déploiement dans la journée + coupure réseau au reboot de 04:30 = page HTML servie depuis le précache avec des `<script>` introuvables : coquille vide, sans horloge ni réessai, jusqu'au retour du réseau ET un rechargement.
- Catégorie : Ouvert
- Pour qui : Myosotis (manifeste de précache produit au build — Workbox ou équivalent) ; Thomas (corriger les trois phrases de doc)
- Confiance : moyenne (lecture serrée ; le démarrage hors ligne réel demande un navigateur)

### Z2-13 — `docs/01` §3.2 et §4 décrivent l'écran d'avant les décisions du 10/09 et du 13/09
- Famille : 1
- Où : `docs/01-spec-fonctionnelle.md:786` (« Train : pastille couleur rame + nom + « TRAIN X » ») et `:857-858` (« « N° x », heure d'origine ») ; `ecran.html:70` (colonne « Rame / Trainset »), `src/pages/ecran.ts:410-414` (badge « T11 » devant la destination), `grille.ts:269-285`
- Preuve : les tests verrouillent l'inverse de la doc — `ecran-colonnes.test.ts:45-58` exige « Rame/Trainset » et `:149-153` « la colonne Rame ne porte plus le numéro » ; `entete-colonne.test.ts:42-62` interdit toute heure dans l'en-tête de la grille.
- Coût : le dossier de reprise décrit un écran qui n'existe plus ; Myosotis « corrigera » dans le mauvais sens.
- Catégorie : Ouvert
- Pour qui : Thomas (doc)
- Confiance : haute

### Z2-14 — Le « version » du signal de vie vaut `production` sur tous les postes
- Famille : 1
- Où : `docs/01-spec-fonctionnelle.md:1324-1325` ; `src/pages/ecran.ts:914`, `grille.ts:605` (`version_app: import.meta.env.MODE`) ; `.github/workflows/deploy.yml:67,146,198` (aucun `--mode`) ; `src/pages/supervision.ts:4040` (l'affiche : `· production`) ; `vite.config.ts:24` (`__VERSION_CACHE__`, horodatage de build, non envoyé)
- Preuve : `import.meta.env.MODE` est le mode Vite, identique pour la production et la préversion ; la valeur ne change à aucun déploiement.
- Coût : impossible de voir en supervision quel poste tourne encore sur le build d'avant (entre un déploiement et le reboot de 04:30) — précisément ce que la doc promet.
- Catégorie : Ouvert
- Pour qui : Myosotis (envoyer `__VERSION_CACHE__`)
- Confiance : haute

### Z2-15 — Les réglages PAR POSTE (veille, vitesse du bandeau) sont proposés pour une grille, renvoyés par son signal de vie, et jetés
- Famille : 1
- Où : `src/pages/supervision.ts:4013-4060` (champs veille et vitesse rendus pour tout poste, sans condition sur `e.type`) ; `src/data/supabase.ts:648-656` (renvoyés) ; `src/pages/ecran.ts:920-924` (appliqués) ; `src/pages/grille.ts:600-609` (aucun `.then`), `:474,488` (vitesse = réglage global), `:447` (`veille: false`)
- Preuve : lecture côte à côte des deux `bat()` ; `journee-non-confirmee.test.ts:170-173` verrouille « la grille n'a pas de veille de nuit » sans que l'interface le sache.
- Coût : un agent règle la vitesse ou la veille d'une grille en gare, la carte dit « Réglage propre », rien ne change à l'écran.
- Catégorie : Ouvert (décision : la grille a-t-elle une veille ? sinon masquer les champs pour ce type)
- Pour qui : Thomas (décision), Myosotis (câblage)
- Confiance : haute

### Z2-16 — Chaque `define` est une substitution TEXTUELLE : le logo rond blanc est écrit quatre fois dans le bundle écran
- Famille : 3 (et 4)
- Où : `vite.config.ts:41-47` ; `src/pages/ecran.ts:161, 459, 471, 751` (`__LOGO_ROND_BLANC__`), `grille.ts:288, 355` (`__MOTRICE_BLANC__`)
- Preuve (vite build du 26/09) : `ecran-*.js` = 478 933 o dont **466 532 o de base64** (six blobs : 67 750 + 4 × 68 554 + 124 566), 12 401 o de code ; `grille-*.js` = 394 341 o dont 385 436 o (67 750 + 68 554 + 2 × 124 566). Gzip mesuré : 222 062 o ; **144 215 o** si chaque logo n'y figurait qu'une fois (−35 %). Correctif : une constante de module par logo.
- Coût : 78 Ko gzip par poste et par jour de plus à télécharger sur la 5G du Nid d'Aigle, pour rien.
- Catégorie : Ouvert
- Pour qui : Myosotis
- Confiance : haute

### Z2-17 — `ecran.ts` et `grille.ts` portent sept fonctions strictement identiques et le même prologue de démarrage
- Famille : 3
- Où : `src/pages/ecran.ts` / `grille.ts` : `$` (:104/:84), `afficheNeutrePermanent` (:648/:415, 11 lignes), `majHorloge` (:660/:397), `afficheErreur` (:629/:392), `dureeCacheMs` (:216/:184), `machineDe` (:206/:164), `nomGare` (:202/:180) ; prologue : URL, `zoom`, `idEcran`, `modeDonnees`, `optionsDemo`, choix du provider, `onChange` / 30 s / `online`, `.catch` final (:123-161 / :94-133 et :814-894 / :512-587) ; `REESSAI_SANS_SOURCE_MS`, `RAME_INCONNUE` dupliqués
- Preuve : comparaison hors blancs des sept corps : identiques ; le défaut 15 min existe en trois exemplaires (`src/core/params.ts:52`, `src/data/mock.ts:209`, `src/pages/affichage-commun.ts:741`) alors que le seuil de 2 min est unique (`resilience.ts:13`).
- Coût : chaque correctif se fait deux fois — Z2-15 montre déjà une des deux copies en retard sur l'autre.
- Catégorie : Ouvert
- Pour qui : Myosotis
- Confiance : haute

### Z2-18 — Des tests verrouillent des COMMENTAIRES et des blocs recopiés, pas un comportement
- Famille : 3
- Où : `src/pages/bandeaux-essai.test.ts:230-268` (« 10 px », « 923 px », « 17vh / 19vh », « padding box » doivent figurer dans les commentaires de `grille.css`) ; `grille-derniere-ligne.test.ts:139-163` (six nombres et le nom du fichier de test dans un commentaire) ; `jour-simule.test.ts:187-193` (une phrase de commentaire d'`affichage-commun.ts`) ; `responsive-index.test.ts:106-141` (trois blocs de `base.css` recopiés verbatim, « ce lot ne l'a pas touché »)
- Preuve : lecture ; ces assertions rougissent sur toute reformulation légitime et jamais sur une régression de comportement.
- Coût : pour le repreneur, du bruit rouge à chaque retouche de commentaire, et une fausse impression de couverture.
- Catégorie : Ouvert (à décider : garder comme mémoire, ou retirer)
- Pour qui : Myosotis
- Confiance : haute

### Z2-19 — Le tableau des départs et les deux tableaux de la grille sont reconstruits intégralement chaque seconde, sans garde
- Famille : 4
- Où : `src/pages/ecran.ts:773→441-447` (`$('corps').innerHTML` à chaque `rendre()`), `:484/490` (`$('arrivee').innerHTML`) ; `grille.ts:482-483` (`tab-montee` et `tab-descente`) ; garde existante pour comparaison : `afficheEtatSpecial`, `ecran.ts:435-438`
- Preuve : lecture. Chaque rangée ou colonne express re-sérialise un data URI de 124 566 caractères (`ecran.ts:356`, `grille.ts:288`) ; le grand service 2026 compte 5 express (`docs/grilles-historique/2026-ete-grand-service.json`) → jusqu'à ~620 Ko de HTML à analyser par seconde pour le seul en-tête de la grille, sur un Pi. Le point pulsant `.train-pos` (`pulse 1.4s`, `grille.css:434`) et la case `.chip.imminent` (clignotement 1 s, `ecran.css:680`) sont recréés à chaque seconde : le cycle de 1,4 s ne se termine jamais. Dans la lettre de « 1×/s max », mais c'est le « travail DOM inutile chaque seconde » nommé par la consigne — une signature du contenu, comme en a le bandeau (`affichage-commun.ts:527`), suffirait.
- Coût : CPU et mémoire sur 18 h/jour ; animations saccadées.
- Catégorie : Ouvert
- Pour qui : Myosotis
- Confiance : moyenne (lecture sans ambiguïté ; le coût réel demande un navigateur)

### Z2-20 — Ce que l'écran de gare télécharge (mesuré), et ce qu'il embarque qu'il n'utilise pas
- Famille : 4
- Où : `dist/ecran.html` (modulepreload), `dist/assets/*` du build du 26/09
- Preuve : `ecran-*.js` 479 Ko / 222 Ko gzip + `supabase-*.js` 217 / 57,3 + `supervision-logique-*.js` 94 / 29,8 + `preversion-*.js` 39,6 / 15,2 + `train-sup` 4,3 / 1,9 + `resilience` 1,4 / 0,8 ≈ **327 Ko gzip** pour une page, sous les 400 Ko de docs/02 §8 mais « hors polices/logos » n'est pas tenu (Z2-16 : les logos SONT le bundle). Le chunk `supervision-logique-*.js`, chargé par les deux pages de gare, contient le fournisseur de DÉMONSTRATION (`echecSimule`, « violates check constraint », `ecartHorlogeS` : `src/data/mock.ts` est importé statiquement via `creeProviderDemo`) et les deux JSON de grilles historiques sont émis en assets pour lui (25 Ko). fflate / lecture-xlsx : absents des bundles écran — seul `browser-*.js` (12 Ko, chunk dynamique) porte les chaînes de fflate ✓.
- Coût : 30 Ko gzip de démonstration et de logique de supervision livrés à chaque poste ; à trancher avec `?demo=1` (utile au portail) plutôt qu'à corriger d'office.
- Catégorie : Ouvert (mesure ; décision sur le mock)
- Pour qui : Myosotis
- Confiance : haute

### Z2-21 — Textes voyageurs en français seul dans le code des écrans (docs/01 §6)
- Famille : 1
- Où : `src/pages/ecran.ts:492` (« (TRAIN n), en provenance de … » — `docs/01:833` le spécifie ainsi, ce qui contredit §6) ; `ecran.ts:346` (« théorique HH:MM ») ; `ecran.ts:872` (« Altitude … m ») ; `src/pages/affichage-commun.ts:563` (« relevé HH:MM ») ; `grille.ts:366-367` (« Today's timetable · Grand service » : libellé français de la grille accolé au titre anglais ; « Hors saison »)
- Preuve : lecture ; aucun `<span class="en">` ni « / » sur ces cinq sites.
- Coût : faible ; à trancher une fois (la spec §3.3 et la spec §6 se contredisent).
- Catégorie : Ouvert (décision)
- Pour qui : Thomas
- Confiance : moyenne

## 3. Suspects éprouvés et acquittés

| Test | Mutation | Verdict |
| --- | --- | --- |
| demarrage-ecrans (CSP) | index.html : balise `<meta CSP>` déplacée après `</head>` | rouge, 1 |
| demarrage-ecrans (CSP) | index.html : directive `script-src` retirée | rouge, 2 |
| demarrage-ecrans (CSP) | index.html : `'unsafe-inline'` ajouté à `script-src` | rouge, 2 |
| demarrage-ecrans (CSP) | index.html : `wss:` retiré | rouge, 2 |
| demarrage-ecrans (CSP) | ecran.html : les quatre mêmes mutations | rouge, 1 / 2 / 2 / 2 |
| demarrage-ecrans (CSP) | grille.html : les quatre mêmes mutations | rouge, 1 / 2 / 2 / 2 |
| demarrage-ecrans (CSP) | supervision.html : les quatre mêmes mutations | rouge, 1 / 2 / 2 / 2 |
| resilience | `ageMs` sans `Math.max(0, …)` (resilience.ts:125) | rouge, 1 |
| resilience | contrôle `quand` nombre fini retiré (:80) | rouge, 1 |
| resilience | rejet du postdaté > 60 s retiré (:82) | rouge, 2 |
| resilience | rejet > 24 h retiré (:83) | rouge, 1 |
| demarrage-ecrans | un `clearInterval(horlogeSecours)` retiré (ecran.ts:932) | rouge, 1 |
| demarrage-ecrans | `.catch` de `demarre()` entièrement retiré | rouge, 1 |
| demarrage-ecrans | écran neutre permanent sans `location.reload()` (ecran.ts:657) | rouge, 1 |
| demarrage-ecrans | `?cache=` relu à la main sans borne (ecran.ts:219) | rouge, 1 |
| service-worker | version figée, query string ignorée (sw.js:40) | rouge, 6 |
| service-worker | cache-d'abord met en cache un 404 (sw.js:211) | rouge, 2 |
| service-worker | `activate` purge aussi l'autre portée (sw.js:120) | rouge, 3 |
| prochain-depart | grille.ts passe `null` au lieu de sa gare (:265) | rouge, 1 |
| entete-colonne | heure d'origine remise dans l'en-tête (grille.ts:280) | rouge, 2 |
| entete-colonne | `getAffluence` remis dans le `Promise.all` (grille.ts:542-561) | rouge, 2 |
| ecran-colonnes + entete-colonne | `mentionCourse` rend une mention sur un train supprimé (affichage-commun.ts:99) | rouge, 2 |
| couleurs-rames | couleur de rame concaténée brute (ecran.ts:491) | rouge, 1 |
| media-injoignable | image `complete` mais vide montrée (ecran.ts:586-589) | rouge, 1 |
| preversion | grille.ts sans `poseMarquePreversion()` | rouge, 1 |
| preversion | `document.title` écrit sans `titrePage` (ecran.ts:868) | rouge, 1 |
| ecrans-sans-outillage-grilles | `import '../core/lecture-xlsx'` dans ecran.ts | rouge, 1 |
| jetons-css | `var(--tmb-rouge-vif)` inexistant (ecran.css:7) | rouge, 1 |
| responsive-ecran | transcription `.gare-nom` retirée du bloc ≤ 4/3 | rouge, 1 |
| responsive-grille | transcription `.horloge` retirée du bloc portrait | rouge, 1 |
| bandeaux-essai | `body.mode-horloge { --reserve-bandeau }` retiré | rouge, 1 |
| grille-derniere-ligne | `line-height: 1.05` de `thead th` retiré | rouge, 2 |
| bandeau-alterne | remesurage de l'aperçu visant l'onglet `medias` (supervision.ts) — cas n° 5 | rouge, 1 |
| affichage-commun | `CACHE_MAX_MINUTES` = 600 | rouge, 1 |

43 mutations tuées. Les contrôles suivants ont aussi été acquittés par lecture ou mesure : CSP identique dans les quatre pages (test « même politique » vert ; lignes 34-46 identiques) ; aucun `it.skip` / `it.only` / `it.todo` dans les tests de la zone ; aucune date d'essai qui dérive (`jour-simule.test.ts:35-42` se protège explicitement contre « aujourd'hui ») ; aucun id demandé par le code absent du HTML, aucune classe visée par le CSS que rien ne pose, aucune classe posée sans règle (les ids `bandeau-demo`, `bandeau-simule`, `bandeau-horloge` ne sont lus par personne, ils servent d'ancres aux tests) ; minuteurs et écouteurs : tous armés une seule fois dans `demarre()`, jamais réarmés à une synchronisation ; `horlogeSecours` libéré sur les deux sorties ; minuterie du bandeau nettoyée au changement de contenu (`affichage-commun.ts:532`, test bandeau-alterne l.456) ; `avecDelai` nettoie son minuteur (test l.309) ; un seul `ResizeObserver`, jamais doublé ; écouteurs des médias portés par des éléments remplacés ; seuils du mode dégradé : 2 min défini une fois et consommé par `badgeFraicheur` (pure, testée), « jamais d'horaire potentiellement faux » = même expression dans les deux pages (`ecran.ts:735`, `grille.ts:457`), retour automatique par resynchronisation 30 s + `online` ; `?cache=` borné 3–60 dans les deux pages ; correctifs PR #7 présents dans les DEUX pages (âge borné, instantané validé, horloge de secours, `avecDelai`, `.catch`, bandeau simulé) — ce sont leurs VERROUS qui sont inertes (Z2-01 à Z2-05), pas le code.

## 4. Non vérifiable ici

- Démarrage hors ligne réel et scénario « déploiement puis reboot sans réseau » (Z2-12) : il faudrait un navigateur avec DevTools (Application → Cache Storage) sur le build de production, un déploiement, puis un rechargement hors ligne.
- Effet réel de la reconstruction DOM par seconde et des animations relancées (Z2-19) : profil de rendu Chromium sur un Pi ; l'analyse est faite sur la lettre du code.
- La CSP en `<meta>` : sa prise en compte au navigateur (le test vérifie la position et le contenu ; aucune console ouverte ici).
- Fraîcheur des polices en cache après une mise à jour de `@fontsource` (le nom haché change, l'ancien reste dans le cache de l'ancienne version — purgé à l'activation).
- Comportement du kiosque (`docs/kiosque.md`) : rien du Pi n'est accessible d'ici.

## 5. Compte

- Constats : 21 — famille 1 : 6 (Z2-11 à Z2-15, Z2-21) ; famille 2 : 10 (Z2-01 à Z2-10) ; famille 3 : 3 (Z2-16 à Z2-18) ; famille 4 : 2 (Z2-19, Z2-20). Catégories : 21 « Ouvert » (dont 4 avec une décision de Thomas : Z2-15, Z2-18, Z2-21 et le sort du mock dans Z2-20) ; 0 « Déjà tombé », 0 « Sans objet », 0 « Ne se corrige pas ».
- Pour qui : Thomas seul — Z2-11, Z2-13, Z2-21 ; Thomas + Myosotis — Z2-12, Z2-15 ; Myosotis — le reste.
- Mutations : 60 faites, 17 survivantes (D1, D2, D4, D6, D7, D8, D9, D10, S1, S2, S4, S5, N1, J1, A2, H1, H2), 43 tuées ; taux de survie 28 %. Chaque mutation a été restaurée par `git checkout -- <fichier>` et suivie d'un `git status --porcelain` vide (journal dans `mutations-*.json.resultats.json`).
- `git status --porcelain` final, relancé après la dernière mutation et la dernière mesure : **vide** (`dist/` ignoré par git).
