# Relecture générale de septembre 2026 — ce que sept semaines de lots ont laissé derrière

Relecture adversariale du dépôt `tmb-affichage-gares` au commit `0739500` (branche
`main` après la fusion de la PR #46, 22/09/2026), demandée le 22/09/2026 et exécutée
les 26 et 28/09/2026. Les rapports bruts des cinq relecteurs, avec chaque mutation et
son verdict, sont dans `docs/relecture-2026-09/`.

## 1. Pourquoi ce document, et comment le lire

**Pourquoi maintenant.** Le dépôt part bientôt dans une organisation GitHub de la
Régie, puis chez un prestataire (Myosotis). Ce qu'une relecture trouve se corrige
tant que le code est familier ; ce qu'elle documente part avec le dossier de reprise.
Entre le 31/08 et le 22/09/2026, cinquante-sept pull requests ont été fusionnées,
écrites par des sessions d'assistant de programmation qui ne se voyaient pas les unes
les autres. Ce document cherche ce qu'elles ont laissé derrière.

**Ce qu'il n'est pas.** Il ne corrige rien (une seule exception, triviale et sûre,
dite au §2). Il produit une liste, avec pour chaque constat la preuve qui le tient : une
lecture de fichier avec son numéro de ligne, une mesure au navigateur, un test vu rouge
— ou resté vert — après avoir cassé ce qu'il protège. Ce qui n'a pas pu être vérifié est
dit comme tel, avec ce qui manquerait pour trancher (§I).

**Les quatre catégories**, reprises du tri des 69 constats de l'audit du 30/08, fait
le 06/09/2026 :

- **Ouvert** (§A) — à corriger, classé par ce que ça coûte si on ne le fait pas ;
- **Déjà tombé** (§B) — le code a bougé, le constat ne s'applique plus ; le dire évite
  de le retrier une troisième fois ;
- **Sans objet** (§C) — n'a pas de sens dans cette architecture ;
- **Ne se corrige pas** (§D) — contrainte de plateforme ou décision assumée, avec sa
  raison et sa date.

**Deux destinataires.** Chaque constat ouvert dit s'il est *pour Thomas* (une décision,
ou un geste court d'exploitation) ou *pour Myosotis* (un travail de prestataire, qui
part avec le dossier de reprise). Inscrire cinquante lignes à la liste d'une seule
personne aggrave le risque de fond du projet — « une seule personne sait faire tourner
le système » — au lieu de le réduire. Le §H récapitule la répartition.

**Les quatre familles cherchées**, dans l'ordre où elles comptent :

1. les **régressions** — une règle réparée puis contournée ailleurs, un garde-fou posé
   puis rendu inopérant, un comportement documenté qui ne correspond plus au code ;
2. les **contrôles qui ne s'exécutent pas** — un test qui cherche une chaîne plutôt
   qu'un comportement, une assertion satisfaite par du contenu voisin, une constante
   d'essai qui dérive, un sélecteur qui ne correspond à rien, un `catch` qui avale, une
   garde qui ne peut pas être fausse. Un contrôle qui ne s'exécute pas est indiscernable
   d'un contrôle qui passe : ce dépôt en a produit sept cas réels en un mois, tous
   trouvés par hasard. Cette relecture est la première à les chercher méthodiquement ;
3. les **simplifications** — règles énoncées en plusieurs exemplaires, notions
   concurrentes, code mort ;
4. les **performances** — en dernier, et sur mesure seulement.

**Lexique**, pour qui n'a pas suivi le projet :

- *écran de gare* : la page `ecran.html` (prochains départs) affichée par un Raspberry
  Pi en kiosque ; *grille du jour* : la page `grille.html` ; *supervision* : la page
  `supervision.html`, derrière connexion, d'où l'exploitation pilote le tout ;
- *signal de vie* : l'écriture que chaque écran envoie toutes les 60 s dans la table
  `ecrans` pour dire « je tourne » ; *guetteur* : la tâche planifiée (`pg_cron` + Edge
  Function `alerte-ecrans`) qui envoie un courriel quand un écran se tait plus de dix
  minutes ;
- *lot* : un chantier livré par une pull request ; *mutation* : casser volontairement le
  code pour vérifier que les tests le voient ; *mutant survivant* : une cassure que la
  suite de tests n'a pas vue ;
- *RLS* : les règles de la base (Row Level Security) qui décident qui écrit quoi ;
  *policy* : une de ces règles ; *GRANT de colonnes* : la liste des colonnes qu'un rôle
  a le droit d'écrire ou de lire ;
- *test de texte* : un test qui lit un fichier source comme une chaîne de caractères
  et y cherche un motif, au lieu d'exécuter le code.

## 2. Ce qui a été relu, et comment

**Le dépôt.** 24 185 lignes de code (`src/`, hors tests), 27 927 lignes de tests
(79 fichiers, 2 334 tests), 2 002 lignes de schéma SQL, 22 migrations, 4 Edge
Functions, 1 146 lignes de recette RLS, 57 fusions. État de référence mesuré avant tout :
`npm run build` sans erreur, `npx vitest run` 2 334 verts, `npx prettier --check .`
propre, arbre propre.

**Le découpage.** Le prompt proposait quatre zones ; cinq ont été retenues, la
cinquième parce que les deux premières familles se cherchent AUSSI entre les zones, là
où aucune lecture de fichier ne les voit :

| Zone | Périmètre | Rapport brut |
| --- | --- | --- |
| 1 | le noyau `src/core/` et ses tests | `relecture-2026-09/zone-1-noyau.md` |
| 2 | les pages d'affichage (`ecran.ts`, `grille.ts`, `affichage-commun.ts`, `resilience.ts`, service worker, quatre pages HTML, CSS) | `zone-2-pages.md` |
| 3 | la supervision (`supervision.ts`, `supervision-logique.ts`, `onglet-horaires.ts`…) | `zone-3-supervision.md` |
| 4 | la couche données `src/data/`, `schema.sql`, les migrations, les Edge Functions, la recette RLS | `zone-4-donnees.md` |
| 5 | les régressions ENTRE lots (les 57 fusions) et les affirmations écrites (CLAUDE.md, docs, workflow CI, outils) | `zone-5-regressions.md` |
| synthèse | recoupement des cinq listes, revérification, signal de vie, performances, mesures au navigateur | ce document |

Chaque relecteur a travaillé dans son propre *worktree* git (une copie de travail
isolée, au même commit), avec la même consigne : pour chaque contrôle suspect,
**casser ce qu'il prétend protéger, lancer le test, regarder s'il tombe, restaurer**.
Un suspect non éprouvé n'entre pas dans la liste.

**Le compte.** Les cinq relecteurs ont fait **190 mutations** : 138 tuées (le contrôle
mord), **52 survivantes** (le contrôle ne mord pas). Ils ont rendu **93 constats
bruts**. La synthèse les a recoupés — 14 doublons entre zones fusionnés, aucun écarté
comme faux — puis a **rejoué elle-même 45 survivantes contre la suite ENTIÈRE**
(2 334 tests, et non le seul fichier visé) dans un sixième worktree : **45 ont
survécu**. Le taux de survie après vérification est donc de 100 % sur ce qui a été
revérifié ; les sept survivantes non rejouées (bornes d'une migration, deux Edge
Functions qu'aucun test n'importe, une preuve par `tsc`, trois lectures) sont
marquées « confiance moyenne » ou tenues par un `grep` sans ambiguïté. Un constat de
la zone 2 a été **corrigé par la mesure** : le DOM n'est pas réécrit chaque seconde
(§F). Une mesure de la synthèse a en revanche **ajouté un constat** que personne
n'avait vu en lisant : le tableau vide hors saison (R-01).

**Ce que la forme des tests dit d'avance.** 44 des 79 fichiers de test lisent un
fichier du dépôt comme du TEXTE (`readFileSync` d'un `.ts`, `.html`, `.sql`, `.css`)
pour y chercher un motif — 21 d'entre eux lisent `supervision.ts`, pour 729
assertions. C'est une technique légitime pour verrouiller une structure (une balise dans
le `<head>`, une colonne dans un `GRANT`), et c'est aussi le terreau exact des cas n° 6
et n° 7 : une assertion qui trouve un MOT sans vérifier une AFFIRMATION. Ces 44 fichiers
ont été instruits en priorité ; c'est de là que viennent la plupart des survivantes.

**Ce que la synthèse a mesuré elle-même** (serveur `vite --mode demo`, navigateur
Chromium, 26 et 28/09/2026) :

- la CSP est dans le `<head>` des quatre pages ET elle agit : un `<script>` injecté par
  le DOM ne s'exécute sur aucune des quatre (console : « Executing inline script
  violates the following Content Security Policy directive 'script-src 'self'' ») ;
- `ecran.html` sans configuration et sans `?demo=1` affiche l'écran neutre
  (« Informations momentanément indisponibles »), zéro ligne, bandeau « HEURE SIMULÉE »
  présent : la règle C-02 tient ;
- `ecran.html` en démonstration, le 26/09 : 73 nœuds DOM au chargement, 74 après trente
  secondes, 3 mutations DOM par seconde, tas JavaScript stable à 7 Mo ; en dix secondes,
  la seule réécriture `innerHTML` est celle de l'horloge (10 × 32 caractères) ;
- `ecran.html` et `grille.html` en démonstration, le 28/09 — premier jour hors des
  périodes de la démonstration : **en-têtes sans aucune ligne**, ni écran neutre, ni
  « Aucun service » (R-01).

**Ce que ce lot a corrigé**, parce que trivial et sûr : `docs/tests-manuels.md` §2
disait `&cache=0.05` (« 3 s ») pour provoquer l'écran neutre ; depuis le correctif M-14
du 06/09, toute valeur hors 3–60 min est ignorée en silence — la recette attendait quinze
minutes. Elle dit maintenant `&cache=3`. Un titre « ## 5. » en double y a été renuméroté.
Rien d'autre n'a été touché dans le dépôt.

## 3. Le compte, par catégorie

| Catégorie | Constats | Dont pour Thomas | Dont pour Myosotis |
| --- | --- | --- | --- |
| A. Ouvert — défauts de comportement (§A.1) | 20 | 9 | 18 |
| A. Ouvert — contrôles inertes (§A.2) | 24 | 1 | 23 |
| A. Ouvert — documents qui ne disent plus vrai (§A.3) | 10 | 10 | 6 |
| A. Ouvert — simplifications (§A.4) | 8 | 0 | 8 |
| B. Déjà tombé | 14 | — | — |
| C. Sans objet | 3 | — | — |
| D. Ne se corrige pas | 6 | à connaître | à connaître |

Un constat peut être pour les deux (une décision de Thomas, un câblage de Myosotis), et
porter deux familles. Famille par famille, les 62 constats ouverts comptent 23
régressions ou affirmations fausses, 26 contrôles inertes, 14 simplifications et 4
performances — plus un constat de performance ramené à sa lettre par la mesure (§A.5).

## A. Ouvert — par ordre de ce que ça coûte si on ne le fait pas

Chaque constat porte : la famille (F1 régression, F2 contrôle inerte, F3
simplification, F4 performance), le destinataire, où (fichier:lignes), la preuve, le
coût, et l'identifiant du rapport brut d'où il vient (Z1-…, Z5-…, S = synthèse).

### A.1 — Ce qui trompe l'exploitation ou les voyageurs aujourd'hui

