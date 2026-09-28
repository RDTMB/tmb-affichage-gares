# Relecture adversariale — zone 1 : le noyau `src/core/`

Worktree `wt-core` au commit 0739500 (= `main`). État de référence remesuré avant la campagne : `npx vitest run src/core src/regles-deplacees.test.ts src/data/alerte-ecrans.test.ts src/data/securite.test.ts` = 23 fichiers / 969 tests verts (2,55 s). `git status --porcelain` vide avant, entre chaque mutation, et à la fin.

## 1. Périmètre couvert

**Code lu en entier (18 modules, 6 233 lignes)** : horaires.ts, import-grille.ts, types.ts, roles.ts, train-sup.ts, edition-grille.ts, export-grille.ts, params.ts, surveillance-ecrans.ts, grilles-periodes.ts, lecture-xlsx.ts, ecarts-grille.ts, ecriture-xlsx.ts, grilles.ts, cycle-medias.ts, ticker.ts, horloge.ts. Fixtures : `2026-ete-exploit-v1.cellules.json` (lu par les tests et muté), `.xlsx` (binaire, lu uniquement à travers `lireClasseur`).

**Tests lus en entier (21 fichiers)** : les 20 `src/core/*.test.ts` et `src/regles-deplacees.test.ts`. Hors zone, lus parce que les points nommés l'exigeaient : `src/data/alerte-ecrans.test.ts` (entier), `src/data/securite.test.ts` (sections rôles, quorum, params, affluence), `src/data/scripts-sql.test.ts` (grep), `src/pages/supervision-logique.ts:1470-1520`, `src/data/mock.ts:770-800`, `supabase/schema.sql` (catalogue rôles, contraintes params, politiques), `supabase/migrations/2026-08-params-forme.sql` (entier), `2026-09-roles-multiples.sql` (seed), `supabase/functions/alerte-ecrans/index.ts` (seuil).

**Règles écrites confrontées au code** : CLAUDE.md, `.claude/regles-horaires.md`, `.claude/regles-courses-libres.md`, docs/01 §2 (l. 79-748) et « Règles de calcul » (l. 835-856), docs/02 §3 (l. 589-609), `docs/format-excel-horaires.md` (entier), `docs/import-grilles.md` (table des refus, l. 176-199). Chaque seuil, ordre, colonne ou délai cité par ces textes a été retrouvé à l'identique dans le code (2 min de tolérance, 30 min d'avertissement, 60 s de repli, 201/101, bornes incluses, priorité par `cree_le`, express jamais tronqué, section = borne extérieure, report de la veille). Les seuls écarts trouvés sont deux commentaires périmés (Z1-10, Z1-11).

**Contrôles méthodiques faits sur toute la zone** : pureté (grep `Date.now`, `new Date()`, `Intl`, `toLocale`, `fetch`, `window`, `document`, `localStorage`, `setTimeout`, `Math.random` sur les 18 modules : rien, les `new Date(Date.UTC(...))` portent un argument et `toLocaleLowerCase('fr')` est déterministe) ; tests sautés (`.skip`/`.only`/`.todo`/`xit` : aucun) ; tests sans assertion (aucun, 8 à 259 `expect` par fichier) ; dates figées (aucun `Date.now`/`new Date()` dans les tests de la zone : les 150 dates 2026 sont des ENTRÉES de fonctions pures et ne dérivent pas) ; tests lisant le texte d'une source (4 fichiers : horaires.test.ts:714, horloge.test.ts:34, lecture-xlsx.test.ts:17, regles-deplacees.test.ts:23 — chacun éprouvé, voir Z1-01, Z1-04, Z1-05) ; exports du noyau sans usage hors tests (66 symboles listés, tous utilisés en interne sauf deux : Z1-09 ; deux autres n'ont plus d'usage en production : Z1-07, Z1-08) ; types de `types.ts` : aucun type mort.

**Mutations : 24 faites, 17 tuées, 5 survivantes franches, 2 preuves structurelles** (détail §3 et §5). Plus un test temporaire (M19), écrit dans le worktree puis supprimé.

