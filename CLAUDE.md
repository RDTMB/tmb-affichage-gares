# TMB — Affichage voyageurs en gare (v2)

Application web d'information voyageurs pour le Tramway du Mont-Blanc (Régie
Départementale, Haute-Savoie) : écrans dynamiques dans 6 gares + poste de
supervision. Ligne à crémaillère, voie unique, 12,8 km, Le Fayet (580 m) →
Nid d'Aigle (été seulement), 4 rames : Marie, Anne, Jeanne, Marguerite.

## Documents de référence (à lire avant de coder)

- `docs/01-spec-fonctionnelle.md` — quoi afficher, règles métier, cas limites
- `docs/02-spec-technique.md` — architecture, schéma de données, sécurité, déploiement
- `docs/03-plan-de-developpement.md` — étapes ordonnées avec critères d'acceptation
- Les grilles horaires vivent EN BASE (table `grilles`), chargées par
  l'exploitation depuis l'Excel exploitation dans la Supervision → onglet
  Horaires (`docs/import-grilles.md` ; contrat de format :
  `docs/format-excel-horaires.md`). `docs/grilles-historique/` = référence
  été 2026 (oracle des tests, grilles de la démo), jamais modifiée à la main
- `public/logos/` — logos officiels SVG (logo rond, logo rond blanc, picto
  motrice express blanc et marine)
- `maquettes/` — maquettes HTML **validées par l'exploitant** : REPRODUIRE
  fidèlement leur rendu (elles font foi pour le visuel)

## Charte graphique 2026 (obligatoire)

- Couleurs : rouge `#E52A23`, bleu clair `#BDDCF4`, bleu-gris `#708DA4`,
  rouge foncé `#8B1419`, crème `#F1E5D1`, marine `#213B57`.
- Rames (pastilles) : Marie `#2E74B5`, Anne `#7FA51E`, Jeanne `#C2447A`,
  Marguerite blanc cerclé rouge `#E52A23` — modifiables dans Paramètres.
- Typographies : **Amaranth** (titres, noms de gares) + **Lato** (textes,
  heures) — auto-hébergées via @fontsource, JAMAIS de CDN (les écrans
  doivent démarrer sans internet).
- Logo : uniquement les fichiers de `public/logos/`, jamais redessiné,
  jamais déformé (interdits de la charte).