**R-01 — Hors saison, l'écran de gare et la grille affichent des en-têtes sans aucune
ligne : le bloc « Aucun service aujourd'hui » est inatteignable depuis le 25/08.**
F1 · Thomas (vérifier AUJOURD'HUI en gare) + Myosotis · S.
Où : `src/pages/ecran.ts:743` (`if (!grille || !jour) return;`) précède `:745-748`
(`if (jour.hors_saison) { afficheEtatSpecial('Aucun service aujourd'hui…') }`) ; même
ordre `grille.ts:464-466` ; `ecran.ts:865-867` (`applique` sort aussi avant de poser le
titre et le nom de gare) ; `src/core/horaires.ts:111-113` (`grillePourJour` = grille de
la version du jour, sinon `serviceActif(date)`) ; `src/data/supabase.ts:360-377` et
`mock.ts:699-712` : hors saison, `getJour` rend `grille_version: ''`, `hors_saison:
true` — donc `grille` est NUL, la garde sort, le bloc n'est jamais atteint. Historique :
l'ordre est celui du commit `f93fbd0` (25/08, « hors saison corrigé »). Preuve
(navigateur, 28/09, périodes de démonstration closes le 27/09) : `?jour=2026-09-26` →
5 lignes ; `?jour=2026-09-28` → 0 ligne, `body.className` = `mode-simule mode-demo`,
`#etat-special` vide, titre resté « TMB — Écran de gare » ; `?jour=2026-11-15` → idem ;
`grille.html` : `#tab-montee` vide. Aucun test ne rend cet état (`grep "Aucun service
aujourd'hui" src/pages/*.test.ts` : rien ; seuls `badgeFraicheur` et `resumeJournee`
sont testés avec `hors_saison: true`).
Coût : un tableau de départs vide se lit « plus aucun train » — c'est E-03, l'information
fausse que la règle « jamais d'horaire potentiellement faux » interdit — sur les six
gares, chaque jour où aucune grille active ne couvre la date. **Si la production n'a pas
de grille couvrant le 28/09/2026, c'est l'état des écrans en ce moment** ; la supervision
le montre (onglet Circulations, journée « hors saison »).

**R-02 — Le guetteur ne lit jamais `error` : une lecture en échec devient « 0
surveillés, aucun défaut », réponse 200, pastille verte.** F2 · Myosotis ; Thomas (à
savoir) · Z4-01.
Où : `supabase/functions/alerte-ecrans/index.ts:408-414` (trois lectures `{ data }`
sans `error`), écritures `:531-564` non contrôlées ; banc `src/data/alerte-ecrans.test.ts:612-614`
(`repond` rend toujours `error: null`). Preuve : la fonction réelle exécutée avec un
client dont toutes les lectures rendent `{ data: null, error: {…} }` → statut 200, corps
`{"surveilles":0,"en_defaut":0}`, `surveillance_etat.dernier_resultat = "0 surveillés,
aucun défaut"`, 0 courriel, console vide. Coût : une clé révoquée, une table renommée ou
une panne PostgREST → « Surveillance active — dernier passage il y a N min » (vert)
alors que plus personne ne regarde ; c'est le défaut du 19/09 déguisé en bonne santé,
sur le lot qui existe pour l'empêcher. Si seule la lecture de `alertes_ecran` échoue :
un courriel par passage, douze par heure.

**R-03 — Rejouer `2026-09-roles-multiples.sql` supprime cinq politiques qu'il ne recrée
pas ; la procédure d'installation neuve le prescrit en dernier.** F1 · Thomas (ne pas
rejouer sur une base en service ; vérifier la production, §I) + Myosotis · Z4-09.
Où : `supabase/migrations/2026-09-roles-multiples.sql:313-327` (drop dynamique de toute
politique dont `qual`/`with_check` contient `a_le_role`, `a_un_des_roles`, `peut_*`, ou
nommée `roles: %`) ; §6 `:600-792` ne recrée ni `roles: affluence`, ni `roles: alertes
lecture`, ni `roles: surveillance lecture`, ni `onglets: reglage` / `onglets: masquage`
(`schema.sql:1044-1047`) ; le contrôle final §11 `:1222-1236` ne les liste pas ;
`docs/mise-en-service.md:58-63` (« à passer en dernier ») et `:94-95` (« le rejeu est
lui-même un contrôle »). Coût : après le rejeu, le guichet ne peut plus déclarer un train
complet, la supervision perd la lecture du guetteur (« JAMAIS lancée »), le technique ne
peut plus régler les onglets — « Success. No rows returned ».

**R-04 — Des scripts « rejouables » plus anciens que `schema.sql` régressent le journal
et la purge quand on les rejoue dans l'ordre documenté.** F1 · Myosotis ; Thomas (doc §B)
· Z4-10.
Où : `supabase/ajout-journal-exploitation.sql:175-181` (déclencheur du journal des
circulations sans `commanditaire`, `nature`, `libelle`, `acces`), `:224-231` (écrans sans
`vitesse_ticker_px_s`, `surveille`), `:244-257` (purge SANS la borne `mois >= 1`) —
étape 8 de `docs/mise-en-service.md` §B, APRÈS `schema.sql` ; `migrations/2026-09-roles-multiples.sql:1177-1190`
(purge sans borne, étape 14) ; `2026-09-vitesse-par-ecran.sql:26-35`,
`2026-09-libelle-course.sql:71-78`, `2026-09-train-special-A.sql:124-131` (déclencheurs
amputés). Chaque script est idempotent pris seul, aucun ne l'est dans l'ordre documenté.
Coût : une base montée selon la doc naît avec six colonnes de journal en moins et une
purge à 0 mois possible (F-01 rouvert) ; à la reprise, rejouer une migration « sûre »
retire une colonne du journal sans message.

**R-05 — La suppression en attente d'un train supplémentaire disparaît du compteur, du
garde-fou de sortie et de l'aperçu dès qu'on quitte sa date.** F1 · Myosotis (trois
lignes) · Z3-01.
Où : `src/pages/supervision.ts:543-552` (`datesPubliables` : `dateSel ∪ brouillonCirc ∪
brouillonTerminus ∪ brouillonSection`, jamais `brouillonSupSupprimes`), `:466-474`
(`nbEnAttente`), `:477-485` (`rienEnAttente`) ; mise en attente `:2881-2888` ;
`beforeunload` `:5529-5532` ; déconnexion `:5499-5507`. Garde-fou posé le 29/08, réservoir
ajouté le 04/09 sans mettre à jour les trois fonctions. Mutation M36 (retirer
`brouillonSection` de `datesPubliables`) : 2 334 verts — le câblage n'est éprouvé par
aucun test. Coût : « Tout est publié ✓ » alors qu'une suppression attend ; perdue sans
un mot au rechargement, ou publiée plus tard à la faveur d'une autre modification.

**R-06 — L'onglet Horaires propose à l'administrateur de réinitialiser des journées que
RLS lui refuse, après avoir déjà enregistré et activé la grille.** F1 · Myosotis · Z3-07.
Où : `src/pages/onglet-horaires.ts:133` (`peutEcrire` = droit `grilles` seul), `:292-300`,
`:569-577`, `:894-900` (cases « journées à réinitialiser » sans condition de droit),
`:363`, `:682`, `:1079` (`reinitialiseJour` APRÈS `saveGrille` et `setGrilleActive`) ;
`schema.sql:777-783` (`delete` sur `jours` réservé à technique et supervision) ;
`src/core/roles.ts:187-208` (admin : `grilles` oui, `journee.reinitialiser` non).
Coût : « journée absente, ou réinitialisation non autorisée pour vos rôles » APRÈS que
la nouvelle grille est en service et l'ancienne désactivée, sans ligne d'historique.

**R-07 — Service worker : entre un déploiement et le second démarrage en ligne, le
démarrage hors ligne est impossible ; trois logos sont préchargés pour rien ; un seul
404 fait échouer toute l'installation.** F1 · Myosotis ; Thomas (trois phrases de doc) ·
Z2-12, Z5-17, S.
Où : `public/sw.js:87-97` (PRECACHE = cinq pages + quatre logos), `:103`
(`cache.addAll`, tout-ou-rien), `:108-124` (`activate` purge les caches de la même portée
et réclame les clients), `:180-199` (`cacheDabord` écrit dans le cache du worker QUI
répond) ; `src/pages/resilience.ts:147-152` (enregistrement fait par le module de la
page, donc après le chargement de ses chunks). Enchaînement, vérifié par lecture : au
premier chargement après un déploiement, les nouveaux chunks passent par l'ANCIEN
worker, qui les écrit dans SON cache ; le nouveau JS enregistre `sw.js?v=neuf`, le
nouveau worker s'installe (précache seul) et son `activate` supprime l'ancien cache —
avec les chunks qu'on vient de charger. Une coupure réseau au démarrage suivant (reboot
04:30) donne une page HTML servie sans ses scripts : coquille vide, sans horloge ni
réessai. Mesure : seul `logos/logo-rond.svg` est demandé à l'exécution (`index.html:51`) ;
`logo-rond-blanc.svg` et les deux motrices (216 895 o) sont téléchargés à chaque
installation puis jamais lus, puisque les pages portent leurs logos inlinés.
`docs/02:623`, `docs/03:76`, `docs/tests-manuels.md:32-34` promettent « précache app +
logos + polices » : aucune police ni aucun chunk n'est précaché (le fichier vit dans
`public/`, il ne connaît pas leurs noms hachés, `sw.js:14-17`). Non exécuté au
navigateur (confiance moyenne sur la fenêtre, haute sur le précache).

**R-08 — Les réglages par poste (veille, vitesse du bandeau) sont proposés pour une
grille, renvoyés par son signal de vie, et jetés.** F1 · Thomas (décision : une grille
a-t-elle une veille ?) + Myosotis · Z2-15.
Où : `supervision.ts:4013-4060` (champs rendus pour tout poste, sans condition sur
`e.type`) ; `supabase.ts:648-656` (renvoyés) ; `ecran.ts:920-924` (appliqués) ;
`grille.ts:600-609` (aucun `.then`), `:447` (`veille: false`). Coût : « Réglage propre »
affiché, rien ne change à l'écran.

**R-09 — `version_app` vaut `production` sur tous les postes, à tous les déploiements.**
F1 · Myosotis · Z2-14.
Où : `ecran.ts:914`, `grille.ts:605` (`version_app: import.meta.env.MODE`) ;
`.github/workflows/deploy.yml` (aucun `--mode`) ; `supervision.ts:4040` l'affiche ;
`vite.config.ts:24` (`__VERSION_CACHE__`, horodatage de build, non envoyé). Coût :
impossible de voir en supervision quel poste tourne encore sur le build d'avant, ce que
docs/01 §7 promet (« version »).

**R-10 — Le mode des médias est écrit immédiatement mais compté « en attente ».** F3 ·
Myosotis · Z3-08.
Où : `supervision.ts:3826-3843` (`saveParams({ mode_medias })` puis `bumpEnAttente`)
contre `:3845-3874` (durée : `bump`) ; définitions `:661-680`. Mutation M37
(`bumpEnAttente` → `bump`) : 2 334 verts. Coût : la pastille « à jour / en retard » et
« Appliqué sur N/N écrans » ne jugent pas cette écriture.

**R-11 — « Voir comme » : le refus d'écriture est LEVÉ synchroniquement là où 77
appelants attendent une promesse rejetée ; le toast « aperçu : lecture seule » ne les
atteint jamais.** F3 (+F1) · Myosotis · Z3-06.
Où : `src/pages/voir-comme.ts:195-206` (`throw new RefusApercu` dans une enveloppe
`async`) ; `supervision.ts` : 77 sites `void provider.x(…).then(…).catch(erreurVersToast)`
contre 23 `await` dans un `try`. Preuve : test temporaire — `void
provider.saveMedia().then().catch(cb)` → `cb` jamais appelé, exception non gérée. Le
verrou TIENT (rien ne part) ; c'est le message qui manque, et toute méthode ajoutée
demain aura le même silence.

