# Spécification fonctionnelle v2 — Affichage voyageurs TMB

Version 2.0 — 24 août 2026 (retours de validation intégrés).
Référence visuelle : maquettes v2 validées (`maquettes/`). Référence
horaires : `public/grilles/*.json` (officiels été 2026).

## 1. Vues

| URL                     | Usage                                      | Utilisateur                          |
| ----------------------- | ------------------------------------------ | ------------------------------------ |
| `ecran.html?gare=<id>`  | Arrivées/départs + médias (quai/extérieur) | Écran public plein écran             |
| `grille.html?gare=<id>` | Grille complète du jour                    | Écran public optionnel (22", totem…) |
| `supervision.html`      | Pilotage (onglets)                         | Agents authentifiés                  |

Paramètres écrans : `gare` (obligatoire), `ecran=` (identifiant physique,
défaut `<gare>-<type>-1` où type = `ecran` ou `grille` — les deux pages
d'une même gare sont ainsi deux postes distincts dans « État des écrans » ;
plusieurs écrans du même type se distinguent par `ecran=`),
`simule=HH:MM` (démo/tests), `zoom=`.

## 2. Données métier

### 2.1 Grilles de saison (fichiers versionnés)

`2026-ete-grand-service.json` (04/07→30/08) et
`2026-ete-petit-service.json` (13/06→03/07 et 31/08→27/09) — générées
depuis le document d'EXPLOITATION des horaires été 2026 : trains numérotés
(impairs = montées), liste ordonnée de passages `{gare, a?, d?: "HH:MM:SS"}`
avec l'arrivée ET le départ RÉELS à chaque gare (ex. arrêt de 5 min à
Saint-Gervais en montée ; « a » absent au point d'origine, « d » absent au
terminus ; les express n'ont pas de passage à col-de-voza/bellevue),
drapeaux `express`, `facultatif`, `velos`. `arret_intermediaire_s` (60 s)
ne sert plus que de REPLI si une arrivée manque dans le document. La halte
de SERVICE de Mont Lachat (entre Bellevue et le Nid d'Aigle) n'est pas
desservie : volontairement absente des grilles, elle ne doit JAMAIS
apparaître sur les écrans.
Une grille « 2026-2027-hiver » sera créée plus tard (terminus Bellevue
permanent). Le service actif se déduit de la date via `periodes`.

### 2.2 Circulations du jour (base)

Générées pour une date depuis la grille active (bouton + génération auto à
la première consultation d'une date) : `date, numero, sens, express,
facultatif, velos, rame, terminus ('nid-daigle'|'bellevue', porté par la
MONTÉE — y compris une montée express, dont la valeur « bellevue » sert
alors à produire le signalement « à traiter » de sa rotation),
facultatif_actif (défaut false), sans_voyageurs (défaut false), statut
ok|retard|supprime, retard_min, motif`. La supervision peut préparer
n'importe quelle date future (calendrier).

**Rotation appariée** : la montée n et la descente n+1 sont assurées par la
même rame ; la rame se choisit sur la montée et s'applique automatiquement
à la descente (non modifiable côté descente). **Terminus par train** : une
montée dont la colonne Terminus vaut Bellevue est tronquée à Bellevue et sa
descente appariée part de Bellevue. Une montée EXPRESS n'est JAMAIS
tronquée (elle ne dessert pas Bellevue) : la limitation manuelle est
interdite dans l'interface ; si la bascule de plage (§2.3) positionne sa
colonne sur Bellevue, l'express circule normalement et est signalé
« à traiter » en supervision, avec deux actions explicites : **Supprimer**
(il reste affiché barré jusqu'à son heure théorique ; la suppression de sa
descente appariée est proposée, comme pour toute montée) ou **Maintenir**
jusqu'au Nid d'Aigle (le signalement est levé et la rotation entière repasse
au Nid d'Aigle : la descente n'est donc PAS reportée à Bellevue, ce qui est
correct puisque la rame s'y trouve). Si la descente appariée est elle-même
un express (T9/T10, T17/T18), elle est signalée « à traiter » séparément :
ne desservant pas Bellevue, elle partirait du Nid d'Aigle alors que le
tronçon supérieur est fermé. Une descente NON express, en revanche, part
normalement de Bellevue. La requalification en omnibus limité à Bellevue reste à définir
avec l'exploitant : elle exigerait une heure d'arrivée à Bellevue absente
du document d'exploitation pour un express, et aucune heure ne doit être
inventée sur un affichage voyageur.
_(Correctif validé par l'exploitant le 24/08/2026.)_

**Trains sans voyageurs (courses à vide)** : `sans_voyageurs` marque une
circulation assurée pour les seuls besoins de l'exploitation
(repositionnement d'une rame, essai, service). Une MONTÉE comme une
DESCENTE peut l'être. Le train reste entier en supervision — il garde sa
rame, sa rotation et son terminus, et continue d'être piloté comme les
autres — mais il est **totalement absent des écrans voyageurs** : aucune
ligne dans les prochains départs, aucune colonne dans la grille du jour,
jamais de « prochaine arrivée », jamais de position en ligne. Le drapeau
n'a aucun effet sur le calcul des retards, sur le terminus Bellevue ni sur
le signalement des express, et l'action groupée sur les facultatifs (§5.1)
ne le modifie jamais.
_(Évolution validée par l'exploitant le 28/08/2026.)_

### 2.3 Jour d'exploitation (drapeaux du jour)

`terminus_bellevue` : false | {a_partir_du_train: N} — bascule PAR
ROTATION : N est un numéro de MONTÉE (impair) ; toutes les rotations dont
la montée porte un numéro ≥ N sont limitées (montée tronquée à Bellevue,
descente appariée au départ de Bellevue). « Terminus Bellevue toute la
journée » ≡ « à partir du T1 » (c'est aussi le régime hiver permanent). Si
un numéro PAIR est fourni (import, API), il est normalisé vers la montée de
sa rotation (N−1) ; l'interface de supervision ne propose que les montées.
La bascule ne fait que PRÉ-REMPLIR la colonne Terminus des rotations
concernées : la colonne reste prioritaire et ajustable train par train
ensuite. Exemple grand service, « à partir du T19 » : T19/T20, T21/T22,
T23/T24 et T25/T26 limités (T23, express, est signalé « à traiter » —
voir §2.2) ; T15/T16 et T17/T18 restent strictement normaux (T16 part bien
du Nid d'Aigle à 14:13:30). Effets écrans : voir §3.

### 2.4 Messages

`texte_fr, texte_en` (l'anglais peut rester VIDE : les écrans n'affichent
alors que le français, sans séparateur ni bloc anglais — on ne fabrique
JAMAIS de faux anglais, ni « [EN] français », ni du franglais mot à mot),
`cible` = toutes | liste de gares | numéro de train,
`priorite` normale (défilement) / importante (bandeau fixe), `expire_at`,
`actif`. Un message ciblé « train » ne s'affiche que dans les gares encore
desservies par ce train, tant qu'il n'est pas passé. **Les messages sont
modifiables après création** (édition en place). **La traduction anglaise
est générée automatiquement** dès la saisie du français (service de
traduction, voir docs/02 §5) et reste modifiable avant et après publication.
Si le service est indisponible et que la phrase n'est pas une phrase type
connue du repli, le champ anglais reste VIDE et la supervision affiche un
avertissement explicite (« Traduction automatique indisponible — saisissez
l'anglais, sinon le message ne sera diffusé qu'en français ») sans bloquer la
publication.
**Bibliothèque de messages préenregistrés** (`modeles_messages` : titre,
texte_fr, texte_en, catégorie, ordre, actif) : un sélecteur « Modèle… » en
tête du formulaire remplit le français ET l'anglais, qui restent modifiables
avant publication ; la cible, la priorité et l'expiration se choisissent
normalement ensuite. La bibliothèque est gérée dans Paramètres (admin).

### 2.5 Médias

Fichiers image (JPG/PNG) ou vidéo muette (MP4 H.264, 16:9 1920×1080
conseillé). Champs : nom, type, `duree_s`, `ordre`, gares cibles, `actif`,
`expire_at`. Réglages globaux : `duree_horaires_s` (temps d'affichage de la
page horaires, défaut 20 s) et `mode_medias`.

**Deux modes**, au choix de l'exploitant (onglet Médias) :
- **alterné** (défaut) — horaires → média 1 → horaires → média 2 → … ;
- **série** — horaires → TOUS les médias à la suite, chacun avec sa propre
  durée → horaires. Exemple : horaires 20 s → média 1 (8 s) → média 2 (8 s)
  → média 3 (12 s) → horaires, soit 48 s le tour.

**Ordre de passage** : colonne `ordre` (croissante, `cree_le` départageant),
réglable par les flèches ▲ / ▼ de l'onglet Médias, qui échangent l'ordre de
deux voisins. Un média fraîchement envoyé passe en DERNIER, pour ne pas
s'insérer au milieu d'une série réglée.

Seuls les médias actifs, non expirés et ciblant la gare entrent dans le
cycle. Sans média actif : horaires en continu.

**Règle prioritaire** : un média ne s'affiche JAMAIS tant qu'un train
occupe le quai — de son heure d'ARRIVÉE jusqu'à son retrait de l'affichage —
ni dans les 2 minutes avant un départ. Cette règle et le libellé de la case
de compte à rebours partagent la MÊME fonction du moteur (`quaiOccupe`,
qui appelle `compteARebours`) : le cycle médias avait sa propre règle
(« départ dans ≤ 2 min »), qui laissait passer les médias pendant les arrêts
longs — à Saint-Gervais, arrêt de 5 min, l'écran affichait « À QUAI » ET des
médias de 09:10 à 09:13.
_(Bug de production corrigé le 29/08/2026.)_ Si un départ approche au
milieu d'une série, l'écran revient immédiatement aux horaires ; la série
reprend ensuite au média SUIVANT, jamais au premier — sans quoi un média
placé juste avant un départ serait systématiquement sauté.

### 2.6 Machines (rames) et motifs

Paramétrables en supervision : machines (nom, couleur, en service) —
défaut Marie/Anne/Jeanne/Marguerite avec les couleurs de CLAUDE.md ;
motifs (défaut : Météo, Croisement, Technique, Affluence, Exploitation).

### 2.7 Train supplémentaire (« train sup »)

Quand trop de clients doivent redescendre par rapport aux places disponibles,
le chef d'exploitation crée un train de renfort. Il part du Fayet à une heure
choisie, ne dessert souvent NI Saint-Gervais NI Motivon, s'arrête au Col de
Voza pour récupérer les voyageurs, et redescend.

Ce train **n'existe dans aucune grille**. Il porte donc SES PROPRES passages
(colonne `passages`, au format des grilles JSON) : sans cela il serait
invisible partout, le moteur ne sachant joindre un état d'exploitation qu'à
un train de grille.

**Numérotation** : la convention impair = montée / pair = descente est
conservée — premier numéro impair libre ≥ 101 pour la montée, `numéro + 1`
pour la descente. L'appariement de rame existant (la descente n+1 hérite de
la montée n) fonctionne donc sans modification.

**Horaires** : calculés depuis la grille EN VIGUEUR — temps inter-gares et
temps d'arrêt lus sur son premier train non express, jamais codés en dur (la
grille hiver aura les siens). Une gare non desservie ne coûte pas son temps
d'arrêt : c'est précisément ce que le renfort gagne. Exemple été 2026 :
Le Fayet 17:00:00 → Col de Voza 17:34:30 (10:00 + 11:30 + 13:00). Chaque
heure calculée reste **modifiable** avant validation, un train qui ne
s'arrête pas gagnant quelques secondes que la grille ignore.

**Ce que l'application ne dit pas** : la voie est unique et les croisements
relèvent du chef d'exploitation. Aucun écran n'indique qu'un sillon serait
libre.

**Affichage** : libellé « TRAIN SUP », ou « TRAIN SUP 1 », « TRAIN SUP 2 »…
s'il y en a plusieurs (fonction unique partagée par l'écran de gare, la
grille du jour et la supervision, pour qu'ils ne divergent jamais). Sous la
destination, les gares non desservies sont listées dans l'esprit de la
mention express : « SANS ARRÊT — non-stop : Saint-Gervais & Motivon ».
Un train sup n'est **jamais** marqué express : ni picto motrice, ni mention
express — « express » désigne le train qui saute Voza et Bellevue.

Il obéit aux mêmes règles que les autres : `sans_voyageurs` l'exclut de tout
affichage, le statut / retard / motif s'appliquent, et la bascule Terminus
Bellevue le tronque comme n'importe quelle rotation. Un train sup limité au
Col de Voza n'est pas concerné, n'ayant aucun passage au-dessus.

_(Fonctionnalité validée par l'exploitant le 30/08/2026.)_

## 3. Écran de gare (`ecran.html`)

Reproduit `maquettes/ecran-gare.html`, à une exception documentée : la
colonne « Arrivée » de la maquette a été RETIRÉE le 29/08/2026 (voir §2
ci-dessous). La maquette n'a pas été retouchée — elle reste le témoin de ce
qui avait été validé à l'époque.

1. **Bandeau crème** : logo officiel à gauche ; nom de gare (Amaranth) +
   « ALTITUDE X M » (rouge) centrés au milieu de l'écran ; horloge
   HH:MM:SS + date à droite ; liseré rouge.
2. **Tableau marine** — colonnes strictement alignées :
   Départ (grosse) · Destination · Train · Départ dans · Statut.

   L'heure d'ARRIVÉE n'est plus affichée (simplification validée par
   l'exploitant le 29/08/2026) : le voyageur qui attend sur le quai lit une
   heure de départ, l'heure d'entrée en gare ne lui sert à rien. La largeur
   libérée revient à la colonne Destination, seule colonne élastique, dont la
   mention « EXPRESS — sans arrêt / non-stop : Col de Voza & Bellevue » se
   trouvait tronquée.

   ⚠ La donnée, elle, RESTE calculée et testée (`arrivee_s` dans le moteur,
   heure réelle du document d'exploitation, repli départ −
   `arret_intermediaire_s` si elle manque). C'est elle qui déclenche l'état
   « À QUAI », de l'arrivée jusqu'à 30 s avant le départ : la retirer du
   modèle casserait cet état. Seul l'affichage a changé. L'heure d'arrivée
   reste par ailleurs visible à deux endroits : le bandeau « Prochaine
   arrivée / Next arrival » en bas de l'écran (qui annonce le train entrant,
   information distincte) et la grille du jour aux terminus, là où il n'y a
   pas d'heure de départ (§4).
   - Destination : flèche oblique ↗ (montée) / ↙ (descente) dans un carré ;
     terminus (« Nid d'Aigle », « Le Fayet », ou « Bellevue » si terminus
     exceptionnel) ; pour un express, GRAND picto motrice blanc (~7 % de la
     hauteur d'écran) à droite du nom de la destination ; sous-ligne :
     « Montée / Ascent » ou « Descente / Descent », remplacée pour un
     express par « EXPRESS — sans arrêt / non-stop : Col de Voza &
     Bellevue » (taille réduite pour tenir sur une ligne) ; « Vélos
     acceptés / Bikes allowed » si train vélos ; motif en orange si retard.
   - Train : pastille couleur rame + nom + « TRAIN X » (majuscules, sans n°).
   - Compte à rebours et états de quai. Le nombre affiché est toujours celui
     du DÉPART, cohérent avec l'heure imprimée à côté : « n min » (mis en
     évidence à 5 min ou moins), « n h mm » si ≥ 60 min. L'heure d'ARRIVÉE
     (réelle, retard compris) commande ensuite l'enchaînement :
     - de l'ARRIVÉE jusqu'à 30 s avant le départ : **« À QUAI / AT
       PLATFORM »**, fond vert plein, FIXE ;
     - des 30 dernières secondes jusqu'à l'heure de départ incluse :
       **« DÉPART IMMINENT / DEPARTING »**, fond rouge charte `#E52A23`,
       clignotement lent (1 s) — la différence d'animation interdit de le
       confondre avec l'état précédent ;
     - après le départ, pendant les 2 min où la ligne reste affichée :
       **« PARTI / DEPARTED »** en gris éteint.

     En gare d'ORIGINE (Le Fayet en montée, Nid d'Aigle en descente) il n'y a
     pas d'heure d'arrivée : « À QUAI » commence `a_quai_origine_s` avant le
     départ (défaut 5 min, réglable dans Paramètres). Un retard décale tout
     l'enchaînement, puisqu'il s'applique aux heures réelles.

     Ligne retirée 2 min après le départ (immédiatement à l'heure théorique
     pour un supprimé). Les cases ont TOUTES la même taille — largeur ET
     hauteur fixes, quel qu'en soit le contenu.
     _(Correctif validé par l'exploitant le 29/08/2026 : « À QUAI »
     n'apparaissait qu'APRÈS le départ, donc trop tard pour être utile.)_
   - Statut : À l'heure/On time (vert) · Retard +n min/Delayed (orange,
     heure réelle affichée + « théorique HH:MM ») · Supprimé/Cancelled
     (rouge, heure et destination barrées).
   - 5 lignes max, tri par heure de départ, deux sens mélangés ; seuls les
     passages AVEC départ figurent dans le tableau (au terminus d'un train,
     son arrivée n'apparaît que via la ligne « prochaine arrivée »).
3. **Prochaine arrivée** : « HH:MM — <Rame en SA couleur> (train n° X), en
   provenance de … ». Marguerite (blanche) : léger halo rouge pour rester
   lisible.
4. **Pied rouge** : messages défilants FR • EN — la durée d'un tour est
   CALCULÉE (durée = largeur du texte ÷ `vitesse_ticker_px_s`), de sorte que
   la vitesse de lecture reste constante quelle que soit la longueur du
   bandeau ; un message sans traduction s'affiche en français seul, sans
   séparateur. Un bandeau de priorité « importante » est fixe, donc non
   concerné. Pavé météo sommet (température + ciel, saisi en supervision).
5. **États spéciaux** (plein tableau, logo blanc affiché dessous) :
   - Fin de service : « Service terminé — premier départ demain à HH:MM »
     bilingue (premier départ lu dans la grille du lendemain) — affiché dès
     qu'il n'y a plus aucun DÉPART à afficher dans la gare, les arrivées
     restantes continuant d'alimenter la ligne « prochaine arrivée » ;
   - Nid d'Aigle quand terminus Bellevue : « Tronçon Bellevue – Nid
     d'Aigle fermé » bilingue ;
   - Écran neutre du mode dégradé (voir §7) ;
   - Veille nuit (plage paramétrable, défaut 21:00–06:00) : écran noir +
     horloge discrète.
6. **Médias** : cycle décrit en §2.5, plein écran, retour automatique aux
   horaires. JAMAIS pendant un état « À QUAI » dans les 2 min avant un
   départ (l'information prime).

### Règles de calcul

- Passages d'une gare = tous les trains du jour dont la grille contient un
  passage à cette gare (donc pas les express à Voza/Bellevue), facultatifs
  seulement si `facultatif_actif`, décalés de `retard_min`.
- Terminus Bellevue (bascule « à partir du TRAIN N », voir §2.3) : pour
  chaque rotation dont la montée porte un numéro ≥ N — montée tronquée à
  Bellevue (destination « Bellevue »), descente appariée démarrant à
  Bellevue à son horaire de passage. Les rotations dont la montée porte un
  numéro < N restent strictement normales. Un EXPRESS de la plage n'est
  JAMAIS limité automatiquement : il circule normalement et est signalé
  « à traiter » en supervision (sa descente appariée non express part de
  Bellevue). Gare nid-daigle en état « tronçon fermé » dès qu'elle n'a plus
  aucun passage à afficher.

## 4. Grille du jour (`grille.html`)

Reproduit `maquettes/grille-horaire.html` : deux tableaux (montée,
descente) ; colonnes = trains du jour effectivement en circulation
(facultatifs non activés absents) avec « N° x », heure d'origine, pictos
motrice EXPRESS / 🚲 vélos / badges +n min / SUPPRIMÉ ; lignes = gares avec
altitudes officielles ; « | » pour passage express sans arrêt ; colonnes
passées atténuées ; prochain départ surligné ; heures retardées en orange,
supprimées barrées ; point pulsant couleur rame sur le dernier point de
passage des trains en ligne ; légende complète ; pied identique à l'écran
gare (messages + météo).

## 5. Supervision (`supervision.html`) — onglets

Reproduit `maquettes/supervision.html`. Connexion obligatoire ; le rôle
détermine les onglets accessibles (§ docs/02 sécurité).

1. **Circulations** : navigation par date (◀ ▶, saisie calendrier, raccourcis
   Aujourd'hui/Demain) ; libellé du service auto (grand/petit/hiver selon
   date) ; bascule « ⚠ Terminus Bellevue » (journée entière = à partir du
   TRAIN 1, ou « à partir du TRAIN N » — sélecteur proposant uniquement les
   MONTÉES ; la bascule PRÉ-REMPLIT la colonne Terminus des rotations
   concernées, ajustable ensuite train par train, LIBÈRE les rotations qui
   sortent de la plage — décocher ou rétrécir rétablit le service jusqu'au
   Nid d'Aigle — et signale « à traiter » les express de la plage, avec les
   boutons Supprimer / Maintenir) ; **ordre apparié** : chaque montée est suivie de sa descente
   (même rotation), séparées visuellement par paires ; par ligne : « TRAIN
   X », heure, sens, badges express/vélos, rame (liste des machines —
   uniquement sur la montée ; la descente affiche la rame héritée avec la
   mention « rotation »), **colonne Terminus** (montées non express : Nid
   d'Aigle / Bellevue ; la descente appariée affiche « Départ de Bellevue »
   le cas échéant ; une montée express dont la rotation est limitée par la
   bascule affiche « à traiter » au lieu du sélecteur), interrupteur Activé/Non activé pour les facultatifs
   (ligne grisée + « ne circule pas — absent des écrans »), statut 3
   boutons, pas de retard ±5 min (min 5), motif ; confirmation avant
   suppression — **la suppression d'une MONTÉE propose aussi la suppression
   de sa descente appariée** (proposition par défaut : Oui, dérogeable par
   la supervision, ex. rame de remplacement) ; pour un express
   « à traiter » : boutons **Supprimer** (avec la même proposition pour la
   descente appariée) ou **Maintenir** jusqu'au Nid d'Aigle ;
   **ouverture d'une date** : si un service circule et que la date n'est pas
   passée, la journée est créée automatiquement en base (jours +
   circulations depuis la grille de la période, idempotent) — aucune action
   manuelle avant de modifier trains, facultatifs, rames ou terminus ; une
   date PASSÉE sans données reste un aperçu théorique en LECTURE SEULE
   (« journée non exploitée », pas d'historique fabriqué) ; hors saison :
   aucune circulation, message « Aucun service ne circule à cette date »,
   contrôles désactivés, aucune écriture ; action discrète « Réinitialiser
   la journée depuis la grille » (confirmation explicite : toutes les
   modifications du jour sont perdues, retour à l'horaire théorique — utile
   si la grille officielle est corrigée ou après une fausse manœuvre) ;
   export CSV.
   _(Amélioration validée par l'exploitant le 25/08/2026.)_

   **Train supplémentaire** (§2.7) : bouton « + Train supplémentaire » à côté
   de « Trains facultatifs » et de la bascule Terminus Bellevue. Le
   formulaire demande l'heure de départ du Fayet, le terminus (Col de Voza
   par défaut ; les choix au-dessus de Bellevue disparaissent quand la
   bascule Terminus Bellevue est active), les gares desservies à la montée
   puis à la descente (origine et terminus toujours cochés et verrouillés),
   le battement au terminus (défaut 5 min), la rame et une case « monte sans
   voyageurs ». L'aperçu montre les horaires CALCULÉS, chacun modifiable
   avant validation. Le train apparaît ensuite dans la liste avec un badge
   « SUP » et, seul de tous les trains, un bouton « Supprimer ce train » avec
   confirmation — les trains de grille ne se suppriment pas, ils se mettent
   au statut « Supprimé ». Création et suppression passent par le brouillon
   et la publication, comme le reste de l'onglet.
   _(Fonctionnalité validée par l'exploitant le 30/08/2026.)_

   **Action groupée sur les facultatifs** : un bouton dans la barre du haut,
   à GAUCHE de la bascule « Terminus Bellevue », bascule d'un geste tous les
   trains facultatifs de la date affichée. Son libellé annonce le nombre de
   trains que le clic changera RÉELLEMENT : « Activer les N trains
   facultatifs » s'il en reste d'inactifs, « Désactiver les N trains
   facultatifs » quand tous le sont ; s'il n'y en a aucun ce jour-là, le
   bouton est grisé et porte la mention « Aucun train facultatif ce jour ».
   Une confirmation rappelle le compte et la date (« Activer les 8 trains
   facultatifs du mardi 25 août ? Ils apparaîtront immédiatement sur les
   écrans. »). L'écriture emprunte le MÊME chemin que les modifications
   unitaires — création de la journée si besoin, contrôle du nombre de
   lignes réellement écrites : une écriture partielle échoue bruyamment,
   jamais de succès silencieux. Elle ne touche que `facultatif_actif` :
   le drapeau « sans voyageurs » reste tel quel — et si l'un des trains
   activés le porte, la confirmation ET le toast le disent (« TRAIN 23 :
   sans voyageurs, donc il restera invisible sur les écrans »), plutôt que
   de promettre une apparition qui n'aura pas lieu. Le bouton est ignoré
   tant que la journée affichée n'est pas celle qui est chargée (changement
   de date en cours). Toast récapitulatif et entrée dans l'historique des
   publications.

   **Rotations appariées à l'activation unitaire** : activer ou désactiver
   un facultatif propose la même opération sur son train apparié (montée n ↔
   descente n+1 : 3/4, 9/10, 17/18, 23/24), proposition par défaut Oui,
   dérogeable — même principe que la suppression d'une montée. Le motif est
   rappelé dans la question : activer une montée sans sa descente
   reviendrait à monter des voyageurs sans train pour les redescendre.
   **Exception** : aucune proposition si le train apparié est marqué « sans
   voyageurs » — la rotation est assurée, simplement à vide. Aucune
   proposition non plus si l'apparié est déjà dans l'état visé.

   **Garde-fou de rotation** : si une montée ouverte aux voyageurs n'est
   suivie d'AUCUNE descente ouverte aux voyageurs dans la journée (« ouverte
   aux voyageurs » = ni supprimée, ni facultative non activée, ni course à
   vide ; « ensuite » se juge sur l'horaire réel : la descente doit partir au
   plus tôt à l'arrivée de la montée), un avertissement orange s'affiche en
   tête de l'onglet : « TRAIN 23 monte des voyageurs sans descente voyageurs
   ensuite ». C'est un avertissement, JAMAIS un blocage.

   **Colonne « Sans voyageurs »** : une case par train, montée comme
   descente. La ligne cochée est distinguée visuellement et porte la mention
   « ne circule pas pour les voyageurs — absent des écrans » (§2.2).
   _(Évolutions validées par l'exploitant le 28/08/2026.)_
2. **Bandeau** (ex-« Messages »), ouvert à TOUS les rôles connectés, caisse
   comprise — c'est le quotidien de la caisse, elle ne doit pas dépendre
   d'un administrateur pour corriger une température. Trois blocs dans cet
   ordre : messages voyageurs, vitesse de défilement, météo au sommet.
   **Tout s'enregistre à la saisie** (anti-rebond ~800 ms sur les champs
   texte et numériques), avec le toast habituel et l'entrée à l'historique :
   l'application ne comporte plus aucun bouton « Enregistrer ».
   - **Messages** : liste + formulaire (FR requis ; EN **généré
   automatiquement à la saisie** puis modifiable ; cible toutes/gares/
   train, priorité, expiration) ; **bouton Modifier** sur chaque message
   (édition en place) : le formulaire RESTITUE la cible et l'expiration du
   message édité — une correction de texte ne peut donc jamais transformer
   un message ciblé en message diffusé partout ; le formulaire affiché est
     exactement ce qui sera enregistré (l'expiration peut être retirée en
     choisissant « jamais ») ; retrait en un clic. La **bibliothèque de
     modèles** est proposée à la saisie pour tous les rôles ; son
     administration (ajouter, modifier, réordonner, activer/désactiver)
     reste réservée à l'administrateur et lui est seule visible.
   - **Vitesse du bandeau** : Lent 60 · Normal 90 · Rapide 130 · Très rapide
     180 px/s, avec aperçu en direct ; appliquée aux écrans sans
     rechargement.
   - **Météo au sommet** : température, ciel FR/EN et **heure du relevé**,
     pré-remplie à l'heure de la modification et modifiable. Elle s'affiche
     discrètement sur les écrans à côté de la température (« relevé 09:15 ») :
     une température sans heure ne dit pas si elle date de dix minutes ou de
     la veille.
   _(Évolution validée par l'exploitant le 29/08/2026.)_
3. **Médias** : choix du mode (alterné / série) et réglage
   `duree_horaires_s`, avec une ligne récapitulative du cycle recalculée en
   direct ; ordre de passage réglable par média (▲ / ▼, rang affiché) ; envoi de fichier (taille max
   20 Mo, formats §2.5) ; par média : durée, **gares ciblées et expiration
   modifiables après création** (aucune gare cochée = toutes), actif,
   aperçu, suppression. La liste montre TOUS les médias, y compris ceux
   désactivés (sinon ils ne seraient plus réactivables).
4. **Écrans** : PREUVE DE MISE À JOUR par écran — une pastille dit si ce qui
   est AFFICHÉ est frais, et non seulement si la machine répond : « à jour »
   (vert : les données de l'écran sont postérieures à la dernière
   publication), « en retard de X min » (orange : la machine tourne mais
   affiche encore d'anciennes données — réseau coupé côté données), « hors
   ligne » (rouge : plus de signal de vie depuis 150 s, soit deux cycles et
   demi — un cycle manqué ne fait pas passer un écran sain au rouge). Chaque carte indique
   l'heure des données affichées et la journée montrée. Le bandeau de
   publication affiche, après un enregistrement, « Appliqué sur N/N écrans »
   ou la liste des gares en attente. Déclaration préalable des postes
   (gare + type + numéro) : un écran ne s'inscrit plus de lui-même, il doit
   être déclaré ici avant d'être installé, sinon son signal de vie n'est
   enregistré nulle part. Cartes (gare, type, en ligne/hors ligne — silence > 150 s,
   réseau fibre/5G, mention alimentation solaire pour le Nid d'Aigle,
   dernière vue, version) ; bouton « Recharger l'écran ».
   **Veille de nuit** (admin/supervision) : un réglage GLOBAL en tête de
   l'onglet (heure de début / heure de fin), et sur chaque carte la
   possibilité de lui donner son propre horaire. La carte indique clairement
   « Suit le réglage global » ou « Réglage propre 19:00 → 06:30 », et un
   bouton « Revenir au global » efface la surcharge. Les DEUX heures sont
   requises pour qu'une surcharge compte — une seule ne décrit pas une
   fenêtre, et l'écran resterait dans un état indécis. Chaque écran apprend
   sa veille par son propre signal de vie : la modification est prise en
   compte sans rechargement, au plus tard au cycle suivant (60 s).
   _(Évolution validée par l'exploitant le 29/08/2026.)_
5. **Paramètres** (admin) : Machines (ajouter/renommer/couleur/en service/
   retirer) ; Motifs (liste modifiable) ; Utilisateurs (créer, attribuer un
   rôle, réinitialiser mot de passe, désactiver — v1 : rôles Administrateur
   / Supervision / Caisse ; le détail fin des droits par catégorie et la
   création de nouvelles catégories — Gestionnaire, Lecteur… — sont prévus
   dans le modèle mais seront précisés plus tard avec l'exploitant) ;
   Saisons et services (grilles chargées + périodes) ; délai
   **« à quai » en gare d'origine** (`a_quai_origine_s`, défaut 5 min, §3).
   La bibliothèque de modèles est passée dans l'onglet Bandeau, la veille de
   nuit dans l'onglet Écrans, la vitesse du bandeau et la météo dans
   l'onglet Bandeau.
6. **Publication**. Le compteur affiche le nombre d'ÉCARTS RÉELS avec un
   état de référence, pris au chargement de la page et après chaque
   publication — et non le nombre de clics : ramener une température de 12 à
   8 n'annonce plus « 2 modifications », mais aucune. La comparaison est
   normalisée (nombres en valeur : 8, « 8 » et « 8.0 » se valent ; textes
   après trim), de sorte qu'aucune différence purement cosmétique ne compte.
   Elle porte sur les circulations de la date affichée (statut, retard,
   motif, rame, terminus, facultatif, sans voyageurs), les messages, les
   médias, les paramètres d'affichage, la veille globale et par écran, les
   machines, les motifs et la bibliothèque de modèles. Elle est recalculée
   après chaque écriture et après chaque rafraîchissement temps réel ; une
   publication faite depuis un AUTRE poste remet la référence à zéro.

   Quand il n'y a **rien à publier**, le bouton « Publier » est gris neutre
   et inerte (désactivé, curseur interdit, infobulle « Aucune modification
   depuis la dernière publication ») et le texte de gauche indique « Tout est
   publié ✓ ». Il reprend le rouge charte dès qu'un écart apparaît, et
   repasse en gris aussitôt la publication réussie. Le résumé consigné à
   l'historique est construit sur ces mêmes écarts : « température 8 → 12 »
   n'y figure pas si la valeur est revenue à 8. « Aperçu écrans » ouvre
   l'écran d'une gare dans un nouvel onglet.

7. **Journal d'exploitation** (Paramètres, lecture seule). Puisqu'une valeur
   posée puis retirée ne laisse plus aucune trace dans le compteur, alors que
   les écrans l'ont bel et bien affichée, chaque ÉCRITURE est consignée à
   part — une ligne par champ modifié, avec quand, qui, objet, champ et
   « avant → après ». Le journal est alimenté par la base elle-même
   (déclencheurs) : rien ne lui échappe, pas même une correction faite
   directement en SQL. Liste antéchronologique paginée par 100, filtres par
   période, par utilisateur et par type d'objet, export CSV. Aucune
   suppression depuis l'interface ; purge des entrées de plus de 12 mois à
   lancer à la main (docs/02).
   Les signaux de vie des écrans n'y figurent JAMAIS : ils noieraient le
   journal sous ~8 600 lignes par jour.
   _(Évolutions validées par l'exploitant le 29/08/2026.)_

## 6. Bilinguisme

Libellés fixes FR + EN (comme les maquettes). Messages : FR puis EN dans le
défilement. Motifs : dictionnaire de traductions modifiable (défauts
fournis : Météo→Weather, Croisement→Crossing, Technique→Technical issue,
Affluence→High demand, Exploitation→Operations).

## 7. Résilience — règle validée par l'exploitant

- Cache local (grille + circulations + messages + params + horodatage).
- Coupure réseau : affichage maintenu depuis le cache avec badge « données
  de HH:MM » pendant `duree_cache_min` (défaut 15) ; AU-DELÀ : **écran
  neutre** — logo, horloge, « Informations momentanément indisponibles /
  Real-time information temporarily unavailable — adressez-vous au
  personnel » (jamais d'horaires potentiellement périmés).
- Retour réseau : resynchronisation et retour automatique aux horaires.
- Démarrage sans réseau : service worker + cache → écran neutre ou données
  fraîches selon l'âge du cache.
- Heartbeat 60 s (id écran, horodatage, fraîcheur des données, journée
  affichée, version). Un échec n'interrompt jamais l'affichage voyageurs.

## 8. Hors périmètre v1 (extensions)

Annonces sonores, météo automatique, géolocalisation des rames, page
publique voyageurs, alertes email écran hors ligne, statistiques.
