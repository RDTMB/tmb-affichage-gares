# Relecture adversariale — zone 3 : la supervision

Commit relu : `0739500` (= `main`), worktree `wt-sup`. État de référence vérifié avant et après : `git status --porcelain` vide.

## 1. Périmètre couvert

**Lu intégralement** : `CLAUDE.md`, `.claude/regles-horaires.md`, `.claude/regles-courses-libres.md`, `.claude/charte-graphique.md`, `docs/01-spec-fonctionnelle.md` §5 (l. 866–1307), `docs/02-spec-technique.md` §5 (l. 632–744), `docs/import-grilles.md` ; `src/core/roles.ts` ; `src/pages/supervision.ts` (l. 190–5680 ; l. 1–190 = en-tête de commentaires, parcouru par grep), `supervision-logique.ts` (fonctions `barrePublication`, `etatFraicheurEcran`, `pastilleSurveillance`, `bandeauGuetteur`, `routageCirculations` ; le reste par titres et greps), `onglet-horaires.ts` (structure, `rendre()`, les trois points de réinitialisation, l. 125–140), `horaires-onglet.ts`, `etat-publiable.ts`, `brouillon.ts`, `correction-grille.ts`, `voir-comme.ts`, `lien-auth.ts`, `mot-de-passe-oublie.ts` ; `supervision.html` ; `src/data/index.ts`, `provider.ts` (signatures), `supabase.ts` (`onChange`, `traduire`, `getOngletsParRole`, `reinitialiseJour`), `supabase/schema.sql` (politiques `jours`).
**Tests lus** : voir-comme, guetteur-supervision, fraicheur, brouillon, apercu-egale-publication, routage-publication, onglet-actif, journee-non-confirmee, resume-journee (intégralement) ; supervision-logique, etat-publiable, etat-publiable-dates, horaires-onglet, correction-grille, lien-auth, mot-de-passe-oublie, responsive-supervision, roles, affluence, train-special, libelle-course, acces-course, tolerance-acces, `src/data/commanditaire.test.ts` (titres + toutes les assertions textuelles).

**Mutations** : 37, sur 22 fichiers de test, chacune appliquée dans le worktree, éprouvée par `npx vitest run <test>`, restaurée par `git checkout -- <fichier>` et suivie d'un `git status --porcelain` vide (script `zone-sup/mutations.cjs`, résultats bruts dans `mutations-resultats-campagne{1,2,3}.json`). 27 tuées, 10 survivantes.

**Non couvert** : `supervision.css` en lui-même (3 757 l., lu par greps et par le test responsive seulement) ; les parties des tests affluence/train-special/libelle-course/acces-course/tolerance-acces/commanditaire qui portent sur `ecran.ts`, le SQL ou `supabase.ts` (autres zones) ; tout ce qui demande un navigateur ou une session Supabase (§5).

## 2. Constats