**R-12 — « L'écran retentera automatiquement » est promis sans mécanisme sur le chemin
d'erreur du démarrage.** F1 · Myosotis · Z5-02.
Où : `ecran.ts:943-948`, `grille.ts:626-631` ; `afficheErreur` (`ecran.ts:629-632`)
ne programme rien ; les deux seuls `reload` sont dans `afficheNeutrePermanent`. Coût :
un `config.js` malformé fige le poste sur « Écran indisponible » jusqu'au reboot de
04:30 ; « Recharger » depuis la supervision est inopérant, le signal de vie n'étant
pas armé sur ce chemin. Chemin rare, texte faux.

**R-13 — Le nombre annoncé à la déconnexion pendant l'aperçu est un nombre de DATES, et
le test refuse la correction.** F2+F3 · Myosotis · Z3-02.
Où : `supervision.ts:466-474` (`brouillonCirc.size`, une `Map<date, Map<numero>>`),
`:5499-5503` ; `voir-comme.test.ts:291-321` (`toContain('brouillonCirc.size')`) ;
`brouillon.ts:64` (`nbCirculationsEnAttente`, jamais appelée). Mutation M02 (la bonne
fonction) : le test tombe — pour un mutant qui est le comportement voulu.

**R-14 — `params.alertes_destinataires` (adresses du personnel) est lisible avec la
clé publiable.** F1 · Thomas (décision) + Myosotis · Z4-11.
Où : `schema.sql:765` (`"lecture publique" on params for select using (true)`, sans
GRANT de colonnes ni `revoke select … from anon`) ; `migrations/2026-09-alerte-ecrans.sql:181-184`
et `schema.sql:1904-1907` ne raisonnent que sur l'écriture ; `supabase.ts:540` (les
écrans reçoivent la clé, `paramsValides` l'écarte ensuite). Posture inverse prise pour
`affluence.maj_par` (`schema.sql:705-709`). Coût : `GET /rest/v1/params?cle=eq.alertes_destinataires`
avec la clé du bundle rend la liste des destinataires d'alerte de la Régie.

**R-15 — Le sondage de 30 s n'est pas un « repli » : il est inconditionnel et doublé ;
la supervision au repos fait ~36 requêtes par minute.** F4 · Myosotis ; Thomas (coût
réseau) · Z4-15, Z3-14.
Où : `supabase.ts:588-589` (`setInterval(notifie, 30 s)` dès le premier `onChange`,
jamais arrêté, sans regarder l'état du canal — aucun `subscribe((status) => …)`) ;
`ecran.ts:893` (second `setInterval(resynchronise, 30 s)`) ; une resynchronisation =
dix requêtes REST (`ecran.ts:846-851`, `supabase.ts:539-544`) ; `resilience.ts:90` ne
dédoublonne que si la première est encore en vol. Compte : 10 à 20 requêtes par 30 s par
écran, soit 21 600 à 43 200 par écran et par jour de 18 h, plus 1 080 signaux de vie ;
supervision : 8 lectures par notification × 2 par minute + 2 toutes les 10 s
(`supervision.ts:696-729`, `:1474-1482`). Non mesuré au réseau (sans base réelle).
Coût : trafic 5G du Nid d'Aigle et quota Supabase ; et si le canal temps réel tombe,
rien ne le dit.

**R-16 — « roles: params technique » n'a aucun filtre de clé : le technique écrit
météo, vitesse, mode médias, délai à quai — `docs/securite.md` dit « — ».** F1 · Thomas
(décision : filtrer ou corriger le tableau) · Z4-12.
Où : `schema.sql:988-990` ; `docs/securite.md:51-54` ; `src/core/roles.ts:174-186`
(l'interface masque ce que la base accorde) ; `roles-rls.sql:817-828` n'éprouve jamais
« technique n'écrit pas la météo ».

**R-17 — `inviter-utilisateur` recopie la liste des rôles ; un cinquième rôle du
catalogue serait filtré en silence.** F3 · Myosotis · Z4-14.
Où : `supabase/functions/inviter-utilisateur/index.ts:24` (`ROLES_CONNUS`), `:54-62`,
alors que le catalogue est lu `:198` ; `docs/securite.md:127-128` promet « jamais
recopiée ». Coût : à la première extension du catalogue (SSO), l'invitation réussit
avec des rôles en moins, sans erreur.

**R-18 — Le formulaire de connexion peut abonner deux fois le poste au temps réel.** F4 ·
Myosotis · Z3-15.
Où : `supervision.ts:5556-5569` (bouton jamais désactivé, `signIn` asynchrone) →
`:1435-1483` (`onChange` et `setInterval(rendreEcrans)` sans garde, alors que
`brancheOngletsParRole` `:1165-1171` en a une, posée pour ce cas). Non exécuté
(confiance moyenne).

**R-19 — Trois défauts mineurs de la couche données.** F3/F1 · Myosotis · Z4-20.
`supabase.ts:1350-1358` : `publications.qui` fourni par le client, non forcé par
déclencheur (à l'inverse du journal) ; `:1081` : `deleteMedia` ignore l'erreur du
`select('chemin')` → fichier orphelin dans le bucket ; `config.ts:99-120` +
`supervision.ts:1041` : une configuration PARTIELLE (URL sans clé) fait tomber la
supervision sur le mock pendant que la pastille annonce « PRODUCTION ».

**R-20 — La ligne « Aucun service ne circule à cette date » couvre 8 colonnes d'un
tableau qui en a 9.** F1 · Thomas (un caractère) ou Myosotis · Z3-09.
Où : `supervision.ts:1866` (`colspan="8"`) ; `supervision.html:463-475` (neuf `<th>`,
colonne Accès ajoutée le 12/09). Mutation M38 : 2 334 verts. Cosmétique.

### A.2 — Les contrôles qui ne s'exécutent pas

C'est le cœur de cette relecture. Chaque ligne ci-dessous est un mutant qui a survécu à
la suite ENTIÈRE de 2 334 tests, rejoué par la synthèse après le relecteur.

**R-21 — L'identifiant de poste : le câblage des pages n'est pas verrouillé ; le repli
par gare du 19/09 peut revenir à tests verts.** F2 · Myosotis · Z2-06, Z5-04.
Où : `ecran.ts:153`, `grille.ts:127` (`identifiantEcran(url.get('ecran'))`) ;
`demarrage-ecrans.test.ts:71-77` et `affichage-sans-ecriture.test.ts:140-150` cherchent
la chaîne ; `supervision-logique.test.ts:169-178` éprouve la fonction pure seule.
Mutation D4 : `identifiantEcran(url.get('ecran')) ?? \`${gareParam}-ecran-1\`` → 2 334
verts. Coût : l'incident du 19/09 (un onglet de bureau battant à la place du Raspberry,
alerte étouffée) peut être réintroduit par une ligne sans faire rougir la suite.

**R-22 — Les cinq correctifs d'audit du 06/09 (PR #7) : leurs verrous cherchent un
nom ou une chaîne, pas un comportement.** F2 · Myosotis · Z2-01 à Z2-05.
(a) horloge armée avant le premier `await` : le test compare `indexOf('horlogeSecours')`
à `indexOf('await ')` (`demarrage-ecrans.test.ts:153-163`) — `const horlogeSecours = 0;`
sans aucun minuteur : vert (D1, D6) ; (b) « un démarrage qui ÉCHOUE bascule sur un écran
d'erreur » n'exige qu'un `.catch(` — `.catch(() => {})` : vert (D2) ; (c) la borne de
10 s de la première synchronisation : `toContain('DELAI_PREMIERE_SYNCHRO_MS')` est
satisfait par la ligne d'import — `10_000_000` : vert (D7, A2 sur `affichage-commun.ts:770`) ;
(d) la garde « sans source → écran neutre » : `if (mode === 'aucune' && Number.isNaN(0))`
(jamais vraie) : vert (D8) ; (e) les bandeaux HEURE SIMULÉE et DÉMONSTRATION : le test
cherche le sélecteur CSS, pas ce qu'il fait — `display: none` (`ecran.css:1126`,
`grille.css:716`) : vert (D9, D10). Le code des cinq correctifs est bien là, dans les deux
pages ; ce sont leurs verrous qui sont inertes.

**R-23 — L'écart d'horloge (lot 5) : la mesure est testée, sa remontée jusqu'aux pages ne
l'est pas.** F2 · Myosotis · Z1-04, Z2-10, Z5-05.
Où : `src/core/horloge.ts:85-97` (pure, testée) ; `supabase.ts:184-199` (`fetch`
enveloppé → `ecartMs` → `ecartHorlogeMs()`) ; `ecran.ts:721`, `grille.ts:454` ;
`horloge.test.ts:138-175` vérifie les pages par texte. Mutations : `ecartHorlogeMs()
{ return null; }` → vert (H1) ; état forcé à `'juste'` en gardant la chaîne (M03) → vert.
Coût : l'écran neutre à 30 s d'écart et le bandeau à 5 s peuvent cesser de se
déclencher ; « PARTI » pour un train encore à quai, le scénario nommé par
`horloge.ts:34-38`.

**R-24 — `service-worker.test.ts` ne joue jamais le gestionnaire `fetch` : l'aiguillage
des stratégies est inerte.** F2 · Myosotis · Z2-07.
Où : `service-worker.test.ts:141, 187-195` (le banc n'expose que `cacheDabord`,
`reseauDabord`, `VERSION`, `activate`). Mutations vertes : `config.js` retiré de la
branche réseau-d'abord (S1) ; `cache.addAll([])` avec la liste conservée (S2 — le test
l.448-460 vérifie la LISTE, pas son usage) ; `if (requete.cache === 'no-store') return;`
rendu inatteignable (S4) ; réseau-d'abord met en cache une réponse non-ok (S5), alors
que la même mutation sur cache-d'abord (S6) tombe. Coût : `config.js` figé en cache, un
précache vide ou une sonde réseau servie par le cache passeraient verts.