**Inventaire des seuils demandé** (où chaque valeur vit dans `src/`, hors tests) : 30 s « imminent » — `horaires.ts:33` seul, dérivé dans `horloge.ts:44` ; 2 min — cinq constantes NOMMÉES de sens différents (`RETRAIT_APRES_DEPART_S` horaires.ts:29, `preavis_s` horaires.ts:987, `AVANCE_MAX_S` train-sup.ts:293, `SEUIL_BADGE_MS` resilience.ts:13, `SILENCE_A_PRECISER_MS` supervision-logique.ts:279), pas un doublon ; 15 min — défaut cache params.ts:52 et `SEUIL_GUETTEUR_MUET_MS` supervision-logique.ts:295, sens différents ; 150 s — supervision-logique.ts:206 seul (mais annoncé « 90 s » ailleurs : Z1-10) ; 10 min guetteur — surveillance-ecrans.ts:36 seul, copie Deno confrontée par exécution (M10/M11) ; veille 21:00/06:00 — QUATRE copies (Z1-12 i) ; 17:30 et 06:15 — n'existent nulle part dans `src/` (seule une heure d'essai `09:17:30`).

**Non couvert et pourquoi** : le rendu réel du `.xlsx` dans Excel (pas d'Excel ici — c'est justement ce que Z1-03 laisse passer) ; la recette RLS `supabase/tests/roles-rls.sql` (base) ; la mesure sur Raspberry (mesurée sur ce poste seulement : `passagesPourGare` 0,039 ms, `prochaineArrivee` 0,034 ms, `finDeService` 0,032 ms, `positionsTrains` 0,030 ms par appel sur la grille grand service — même vingt fois plus lent en gare, un tick coûte moins d'une milliseconde : **aucun constat de famille 4**) ; l'usage que les pages font des sorties du moteur (zone pages).

## 2. Constats

### Z1-01 — Le verrou « jamais d'horloge dans src/core » ne regarde que 3 modules sur 18
- **Famille** : 2 (contrôle inerte)
- **Où** : `src/core/horaires.test.ts:711-720` ; CLAUDE.md § Conventions (« jamais Date.now() dans src/core/ »)
- **Preuve** : la boucle porte sur la liste écrite en dur `['./horaires.ts', './types.ts', './cycle-medias.ts']` (l. 713) alors que le titre dit « aucun module de src/core/ ». Mutation M01 : `Date.now()` ajouté dans `src/core/train-sup.ts:108` (`% 86400 + 0 * Date.now()`) → `npx vitest run src/core` : **vert, 20 fichiers**. Aujourd'hui aucun des 15 modules non surveillés n'accède à l'horloge (grep) : le constat porte sur le verrou, pas sur une violation.
- **Coût** : un `Date.now()` glissé dans train-sup, surveillance-ecrans ou params casserait `?simule=` et le déterminisme des tests sans qu'un test rougisse — exactement ce que le titre du test promet d'empêcher.
- **Catégorie** : Ouvert — **Pour qui** : Myosotis (geste court : itérer sur `readdirSync` de `src/core`, exclure les `.test.ts`) — **Confiance** : haute

### Z1-02 — Le catalogue `roles` de `schema.sql` n'est comparé à rien : le « miroir » ne lit que la migration
- **Famille** : 2
- **Où** : `src/data/securite.test.ts:787-811` (`sql(MIGRATION_ROLES)`), `supabase/schema.sql:385-393`, `src/core/roles.ts:10-12` (renvoie à `src/data/scripts-sql.test.ts`, qui ne compare aucune matrice ; `roles.test.ts` ne lit aucun SQL)
- **Preuve** : M05, `('supervision', 'Supervision', false, array['admin']` → `array['technique']` dans `schema.sql` → `npx vitest run src/data src/core/roles.test.ts` : **vert, 14 fichiers**. M06, même mutation dans `migrations/2026-09-roles-multiples.sql:284` → rouge (1 test). M04, même divergence côté TypeScript → rouge (6 tests, 2 fichiers).
- **Coût** : `schema.sql` est ce qu'une installation NEUVE reçoit ; elle peut livrer « supervision attribuable par technique » pendant que le front dit « par admin », et la supervision proposerait un geste que la base refuse — le cas que le commentaire de `roles.ts:167-171` nomme « le pire résultat possible ».
- **Catégorie** : Ouvert — **Pour qui** : Myosotis (comparer aussi le seed de `schema.sql`, et corriger la référence de `roles.ts:11`) — **Confiance** : haute

### Z1-03 — Le format d'heure du `.xlsx` exporté est verrouillé par des chaînes, pas par le lien style → format
- **Famille** : 2
- **Où** : `src/core/ecriture-xlsx.test.ts:127-139` ; `src/core/ecriture-xlsx.ts:69`
- **Preuve** : ce test a été ajouté le 22/09 parce que « retirer le style … Excel affichait 0,2916666667 ». Il vérifie la présence de `<numFmt numFmtId="164" formatCode="h:mm"/>` et que chaque cellule numérique porte `s="1"` — jamais que le style 1 pointe sur le format 164. Mutation M14 : dans `cellXfs`, second `xf` passé de `numFmtId="164"` à `numFmtId="0"` → `ecriture-xlsx.test.ts` + `export-grille.test.ts` : **verts (2 fichiers)**. Le fichier se relit parfaitement (le lecteur ignore les styles) et Excel afficherait de nouveau 0,2916666667.
- **Coût** : le document d'exploitation rediffusé peut redevenir illisible, test vert — et personne n'ouvre Excel dans la CI.
- **Catégorie** : Ouvert — **Pour qui** : Myosotis (lire l'index du `xf` référencé par `s="1"` et vérifier SON `numFmtId`) — **Confiance** : haute

### Z1-04 — L'écran peut ignorer l'écart d'horloge sans que « les deux pages agissent sur l'état » ne tombe
- **Famille** : 2
- **Où** : `src/core/horloge.test.ts:138-151` (chaînes cherchées dans `src/pages/ecran.ts` et `grille.ts`) ; `src/pages/ecran.ts:721`
- **Preuve** : M03, `const horloge = [etatHorloge(fournisseur?.ecartHorlogeMs() ?? null)].map(() => 'juste' as ReturnType<typeof etatHorloge>)[0]!;` — la chaîne exigée est conservée, l'état est forcé à « juste » → `horloge.test.ts` **vert**, `npx tsc --noEmit` **OK**.
- **Coût** : la protection §B (30 s d'écart → écran neutre, pour ne pas afficher « PARTI » sur un train à quai) peut être débranchée sans signal ; c'est la faiblesse de tout contrôle par chaîne, et celui-ci garde une règle de sécurité voyageur.
- **Catégorie** : Ouvert (à instruire avec la zone pages, qui possède `ecran.ts`) — **Pour qui** : Myosotis — **Confiance** : haute

### Z1-05 — La « dérivation » du seuil bloquant est vérifiée par une chaîne
- **Famille** : 2 (faible)
- **Où** : `src/core/horloge.test.ts:37-44` ; `src/core/horloge.ts:44`
- **Preuve** : M02, `ECART_BLOQUANT_MS = 30_000 + 0 * SEUIL_IMMINENT_S; // valait SEUIL_IMMINENT_S * 1000` → `horloge.test.ts` **vert** : l'assertion l. 43 trouve la chaîne dans le commentaire, l. 42 compare deux valeurs égales, l. 41 fige `SEUIL_IMMINENT_S` à 30 (elle rougirait aussi le jour où la fenêtre change légitimement — elle ne distingue donc pas les deux cas).
- **Coût** : faible ; le jour où la fenêtre de quai change, le seuil ne suit plus, ce que le commentaire de `horloge.ts:41-42` promet.
- **Catégorie** : Ouvert — **Pour qui** : Myosotis — **Confiance** : haute

### Z1-06 — « Bellevue n'a plus de ligne D en montée » est satisfait par n'importe quelle ligne D
- **Famille** : 2 (faible)
- **Où** : `src/core/export-grille.test.ts:80-83`
- **Preuve** : le filtre est `l[0] === 'Bellevue' || l[1] === 'D'` et l'assertion `length > 0`. Test temporaire M19 (écrit puis supprimé) : le même filtre sur la grille d'ÉTÉ — où Bellevue A une ligne D — est non vide et attrape la ligne D du Fayet. Le comportement est en réalité tenu par la boucle export → import des l. 75-77 ; l'assertion 80-83 est décorative.
- **Coût** : faible — une garantie annoncée qui n'existe pas à cet endroit.
- **Catégorie** : Ouvert — **Pour qui** : Myosotis — **Confiance** : haute

### Z1-07 — `expressATraiter()` n'est sur aucun chemin de production : la supervision recalcule la règle en ligne
- **Famille** : 3 (simplification)
- **Où** : `src/core/horaires.ts:451-475` ; seul appelant `appliqueTerminusBellevue` (l. 438), lui-même appelé uniquement par `src/data/mock.ts:785` (option de démo) ; règle réécrite dans `src/pages/supervision-logique.ts:1483-1488` (`circulationMontee?.terminus === 'bellevue' && c.statut !== 'supprime' && !inactif`) ; docs/02 §3 (l. 596-597) présente pourtant les deux fonctions comme moteur « exigé »
- **Preuve** : M21, `expressATraiter` rendu toujours vide → `npx vitest run src/pages src/data` : **vert, 58 fichiers** ; seul `src/core/horaires.test.ts` rouge (5 tests). Grep : `aTraiter` calculé une seule fois hors noyau, l. 1487.
- **Coût** : deux énonciations de « à traiter » — une testée mais inerte, une vivante mais jugée par un autre oracle. Une divergence (par exemple sur la descente express appariée, que le noyau signale explicitement l. 469-473 et que la page traite par une autre branche l. 1503-1515) ne ferait rougir aucun test qui compare les deux.
- **Catégorie** : Ouvert — **Pour qui** : Myosotis (faire appeler `expressATraiter()` par la page, ou retirer la fonction et la mention de docs/02) — **Confiance** : haute

### Z1-08 — La bascule Terminus Bellevue et la normalisation « pair → N−1 » existent en deux exemplaires
- **Famille** : 3
- **Où** : `seuilMontee()` `horaires.ts:369-371` ; copie en ligne dans `appliqueTerminusBellevue` `horaires.ts:427-428` ; troisième forme sans plancher dans `rangDansSaSerie` l. 777. `deltaTerminusBellevue` (l. 386-389 : « Cette fonction est la SEULE description de la règle ») contre `appliqueTerminusBellevue` (l. 430-432), que `src/data/mock.ts:783-788` RÉAPPLIQUE à chaque `getJour()` : une rotation rétablie à la main dans la démo est re-limitée à la lecture suivante — le défaut M-21 du 08/09 (« recalculer la colonne entière efface les réglages manuels ») reproduit dans le mock.
- **Preuve** : M16, `seuilMontee` privé de son plancher → `npx vitest run src/core` : **vert, 20 fichiers** ; attrapé seulement par `src/pages/apercu-egale-publication.test.ts` (1 test). Les deux copies vivent donc sous deux suites qui ne se confrontent jamais.
- **Coût** : démo et production peuvent diverger en silence ; la phrase « SEULE description » est fausse et orientera mal une reprise.
- **Catégorie** : Ouvert — **Pour qui** : Myosotis — **Confiance** : haute

### Z1-09 — Code mort : `origineStructurelle()` et `terminusStructurel()`
- **Famille** : 3
- **Où** : `src/core/edition-grille.ts:46-54`
- **Preuve** : grep sur tout `src/` : 1 occurrence chacune (la déclaration), 0 test. M15, les deux fonctions renommées → `npx tsc --noEmit` **OK** (aucune référence).
- **Coût** : reprise — deux fonctions publiques à comprendre pour rien.
- **Catégorie** : Ouvert — **Pour qui** : Myosotis (supprimer) — **Confiance** : haute

### Z1-10 — Le guetteur annonce « 90 s » pour la pastille hors ligne, qui vaut 150 s
- **Famille** : 1 (régression documentaire)
- **Où** : `src/core/surveillance-ecrans.ts:31` (« 90 s, `SEUIL_HORS_LIGNE_MS` ») ; `src/pages/supervision-logique.ts:219` (même « 90 s ») contre l. 206 `2.5 * INTERVALLE_HEARTBEAT_MS` = 150 000 ms, épinglé par `src/pages/fraicheur.test.ts:91` ; docs/01 l. 1021 dit bien 150 s
- **Preuve** : `git log -S` : 90 000 ms posé le 28/08 (24a5aed), passé à 2,5 battements le 29/08 (40a862e) sans retoucher le commentaire l. 219 ; le commentaire du guetteur (19/09, f5e5017) a recopié la valeur périmée.
- **Coût** : le raisonnement écrit (« 10 min n'est pas 90 s, ne pas les confondre ») repose sur un chiffre faux ; un repreneur qui « aligne » sur 90 s changerait un comportement validé.
- **Catégorie** : Ouvert (geste court) — **Pour qui** : Thomas ou Myosotis — **Confiance** : haute

### Z1-11 — `Circulation.acces` est documenté « facultatif côté type » alors qu'il est obligatoire depuis le 13/09
- **Famille** : 1
- **Où** : `src/core/types.ts:366-373` (commentaire) contre l. 373 (`acces: AccesCourse`) ; commentaire orphelin l. 24 (« Bornes de la ligne complète ») au-dessus de `NatureCirculation`, la constante étant l. 149
- **Preuve** : `git log -S` : commentaire posé par cbce919 (12/09), champ rendu obligatoire par b8ae147 (13/09) sans retouche. Le bloc « TOLÉRANCE DATÉE » de `accesValide` (l. 92-144) reste, lui, cohérent avec le code.
- **Coût** : faible ; trompe sur ce que le type garantit.
- **Catégorie** : Ouvert — **Pour qui** : Myosotis — **Confiance** : haute

### Z1-12 — Constantes et petits helpers énoncés en double dans le noyau
- **Famille** : 3
- **Où** : (a) « secondes → HH:MM:SS » écrit trois fois : `import-grille.ts:239` `heureDepuisSecondes`, `train-sup.ts:107` `formatHms`, `edition-grille.ts:135` `decaleHeure` (plus `formatHmsTest`, `train-sup.test.ts:28`) ; (b) `hhmm()` : `import-grille.ts:684` et `ecarts-grille.ts:131` ; (c) noms de gares en trois sources : `import-grille.ts:81` `GARES_LIGNE`, `ecarts-grille.ts:119-129` map privée, `grille.gares[].nom` (lu par `fermetureGare`) ; (d) `garesDansLeSens` : `edition-grille.ts:42` exportée, `export-grille.ts:82` copie privée ; (e) lettres de légende : `import-grille.ts:131-133` et `export-grille.ts:29-31` (le commentaire dit « les mêmes que l'import lit » mais ne les importe pas) ; (f) repli 60 s : `import-grille.ts:91` et `grilles.ts:28` ; (g) regex `DATE_ISO` : `import-grille.ts:1016` et `grilles.ts:30` ; (h) condition « Nid d'Aigle sous bascule » : `horaires.ts:1080` et `1137` ; (i) veille par défaut 21:00/06:00, quatre copies : `params.ts:50`, `src/data/mock.ts:207`, `src/pages/supervision.ts:4008` et `4175-4176` (la copie Deno, elle, est confrontée à `PARAMS_DEFAUT` par `alerte-ecrans.test.ts:1133`).
- **Preuve** : greps ci-dessus ; mutations M17 (e), M18 (d), M20 (h), M22 (c), M23 (f) : chaque copie est tuée par SON test, aucune par une comparaison avec l'autre — une divergence entre deux copies ne fait rougir personne.
- **Coût** : reprise (où est la vérité ?) ; les noms de gares surtout : un renommage à l'écran passe par trois fichiers.
- **Catégorie** : Ouvert — **Pour qui** : Myosotis — **Confiance** : haute

### Z1-13 — Bornes de `params` : trois copies littérales reliées par un quatrième littéral dans le test
- **Famille** : 3 (faible)
- **Où** : `src/core/params.ts:258` (`3, 60`) et `:260` (`0, 1800`) écrites en ligne, alors que `DUREE_HORAIRES_MIN_S/MAX_S` (l. 90-91) et `VITESSE_TICKER_MIN/MAX` sont exportées « parce qu'elles servent deux fois » ; `supabase/schema.sql:282-296` ; `supabase/migrations/2026-08-params-forme.sql` ; `src/data/securite.test.ts:1063-1070` (liste `'between 3 and 60'`… écrite à la main)
- **Preuve** : lecture : les bornes concordent aujourd'hui des deux côtés (−50..50, HH:MM, alterne|serie, 3..60, 0..1800, 20..400 ; `duree_horaires_s` volontairement sans contrainte SQL, dit des deux côtés). M13 (TS 3 → 2) : rouge par `params.test.ts:77` ; M24 (SQL 3 → 2 dans les deux copies) : rouge par le littéral de `securite.test.ts`. Aucun test n'importe `params.ts` pour le comparer au SQL.
- **Coût** : une borne changée d'un côté avec son test met la base neuve et le front en désaccord sans signal.
- **Catégorie** : Ouvert — **Pour qui** : Myosotis — **Confiance** : haute

### Z1-14 — La matrice droit × rôle n'est reliée aux 54 politiques RLS par rôle que par un seul pont calculé
- **Famille** : 3 (faible)
- **Où** : `src/core/roles.ts:173-223` (`DROITS_PAR_ROLE`) ; `supabase/schema.sql` : 54 politiques `a_le_role(...)`/`a_un_des_roles(array[...])` ; ponts dans les tests : `securite.test.ts:1642-1650` (`aLeDroit([role], 'affluence')` contre la politique `roles: affluence`) — le seul calculé ; `securite.test.ts:410` et `scripts-sql.test.ts:55` recopient à la main le tableau de `roles: grilles`
- **Preuve** : M25 (`array['technique','admin','supervision']` privé d'`admin` dans `schema.sql`) : rouge, mais par le littéral de `securite.test.ts:410` ; grep `aLeDroit(`/`plafondOnglets(` dans les tests hors noyau : un seul pont dérivé de la matrice. Même structure que Z1-13.
- **Coût** : élargir `roles.ts` sans élargir une politique non épinglée (bandeau, medias, circulations…) donne « l'interface affiche le bouton, la base refuse » sans qu'un test le voie.
- **Catégorie** : Ouvert — **Pour qui** : Myosotis (dériver les tableaux attendus de `droits()` plutôt que les recopier) — **Confiance** : haute pour la lecture, moyenne sur l'étendue réelle du trou (les politiques non épinglées n'ont pas été mutées une à une)

## 3. Suspects éprouvés et acquittés

| Mutation | Fichier muté → mutation | Cibles | Verdict |
| --- | --- | --- | --- |
| M04 | `roles.ts` `ATTRIBUABLE_PAR.supervision` → `['technique']` | roles.test.ts, securite.test.ts | rouge, 6 tests (2 fichiers) |
| M06 | migration roles, seed supervision → `array['technique']` | securite.test.ts | rouge, 1 test |
| M07 | `roles.ts` caisse + `'circulations'` | roles.test.ts | rouge, 10 tests |
| M08 | `roles.ts` technique − `'parametres.technique'` | roles.test.ts, securite.test.ts | rouge, 5 tests (`ROLES_QUI_ROUVRENT` vide : 3 + quorum SQL 2) |
| M09 | `schema.sql` `rouvreurs … array['technique','admin']` | securite.test.ts | rouge, 1 test (miroir du quorum) |
| M10 | Deno `SEUIL_DEFAUT_MS` 10 → 9 min | alerte-ecrans.test.ts | rouge, 3 tests (seuil, balayage 5 000 combinaisons, 300 flottes) |
| M11 | `surveillance-ecrans.ts` `SEUIL_DEFAUT_MS` 10 → 9 min | surveillance-ecrans.test.ts, alerte-ecrans.test.ts | rouge, 4 tests (1 + 3) |
| M12 | fixture `cellules.json` 07:00 → 07:01 (1 cellule) | import-grille.test.ts, lecture-xlsx.test.ts | rouge, 3 tests — deux oracles indépendants (JSON officiel, extraction SheetJS) |
| M13 | `params.ts` cache borne basse 3 → 2 | params.test.ts | rouge, 1 test |
| M16 | `seuilMontee` sans plancher | src/core, apercu-egale-publication.test.ts | vert sur src/core (20 fichiers), rouge 1 test pages — voir Z1-08 |
| M17 | `export-grille.ts` `LETTRE_VELOS` 'b' → 'v' | export-grille.test.ts | rouge, 4 tests (boucle export → import) |
| M18 | `export-grille.ts` `garesDansLeSens` sans inversion | export-grille.test.ts | rouge, 3 tests |
| M20 | `fermetureGare` condition sur 'bellevue' | section-exploitee.test.ts | rouge, 1 test |
| M22 | `ecarts-grille.ts` nom « Motivon » | ecarts-grille.test.ts | rouge, 1 test |
| M23 | `grilles.ts` repli 60 → 61 s | grilles.test.ts | rouge, 1 test |
| M24 | `schema.sql` + migration `between 3 and 60` → `2 and 60` | securite.test.ts, params.test.ts | rouge, 2 tests (littéraux du test) |
| M25 | `schema.sql` politiques `array['technique','admin','supervision']` sans admin | src/data, roles.test.ts | rouge, 1 test (littéral `securite.test.ts:410`) |

**Survivantes** (constats) : M01 (Z1-01), M02 (Z1-05), M03 (Z1-04), M05 (Z1-02), M14 (Z1-03). **Preuves structurelles** : M15 (`tsc` OK après renommage → Z1-09), M21 (vert sur `src/pages` + `src/data` → Z1-07). M19 est un test temporaire (Z1-06), pas une mutation.

## 4. Non vérifiable ici

- **Le catalogue `roles` et les politiques de la base de PRODUCTION** : Z1-02 et Z1-14 portent sur les fichiers ; savoir si la production a dérivé demande `select code, attribuable_par from roles` et la recette `supabase/tests/roles-rls.sql` sur le projet de test.
- **Le rendu du `.xlsx` exporté dans Excel** (Z1-03) : il manque Excel ou LibreOffice pour ouvrir un fichier produit par `ecritClasseur` et lire « 7:00 » ou « 0,2916 ».
- **La provenance de l'oracle des tests d'import** : `docs/grilles-historique/*.json` sont « générées le 25/08/2026 » (docs/01 l. 163-165), vraisemblablement par ce même importeur. `import-grille.test.ts` compare donc l'importeur à sa propre sortie figée : cela verrouille la régression, pas la conformité au document papier. Ce qui trancherait : dix cellules du document d'exploitation (PDF ou papier) confrontées à la main au JSON.
- **Le coût sur Raspberry** : mesuré sur ce poste seulement (0,03-0,04 ms par appel) ; un facteur 20 en gare reste sous la milliseconde, la règle « re-rendu 1×/s » n'est pas menacée par le noyau. Une mesure `performance.now()` sur un Pi le confirmerait définitivement.
- **L'étendue de Z1-14** : seules les politiques `affluence` (pont calculé) et `grilles` (littéral) ont été éprouvées ; les 50 autres n'ont pas été mutées une à une.

## 5. Compte

- **Constats : 14** — famille 1 : 2 (Z1-10, Z1-11) · famille 2 : 6 (Z1-01 à Z1-06) · famille 3 : 6 (Z1-07, 08, 09, 12, 13, 14) · famille 4 : 0 (mesuré, rien à signaler). Catégories : 14 Ouvert, 0 Déjà tombé, 0 Sans objet, 0 Ne se corrige pas. Pour qui : 13 Myosotis, 1 Thomas ou Myosotis (Z1-10, geste court).
- **Mutations : 24** (M01-M18, M20-M25) — **17 tuées** (§3), **5 survivantes franches** (M01, M02, M03, M05, M14), **2 preuves structurelles** (M15 par `tsc`, M21 hors noyau) ; taux de survie franc 5/24. Plus 1 test temporaire (M19), supprimé.
- **`git status --porcelain` final** : vide (vérifié après chaque restauration et en dernier ; aucun fichier ne reste dans le worktree). Outils de campagne dans `scratchpad/zone-core/` (`replace.js`, `mut.sh`), hors worktree.
