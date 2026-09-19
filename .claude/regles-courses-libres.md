# Courses hors grille — spécial, libellé libre, accès

Ouvre ce fichier si tu t'apprêtes à créer ou modifier une course qui ne vient
pas de la grille : train spécial (affrété), nom d'affichage libre, ou accès
public / privé / mixte.

Voisins : `.claude/regles-horaires.md` (numérotation, libellé canonique,
départ réel), `.claude/regles-affichage.md` (pastilles à l'écran).

## Règles qui piègent (ne pas improviser)

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
  Le REFUS DE LARGEUR — et lui seul, un nom déjà porté ne se raccourcit pas —
  s'accompagne de formes courtes CLIQUABLES (`propositionsLibelle()`, pure,
  oracle injecté) : premier mot + initiale des suivants, initiales de tous les
  mots à partir de trois, premier mot seul. Chaque candidat est MESURÉ par le
  même oracle que le champ, jamais estimé à la longueur ; « MARIAGE M. » vaut
  6,013 em et ne tient donc PAS. Aucune coupe en plein mot, aucun
  raccourcissement d'office — l'agent accepte d'un clic —, et la liste vide
  (mot unique trop long) est une réponse : on n'affiche alors rien de plus que
  le refus.
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

## Ailleurs

- La NUMÉROTATION et le libellé canonique (« TRAIN 9 », `libelleTrain()` /
  `libelleTrainCourt()`) valent pour toutes les courses : ils sont dans
  `.claude/regles-horaires.md`.
- Le départ RÉEL d'un train supplémentaire est dans
  `.claude/regles-horaires.md` lui aussi : c'est un recalcul d'horaires, pas
  une propriété de la course.