**R-25 — Les colonnes du signal de vie côté front ne sont comparées à aucun GRANT.** F2 ·
Myosotis · Z5-03.
Où : `supabase.ts:617-627` ; `schema.sql:1058-1060` ; `securite.test.ts:454-472` ne
verrouille que la liste SQL. Mutation : `gare: e.gare` ajouté à l'UPDATE → 2 334 verts.
Coût : « permission denied for column » → PostgREST refuse l'UPDATE entier → les six
postes passent muets et le guetteur annonce une panne générale (même classe que
l'incident du 11/09).

**R-26 — Les garde-fous SQL ne sont verrouillés que par des mots : quatre inversions de
règle et l'horodatage serveur survivent.** F2 · Myosotis · Z4-02, Z4-03.
Mutations vertes sur `schema.sql` : purge — `auth.uid() is not null` → `is null`
(`:1778`, et la migration `purge-journal-bornee.sql:50`) ; identité d'écran — même
inversion (`:1398`) ; « personne ne modifie ses propres rôles » — `if false` (`:1195`,
le test cherche la chaîne du message) ; quorum — `= 0` → `< 0` (`:1255`, ne lève
jamais) ; horodatage du signal de vie — `new.derniere_vue := new.derniere_vue;`
(`:1124`, garde-fou n° 3 de docs/securite.md §4 : AUCUN test ne cite
`trg_signal_de_vie`). Coût : un lot qui affaiblit un garde-fou d'une ligne passe
l'intégration verte ; seule `roles-rls.sql`, jouée à la main sur la base de test, le
verrait — et elle ne couvre pas l'horodatage. Limite connue des tests de texte
(`securite.test.ts:1-5` l'énonce), mais CLAUDE.md et docs/02 présentent ces garde-fous
comme « verrouillés ».

**R-27 — Trois autres tests SQL satisfaits par du texte voisin.** F2 · Myosotis ·
Z4-05, Z4-06, Z4-07.
« Les bornes de `schema.sql` sont celles de la migration, au chiffre près » :
`toContain(borne)` sur le fichier entier — `between 20 and 400` → `500` sur `params`
(`schema.sql:305`) : vert, la même chaîne vit `:472` ; `commanditaire.test.ts:25-30` lit
le fichier BRUT — `-- revoke all on circulations from anon;` (`schema.sql:748`) : vert ;
« le déclencheur du journal garde TOUTES ses colonnes » ne lit que les arguments du
traceur, pas la liste `update of` — `surveille` retiré de `update of` (`schema.sql:1754-1755`) :
vert.

**R-28 — « Ne JAMAIS étendre `--no-verify-jwt` aux trois autres fonctions » n'est
verrouillé par rien.** F2 · Myosotis · Z4-04.
Où : `outils/deployer-edge-functions.ps1:476-488` (bien limité aujourd'hui) ;
`securite.test.ts:814-907` (14 tests sur le script, aucun sur ce drapeau). Mutation :
drapeau ajouté à l'appel commun `:481` → 2 334 verts. Coût : une retouche « pour
simplifier » ouvre invitation, suppression de compte et traduction à tout Internet.

**R-29 — `traduire` et `inviter-utilisateur` ne sont exécutées par aucun test : deux
règles de docs/securite.md §3 sont sans verrou.** F2 · Myosotis · Z4-08.
Où : `traduire/index.ts:147` (« profil actif portant au moins un rôle »),
`inviter-utilisateur/index.ts:230-233` (le compte Auth est supprimé si le profil échoue) ;
`cles-edge-functions.test.ts:105-128` ne compile que le bloc des clés. Mutations
(contrôle retiré, `deleteUser` retiré) : vertes. Le banc de `supprimer-utilisateur`
existe et se reproduit.

**R-30 — `roles-rls.sql` ne rejoue pas les instructions que le front envoie vraiment,
sur dix chemins.** F2 · Myosotis · Z4-17 (confiance moyenne).
Absents de la recette : le signal de vie anonyme avec son `RETURNING` ; `declareEcran`
/ `oublierEcran` par technique ; `genererJour` (`INSERT … on conflict do nothing`) ;
`supprimerTrainSup` ; `saveGrille` (INSERT) ; `saveMessage` positif ; `logPublication` ;
les quatre UPSERT (`saveParams`, `saveMachine`, `saveMotif`, `saveCiel`) — la recette
n'écrit que des `update`. La leçon du 10/09 (« recette verte, production refusée »,
`roles-rls.sql:626-631`) n'a été appliquée qu'à `affluence` et au spécial.

**R-31 — Le catalogue `roles` de `schema.sql` n'est comparé à rien : le « miroir » ne
lit que la migration.** F2 · Myosotis · Z1-02.
Où : `securite.test.ts:787-811` (`sql(MIGRATION_ROLES)`) ; `schema.sql:385-393` ;
`roles.ts:10-12` renvoie à un test qui ne compare aucune matrice. Mutation : supervision
attribuable par `technique` dans `schema.sql` → 2 334 verts ; la même dans la migration
ou en TypeScript : rouge. Coût : une installation neuve peut livrer une règle que le
front contredit — « l'interface propose, la base refuse », le pire cas nommé par
`roles.ts:167-171`.

**R-32 — Le format d'heure du `.xlsx` exporté est verrouillé par des chaînes, pas par le
lien style → format.** F2 · Myosotis · Z1-03.
Où : `ecriture-xlsx.test.ts:127-139` (ajouté le 22/09 parce qu'Excel affichait
0,2916666667) vérifie `<numFmt numFmtId="164"…>` et `s="1"`, jamais que le style 1
pointe sur le format 164. Mutation : `numFmtId="0"` sur le second `xf`
(`ecriture-xlsx.ts:69`) → 2 334 verts. Coût : le document d'exploitation rediffusé peut
redevenir illisible, test vert ; personne n'ouvre Excel dans la CI.

**R-33 — « Jamais `Date.now()` dans `src/core/` » ne regarde que 3 modules sur 18.** F2 ·
Myosotis (geste court) · Z1-01.
Où : `horaires.test.ts:711-720`, liste en dur `['./horaires.ts', './types.ts',
'./cycle-medias.ts']`. Mutation : `+ 0 * Date.now()` dans `train-sup.ts:108` → 2 334
verts. Aujourd'hui aucun module n'accède à l'horloge (grep) : c'est le verrou qui est
troué, pas la règle.

**R-34 — La lecture seule de Circulations pour l'administrateur ne tient que par
`disabled` ; ni les gestionnaires ni le test ne verrouillent la règle.** F2+F3 ·
Myosotis · Z3-03.
Où : `supervision.ts:771-773`, `:2825-2973` (`surAction`, 16 actions sans contrôle de
droit) contre `:960-964`, `:2434`, `:3378-3381` qui refusent dans le gestionnaire ;
`train-special.test.ts:361-369` (trois chaînes). Mutation M26 (admin modifie tout) :
2 334 verts. RLS tient ; docs/01 §5.5 n'est verrouillé que par des chaînes.

**R-35 — « Le redessin ne choisit plus l'onglet » reste vert quand le défaut du 15/09
est réintroduit.** F2 · Myosotis · Z3-04.
Où : `onglet-actif.test.ts:103-130` ; `supervision.ts:1082`. Mutation
`ongletAOuvrir(undefined, visibles)` : 2 334 verts.

**R-36 — « Entrer/sortir de l'aperçu ne recharge jamais la page » n'interdit que deux
orthographes.** F2 · Myosotis · Z3-05.
Où : `voir-comme.test.ts:262-278` (`not.toContain('location.reload')`,
`'location.href'`). Mutation `window.location.replace(…)` dans `sortApercu` : 2 334
verts. La « contrainte dure » de docs/01 §5.7 (le brouillon ne vit qu'en mémoire) peut
être violée par `replace` ou `assign`.

**R-37 — La règle des 12 caractères vit en quatre exemplaires et son test est
tautologique.** F2+F3 · Myosotis · Z3-10.
Où : `lien-auth.ts:29` ; `supervision.html:168, 170, 178` ; `lien-auth.test.ts:67-73`
(`'a'.repeat(LONGUEUR_MIN_MOT_DE_PASSE - 1)` : le test lit la constante qu'il devrait
éprouver). Mutation 12 → 6 : 2 334 verts. « Quatre familles » (docs/securite.md §4)
n'est imposé par aucun code du front — réglage Supabase Auth, à vérifier (§I).

**R-38 — Brouillon : deux des cinq paramètres de `appliqueBrouillonJour` et la clé
« départ réel » de l'état publiable ne sont exercés par aucun test.** F2 · Myosotis ·
Z3-11.
Où : `brouillon.ts:96-154` (`supSupprimes` `:139-146`, `brouillonSection` `:151`) ;
`etat-publiable.ts:129-132`. Mutations M13, M39, M15 : 2 334 verts chacune. Coût :
l'aperçu peut montrer un train sup supprimé ou une ligne non restreinte, et un départ
réel corrigé peut disparaître du résumé de publication.

**R-39 — Les secondes de `?simule=HH:MM:SS` peuvent être ignorées sans qu'un test
tombe.** F2 · Myosotis · Z5-06.
Où : `horloge-source.ts:79-83` ; CLAUDE.md (« les secondes servent aux états À QUAI /
DÉPART IMMINENT »). Mutation `+ 0 * s` : 2 334 verts. `tsc` ne le verrait qu'au hasard
d'une variable inutilisée.

**R-40 — « Re-rendu 1×/s max » et « pas de fuite mémoire (18 h/jour) » ne sont tenus par
aucun test ni aucune mesure.** F2 · Myosotis (un test de texte pour la cadence) ; la
mémoire ne se mesure qu'en gare (§D) · Z5-08.
Mutation : intervalle de rendu à 500 ms (`ecran.ts:934-937`) → 2 334 verts.

**R-41 — Deux verrous de l'écran satisfaits par du contenu voisin.** F2 · Myosotis ·
Z2-08, Z2-09.
« `ecran.ts` passe `jour` au badge » : `toMatch(/jour,/)` est satisfait par
`passagesPourGare(grille, jour, gare, …)` — `jour: null,` au badge (`ecran.ts:709`) :
vert (le badge F-16 « journée non confirmée » peut disparaître). `jour-simule.test.ts:156-169`
lit la source BRUTE : la chaîne attendue recopiée dans un commentaire suffit (cas n° 6 —
le fichier avertit lui-même de ce piège pour le mot `await`, l. 166-169).

**R-42 — Cadence `pg_cron` (5 min) et seuil « À L'ARRÊT » (15 min) : deux constantes
sans lien éprouvé.** F2 (faible) · Myosotis · Z5-07.
Où : `migrations/2026-09-alerte-ecrans.sql:343` (`'*/5 * * * *'`) ;
`supervision-logique.ts:295` (`SEUIL_GUETTEUR_MUET_MS`). Mutation `'*/6 * * * *'` : 2 334
verts. Une cadence relevée au-delà de 15 min ferait dire « À L'ARRÊT » à un guetteur
sain.

**R-43 — Trois verrous faibles.** F2 · Myosotis · Z1-05, Z1-06, Z5-19.
`ECART_BLOQUANT_MS` « dérivé » de `SEUIL_IMMINENT_S` : vérifié par une chaîne
(`horloge.test.ts:37-44`) — `30_000 + 0 * SEUIL_IMMINENT_S` : vert ; « Bellevue n'a plus
de ligne D en montée » (`export-grille.test.ts:80-83`) : le filtre `l[0] === 'Bellevue' ||
l[1] === 'D'` est satisfait par n'importe quelle ligne D, l'assertion est décorative ;
le verrou des couleurs (F-08) a un périmètre figé à trois fichiers
(`couleurs-rames.test.ts:110`), six fichiers de pages créés depuis n'y sont pas.

**R-44 — `/verif` : ses `allowed-tools` n'autorisent pas ce que son texte demande sous
PowerShell.** F2 · Thomas · Z5-20 (confiance moyenne, non exécuté).
Où : `.claude/commands/verif.md:3` (`Bash(npm run build:*)`, …) contre `:22-24` (« écris
`npm.cmd` et `npx.cmd` »).

### A.3 — Les documents qui ne disent plus vrai

**R-45 — La « phase 2 » est abandonnée par le Plan de pérennisation, mais promise dans
tout le dépôt ; l'échéance du risque « signal de vie anonyme » n'existe plus.** F1 ·
Thomas (décision, §E) ; Myosotis (dossier de reprise) · S, Z4-21, Z5-12.
Où : CLAUDE.md:48-49 (« phase 2 `ApiProvider` (micro-serveur Windows) ») ; docs/02 l. 8,
50, 576, §7 entier (l. 811-862) ; docs/03 étape 10 ; `docs/securite.md:149` (« Échéance :
fermeture en phase 2 ») ; `schema.sql:1088` ; `provider.ts:3`. Contre : Plan de
pérennisation v3 du 06/09/2026 (hors dépôt, dossier « 08 - Perennisation »), résumé :
« La migration sur la tour Windows interne, envisagée en version 1, est abandonnée » ;
annexe D : « Phase 2 "serveur interne" : Abandonnée. Le `SupabaseProvider` reste le
provider de production. » Le même CLAUDE.md:83 dit « Écrans en lecture seule » alors que
l'écran ÉCRIT (le signal de vie, cinq colonnes) : un repreneur qui audite depuis la règle
absolue ne cherche pas la politique anonyme d'UPDATE.

**R-46 — Le tableau des droits et le modèle de sécurité sont faux sur six points.** F1 ·
Thomas relit ; Myosotis corrige · Z4-13, Z4-12, Z3-12.
`docs/securite.md:49-60` : caisse « — » sur `medias`, `params mode_medias /
duree_horaires_s`, `ecrans (rechargement, veille)`, accordés par le SQL depuis le 06/09
(`schema.sql:938-940, 976-984, 1104-1106`) ; technique « — » sur les trois premières
lignes de `params`, faux (R-16). `docs/01` §5.5 : « veille de nuit globale et durée du
cache » pour Technique — aucun contrôle de `duree_cache_min` en supervision (grep vide) ;
`publier` listé pour Supervision seule alors que `roles.ts` le donne aux quatre et
qu'AUCUN code du front ne le consomme ; §5.6 « trois exceptions » qui partent
immédiatement — le code en a une quatrième, la réinitialisation (`supervision.ts:2655-2658`).
`docs/02:359-364` « SEIZE colonnes » puis 17 listées, la base en accorde 18 ;
`docs/02:313-316` journal `ecrans` sur 5 colonnes, le SQL en trace 7 ; docs/02 §5 « 65
méthodes de `DataProvider` », il y en a 67. `docs/mise-en-service.md:484-503, 526`
décrit un repli sur `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` que le code n'a
plus et que `cles-edge-functions.test.ts:174-203` INTERDIT ; `:561-562` « roles-rls.sql
se termine par un rollback » — le script dit le contraire (`:11-15`).

**R-47 — `docs/01` §3.2 et §4 décrivent l'écran d'avant les décisions du 10/09 et du
13/09.** F1 · Thomas · Z2-13.
`docs/01:786` (« Train : pastille couleur rame + nom + « TRAIN X » ») et `:857-858`
(« « N° x », heure d'origine ») ; les tests verrouillent l'inverse
(`ecran-colonnes.test.ts:45-58, 149-153` ; `entete-colonne.test.ts:42-62`). Myosotis
« corrigerait » dans le mauvais sens.

**R-48 — `docs/mise-en-service.md` §B cite six migrations sur vingt et une.** F1 ·
Thomas + Myosotis · Z5-09.
`:126-131` ; `:653-654` promet que « les nouveaux scripts sont aussi ajoutés au §B ».
Absents : acces-course, caisse-medias-ecrans, depart-reel, libelle-admin, libelle-course,
maj-honnete, onglet-affluence, onglets-par-role, purge-journal-bornee,
roles-multiples-nettoyage, section-exploitee, train-special-A, train-special-B,
vitesse-par-ecran. Pour une base ANCIENNE (la production), l'ordre d'application n'existe
plus que dans des PR fermées.

**R-49 — La recette des rôles (§F) et le plan (étape 6) décrivent des onglets d'avant le
lot 2.** F1 · Thomas · Z5-10.
`docs/mise-en-service.md:551-558` ; `docs/03:133-134` ; contre `docs/01:1127` et le seed
`schema.sql:413-440`. Trois lignes fausses : caisse « Bandeau et Horaires » (Horaires
retiré, Places / Écrans / Journal absents) ; supervision sans Places ni Journal ;
technique « Paramètres… carte Utilisateurs ».

**R-50 — `docs/03` cite des fichiers absents et des cadences périmées, sans se dater
comme historique.** F1 · Thomas · Z5-15.
`:8-10` (`PROMPT-DE-DEMARRAGE.md` : inexistant), `:17-18` (`public/grilles/*.json` :
dossier absent), `:100-101` (« Heartbeat 30 s » ; code et docs/01 disent 60 s),
`:191-193` (kiosque « Pi OS Lite … systemd », contredit par `docs/kiosque.md`).
CLAUDE.md y renvoie pour « ce qui reste à faire ». Un chapeau « prompts d'origine,
figés au 24/08 » suffirait.

**R-51 — Deux croyances contradictoires sur l'éditeur SQL de Supabase cohabitent.** F3 ·
Thomas (geste de 30 s, §I) ; Myosotis · Z4-18 (confiance moyenne).
« Une table temporaire ne survit pas d'une instruction à l'autre » :
`migrations/2026-09-roles-multiples.sql:75-81`, `securite.test.ts:682-688`,
`docs/mise-en-service.md:97-109`. « Elle survit » : `diagnostic-roles.sql:31-38` puis
`:491-493`, `verification-roles.sql:19-26` puis `:226-228`, `remise-a-zero.sql:39-47`.
Si la première est vraie, deux recettes ne rendent jamais leur tableau et la remise à
zéro refuse toujours ; sinon, la règle et son test contraignent pour rien.

**R-52 — Petites affirmations périmées, regroupées.** F1 · Myosotis (lot d'hygiène) ;
Thomas pour `.gitattributes` · Z1-10, Z1-11, Z4-13, Z4-19, Z5-11, Z5-13, Z5-14, Z5-16,
Z5-21, Z3-12.
`surveillance-ecrans.ts:31` et `supervision-logique.ts:219` disent « 90 s » pour la
pastille hors ligne, qui vaut 150 s (`:206`, 2,5 × 60 s ; docs/01:1021 dit 150) —
posé le 28/08, changé le 29/08 sans retoucher le commentaire ; `supabase.ts:58, 579`
« 6 écrans toutes les 30 s », le signal de vie bat toutes les 60 s
(`affichage-commun.ts:713`) ; `types.ts:366-373` documente `acces` « facultatif côté
type » alors qu'il est obligatoire depuis le 13/09 (`b8ae147`) ; CLAUDE.md:107 « 71
attributs `style=""` en supervision » — 79 dans le HTML, 95 avec le TS, 72 le jour où la
phrase a été écrite ; `.gitattributes:11-13` « la copie de travail reste en CRLF sous
Windows » — faux, `eol=lf` la met en LF (mesuré : `git ls-files --eol` → `w/lf`, zéro
`\r`) ; `deployer-edge-functions.ps1:6-7, 26-27` « les trois fonctions », le défaut en
déploie quatre ; `.prettierignore:14-15` protège `public/grilles/`, qui n'existe plus ;
`schema.sql:66-67` nomme la contrainte de `nature` `circulations_nature_check`, la
migration `circulations_nature_valeurs` (une vérification de reprise rendra 2 lignes au
lieu de 3) ; `README.md:35` « `npm test` # moteur horaires » (c'est toute la suite),
`:16` `?simule=HH:MM` sans `[:SS]` ; CLAUDE.md:131 « les deux copies doivent rester
identiques » — le test compare depuis le 19/09 `schema.sql` à l'UNION des migrations.

**R-53 — Textes voyageurs en français seul dans le code des écrans.** F1 · Thomas
(décision : docs/01 §3.3 et §6 se contredisent) · Z2-21 (confiance moyenne).
`ecran.ts:492` (« (TRAIN n), en provenance de … », spécifié ainsi par docs/01:833),
`:346` (« théorique HH:MM »), `:872` (« Altitude … m ») ; `affichage-commun.ts:563`
(« relevé HH:MM ») ; `grille.ts:366-367` (« Hors saison »).

**R-54 — Le mot « rollback », « legacy » et les procédures de `mise-en-service.md`
(§B, §F, §I) : voir R-46, R-48, R-49.** Regroupés ici pour le §H : une relecture
complète de `docs/mise-en-service.md` par Thomas, avec Myosotis, avant le transfert.

### A.4 — Simplifications, pour le dossier de reprise

**R-55 — `ecran.ts` et `grille.ts` portent sept fonctions strictement identiques et le
même prologue de démarrage ; le défaut de 15 min existe en trois exemplaires.** F3 ·
Myosotis · Z2-17.
`$` (`:104`/`:84`), `afficheNeutrePermanent` (`:648`/`:415`), `majHorloge`
(`:660`/`:397`), `afficheErreur`, `dureeCacheMs`, `machineDe`, `nomGare` ; prologue URL /
zoom / identifiant / mode / fournisseur / `onChange` / `.catch` (`:123-161` et
`:814-894` contre `:94-133` et `:512-587`) ; 15 min : `params.ts:52`, `mock.ts:209`,
`affichage-commun.ts:741`. R-08 montre déjà une des deux copies en retard sur l'autre.

**R-56 — `expressATraiter()` n'est sur aucun chemin de production : la supervision
recalcule la règle en ligne.** F3 · Myosotis · Z1-07.
`horaires.ts:451-475`, seul appelant `appliqueTerminusBellevue` (`:438`), lui-même
appelé par `mock.ts:785` seulement ; règle réécrite `supervision-logique.ts:1483-1488` ;
docs/02 §3 la présente comme moteur exigé. Mutation « toujours vide » : `src/pages` et
`src/data` verts (58 fichiers).

**R-57 — La bascule Terminus Bellevue et la normalisation « pair → N−1 » existent en
deux exemplaires, et le mock la réapplique à chaque lecture.** F3 · Myosotis · Z1-08.
`seuilMontee()` `horaires.ts:369-371` ; copie en ligne `:427-428` ; troisième forme sans
plancher `:777` ; `deltaTerminusBellevue` `:386-389` (« la SEULE description de la
règle », faux) ; `mock.ts:783-788` réapplique la bascule à chaque `getJour()` — le
défaut M-21 du 08/09 reproduit dans la démonstration.

**R-58 — Constantes et helpers en double dans le noyau ; bornes de `params` en trois
copies ; la matrice des droits n'est reliée aux 54 politiques que par un seul pont
calculé.** F3 · Myosotis · Z1-12, Z1-13, Z1-14.
« secondes → HH:MM:SS » écrit trois fois (`import-grille.ts:239`, `train-sup.ts:107`,
`edition-grille.ts:135`) ; `hhmm()` deux fois ; noms de gares en trois sources ;
`garesDansLeSens` exportée et recopiée ; lettres de légende et repli 60 s en double ;
veille par défaut 21:00/06:00 en QUATRE copies (`params.ts:50`, `mock.ts:207`,
`supervision.ts:4008`, `:4175-4176`) ; bornes `3, 60` et `0, 1800` écrites en ligne
(`params.ts:258-260`) et recopiées à la main dans `securite.test.ts:1063-1070` ;
`aLeDroit` n'est confronté à une politique RLS que pour `affluence`
(`securite.test.ts:1642-1650`). Chaque copie est tuée par SON test, aucune par une
comparaison avec l'autre.

**R-59 — Six exports morts, testés mais jamais appelés.** F3 · Myosotis · Z1-09, Z3-13.
`edition-grille.ts:46-54` (`origineStructurelle`, `terminusStructurel` — renommage :
`tsc` OK) ; `brouillon.ts:64` (`nbCirculationsEnAttente`, précisément ce que R-13
devrait employer) ; `correction-grille.ts:147-150` ; `supervision-logique.ts:635, 1869`.

**R-60 — Des tests verrouillent des commentaires et des blocs recopiés.** F3 · Myosotis
(décider : mémoire, ou retirer) · Z2-18.
`bandeaux-essai.test.ts:230-268` (« 10 px », « 923 px », « 17vh / 19vh » doivent figurer
dans les commentaires de `grille.css`) ; `grille-derniere-ligne.test.ts:139-163` ;
`jour-simule.test.ts:187-193` ; `responsive-index.test.ts:106-141` (trois blocs de
`base.css` recopiés). Rouges sur toute reformulation, jamais sur une régression.

**R-61 — Le chunk de logique partagé embarque en gare le mock, la supervision, la
matrice des rôles et la règle du guetteur.** F3+F4 · Myosotis · Z2-20, Z4-16, S.
Mesure (§F) : 180 925 o de source sur 362 724 dans `supervision-logique-*.js`, dont
`ecran.html` n'exécute que trois lignes. Causes : `ecran.ts:81`, `grille.ts:63`
(`identifiantEcran` importé de `./supervision-logique`) ; `src/data/index.ts:10` (import
statique de `MockProvider`).

**R-62 — Logos inlinés par `define` : le rond blanc quatre fois dans le bundle écran, la
motrice deux fois dans la grille ; la motrice est un PNG déguisé.** F4+F3 · Myosotis ·
Z2-16, Z5-18, S. Mesures au §F.

### A.5 — Un constat corrigé par la mesure

**Z2-19 (« le tableau des départs et les deux tableaux de la grille sont reconstruits
intégralement chaque seconde ») est ramené à sa lettre.** Le code assigne bien
`$('corps').innerHTML` sans garde dans `afficheTableau` (`ecran.ts:441-447`) et
`$('tab-montee').innerHTML` dans `grille.ts:482-483`, à chaque `rendre()`. Mais la mesure
au navigateur (26/09, écran de démonstration, 10 s, `innerHTML` intercepté) ne montre
que l'horloge : 10 affectations de 32 caractères. Le 28/09 la même mesure tombe sur un
jour hors saison (R-01), où `rendre()` sort avant les tableaux. La reconstruction par
seconde existe donc dans le code, mais son coût réel n'a pas été observé ; il reste à
mesurer un jour de service, sur un Raspberry (§I). Le constat est classé **Ouvert,
confiance moyenne, sans urgence** : une signature du contenu, comme en a le bandeau
(`affichage-commun.ts:527`), suffirait.

## B. Déjà tombé — le code a bougé, le constat ne s'applique plus

Constats du tri du 06/09 renvoyés « hors périmètre » des lots 1-2, et cas réels de
septembre, tous vérifiés en cassant ce qu'ils protègent (le test tombe) ou en le mesurant :

| Constat d'origine | Ce qui le ferme aujourd'hui | Preuve |
| --- | --- | --- |
| C-03 a/b — âge des données non borné, instantané relu non validé | `resilience.ts:80-83, 125` | `Math.max` retiré, `quand` non contrôlé, postdaté > 60 s, > 24 h : quatre mutations rouges |
| C-03 c — comparaison à l'horloge serveur (en-tête `Date`) | `horloge.ts:85-97`, `supabase.ts:184-199` | fonction pure testée (le câblage : R-23) |
| C-03 d — NTP imposé sur les postes | `docs/kiosque.md` §4, `corrige-horloge.service` | doc ; le script sort en succès sans réseau, limite connue et écrite (`:214-218`) |
| C-04 / M-06 — version du service worker dérivée du build | `sw.js:40` (`?v=` relu dans sa propre URL) | version figée : 6 tests rouges |
| E-01 — `signOut` global | `session-et-purge.test.ts` | `scope: 'global'` : rouge |
| E-02 — session ouverte depuis le fragment d'URL sur un écran | `creeProviderReel(…, true)` | `sansSession` retiré : rouge |
| E-03 — tableau vide au démarrage | horloge de secours, borne 10 s, `.catch` | code présent dans les deux pages (verrous : R-22) ; mais voir R-01 pour le cas hors saison, qui est un AUTRE chemin vers le même symptôme |
| E-04 — `?simule=` sans trace | bandeau « HEURE SIMULÉE » | mesuré au navigateur, présent y compris sur l'écran neutre |
| M-14 — `?cache=` sans borne | `affichage-commun.ts:730-741` | `n <= 99999` : rouge ; recette manuelle corrigée dans ce lot |
| M-02 — média supprimé du bucket rejoué indéfiniment | `sw.js` péremption 6 h | cache-d'abord met en cache un 404 : rouge |
| M-21 — recalculer la colonne efface les réglages manuels | supervision (08/09) | vérifié par la zone 3 ; reproduit dans le SEUL mock (R-57) |
| F-08 — couleurs de rame non validées | `couleursRame` / `couleurSure` | couleur brute concaténée : rouge (périmètre du test : R-43) |
| Cas du 19/09 — usurpation ACCIDENTELLE de l'identifiant de poste | PR #43, `identifiantEcran` | blancs = absence : rouge ; le câblage des pages : R-21 |
| Cas n° 7 — CSP hors du `<head>`, test qui cherchait la chaîne | PR #44, test de position | balise déplacée après `</head>` : rouge sur chacune des quatre pages ; et la CSP AGIT au navigateur |

La double construction CI d'une branche portant une PR (13/09) est fermée par le
workflow du 19/09 (`deploy.yml`, déclencheurs restreints à `main`, `dev` et aux PR).

## C. Sans objet — n'a pas de sens dans cette architecture

- **Poser la CSP par en-tête HTTP, ou `frame-ancestors`** : GitHub Pages ne permet
  aucun en-tête ; `frame-ancestors` est ignoré dans un `<meta>`. Dit dans les quatre
  pages et dans CLAUDE.md.
- **Précacher les chunks hachés dans `sw.js`** : le fichier vit dans `public/`, Vite ne
  le traite pas ; la solution est un manifeste produit au build (R-07), pas une liste
  écrite à la main.
- **Tester la fuite mémoire dans l'intégration continue** : il n'y a pas de Raspberry
  dans la CI ; c'est une mesure en gare (§D, §I).

## D. Ne se corrige pas — contrainte ou décision assumée

- **Le signal de vie anonyme sur `ecrans`** — décision du 29/08/2026
  (`securite-advisors.sql:440`), reconduite le 22/09 (PR #43 : « pas de correctif
  court »). Mais son échéance a disparu (R-45) : à ré-acter, §E.
- **« Mot de passe oublié » annonce « un lien vient d'être envoyé » même hors réseau** —
  décision du 09/09/2026 (docs/02 §5 : succès, adresse inconnue et panne confondus,
  anti-énumération). Verrouillée : remonter l'erreur fait tomber 3 tests. À connaître.
- **`style-src 'unsafe-inline'`** — 95 attributs `style=""` (79 dans `supervision.html`),
  décision du 06/09 (lot 2) ; le chiffre de CLAUDE.md est faux (R-52), la décision non.
- **Lecture publique des tables d'affichage** — assumée (`docs/securite.md` §2) ; ce
  qui ne l'est pas, c'est `params.alertes_destinataires` (R-14) et la liste des
  identifiants d'écrans (§E).
- **Pas de contrôle des mots de passe compromis** — plan Supabase gratuit
  (`docs/securite.md` §4) ; compensation par la longueur, dont le verrou est R-37.
- **La fuite mémoire sur 18 h** — ne se prouve qu'en gare : `ps` ou
  `chrome://memory-internals` sur le Pi de Saint-Gervais, une fois par heure sur une
  journée. Rien dans le dépôt ne le contredit ni ne le confirme.

## E. Le signal de vie anonyme sur `ecrans` — la question à arbitrer

### Ce qu'un anonyme peut faire aujourd'hui, mesuré dans le SQL

Un écran en gare n'a pas de compte : il écrit dans `ecrans` avec la clé publiable, qui
est publique par conception (elle est dans le bundle JavaScript). La portée de cette
écriture, lue dans `supabase/schema.sql` :

- **cinq colonnes** : `grant update (derniere_vue, donnees_maj, date_affichee,
  version_app, reseau) on ecrans to anon` (l. 1059-1060) ; `insert`, `delete` et
  `truncate` sont révoqués (l. 1058) ;
- **toutes les lignes** : `create policy "signal de vie" on ecrans for update to anon
  using (true) with check (true)` (l. 1090-1091) — aucun lien entre l'appelant et l'`id` ;
- **l'horodatage est forcé côté serveur** : `trg_signal_de_vie` (l. 1118-1140, migration
  `2026-08-signal-de-vie-serveur.sql`) remplace `derniere_vue` par `now()` dès qu'elle
  change, borne `donnees_maj` à `now()` — et accepte `NULL`, qui efface la preuve de
  fraîcheur ;
- **la lecture est publique et entière** : `create policy "lecture publique" on ecrans
  for select using (true)` (l. 766), sans restriction de colonnes — alors que
  `circulations` (l. 749-753) et `affluence` (l. 710) ont des GRANT de colonnes en
  lecture pour `anon`. Les treize colonnes se lisent d'un `GET /rest/v1/ecrans` avec la
  clé publiable : identifiants déclarés, gare, type, veille, ordre de rechargement en
  attente, `surveille` (rendu public par la migration du guetteur sans le dire) ;
- **aucune trace** : `trg_journal_ecrans` (l. 1752-1760) exclut ces colonnes.

Le client (`src/data/supabase.ts:608-641`) envoie `update({derniere_vue, donnees_maj,
date_affichee, version_app, reseau}).eq('id', e.id)` puis relit `recharger_demande_at,
veille_debut, veille_fin, vitesse_ticker_px_s`. Les deux textes libres (`reseau`,
`version_app`) sont échappés à l'affichage en supervision (`supervision.ts:4035,
4040`) : pas d'injection par ce chemin.

### Ce que ça permet, et ce que ça ne permet pas

**Impossible** : créer un poste, en supprimer un, ordonner un rechargement
(`recharger_demande_at` n'est pas dans le GRANT), régler une veille, faire paraître des
données plus fraîches qu'elles ne sont, antidater ou postdater un signal.

**Possible** pour quiconque a la clé publiable — c'est-à-dire n'importe qui — et lit un
identifiant déclaré :

1. **faire battre un écran mort** : un `PATCH /rest/v1/ecrans?id=eq.saint-gervais-ecran-1`
   toutes les dix minutes maintient `derniere_vue` fraîche ; la supervision le dit en
   ligne, le guetteur ne l'alerte jamais, sans trace. C'est le scénario du 19/09/2026
   (trois heures d'écran muet, une heure de supervision rassurante), sauf qu'il serait
   voulu ;
2. **faire passer un écran vivant pour en retard** : `donnees_maj` reculée ou `NULL` ;
   l'erreur va dans le sens de la fausse alerte, ce que `schema.sql` (l. 1084-1087)
   assume explicitement — mais le point 1 va dans l'AUTRE sens, celui du faux « tout va
   bien », que le même commentaire dit exclu ;
3. **afficher une journée fausse en supervision** : `date_affichee` libre.

Le lot du 22/09 (PR #43) a supprimé l'usurpation ACCIDENTELLE : l'identifiant ne se
déduit plus de la gare, il faut l'avoir écrit dans l'URL du kiosque. Le commentaire de
`identifiantEcran()` (`supervision-logique.ts:182-183`) dit « il n'est plus devinable —
il faut l'avoir écrit ». Vrai pour un onglet ouvert par curiosité ; faux pour une
volonté, puisque la liste des identifiants est publique par l'API.

Ce n'est pas une fuite de données : c'est un **mensonge possible sur l'état du parc**,
c'est-à-dire exactement ce que la table `ecrans` existe pour dire, et le guetteur en
dépend depuis le 19/09. Le seul endroit du dépôt qui le nomme est
`securite-advisors.sql:450-460` (« renvoyé à la relecture générale d'avant transfert ») ;
`docs/securite.md` §4 et CLAUDE.md n'énoncent que les trois garde-fous, sans le résidu.

### Pourquoi la question doit être posée maintenant

Le risque est *assumé* et documenté — `docs/securite.md` §4, `schema.sql` l. 1063-1089,
`docs/02` l. 576 — avec une **échéance** : « fermeture définitive en **phase 2**, où le
micro-serveur interne prendra en charge les écritures des écrans et le rôle anonyme
disparaîtra ». Or le *Plan de pérennisation* (version 3 du 06/09/2026) abandonne la
phase 2 (R-45). **L'échéance du risque assumé n'existe donc plus**, et le dépôt ne le
sait pas : un prestataire qui en hérite lira qu'un défaut connu se ferme « en phase 2 »
et l'attendra.

### Ce que ça coûterait de résoudre — trois options

**Option A — un secret par poste, vérifié côté serveur.** Le poste en gare PEUT garder
un secret : pas dans le bundle (public), mais dans l'URL de son `autostart`, qui ne vit
que sur sa carte SD. Mécanisme : une colonne `ecrans.jeton` (empreinte), une fonction
SQL `signal_de_vie(id, jeton, …)` en `security definer` qui vérifie l'empreinte, fait
l'`update` et renvoie les réglages du poste ; `revoke update on ecrans from anon` — le
rôle anonyme ne garde plus AUCUNE écriture, ce qui simplifie d'autant le modèle de
sécurité et sa documentation ; et un GRANT de colonnes en lecture sur `ecrans` pour
`anon`, comme `circulations` en a un, pour cesser de publier la liste. Côté front,
`heartbeat()` appelle la fonction ; côté supervision, « Déclarer » génère le jeton et
l'affiche une fois ; côté kiosque, `docs/kiosque.md` et la checklist de pose ajoutent
`&jeton=` ; côté exploitation, le même ordre de mise en service que la PR #43 — **le Pi
d'abord, la fusion ensuite**. Résidu : qui accède physiquement à un Pi peut usurper CE Pi,
et lui seul. Coût : un lot d'une journée de prestataire (migration + fonction +
provider + supervision + doc + cas dans `roles-rls.sql`), plus une intervention par Pi
posé.

**Option B — détecter plutôt qu'empêcher.** Faire enregistrer par le déclencheur
l'adresse d'origine de chaque signal (`current_setting('request.headers')`, en-tête
`x-forwarded-for`), l'afficher en supervision, faire alerter le guetteur quand elle
change. Coût : une demi-journée. Robustesse faible : les gares derrière la même sortie
internet partagent une adresse, celle du Nid d'Aigle en 5G change, un onglet de bureau sur
le réseau de la Régie serait indiscernable. À écarter, sauf comme complément de A.

**Option C — accepter, et le dire.** Garder l'écriture anonyme, mais réécrire
l'échéance : remplacer « fermeture en phase 2 » par une décision datée (« accepté le
JJ/MM/2026 en connaissance du guetteur, réexamen au transfert à Myosotis ») dans
`docs/securite.md` §4, `schema.sql` et `docs/02`, en nommant le résidu (le point 1).
Coût : nul. Ce que ça achète : un dossier de reprise qui dit la vérité. Ce que ça
n'achète pas : le point 1 reste possible.

**Recommandation de la relecture** : C tout de suite (une correction de documentation),
A inscrit au dossier de reprise comme premier lot du prestataire — parce qu'il ferme la
dernière écriture anonyme de la base, qu'il ferme aussi R-14 par le même geste (un GRANT
de colonnes) et qu'il coûte une journée. La décision revient à Thomas, avec Myosotis.

## F. Performances — sur mesure, et pas contre une cible inventée

Le budget écrit est « JS < 400 Ko gzippé hors polices » (CLAUDE.md) et « hors
polices/logos ; TTI < 3 s sur Pi » (`docs/02` §8). Ce qui a été mesuré, sur le build du
26/09 (`vite build --sourcemap`, tailles gzip mesurées fichier par fichier) :

**Ce qu'une page d'écran charge réellement.** `ecran.html` référence neuf fichiers JS et
CSS : **349 121 o gzippés** au total ; `grille.html`, huit : **350 212 o**. Les polices
font 164 316 o (dix `.woff2`, chargés à la demande). Après le premier chargement, le
service worker sert JS, CSS et polices depuis le cache : ce poids ne se paie qu'une fois
par version déployée. Sur la 5G du Nid d'Aigle comme sur la fibre, moins d'une seconde ;
sur une liaison à 2 Mbit/s, deux à trois secondes. **Ce n'est pas un problème
d'exploitation.** Le budget est tenu, avec ou sans logos.

**Ce qui est anormal dans la construction, mesuré.** Le bundle `ecran-*.js` pèse
479 388 o bruts, 223 223 o gzippés ; son CODE en fait 12 509 o bruts, 5 492 o gzippés.
**Les 97 % restants sont six logos en base64**, parce que `vite.config.ts` (l. 41-56)
les injecte par `define`, qui substitue le texte à CHAQUE occurrence du symbole :

| Logo | occurrences dans `ecran.ts` | base64 gz par copie | copies en trop |
| --- | --- | --- | --- |
| `logo-rond-blanc` | 4 (l. 161, 459, 471, 751) | 26 086 o | 3 → **78 258 o gz** |
| `logo-long` | 1 (l. 160) | 26 006 o | — |
| `motrice-blanc` | 1 (l. 356) | 87 026 o | — |

Dans `grille-*.js` (394 780 o bruts, 231 242 o gz, code réel 4 187 o gz), la motrice est
présente **deux fois** (`grille.ts` l. 288 et 355) : **87 026 o gz en trop**. gzip ne
rattrape rien : sa fenêtre de 32 Ko ne voit pas une répétition de 68 Ko. La zone 5 a
refait le calcul autrement (doublons remplacés par un jeton) : 145 673 o gz au lieu de
223 478 (−35 %) sur l'écran, 144 213 au lieu de 231 503 (−38 %) sur la grille.

**La motrice n'est pas un dessin vectoriel.** `motrice-direct_blanc_FFFFFF.svg`
(93 405 o) contient `<image … width="2541" height="1876"
xlink:href="data:img/png;base64,…">` : 90 017 o de PNG, un bitmap de 4,8 Mpx pour un
pictogramme affiché en quelques dizaines de pixels de haut, qui ne se compresse pas
(68 966 o gz pour le SVG seul, 87 026 o une fois en base64) et qui est livré quatre fois
en tout (écran ×1, grille ×2, supervision ×1). Les autres logos sont des exports
Illustrator non optimisés (« Generator: Adobe Illustrator 30.4.0 » ; 51 à 72 Ko chacun) —
le gain d'une optimisation n'a pas été mesuré, les logos officiels étant hors de portée
de ce lot.

**Le service worker précharge des fichiers que personne ne demande** (R-07) :
216 895 o par installation, et un point d'échec pour le démarrage hors ligne.

**Le chunk de logique partagé embarque en gare ce qui n'y sert pas** (R-61).
`supervision-logique-*.js` (93 981 o bruts, 29 799 o gz) est chargé par les trois pages.
D'après la carte de source, il contient `supervision-logique.ts` (82 006 o de source),
`mock.ts` (67 705 o, le fournisseur de démonstration), `roles.ts` (21 547 o) et
`surveillance-ecrans.ts` (9 667 o) : 180 925 o de source sur 362 724 (50 %) dont un écran
de gare n'exécute rien, sauf les trois lignes de `identifiantEcran()`. Le coût réseau
est faible (une quinzaine de Ko gz) ; le coût de reprise est réel : un prestataire qui
change la supervision recompile et redéploie les écrans, et un défaut de
`supervision-logique.ts` au chargement du module tombe sur les six gares.

**À l'exécution.** Le noyau est hors de cause : `passagesPourGare`, `prochaineArrivee`,
`finDeService`, `positionsTrains` coûtent 0,03 à 0,04 ms par appel sur la grille du grand
service (mesuré par la zone 1) — même vingt fois plus lent en gare, un tick reste sous la
milliseconde. Au navigateur, en démonstration : 3 mutations DOM par seconde, nœuds
stables, tas stable à 7 Mo sur trente secondes ; la reconstruction des tableaux par
seconde (Z2-19) n'a pas été observée et reste à mesurer un jour de service (§A.5). Les
minuteurs et écouteurs sont armés une seule fois dans `demarre()`, jamais réarmés à une
synchronisation ; un seul `ResizeObserver` ; la minuterie du bandeau nettoyée au
changement de contenu (zone 2, acquittements). Ce qui reste sans mesure : « TTI < 3 s
sur Pi » et la mémoire sur 18 h (§D).

**Verdict.** Rien de ce qui précède ne justifie un chantier de performance ; tout
justifie un lot court d'hygiène de construction, pour Myosotis, sans urgence : (1) un
module `logos.ts` qui exporte chaque data URI une fois (−78 Ko gz sur l'écran, −87 Ko
sur la grille, dix lignes) ; (2) une motrice réellement vectorielle, à demander à qui a
fourni les logos, ou à défaut un PNG à la taille d'affichage ; (3) retirer du précache
les trois logos que rien ne demande, et produire la liste des chunks au build ; (4)
sortir `identifiantEcran()` dans un module sans dépendance et charger `mock.ts` par
import dynamique ; (5) un seul sondage de repli, conditionné à l'état du canal (R-15).

## G. `supervision.ts`, 5 680 lignes : problème ou pas

Mesuré par la zone 3 (`zone-3-supervision.md` §3) : 5 680 lignes dont 1 355 de
commentaires (24 %) ; 124 fonctions de niveau module ; la plus longue,
`initCirculations` (l. 1929-2982), fait **1 054 lignes**, 18,6 % du fichier — une
fermeture qui tient vingt fonctions internes et un répartiteur à seize actions ; puis
`initParametres` (253), `demarre` (191), `initEcrans` (177), `initMedias` (165). État de
niveau module : 42 `let` et 8 collections mutées en place, 50 liaisons partagées par tout
le fichier — mais 26 ont au plus deux sites d'écriture, 16 un seul ; les plus écrites
sont `utilisateurs` (5), `roles` (4, et c'est ce que R-34 exploite), `jour` (4). Neuf
onglets ; `onglet-horaires.ts` est une seule fonction de 1 305 lignes de la même forme.
`supervision-logique.ts` (47 fonctions) n'a **aucun** accès au DOM : la séparation
annoncée est réelle. Les 95 attributs `style=""` (79 dans le HTML) sont comptés au R-52.

Ce qu'un prestataire lit pour changer UN onglet : Écrans, cas favorable, ~600 lignes
dans trois fichiers, trouvables parce que chaque bloc est titré ; Circulations, cas
défavorable, 1 630 lignes d'un seul tenant plus `brouillon.ts`, `etat-publiable.ts`,
`publieLeBrouillon` et six fonctions de logique — le seul onglet réellement difficile.

**Un test peut-il monter un onglet isolément ? Non.** Le module a cinq effets à l'import
(`poseMarquePreversion()` l. 202, `analyseLienAuth(…)` l. 204, `creeProvider(…)` l. 233,
`creeSourceHeure(…)` l. 506, `void demarre()` l. 5680), et `$()` lève au premier
identifiant absent. Conséquence mesurée : **21 fichiers de test lisent `supervision.ts`
comme du texte, pour 729 assertions** ; sur les 16 mutations dirigées contre ces
assertions, 4 ont survécu (R-13, R-34, R-35, R-36), et le dépôt en avait déjà relevé
une cinquième (le cas n° 5).

**Conclusion.** Les 5 680 lignes ne sont pas un problème de lecture — le fichier est
commenté au quart, titré par onglet, et sa logique pure est vraiment sortie — mais un
problème de **test** : parce que le module s'exécute à l'import, aucune règle qu'il
porte ne peut être exercée autrement que par des assertions sur son texte, et cette
relecture en a trouvé quatre qui laissent passer le défaut qu'elles prétendent tenir.
Le geste utile n'est pas de le découper, c'est de le rendre importable (exporter
`demarre(document, config)` et retirer les cinq effets de module), puis de migrer les
assertions textuelles onglet par onglet, en commençant par Circulations. Pour Myosotis,
dans le dossier de reprise ; pas pour ce lot.

## H. Ce qui part chez Myosotis avec le dossier de reprise, et ce qui reste à Thomas

**Pour Thomas — décisions et gestes courts (14 constats)** :

- R-01 : vérifier aujourd'hui l'état des écrans en gare et la journée en supervision ;
  si aucune grille active ne couvre la date, en charger une (ou décider de l'affichage
  hors saison) — le correctif du code va à Myosotis ;
- R-03 : ne pas rejouer `2026-09-roles-multiples.sql` sur une base en service ; passer
  la requête du §I sur la production ;
- R-45 et §E : ré-acter la décision sur le signal de vie anonyme, sans échéance
  fictive (option C aujourd'hui, A au dossier de reprise) ;
- R-08, R-14, R-16, R-53 : quatre décisions d'exploitation (veille d'une grille,
  destinataires d'alerte lisibles, périmètre réel du technique sur `params`, textes
  français seuls) ;
- R-46, R-47, R-48, R-49, R-50 : relire `docs/securite.md` §2, `docs/01` §3-§5,
  `docs/mise-en-service.md` §B/§F/§I et `docs/03` — Myosotis corrige, Thomas valide ;
- R-51 : trente secondes dans l'éditeur SQL pour trancher la croyance sur les tables
  temporaires (§I) ;
- R-44 : `/verif` sous PowerShell.

**Pour Myosotis — dans le dossier de reprise, par lots (54 constats, certains dans deux
lots)** :

1. *Lot « guetteur et signal de vie »* : R-02, R-25, R-26 (horodatage), R-42, option A du
   §E ;
2. *Lot « installation d'une base neuve »* : R-03, R-04, R-31, R-27, R-48, R-51 —
   une seule source d'installation (`schema.sql` + seed + textes), et les tests qui
   comparent VRAIMENT `schema.sql` aux migrations ;
3. *Lot « verrous des écrans »* : R-01 (le correctif : afficher l'état hors saison
   avant la garde, et un test qui le rend), R-21, R-22, R-23, R-24, R-33, R-39, R-40,
   R-41, R-43 — des tests qui exécutent `ecran.ts` et `grille.ts` au lieu de les lire ;
4. *Lot « supervision testable »* : §G, R-05, R-06, R-10, R-11, R-13, R-34, R-35, R-36,
   R-37, R-38, R-59 ;
5. *Lot « Edge Functions et recette RLS »* : R-17, R-28, R-29, R-30, R-32 ;
6. *Lot « hygiène de construction »* : §F, R-07, R-09, R-15, R-18, R-19, R-20, R-55 à
   R-62, R-12, R-52 ;
7. *Lot « documentation »* : R-46 à R-50, R-52 (avec Thomas).

Les 18 constats informatifs du lot 7 (06/09) sont déjà partis par ce chemin en
septembre ; les 52 ci-dessus les rejoignent, pour la même raison.

## I. Ce qui n'a pas pu être vérifié, et ce qui manquerait pour trancher

Sans base de données, sans Raspberry, sans GitHub ni Supabase depuis cette relecture :

- **R-01 en production, aujourd'hui** : ouvrir `ecran.html?gare=saint-gervais` en
  production, ou la supervision (Circulations, date du jour) : « hors saison » = les six
  gares affichent un tableau vide.
- **R-03 — la production a-t-elle déjà subi le rejeu ?** `select tablename, policyname
  from pg_policies where tablename in ('affluence','onglets_par_role','alertes_ecran',
  'surveillance_etat') order by 1,2;` → 7 lignes attendues.
- **R-04 — journal et purge en production** : `select prosrc like '%mois < 1%' from
  pg_proc where proname = 'purge_journal_exploitation';` → `true` ; `select
  pg_get_triggerdef(oid) from pg_trigger where tgname in ('trg_journal_circulations',
  'trg_journal_ecrans');` → doit citer `acces` et `surveille`.
- **R-14** : `curl -H "apikey: <sb_publishable>"
  "https://<ref>.supabase.co/rest/v1/params?cle=eq.alertes_destinataires&select=valeur"`
  → un 200 avec la liste confirme.
- **§E — la surface décrite est-elle bien celle de la base ?** `curl -X PATCH -H
  "apikey: <sb_publishable>" -H "Content-Type: application/json" -d
  '{"derniere_vue":"2000-01-01"}' "https://<ref>.supabase.co/rest/v1/ecrans?id=eq.<un
  poste éteint>"` puis lire `derniere_vue` → `now()` attendu.
- **R-51** : dans l'éditeur SQL, d'un bloc : `create temporary table t(x int); insert
  into t values (1); select * from t;` — une ligne rendue = la table survit.
- **Le guetteur réellement armé** : `select jobname, schedule, active from cron.job;` ;
  `select status, return_message, start_time from cron.job_run_details order by
  start_time desc limit 5;` ; `select name from vault.decrypted_secrets;` (deux noms :
  `url_alerte_ecrans`, `cle_guetteur`) ; `select derniere_execution, now() -
  derniere_execution from surveillance_etat;`.
- **`--no-verify-jwt` réellement limité à `alerte-ecrans`** : `npx supabase functions
  list --project-ref <ref>` → colonne VERIFY JWT à `false` pour elle seule.
- **Le nettoyage des rôles a-t-il été joué ?** `select column_name from
  information_schema.columns where table_name = 'profils' and column_name = 'role';` →
  0 ligne attendue.
- **R-30 / R-26 — la RLS réelle** : compléter `roles-rls.sql` des dix chemins manquants
  et la jouer sur la base de test ; elle ne couvre pas l'horodatage.
- **R-37 — « quatre familles de caractères »** : tableau de bord Supabase Auth,
  « Password requirements ».
- **R-32** : ouvrir dans Excel un fichier produit par `ecritClasseur` et lire « 7:00 »
  ou « 0,2916 ».
- **R-07 en réel** : DevTools → Application → Cache Storage sur le build de
  production, un déploiement, puis un rechargement hors ligne.
- **R-15, R-18, R-40, Z2-19, « TTI < 3 s », mémoire sur 18 h** : l'onglet Réseau et un
  profil de rendu sur un Raspberry en gare, un jour de service.
- **`.claude/launch.json`** : le chemin `…\AppData\Local\nodejs-portable\…` existe vu de
  l'application, pas forcément du terminal (redirection MSIX) — un `ls` hors de
  l'application tranche.
- **La provenance de l'oracle des tests d'import** : `docs/grilles-historique/*.json`
  ont vraisemblablement été produites par l'importeur qu'elles servent à tester ; dix
  cellules du document d'exploitation papier confrontées au JSON trancheraient.

## J. Les contrôles éprouvés et acquittés — le taux de survie

138 mutations sont tombées (le contrôle mord). Elles sont listées une par une dans les
cinq rapports bruts ; les acquittements qui comptent le plus, parce qu'ils ferment des
questions posées par le prompt ou par le tri du 06/09 :

| Ce qui était en question | Comment ça a été éprouvé | Verdict |
| --- | --- | --- |
| La CSP, sur les QUATRE pages : position dans `<head>`, `script-src`, `'unsafe-inline'`, `wss:` | 16 mutations (4 par page) sur `demarrage-ecrans.test.ts` ; injection d'un script au navigateur | 16 rouges ; bloqué sur les 4 pages |
| C-03 : âge borné, instantané postdaté / périmé / non numérique | 4 mutations sur `resilience.ts` | 4 rouges |
| `?cache=` borné 3–60 ; `?jour=` posé sur les deux pages ; secondes conservées dans les calculs | mutations ciblées | rouges |
| Le guetteur : clé comparée AVANT toute lecture ; seuil 10 min (copie Deno confrontée) ; exclusion de la veille ; échec Brevo tracé | 4 mutations sur la copie Deno et l'originale | rouges (jusqu'à 5 000 combinaisons) |
| `ongletsVisibles()` : intersection, deux replis, ligne forgée | 3 mutations | 13 tests rouges |
| Rouvreurs, onglet de secours, quorum différé + verrou consultatif (SQL et migration) | 5 mutations | rouges |
| « Voir comme » : droit d'entrée, brouillon non appliqué, verrou reposé, méthode non classée, en-tête, restauration | 7 mutations | rouges ; aucun chemin d'écriture hors du verrou (grep `fetch`, `supabase`, `XMLHttpRequest`) |
| Édition / import de grilles : validateur bloquant, avertissements non acquittés | 2 mutations | rouges |
| Les correctifs PR #7 sont dans les DEUX pages (horloge de secours, borne 10 s, `.catch`, bandeau) | lecture côte à côte | présents — ce sont les verrous qui sont inertes (R-22) |
| Aucun `Date.now()` dans `src/core/` ; aucun appel Supabase hors `src/data/` ; `lecture-xlsx` hors des bundles écrans | grep + build + mutation d'import statique | vrai ; rouge |
| Pureté du noyau, tests sans assertion, `.skip` / `.only`, dates qui dérivent | grep systématique sur les 79 fichiers | rien |
| Cas n° 5 (sélecteur vers rien) sur les trois pages et la supervision | 223 identifiants lus, tous posés ; classes CSS ; écouteurs `?.` | aucun orphelin prouvé |
| Idempotence de chaque migration prise seule ; `sed` de `REF_PROJET_PRODUCTION` ; grep d'artefact et étape de test du workflow | lecture ; exécution du `sed` ; 2 mutations du workflow | conforme ; rouges |
| Coureur en UTC | `TZ=UTC npx vitest run` | 79 / 2 334 verts |
| Le mock est-il tautologique ? | lecture de `mock.test.ts` | non : il exécute le `MockProvider` et teste des comportements |
| `identifiantEcran` : blancs = absence ; URL d'autostart cohérente avec la fonction | mutation ; lecture de `kiosque.md:45` | rouge ; cohérent |

Ce que ce tableau dit, avec la liste des survivantes : les tests de ce dépôt mordent
là où ils EXÉCUTENT (fonctions pures, bancs de `supprimer-utilisateur` et
`alerte-ecrans`, `MockProvider`, `roles.ts`), et ils laissent passer là où ils LISENT
(pages, SQL, scripts). La prochaine ligne de défense n'est pas plus de tests de texte ;
c'est rendre exécutable ce qui ne l'est pas — `supervision.ts` (§G), le démarrage des
pages d'écran (R-22), les deux Edge Functions sans banc (R-29) — et jouer la recette RLS
sur la base de test à chaque lot qui touche au SQL (R-30).