- `logo-long.svg` = logo HORIZONTAL officiel, porté par le bandeau de titre
  de l'écran de gare et de la grille du jour. Son `viewBox` (`119 229 1678
  617`) recadre le dessin : l'export d'origine laissait 46 % de VIDE en
  hauteur, et sans ce recadrage le logo s'afficherait à 71 px au lieu de 132
  — plus petit que le rond qu'il remplace. Ce n'est PAS une erreur à
  « corriger » : le recadrage retire du vide, il ne redimensionne ni ne
  déforme rien. Le fichier a aussi été débarrassé de cinq calques
  Illustrator invisibles (441 Ko de rasters hors du viewBox) ; le rendu est
  identique au pixel, mais leur data URI base64 pesait 427 Ko gzippés dans
  les bundles écran ET grille.
- Les écrans CENTRÉS gardent le logo ROND BLANC (écran neutre, fin de
  service, tronçon fermé, supervision) : il n'existe pas de version
  horizontale blanche exploitable, et une marque circulaire au-dessus d'une
  horloge fonctionne là où un logo horizontal étiré en plein écran non.

## Stack et contraintes

- **Vite + TypeScript, sans framework** (vanilla). Cibles : Raspberry Pi en
  navigateur kiosque (écrans) + navigateurs récents (supervision).
- Multi-pages : `index.html` (portail de test), `ecran.html`, `grille.html`,
  `supervision.html`.
- **Couche d'accès aux données interchangeable** : interface `DataProvider`
  (`src/data/provider.ts`). Phase 1 `SupabaseProvider`, phase 2 `ApiProvider`
  (micro-serveur Windows). AUCUN appel Supabase hors de `src/data/`.
- Bundle JS < 400 Ko gzippé hors polices ; re-rendu 1×/s max ; pas de fuite
  mémoire (18 h/jour d'affichage).
- Import Excel : `src/core/lecture-xlsx.ts` (lecteur .xlsx maison sur
  `fflate`, chargé à la demande par la supervision UNIQUEMENT — jamais dans
  les bundles des écrans) et `src/core/import-grille.ts` (cellules → Grille,
  validation, PUR et testé sur les cellules du document réel en
  `src/core/__fixtures__/`).

## Conventions

- UI voyageurs bilingue FR + EN ; code en anglais ; commentaires en français.
- TypeScript `strict`, Prettier. Fuseau Europe/Paris, format `HH:MM`
  (les secondes des horaires officiels — ex. 07:27:30 — sont tronquées à
  l'affichage mais conservées dans les calculs).
- Gares (ordre de la ligne) : `le-fayet`, `saint-gervais`, `motivon`,
  `col-de-voza`, `bellevue`, `nid-daigle`.
- Toute logique horaire vit dans `src/core/horaires.ts`, PURE et testée
  (Vitest) ; l'heure y est toujours injectée (jamais `Date.now()` dans
  `src/core/`) pour permettre l'heure simulée `?simule=HH:MM[:SS]`
  (les secondes servent aux états « À QUAI » / « DÉPART IMMINENT », qui se
  jouent sur une fenêtre de 30 s).

## Règles métier qui piègent (ne pas improviser)

- **Trains numérotés** 1–25 impairs = montées, 2–26 pairs = descentes.
  Libellé canonique, partout : « TRAIN 9 » (majuscules, sans « n° ») —
  `libelleTrain()`, seule source pour la supervision et la grille du jour.
  SEULE exception, voulue par l'exploitant : le badge rouge devant le nom de
  la gare de destination sur l'écran de gare, qui porte l'écriture compacte
  « T9 » / « SUP 2 » (`libelleTrainCourt()`, même calcul de rang). Cette
  divergence est délibérée, ce n'est pas un oubli à « corriger ».
- **Rames appariées** : la rame se choisit sur la montée UNIQUEMENT ; la
  descente de la même rotation hérite automatiquement (non modifiable).
  En supervision, montée et descente d'une rotation sont affichées l'une
  sous l'autre.
- **Section exploitée** (`jours.gare_debut` / `gare_fin`, bornes incluses) :
  « une partie seulement de la ligne est exploitée » est UN concept, pas deux.
  « Terminus Bellevue » n'en est qu'un cas particulier — il n'existe donc
  qu'une seule troncature dans le moteur, `tronqueTrain()`, et les bornes se
  lisent TOUJOURS par `sectionDuJour()` (un instantané en cache d'avant le
  déploiement n'a pas les colonnes ; un index -1 viderait tous les écrans).
  INVARIANT : la section est la borne EXTÉRIEURE, la colonne `terminus` d'une
  circulation ne peut que réduire davantage, jamais dépasser. Les heures ne
  sont jamais recalculées : la grille est simplement TRONQUÉE. Une gare hors
  section affiche « Ligne fermée » (message saisi, sinon défaut bilingue
  construit sur la section) et JAMAIS « service terminé ». La section se
  REPORTE sur la journée suivante à sa création (`sectionReportee()`) : un
  chantier dure des semaines, et une journée oubliée annoncerait des trains
  qui ne circulent pas.
- **Départ RÉEL d'un train supplémentaire** (`circulations.depart_reel`) :
  le temps de stationnement au terminus est ESTIMÉ à la création (battement),
  et les horaires de la descente en découlent. Sur la ligne de DESCENTE, un
  bouton « Le train est reparti » ouvre une confirmation (heure pré-remplie à
  l'heure courante, récapitulatif gare par gare recalculé en direct), puis
  « Corriger l'heure de départ » — une heure constatée reste rectifiable.
  `recalculeDescenteSup()` relit la desserte dans les passages EXISTANTS et ne
  la réinvente jamais : l'agent l'a choisie à la création. Refus si l'heure
  précède l'arrivée de la montée, ou dépasse l'heure courante de plus de
  2 min (on CONSTATE un départ, on ne le programme pas) ; avertissement
  non bloquant au-delà de 30 min d'écart avec l'estimation.
  EXCEPTION ASSUMÉE, à ne pas « corriger » : cette écriture est IMMÉDIATE
  alors que tout l'onglet Circulations passe par le brouillon et « Publier ».
  La correction a lieu au moment où le train s'en va, avec des voyageurs qui
  attendent en bas ; un clic de publication supplémentaire laisserait une
  heure fausse à l'écran pendant ce temps. En contrepartie, l'échec est dit
  franchement — message PERSISTANT, anciennes heures conservées. L'écran de
  gare l'annonce en couleur NEUTRE (« Horaire confirmé / Departure
  confirmed ») : ce train n'est pas en retard, son heure n'était pas ferme.
- **Affluence ≠ statut** : « Complet » / « Dernières places » (table
  `affluence`, docs/01 §2.8) est un axe INDÉPENDANT de la ponctualité — un
  train à l'heure peut être complet, un train en retard peut être vide. D'où
  une table à part, et non une colonne de `circulations` : ce n'est pas la
  même donnée, et surtout pas la même main (la caisse écrit ici, jamais dans
  `circulations`). La donnée est (date, numéro) : un TRAIN 9 complet l'est
  dans TOUTES les gares qu'il doit encore desservir.
  L'ABSENCE de ligne vaut « places disponibles » — pas de troisième niveau,
  remettre un train à la normale est une SUPPRESSION.
  Tout se déclare dans l'onglet « Places », qui porte la MÊME barre de date
  que Circulations (même `allerDate`, même `dateSel`) : la caisse n'a pas
  l'onglet Circulations et doit pouvoir préparer le lendemain. Le jour même
  la liste ne garde que les DÉPARTS RESTANTS ; les autres dates listent TOUS
  les trains — il n'y a pas d'heure courante à laquelle se comparer. Une date
  PASSÉE est en lecture seule pour tout le monde, supervision comprise, et
  une journée pas encore OUVERTE l'est pour la caisse (RLS réserve `jours` à
  la supervision) : la liste reste affichée, les sélecteurs sont éteints, un
  bandeau dit qui l'ouvre, et le signal temps réel rend la main dès que c'est
  fait. Le refus est calculé UNE fois (`saisieAffluence`) et sert au rendu
  comme à l'écriture — `disabled` se retire dans l'inspecteur.
  Le remplissage se déclare dans l'onglet **Places** UNIQUEMENT (droit
  `affluence`, ouvert à admin, supervision et caisse) : un seul endroit pour
  les deux rôles. Circulations n'en garde que le filet de rangée, qui est une
  information et non une commande.
  EXCEPTION ASSUMÉE, à ne pas « corriger » : l'écriture est IMMÉDIATE, hors
  brouillon et hors « Publier », pour la même raison que `depart_reel` — on
  constate au guichet qu'on ne vend plus, avec des voyageurs sur le quai. En
  contrepartie l'échec est dit franchement (message persistant) et l'écran de
  saisie garde son état précédent.
- **Train SPÉCIAL** (`circulations.nature = 'special'`, docs/01 §2.9) : course
  AFFRÉTÉE, affichée en gare avec la mention « privé » bilingue. `nature` est
  un ENUM — `grille` | `supplementaire` | `special` — et surtout PAS un second
  booléen à côté de `supplementaire` : « sup ET spécial » n'existe pas en
  exploitation et rien ne l'empêcherait en base. Trois formes (aller-retour,
  aller simple, stationnement long en haut) ; série de numéros PROPRE à partir
  de 201, tenue par une contrainte SQL, parité impair = montée conservée, et le
  numéro pair RÉSERVÉ même pour un aller simple (`sync_rame_descente` écrit
  dans `numero + 1`). Créé par la supervision ET par l'admin, qui n'obtient pas
  `circulations` pour autant : droit propre `circulations.special` et trois
  politiques RLS bornées à `nature = 'special'` — l'onglet Circulations s'ouvre
  à lui en LECTURE SEULE, bouton de création excepté. Terminus sans limite
  (avertissement non bloquant hors section) ; express et vélos gardés,
  facultatif retiré ; `commanditaire` en colonne propre, INTERNE (retirée à
  `anon` par droit de colonne). EXCLU de l'onglet « Places » et sans pastille
  de remplissage à l'écran : un train affrété ne vend pas ses places au
  comptoir, et les deux pastilles ne tiendraient pas ensemble (mesuré).
- **Libellé LIBRE** d'une course hors grille (`circulations.libelle`, docs/01
  §2.10) : nom d'affichage FACULTATIF qui remplace VERBATIM « SPÉ n » / « SUP n »
  partout — supervision, grille du jour, badge de l'écran. Il MASQUE le numéro,
  qui reste dans sa plage. `libelleTrain()` et `libelleTrainCourt()` restent les
  SEULES sources du nom : ne pas fabriquer un troisième chemin. Borne en
  LARGEUR et non en caractères (4,9 em mesurés à la police RÉELLE du badge ;
  plafond CSS 5 em en filet) — « MARIAGE » et « 12345678 » ont huit caractères
  et pas la même largeur. La police doit être CHARGÉE avant de mesurer : un
  repli est faux dans le sens qui laisse passer (Arial rend « WWWWII » plus
  étroit que Lato) ; si elle manque, on refuse le LIBELLÉ, jamais la création
  du train. Unique dans la journée, comparaison sur la forme COURTE contre
  `jour.circulations` (et non `trainsDuJour()`, qui écarte les facultatifs non
  activés), insensible à la casse et aux espaces de bord.
  Les CASES DE DESSERTE suivent « express » — cochée, Voza et Bellevue se
  décochent ; décochée, elles se recochent — sans jamais être verrouillées.
- **Accès d'une course** (`circulations.acces`, docs/01 §2.12) : `public` |
  `prive` | `mixte`, sur TOUTE circulation quelle que soit sa nature. AXE
  INDÉPENDANT de `nature` — « d'où vient ce train » et « à qui il est vendu »
  sont deux questions, et les confondre était le défaut d'origine : « privé »
  se DÉDUISAIT de `nature = 'special'`, donc un spécial était forcément privé
  et un train de GRILLE affrété impossible à dire (la plage ≥ 201 porte le
  sens). Un champ à trois états, jamais deux booléens. La pastille
  « Privé / Private » et l'exclusion de l'onglet Places suivent `acces`, plus
  `nature` (`courseFermee()` — SEULE lecture, ne pas en fabriquer une
  deuxième) ; `mixte` ne change RIEN à l'écran, le voyageur peut monter.
  Montée et descente se privatisent SÉPARÉMENT — jamais de propagation à la
  course appariée. Choix OBLIGATOIRE à la création d'un spécial, sans valeur
  par défaut. Droits : admin et supervision, ni la caisse ni le technique. La
  déclaration d'affluence SURVIT à la privatisation (masquée, pas effacée) —
  écart assumé avec la réinitialisation d'une journée, écrit dans le code.
  **L'écriture passe par `public.definir_acces`** (SECURITY DEFINER, deux
  colonnes) et par elle SEULE : aucune politique RLS n'est ajoutée à
  `circulations`, parce qu'une politique filtre des LIGNES et jamais des
  COLONNES — en ouvrir une à l'admin lui donnerait `statut`, `retard_min`,
  `terminus` et `passages`. Les droits de colonne ne pouvaient pas servir :
  admin, supervision et caisse sont le MÊME rôle PostgreSQL. C'est la seule
  dérogation à « aucun SECURITY DEFINER dans `public` », et elle porte trois
  garanties vérifiées par `src/data/securite.test.ts`.
- **Terminus par train** : chaque montée (hors express) peut être limitée à
  Bellevue individuellement (colonne Terminus) ; sa descente appariée part
  alors de Bellevue. La bascule « Terminus Bellevue » s'exprime « à partir
  du TRAIN N » (N = montée, impair ; pair normalisé vers N−1) et PRÉ-REMPLIT
  la colonne des rotations dont la montée porte un numéro ≥ N — la colonne
  reste prioritaire et ajustable ; journée entière = à partir du T1.
- **Express** : passages absents à col-de-voza et bellevue (rien à afficher
  dans ces gares) ; GRAND picto motrice à droite du nom de la destination +
  ligne « EXPRESS — sans arrêt / non-stop : Col de Voza & Bellevue ». Un
  express n'est JAMAIS tronqué à Bellevue : dans une plage limitée, il
  circule normalement et est signalé « à traiter » (suppression ou
  requalification manuelle en supervision) ; sa descente appariée non
  express part, elle, de Bellevue.
- **Facultatif** : n'apparaît sur AUCUN écran tant qu'il n'est pas activé en
  supervision ; une fois activé, il s'affiche normalement.
- **Terminus Bellevue** (fermeture imprévue, météo : à partir du TRAIN N) :
  montées ≥ N → destination « Bellevue — terminus exceptionnel », express
  signalés « à traiter » (jamais retirés automatiquement), écran du Nid
  d'Aigle → état « tronçon fermé » bilingue avec logo dès qu'il n'a plus
  aucun passage à afficher. En HIVER, Bellevue est le terminus NORMAL : la
  grille d'hiver n'a simplement aucun passage au Nid d'Aigle (ce n'est pas
  la bascule « à partir du T1 » qui fait le régime hiver).
- **Grilles** (table `grilles`) : une grille ne s'applique qu'à ses périodes
  (bornes incluses) ; seules les grilles ACTIVES comptent ; si deux grilles
  actives couvrent une date, la plus récemment chargée l'emporte
  (`serviceActif()`) ; désactiver une grille redonne la main à la précédente
  (retour arrière) ; hors de toute période = AUCUN service, jamais de repli ;
  une version n'est jamais réécrite (recharger crée « …-v2 » et désactive
  la précédente, réactivable). Les écrans affichent une journée avec la
  grille qui l'a générée, sinon celle en vigueur à sa date
  (`grillePourJour()`), jamais « la première de la liste ».
- **Arrivée + départ** affichés pour chaque passage ; les arrivées sont les
  heures RÉELLES du document d'exploitation (dans les grilles) ;
  `arret_intermediaire_s` (60 s) n'est qu'un REPLI si une arrivée manque ;
  « — » au point d'origine.
- **Suppression** : le train reste affiché barré avec motif jusqu'à son
  heure théorique, puis disparaît.
- **Mode dégradé** : cache ≤ 15 min avec badge « données de HH:MM », puis
  ÉCRAN NEUTRE (logo + horloge + message bilingue) — jamais d'horaires
  potentiellement faux.
- **Compte à rebours** : cases (« chips ») toutes de la même taille.
- **Messages** : modifiables après création ; traduction anglaise générée
  automatiquement (service de traduction) puis éditable.
- **Rotation** : la rame d'une montée assure la descente suivante (ex.
  T1 07:00 → arrivée 08:05:30 → repart T2 08:13:30).

## Sécurité — règles absolues

- Jamais de secret dans le code (dépôt public) : URL/clé Supabase via
  variables de dépôt → `config.js` généré au build. Le projet utilise la
  nouvelle génération de clés Supabase : la clé « publishable »
  (`sb_publishable_…`, voir `supabase/INFOS-PROJET.md`) est PUBLIQUE par
  conception — la sécurité repose sur RLS ; la clé « secret »
  (`sb_secret_…`) ne doit JAMAIS apparaître nulle part côté front.
- Écrans en lecture seule ; écritures réservées aux sessions authentifiées
  (RLS) ; rôles MULTIPLES et CUMULABLES — technique, admin, supervision,
  caisse — dont les droits s'additionnent sans qu'aucun n'implique un autre
  (table `profils_roles`, `private.a_le_role()` ; matrice docs/01 §5.5,
  docs/02 §5, docs/securite.md §2). Miroir de confort du front dans
  `src/core/roles.ts` ; recette RLS dans `supabase/tests/roles-rls.sql`.
- Supervision derrière connexion obligatoire.
- **Content-Security-Policy** en `<meta>` dans les QUATRE pages, identique
  partout (GitHub Pages n'autorise aucune en-tête HTTP). C'est un SECOND
  verrou : l'échappement (`echapper()`) reste la première défense. Elle
  interdit tout script injecté (`script-src 'self'`, sans `unsafe-inline` ni
  `unsafe-eval`) et n'autorise que ce que le code utilise vraiment —
  `img-src data:` (logos inlinés au build), `font-src data:` (Vite inline les
  `.woff` de repli), `style-src 'unsafe-inline'` (71 attributs `style=""` en
  supervision), Supabase en `https:` ET `wss:` sur le DOMAINE `*.supabase.co`
  et non une référence de projet (prod et base de test diffèrent).
  `frame-ancestors` est absente car ignorée dans un `<meta>`. Toute origine
  ajoutée doit être RELEVÉE dans le code, jamais supposée, et VÉRIFIÉE au
  navigateur console ouverte : une CSP qui casse l'affichage en gare serait
  pire que son absence. Verrouillée par `src/pages/demarrage-ecrans.test.ts`.
- Contraintes de FORME sur `params` (`schema.sql`, et
  `migrations/2026-08-params-forme.sql` pour une base existante) : la base
  refuse la valeur aberrante, ce que le front ne peut pas faire. Les deux
  copies doivent rester identiques (`src/data/securite.test.ts`).
- **Onglets visibles par rôle** (`onglets_par_role`, réglable en supervision) :
  la matrice droit × rôle et RLS restent le PLAFOND — cette table ne peut que
  RETRANCHER. `ongletsVisibles()` intersecte ce qu'elle lit avec ce que les
  droits ouvrent : une ligne forgée n'accorde RIEN. Ce n'est pas un mécanisme
  de permissions, c'est du rangement d'interface, et il ne doit jamais en
  devenir un. Deux replis vers la matrice du code (réglage indisponible, rôle
  sans ligne), jamais vers « aucun onglet ». Garde-fou d'enfermement en base :
  au moins un rôle portant `parametres.technique` garde l'onglet Utilisateurs
  (`trg_onglets_quorum`, différé + verrou consultatif) ; la liste y est écrite
  en dur et `securite.test.ts` la compare à `ROLES_QUI_ROUVRENT`.

## Commandes

```bash
npm run dev / build / test / preview
```

## Definition of done (chaque étape)

1. `npm run build` et `npm run test` sans erreur ni warning TS.
2. Critères d'acceptation de l'étape (docs/03) vérifiés, y compris avec
   `?simule=` et en coupant le réseau quand c'est pertinent.
3. Rendu conforme aux maquettes (couleurs charte, colonnes alignées).
4. Aucun secret commité.