### Z3-01 — La suppression en attente d'un train supplémentaire déjà publié disparaît du compteur, du garde-fou de sortie et du bandeau d'aperçu dès qu'on quitte sa date
- **Famille** : 1 (garde-fou posé le 29/08 pour le brouillon, rendu inopérant par l'ajout de `brouillonSupSupprimes` le 04/09 : `videDate()` a été mis à jour, pas les trois fonctions ci-dessous).
- **Où** : `src/pages/supervision.ts` l. 543–552 (`datesPubliables` : `dateSel ∪ brouillonCirc ∪ brouillonTerminus ∪ brouillonSection`, jamais `brouillonSupSupprimes`), l. 466–474 (`nbEnAttente`), l. 477–485 (`rienEnAttente`) ; mise en attente l. 2881–2888 (`brouillonSupSupprimes.set`, puis `brouillonCirc.get(dateSel)?.delete(numero)`) ; publication l. 5243–5253 ; `beforeunload` l. 5529–5532 ; déconnexion l. 5499–5507.
- **Preuve** : lecture. Scénario : train 101/102 publié sur D ; « Supprimer ce train » → seule `brouillonSupSupprimes` porte D ; barre = 2 écarts tant qu'on est sur D ; `allerDate(D2)` → `datesPubliables()` = {D2} → 0 écart, « Tout est publié ✓ », bouton `disabled` (l. 654) ; `rienEnAttente()` vrai → aucun avertissement à la fermeture ni à la déconnexion ; le bandeau d'aperçu dit « Aucune modification en attente. ». Mutation **M36** (retirer `brouillonSection.keys()` de `datesPubliables`) : 73 tests verts → le câblage n'est éprouvé par aucun test.
- **Coût** : la suppression est impubliable tant qu'on n'est pas revenu sur sa date, et perdue sans un mot au rechargement ; ou publiée plus tard, à la faveur d'une autre modification, sans que l'agent s'en souvienne.
- **Catégorie** : Ouvert. **Pour qui** : Myosotis (trois lignes : ajouter `...brouillonSupSupprimes.keys()` et `brouillonSupSupprimes.size` aux trois fonctions) — mais assez court pour Thomas s'il préfère. **Confiance** : haute.

### Z3-02 — Le nombre annoncé à la déconnexion pendant l'aperçu est un nombre de DATES, et le test refuse la correction
- **Famille** : 2 (le test verrouille le défaut) + 3 (la bonne fonction existe, exportée, jamais appelée).
- **Où** : `supervision.ts` l. 466–474 (`brouillonCirc.size` = nombre de dates, `Map<date, Map<numero>>`) et l. 5499–5503 (`${enAttente} modification(s) en attente de publication seront perdues`) ; `voir-comme.test.ts` l. 291–321 (`expect(corps).toContain('brouillonCirc.size')`) ; `brouillon.ts` l. 64 (`nbCirculationsEnAttente`, aucun appel hors tests — `orphelins.cjs`).
- **Preuve** : **M02** (`brouillonCirc.size` → `nbCirculationsEnAttente(brouillonCirc)`) : `voir-comme.test.ts` ROUGE, 1 test tombé — pour un mutant qui est le comportement voulu.
- **Coût** : douze trains modifiés le même jour = « 1 modification(s) seront perdues » ; et le prestataire qui corrige casse un test « pour la mauvaise raison ».
- **Catégorie** : Ouvert. **Pour qui** : Myosotis. **Confiance** : haute.

### Z3-03 — La lecture seule de Circulations pour l'admin ne tient que par l'attribut `disabled` : ni les gestionnaires ni le test ne verrouillent la règle
- **Famille** : 2 (contrôle inerte) + 3 (motif « disabled ET le gestionnaire refuse » appliqué à trois commandes sur vingt).
- **Où** : `supervision.ts` l. 771–773 (`peutModifierCirculations`) ; l. 2825–2973 (`surAction`, 16 actions : aucun contrôle de droit, seulement `hors_saison`/`enregistre`) ; l. 1934–1975 (`btn-facultatifs`), 2759–2779 (`terminusChange`), 2699–2738 (section), 2655–2687 (réinitialisation) — idem ; contre l. 960–964 (`changeAcces`), 2434 et 2487 (train sup), 3378–3381 (Places) qui refusent dans le gestionnaire. Test : `train-special.test.ts` l. 361–369 (trois chaînes).
- **Preuve** : **M26** (`peutModifierCirculations` ouvert à `circulations.special`, donc l'admin modifie tout) : `train-special` + `acces-course` = 108 tests VERTS.
- **Coût** : un admin qui retire `disabled` dans l'inspecteur — le scénario que docs/01 §5.7 nomme — met des trains de grille au brouillon ; RLS refuse à « Publier » → « Publication incomplète », brouillon coincé. RLS tient ; la règle docs/01 §5.5 (admin = spécial seulement) n'est verrouillée que par des chaînes.
- **Catégorie** : Ouvert. **Pour qui** : Myosotis. **Confiance** : haute.

### Z3-04 — Le test « le redessin ne choisit plus l'onglet » reste vert quand le défaut du 15/09 est réintroduit
- **Famille** : 2.
- **Où** : `onglet-actif.test.ts` l. 103–130 (cherche `ongletAOuvrir(` et l'absence de `visibles[0]`) ; `supervision.ts` l. 1082.
- **Preuve** : **M23** (`ongletAOuvrir(ouvert, visibles)` → `ongletAOuvrir(undefined, visibles)` : la page rouvre le premier onglet visible à chaque `appliqueRoles()`, exactement le défaut décrit en tête du test) : 8 tests VERTS.
- **Coût** : la page peut de nouveau sauter sur Circulations à chaque case cochée sans qu'un test le dise.
- **Catégorie** : Ouvert (remplacer la chaîne par `ongletAOuvrir(ouvert, visibles)` littéral, ou mieux, éprouver `appliqueRoles` — voir §3). **Pour qui** : Myosotis. **Confiance** : haute.

### Z3-05 — « Entrer/sortir de l'aperçu ne recharge jamais la page » n'interdit que deux orthographes
- **Famille** : 2 (assertion négative trop étroite).
- **Où** : `voir-comme.test.ts` l. 262–278 (`not.toContain('location.reload')`, `not.toContain('location.href')`).
- **Preuve** : **M01** (`window.location.replace(window.location.pathname)` ajouté à `sortApercu`) : 32 tests VERTS.
- **Coût** : la « contrainte dure » de docs/01 §5.7 (le brouillon ne vit qu'en mémoire) peut être violée par `replace`/`assign` sans qu'un test tombe.
- **Catégorie** : Ouvert. **Pour qui** : Myosotis. **Confiance** : haute.

### Z3-06 — Le refus de l'aperçu est LEVÉ synchroniquement là où 77 appelants attendent une promesse rejetée : le toast « aperçu : lecture seule » ne les atteint jamais
- **Famille** : 3 (deux conventions : lever / rejeter), avec une facette 1 (`voir-comme.ts` l. 161–166 promet que « le toast doit pouvoir dire "c'est un aperçu" »).
- **Où** : `voir-comme.ts` l. 195–206 (`throw new RefusApercu(prop)` dans un wrapper de méthode `async`) ; `supervision.ts` : 41 sites `void provider.x(…).then(…).catch(erreurVersToast)` sur une ligne + 36 sur deux lignes (ex. l. 3793–3803, 4160–4167, 5080–5089), contre 23 sites `await` dans un `try` ; `erreurVersToast` l. 682–690.
- **Preuve** : test temporaire `src/pages/zz-preuve-refus-synchrone.test.ts` (2 tests verts, supprimé ensuite, status propre) : `void provider.saveMedia().then().catch(cb)` → `cb` jamais appelé, `RefusApercu` s'échappe du gestionnaire ; l'appelant `await` dans `try` le reçoit.
- **Coût** : le verrou TIENT (rien ne part), mais dans le scénario nommé par la doc — `disabled` retiré dans l'inspecteur — l'agent n'a aucun message, seulement une exception console ; et toute méthode ajoutée demain et appelée en `void provider.x()…catch()` aura le même silence.
- **Catégorie** : Ouvert (`return Promise.reject(new RefusApercu(prop))` — le test 7.1 attend `toThrowError`, il change avec). **Pour qui** : Myosotis. **Confiance** : haute.

### Z3-07 — L'onglet Horaires propose à l'admin de réinitialiser des journées que RLS lui refuse, après avoir déjà enregistré et activé la grille
- **Famille** : 1 (« l'interface affiche le bouton, la base refuse l'écriture » — le pire cas nommé dans `roles.ts` l. 167–171).
- **Où** : `onglet-horaires.ts` l. 133 (`peutEcrire` = `grilles` seul), l. 292–300 / 569–577 / 894–900 (cases « journées à réinitialiser », sans condition de droit), l. 363 / 682 / 1079 (`provider.reinitialiseJour` APRÈS `saveGrille` et `setGrilleActive`) ; `supabase.ts` l. 775–788 (`delete from jours` + `exigeLignes`) ; `schema.sql` l. 777–783 (delete réservé à `technique` ; `supervision` par « jours ecriture ») ; `roles.ts` l. 187–208 (admin : `grilles` oui, `journee.reinitialiser` non) ; `docs/import-grilles.md` étape 4 (« Cocher celles à réinitialiser », sans réserve).
- **Preuve** : lecture croisée code / RLS / matrice.
- **Coût** : un administrateur qui coche « réinitialiser » à l'import, à la correction ou à la modification des dates lit « journée absente, ou réinitialisation non autorisée pour vos rôles » APRÈS que la nouvelle grille est en service et l'ancienne désactivée, sans ligne d'historique (`logPublication` non atteint) : opération à moitié faite, message qui envoie chercher une journée absente.
- **Catégorie** : Ouvert (masquer les cases sans `journee.reinitialiser`, ou réinitialiser AVANT d'activer). **Pour qui** : Myosotis. **Confiance** : haute (lecture) — non exécuté sans base.

### Z3-08 — L'écriture immédiate du mode des médias est comptée comme « en attente »
- **Famille** : 3 (deux notions, `bump` / `bumpEnAttente`, la mauvaise appliquée).
- **Où** : `supervision.ts` l. 3826–3843 (`saveParams({ mode_medias })` immédiat puis `bumpEnAttente(...)`) contre l. 3845–3874 (durée horaires : `bump`) ; définitions l. 661–669 et 677–680 (« n'a encore touché aucun écran »).
- **Preuve** : lecture ; **M37** (`bumpEnAttente` → `bump`) : 127 tests VERTS, rien ne distingue les deux.
- **Coût** : `referenceMajMs` n'avance pas → la pastille « à jour / en retard » et « Appliqué sur N/N écrans » ne jugent pas cette écriture, alors que les écrans l'ont reçue.
- **Catégorie** : Ouvert. **Pour qui** : Myosotis. **Confiance** : haute.

### Z3-09 — La ligne « Aucun service ne circule à cette date » couvre 8 colonnes d'un tableau qui en a 9
- **Famille** : 1 (colonne Accès ajoutée le 12/09, `colspan` non suivi).
- **Où** : `supervision.ts` l. 1866 (`colspan="8"`) ; `supervision.html` l. 463–475 (neuf `<th>`).
- **Preuve** : lecture ; **M38** (8 → 9) : 43 tests VERTS (`responsive-supervision.test.ts` l. 228–240 ne teste `td[colspan]` qu'en mode carte).
- **Coût** : cosmétique, en mode tableau (≥ 769 px) : une neuvième colonne vide à droite du message hors saison.
- **Catégorie** : Ouvert. **Pour qui** : Thomas (un caractère) ou Myosotis. **Confiance** : haute.

### Z3-10 — La règle des 12 caractères vit en quatre exemplaires et son test est tautologique
- **Famille** : 2 + 3.
- **Où** : `lien-auth.ts` l. 29 ; `supervision.html` l. 168 (placeholder), 170 et 178 (`minlength="12"`) ; `lien-auth.test.ts` l. 67–73 (`'a'.repeat(LONGUEUR_MIN_MOT_DE_PASSE - 1)` : le test lit la constante qu'il devrait éprouver) ; `docs/securite.md` l. 153 (« 12 caractères minimum et quatre familles »).
- **Preuve** : **M19** (12 → 6) : 12 tests VERTS ; aucun test ne lit `minlength` (grep vide).
- **Coût** : la compensation annoncée par docs/securite.md §4 peut tomber à 6 sans qu'un test bouge, HTML et TS peuvent diverger ; « quatre familles » n'est imposé par aucun code du front (réglage Supabase Auth ? — §5).
- **Catégorie** : Ouvert. **Pour qui** : Myosotis. **Confiance** : haute (mutation) ; moyenne pour les « quatre familles ».

### Z3-11 — Deux des cinq paramètres de `appliqueBrouillonJour` et la clé « départ réel » de l'état publiable ne sont exercés par aucun test
- **Famille** : 2 (contrôle absent).
- **Où** : `brouillon.ts` l. 96–154 (`supSupprimes` l. 139–146, `brouillonSection` l. 151) ; `etat-publiable.ts` l. 129–132 (« sans elle la correction n'apparaîtrait dans aucun journal d'écarts ») ; `brouillon.test.ts`, `apercu-egale-publication.test.ts`, `etat-publiable*.test.ts` (aucun n'y passe ces paramètres — grep `depart_reel` vide).
- **Preuve** : **M13** (suppressions sup ignorées) 62 tests VERTS ; **M39** (section ignorée) 62 tests VERTS ; **M15** (clé `depart_reel` retirée) 28 tests VERTS.
- **Coût** : l'aperçu peut montrer un train sup supprimé ou une ligne non restreinte, et un départ réel corrigé peut disparaître du résumé de publication, sans qu'un test tombe.
- **Catégorie** : Ouvert. **Pour qui** : Myosotis. **Confiance** : haute.

### Z3-12 — La documentation promet ce que le code ne fait pas (quatre écarts)
- **Famille** : 1.
- **Où / preuve** :
  (a) docs/01 §5.5, tableau, ligne Technique : « veille de nuit globale et **durée du cache** » — aucun contrôle de `duree_cache_min` dans `supervision.html` ni `supervision.ts` (grep `cache` vide ; le paramètre existe, `src/core/params.ts` l. 52 et 258, borné 3–60).
  (b) docs/01 §5.5 : `publier` n'est listé que pour Supervision ; `roles.ts` l. 185, 207, 222 le donne aux quatre rôles, et **aucun code du front ne le consomme** (grep `'publier'` vide dans `src/pages` et `src/data` hors tests) : la barre « Publier » s'affiche à tout rôle connecté.
  (c) docs/01 §5.6 : « trois exceptions » qui partent immédiatement ; le code en a une quatrième dans Circulations, la réinitialisation (`supervision.ts` l. 2655–2658 : « Seule action de l'onglet Circulations à rester IMMÉDIATE (docs/01 §5.6) » — la section ne la nomme pas).
  (d) docs/02 §5 « les 65 méthodes de `DataProvider` » (67 : `provider.ts` l. 46–336) ; CLAUDE.md « 71 attributs `style=""` en supervision » (79 dans `supervision.html`, + 15 dans `supervision.ts`, + 1 dans `onglet-horaires.ts` = 95 attributs, plus 47 affectations `.style.x =` qui, elles, ne relèvent pas de la CSP).
- **Coût** : le dossier de reprise décrit un réglage inexistant (a), un droit sans consommateur (b) et une règle de brouillon incomplète (c).
- **Catégorie** : Ouvert. **Pour qui** : Thomas (décider pour (a) : ajouter le réglage ou retirer la promesse ; corriger la doc pour b–d). **Confiance** : haute.

### Z3-13 — Quatre exports morts, testés mais jamais appelés
- **Famille** : 3.
- **Où** : `brouillon.ts` l. 64 `nbCirculationsEnAttente` ; `correction-grille.ts` l. 147–150 `avertissementsCorrection` ; `supervision-logique.ts` l. 635 `largeurLibelleEm`, l. 1869 `estOngletAdministration`.
- **Preuve** : `zone-sup/orphelins.cjs` : aucun usage dans le code de production, ni dans un autre fichier ni dans le fichier lui-même ; seulement `brouillon.test.ts`, `correction-grille.test.ts`, `supervision-logique.test.ts`.
- **Coût** : du code lu, testé et maintenu pour rien ; `nbCirculationsEnAttente` est précisément ce que Z3-02 devrait employer.
- **Catégorie** : Ouvert. **Pour qui** : Myosotis. **Confiance** : haute.

### Z3-14 — Au repos, une supervision ouverte émet ~36 requêtes par minute et redessine les neuf onglets toutes les 30 s
- **Famille** : 4.
- **Où** : `supervision.ts` l. 696–729 (`chargeTout` : 8 lectures — grilles, params, messages, médias, modèles, journée, affluence, dernière publication), l. 1004–1025 (`rendreTout` : `listGrilles` via `onglet-horaires.ts` l. 1402, `listJournal` l. 4850 — 100 lignes, onglet Journal ouvert ou non —, `listEcrans` + `getSurveillance` l. 3957), l. 1474–1481 (`onChange` → `chargeTout` + `rendreTout`), l. 1482 (`rendreEcrans` toutes les 10 s = 2 requêtes) ; `src/data/supabase.ts` l. 588 (sondage toutes les 30 s **inconditionnel** — le commentaire dit « repli si le temps réel est indisponible » ; zone data).
- **Preuve** : comptage sur le code : 12 requêtes par notification × ≥ 2/min + 12/min pour les écrans ≈ 36/min par poste ouvert ; chaque écriture d'un écran voyageurs (table `affluence` dans `TABLES_AFFICHAGE`) relance le tout, avec anti-rafale 300 ms.
- **Coût** : supportable sur un poste de bureau ; à mesurer avant d'agir (aucune mesure navigateur ici).
- **Catégorie** : Ouvert. **Pour qui** : Myosotis. **Confiance** : moyenne.

### Z3-15 — Le formulaire de connexion peut abonner deux fois le poste au temps réel
- **Famille** : 4.
- **Où** : `supervision.ts` l. 5556–5569 (`submit` : bouton jamais désactivé, `signIn` asynchrone) → l. 5535–5554 → l. 1435–1483 (`provider.onChange(...)` et `setInterval(rendreEcrans, 10 s)` sans garde, alors que `brancheOngletsParRole` l. 1165–1171 et `brancheAffluence` l. 1453–1456 en ont une, posée pour ce cas précis : « une session peut être rouverte sans recharger la page »).
- **Preuve** : lecture.
- **Coût** : deux clics sur « Se connecter » = chaque notification recharge tout deux fois, jusqu'au rechargement de la page.
- **Catégorie** : Ouvert. **Pour qui** : Myosotis. **Confiance** : moyenne (non exécuté).

### Z3-16 — « Mot de passe oublié » annonce « un lien vient d'être envoyé » quand le réseau est coupé
- **Famille** : 1 par la forme (message de succès après un échec) — décision assumée.
- **Où** : `mot-de-passe-oublie.ts` l. 119–131 ; docs/02 §5 (« succès, adresse inconnue ou panne confondus », mesuré le 09/09/2026).
- **Preuve** : lecture ; **M20** (remonter l'erreur du fournisseur) : 3 tests tombés — la décision est verrouillée.
- **Coût** : un agent hors réseau attend un courriel qui ne partira pas ; c'est le prix choisi de l'anti-énumération, la limite de débit étant la seule exception.
- **Catégorie** : Ne se corrige pas (décision du 09/09/2026, docs/02 §5). **Pour qui** : Thomas (à connaître). **Confiance** : haute.

### Points instruits sans constat
- **Chemin d'écriture hors du verrou « voir comme »** : aucun. `supervision.ts` et `onglet-horaires.ts` ne contiennent ni `fetch(`, ni `supabase`, ni `XMLHttpRequest` ; les seules écritures locales sont `sessionStorage` (aperçu) et `localStorage` (gare du poste de caisse, l. 3201–3208) ; `onglet-horaires` reçoit le fournisseur enveloppé (l. 5452–5464) ; les fenêtres `window.open` (l. 4292, 5400) ouvrent des pages dont `getJour` ne crée rien par défaut. Le verrou est complet ; ses faiblesses sont Z3-05 (test) et Z3-06 (message).
- **`ongletsVisibles()`** : les trois propriétés mordent — M12a (intersection retirée) 2 tests tombés, M12b (repli vers rien) 10, M12c (liste vide ≠ absence) 1.
- **Guetteur côté supervision** : « en ligne » pour un poste muet → M09, 4 tests tombés (`fraicheur.test.ts`) ; heure hors Paris → M08, 2 tests tombés sous trois fuseaux ; câblage de `rendreEcrans` (M06) et de la case « Surveiller » (M07) : rouges.
- **Droits décidés hors `roles.ts`** : aucune comparaison de rôle en dur dans `supervision.ts`/`onglet-horaires.ts` (seul `u.roles.includes(r)` l. 1354, pour DESSINER une case). Tout passe par `aLeDroit`/`peut`. Restent un droit sans consommateur (`publier`, Z3-12 b) et un droit non consulté là où il faudrait (`journee.reinitialiser`, Z3-07).
- **Onglet Horaires** : lecteur `.xlsx` chargé par `import()` dynamique (`onglet-horaires.ts` l. 843 ; export l. 394–395) ; validation avant enregistrement mordue par M17 (correction, 2 tests) et M18 (import, 1 test) ; `horaires-onglet.test.ts` et `correction-grille.test.ts` ne lisent aucun fichier en texte.
- **Cas n° 5 (sélecteur vers rien)** : `zone-sup/ids.cjs` — 223 identifiants lus par le TS, **0 lu sans être posé** ; 35 « posés jamais lus » sont en réalité lus par des aides (`montreSi`, `montre`, `val`, `champMeteo`, arguments de `controleLibelleSaisi`) ou par délégation `cible.id ===` (`onglet-horaires.ts` l. 1159, 1211, 1335) ; aucun `?.addEventListener` ; aucun `data-*` lu sans être posé ; le remesurage du bandeau vise bien `t-bandeau` (l. 1428) et **M35** (viser Paramètres) est tué par `bandeau-alterne.test.ts`. Classes CSS : relevé non concluant (rendu dynamique), aucun orphelin prouvé.
- **Auth** : pas de redirection construite depuis l'URL dans la zone (`analyseLienAuth` ne lit que le fragment ; `history.replaceState` sur `pathname + search`, l. 5604) ; `definirMotDePasse` et `signIn` remontent leurs erreurs (l. 5564–5568, 5671–5676).

## 3. La réponse à la question des 5 680 lignes

**Mesures** (`zone-sup/mesure-fonctions.cjs`, `etat-module.cjs`, greps) :
- 5 680 lignes dont **1 355 de commentaires** (24 %) ; **124 fonctions** de niveau module couvrant 4 677 lignes ; **360 accès DOM** `$('…')` sur 189 identifiants distincts ; 108 `addEventListener`, 45 `innerHTML =`, 14 `window.confirm`, 66 `toast(` ; ~90 appels au fournisseur (34 méthodes distinctes).
- **Les cinq plus longues** : `initCirculations` l. 1929–2982 (**1 054 l.**, 18,6 % du fichier : une fermeture qui tient ~20 fonctions internes et le répartiteur `surAction` à 16 actions) ; `initParametres` 4932–5184 (253) ; `demarre` 5433–5623 (191) ; `initEcrans` 4136–4312 (177) ; `initMedias` 3783–3947 (165). Puis `rendreCirculations` 157, `publieLeBrouillon` 150, `ligneCirculation` 142, `rendreEcrans` 132, `rendreAffluence` 123.
- **État de niveau module** : **42 `let`** + 8 collections `const` mutées en place (les six réservoirs du brouillon, `joursPublies`, `journal`) = 50 liaisons mutables partagées par tout le fichier. Les plus écrites : `utilisateurs` (5 sites, `initParametres` + `demarre`), `roles` (4 : `entreApercu`, `sortApercu`, `demarre`), `jour` (4 : `rafraichitJourEffectif`, `chargeTout`, `rechargeJour`, `allerDate`), `traductionManuelle` (4) ; 26 variables ont ≤ 2 sites d'écriture, 16 un seul. C'est discipliné pour un fichier de cette taille — mais `roles` réaffecté à quatre endroits est exactement ce que Z3-03 exploite.
- **Onglets servis** : 9 ; 8 dans `supervision.ts`, Horaires dans `onglet-horaires.ts` — qui est **une seule fonction de 1 305 lignes** (`initOngletHoraires`, l. 121–1425), même forme que `initCirculations`.
- **`supervision-logique.ts`** : 47 fonctions, **zéro accès DOM** (grep `document.`/`window.`/`innerHTML` vide) : la séparation annoncée est réelle. Mais la logique qui reste dans `supervision.ts` n'est pas mince : brouillon et publication (`datesPubliables`, `nbEnAttente`, `publieLeBrouillon`), droits d'interface (`peutModifierCirculations`, `appliqueRoles`), aperçu (`entreApercu`/`sortApercu`), tout `surAction`.
- **`style=""`** : 79 dans `supervision.html`, 15 dans `supervision.ts`, 1 dans `onglet-horaires.ts` = **95** (CLAUDE.md dit 71) ; les 47 affectations `.style.x =` ne comptent pas pour la CSP.
- **Ce qu'un prestataire lit pour changer UN onglet** — Écrans, cas favorable : `supervision.html` l. 901–944 ; `supervision.ts` `rendreEcrans` 3953–4084, `majResumeApplication` 4086–4134, `initEcrans` 4136–4312, plus l'état partagé (`ecransConnus`, `referenceMajMs`, `params`, `heurePoste`) ; les quatre décisions pures de `supervision-logique.ts` (235–273, 311–352, 371–399, 431–468) ; `src/core/surveillance-ecrans.ts` ; 8 méthodes du fournisseur ; `supervision.css`. ~600 lignes dans trois fichiers, trouvables parce que chaque bloc est titré. Circulations, cas défavorable : l. 1489–3121 d'un seul tenant (1 630 l.), plus `brouillon.ts`, `etat-publiable.ts`, `publieLeBrouillon` (5199–5348), six fonctions de `supervision-logique.ts` et les règles de `.claude/regles-horaires.md` — c'est le seul onglet réellement difficile.
- **Un test peut-il monter un onglet isolément ?** Non. Le module a cinq effets à l'import : `poseMarquePreversion()` l. 202, `analyseLienAuth(window.location…)` l. 204, `creeProvider(window.TMB_CONFIG…)` l. 233, `creeSourceHeure(new URLSearchParams(window.location.search))` l. 506, et `void demarre()` l. 5680 qui appelle tous les `init*` et fait lever `$()` au premier identifiant absent. Les tests le disent eux-mêmes (`guetteur-supervision.test.ts` l. 220 : « Vitest ne l'importe pas »). **Conséquence mesurée** : 21 fichiers de test lisent `supervision.ts` comme du TEXTE (12 lisent `supervision.html`), pour **729 assertions** `toContain`/`toMatch` ; sur les 16 mutations que j'ai dirigées contre ces assertions, 4 ont survécu (Z3-02, Z3-03, Z3-04, Z3-05) — et le dépôt lui-même en avait déjà relevé un cinquième (le cas n° 5).

**Conclusion (une phrase)** : les 5 680 lignes ne sont pas un problème de lecture — le fichier est commenté au quart, titré par onglet, et sa logique pure est vraiment sortie — mais un problème de **test** : parce que le module s'exécute à l'import, aucune règle qu'il porte ne peut être exercée autrement que par des assertions sur son texte, et cette relecture en a trouvé quatre qui laissent passer le défaut qu'elles prétendent tenir ; le geste utile n'est pas de le découper, c'est de le rendre importable (exporter `demarre(document, config)` et retirer les cinq effets de module), puis de migrer les assertions textuelles onglet par onglet.

## 4. Suspects éprouvés et acquittés

| Test | Mutation (id — ce qui est cassé) | Verdict |
| --- | --- | --- |
| voir-comme.test.ts | M03 — `entreApercu` sans `peut('comptes.lire')` | rouge, 1 tombé |
| voir-comme.test.ts | M04 — `rafraichitJourEffectif` applique le brouillon en aperçu | rouge, 1 |
| voir-comme.test.ts | M05 — `rendreCirculations` ne repose plus `verrouilleApercu()` | rouge, 1 |
| voir-comme.test.ts | M21 — `creerSiAbsent` passe tel quel dans l'enveloppe | rouge, 1 |
| voir-comme.test.ts | M22 — méthode non classée : passe au lieu de lever | rouge, 4 |
| voir-comme.test.ts | M31 — l'en-tête affiche `roles` (simulés) | rouge, 1 |
| voir-comme.test.ts | M32 — restauration sans revérifier sur `rolesReels` | rouge, 1 |
| guetteur-supervision.test.ts | M06 — `rendreEcrans` juge la veille sur `Date.now()` | rouge, 1 |
| guetteur-supervision.test.ts | M07 — la case « Surveiller » écrit toujours `true` | rouge, 1 |
| guetteur-supervision.test.ts | M08 — heure d'envoi sans `timeZone: 'Europe/Paris'` | rouge, 2 (sous UTC, New York, Tokyo) |
| fraicheur + guetteur | M09 — poste muet annoncé « à jour » (seuil × 1000) | rouge, 4 |
| supervision-logique.test.ts | M10 — bouton « Publier » actif quand tout est publié | rouge, 1 |
| routage-publication.test.ts | M11 — nouveauté devinée au lieu de marquée (bug du 04/09) | rouge, 5 |
| roles.test.ts | M12a — `ongletsVisibles` sans intersection (ligne forgée accorde) | rouge, 2 |
| roles.test.ts | M12b — repli vers « aucun onglet » | rouge, 10 |
| roles.test.ts | M12c — liste vide ≠ absence de réglage | rouge, 1 |
| etat-publiable.test.ts | M14 — `sans_voyageurs` retiré de l'état publiable | rouge, 1 |
| etat-publiable-dates.test.ts | M16 — les clés datées figées (retour du « 252 ») | rouge, 4 |
| correction-grille.test.ts | M17 — les erreurs du validateur ne bloquent plus | rouge, 2 |
| horaires-onglet.test.ts | M18 — avertissements non acquittés ne bloquent plus | rouge, 1 |
| mot-de-passe-oublie.test.ts | M20 — l'erreur du fournisseur est remontée | rouge, 3 |
| mot-de-passe-oublie.test.ts | M30 — le mode démo saute l'appel au fournisseur | rouge, 2 |
| libelle-course.test.ts | M24 — `largeurEnEm` mesure sans police chargée | rouge, 1 |
| acces-course.test.ts | M25 — `changeAcces` sans contrôle du droit | rouge, 1 |
| responsive-supervision.test.ts | M27 — `initPublication` n'observe plus la hauteur de la barre | rouge, 1 |
| bandeau-alterne + pieges-desarmes | M35 — remesurage visant Paramètres (cas n° 5 d'origine) | rouge, 1 |
| voir-comme.test.ts | M02 — `nbEnAttente` compte les circulations (correct) | rouge, 1 — **verrouille le défaut** (Z3-02) |

**Survivantes** (10) : M01 → Z3-05 ; M13, M15, M39 → Z3-11 ; M19 → Z3-10 ; M23 → Z3-04 ; M26 → Z3-03 ; M36 → Z3-01 ; M37 → Z3-08 ; M38 → Z3-09.

## 5. Non vérifiable ici

- **Z3-07 en réel** : il faudrait une session admin sur la base de test et un import avec une journée cochée, pour lire le message exact et l'état final (grille active, journée intacte, historique vide).
- **Z3-14 et Z3-15** : le nombre de requêtes par minute et la double souscription demandent un navigateur avec l'onglet Réseau ouvert (le sondage 30 s vit dans `src/data/supabase.ts`, autre zone).
- **Z3-10, « quatre familles de caractères »** : peut être un réglage Supabase Auth (tableau de bord, « Password requirements ») — à vérifier dans le projet, pas dans le dépôt.
- **Le verrou RLS derrière Z3-03** (l'admin ne peut pas écrire une circulation de grille) : la recette `supabase/tests/roles-rls.sql` l'affirme ; non rejouée ici.
- **Z3-06 dans un vrai navigateur** : l'exception non gérée est prouvée en Node ; l'absence de toast à l'écran découle de la lecture, pas d'une observation.

## 6. Compte

- **Constats** : 16. Par famille : 1 → 6 (Z3-01, 07, 09, 12, 16 + facette de 06) ; 2 → 6 (Z3-02, 03, 04, 05, 10, 11) ; 3 → 5 (Z3-02, 03, 06, 08, 13 — deux constats portent deux familles) ; 4 → 2 (Z3-14, 15). Par catégorie : Ouvert 15, Ne se corrige pas 1 (Z3-16), Déjà tombé 0, Sans objet 0. Pour qui : Myosotis 12, Thomas 4 (Z3-09, Z3-12, Z3-16, et Z3-01 s'il veut le geste court).
- **Mutations** : 37 (campagne 1 : 33 ; campagne 2 : 3 ; campagne 3 : 1), sur 22 fichiers de test ; **27 tuées, 10 survivantes** (taux de survie 27 %) ; plus un test temporaire de preuve (Z3-06), supprimé après exécution.
- **`git status --porcelain` final** : vide (vérifié après la dernière mutation et après la suppression du test temporaire ; `HEAD` = `0739500`). Scripts et résultats hors worktree, dans `scratchpad/zone-sup/` (`mutations.cjs`, `mutations-liste{,2,3}.cjs`, `mutations-resultats-campagne{1,2,3}.json`, `ids.cjs`, `orphelins.cjs`, `mesure-fonctions.cjs`, `etat-module.cjs`, `notes-intermediaires.md`).
