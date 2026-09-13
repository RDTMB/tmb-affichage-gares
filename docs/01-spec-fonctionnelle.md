# Spécification fonctionnelle v2 — Affichage voyageurs TMB

Version 2.1 — 2 septembre 2026 (grilles en base, import Excel).
Référence visuelle : maquettes v2 validées (`maquettes/`). Référence
horaires : la table `grilles` (chargée depuis l'Excel exploitation) ;
historique été 2026 dans `docs/grilles-historique/`.

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
`simule=HH:MM` (démo/tests), `jour=AAAA-MM-JJ`, `zoom=`.

`jour=AAAA-MM-JJ` simule la **journée d'exploitation** : l'écran sert la
journée demandée, ce qui permet de regarder aujourd'hui ce qu'il affichera
demain — sans quoi un train créé pour demain n'est vérifiable que demain. Il
ne déplace **que** la date : ni l'horloge affichée, ni l'horodatage qui fait
expirer les messages et tourner les médias. Décaler celui-ci de plusieurs
jours donnerait un écran qui a l'air de marcher tout en montrant autre chose
que la réalité. Une valeur mal formée — ou une date qui n'existe pas, comme
le 31 juin — est **ignorée**, comme l'est déjà une heure mal formée : on ne
casse pas un écran de gare sur une faute de frappe d'URL.

Les deux paramètres partagent le **bandeau permanent et non masquable** de
l'heure simulée, dont le texte nomme alors la journée regardée, en français
et en anglais. C'est le cas le plus grave des deux : une heure décalée de
trois heures se remarque au premier coup d'œil, la grille de demain a l'air
parfaitement normale. Sur une journée à venir non encore ouverte en
supervision, le badge « Horaires théoriques — journée non confirmée »
apparaît de lui-même, et c'est juste.

**Paramètres de la supervision.** `demo=1` sert la démonstration (aucune
écriture réelle) ; il est reconnu **strictement** — `?demo`, `?demo=true` et
`?demo=0` ne l'activent pas, une faute de frappe ne doit jamais substituer
des horaires fictifs à des horaires réels. `simule=HH:MM` décale l'heure du
poste, qui écrit alors dans la VRAIE base : une pastille l'annonce dans
l'en-tête, sans quoi on croirait lire un poste normal.

`demo=1&echec=1` fait ÉCHOUER la publication des circulations, et elle seule :
le bandeau publie normalement. C'est le seul moyen de voir le troisième état
de la barre de publication — l'échec partiel — sans attendre qu'il survienne
un matin en gare. Il montre le liseré rouge, la barre plus haute, la cause
conservée dans son encart et le bouton « Réessayer la publication ».

> Ce drapeau est **inopérant sur une base réelle**, et pas seulement parce
> qu'une condition le vérifie. Il n'est lu que par le fournisseur de
> démonstration (`OptionsMock`, `src/data/mock.ts`) ; dès qu'une
> configuration Supabase existe, `creeProvider()` rend un `SupabaseProvider`,
> qui n'accepte pas ces options. Sur la production, l'objet capable de lire
> ce paramètre n'est jamais construit — il n'y a rien à contourner.

## 2. Données métier

### 2.1 Grilles de saison (en base, chargées depuis l'Excel exploitation)

Les grilles horaires sont des DONNÉES (table `grilles`), chargées par
l'exploitation depuis le classeur Excel d'exploitation, dans la Supervision →
onglet Horaires, avec aperçu, contrôle des écarts et retour arrière
(`docs/import-grilles.md` ; contrat de format : `docs/format-excel-horaires.md`).
Aucun développeur n'intervient. Une grille porte : `version` (identifiant
`année-saison-feuille`, ex. `2026-ete-grand-service`), `libelle`, `source`
(fichier et date de mise à jour), `periodes` de validité (bornes incluses,
plusieurs possibles), les gares avec altitudes, et les trains numérotés
(impairs = montées) : liste ordonnée de passages `{gare, a?, d?: "HH:MM:SS"}`
avec l'arrivée ET le départ RÉELS à chaque gare (ex. arrêt de 5 min à
Saint-Gervais en montée ; « a » absent au point d'origine, « d » absent au
terminus ; les express n'ont pas de passage à col-de-voza/bellevue),
drapeaux `express`, `facultatif`, `velos`. `arret_intermediaire_s` (60 s)
ne sert que de REPLI si une arrivée manque dans le document. La halte de
SERVICE de Mont Lachat (entre Bellevue et le Nid d'Aigle) n'est pas
desservie : lue puis ignorée à l'import, elle ne doit JAMAIS apparaître sur
les écrans.

**Priorité entre grilles** (règle unique, `serviceActif()`) : une grille ne
s'applique qu'à ses périodes ; seules les grilles ACTIVES comptent ; si deux
grilles actives couvrent la même date, la plus récemment chargée l'emporte ;
désactiver une grille redonne la main à la précédente (c'est le retour
arrière) ; hors de toute période, AUCUN service n'est affiché, jamais de
repli sur une autre grille. Une version n'est jamais réécrite : recharger
une grille existante crée « …-v2 » et désactive automatiquement la
précédente, qui reste réactivable. Rien ne change sur les écrans avant la
première date de validité ; les journées déjà préparées ne sont réécrites
que si l'agent le demande, journée par journée, à l'import.

**Grille d'hiver** : le Nid d'Aigle est fermé, Bellevue est le terminus
NORMAL. La grille d'hiver n'a donc aucun passage au Nid d'Aigle (ligne
absente ou tirets dans l'Excel) ; les écrans affichent « Bellevue » comme
destination, sans mention « terminus exceptionnel ». La bascule « Terminus
Bellevue à partir du TRAIN N » (§2.3) reste réservée aux fermetures
imprévues.

Référence historique : `docs/grilles-historique/` (grilles été 2026 telles
que générées le 25/08/2026 ; oracle des tests d'import et grilles de la
démonstration — jamais modifiées à la main).

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
`priorite` normale (défile avec les autres) / importante (seule à l'écran
deux temps sur trois, voir §2.11), `expire_at`,
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
normalement ensuite. La bibliothèque s’administre dans l’onglet Bandeau, et
seul le chef d’exploitation la voit (§5.5).

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

### 2.8 Affluence — trains complets (table `affluence`)

Le voyageur doit voir, sur l'écran de gare, qu'un train est **complet** ou
n'a plus que **quelques places**. Deux niveaux, pas trois :

| Niveau    | Écran de gare                          | Couleur                  |
| --------- | -------------------------------------- | ------------------------ |
| `complet` | « COMPLET / Full »                     | rouge charte `#E52A23`   |
| `limite`  | « DERNIÈRES PLACES / Few seats »       | ambre `--affluence-limite` |

**L'absence de déclaration vaut « places disponibles ».** Il n'existe pas de
troisième niveau : remettre un train à la normale SUPPRIME la ligne. C'est
aussi ce qui fait qu'une journée sans affluence est une table vide, et non
une table pleine de lignes qui ne disent rien.

**PAR TRAIN, PAS PAR GARE.** La donnée est (date, numéro) : un TRAIN 9
complet l'est dans **toutes** les gares qu'il doit encore desservir. Une
descente se déclare comme une montée — une descente peut être pleine.

**L'affluence n'est PAS un statut.** Ponctualité et remplissage sont deux
axes indépendants : un train à l'heure peut être complet, un train en retard
peut être vide. C'est pourquoi la pastille ne vit pas dans la colonne Statut,
et pourquoi la donnée ne vit pas dans `circulations`.

Règles d'affichage (écran de gare) :

- la pastille se place **après le nom de la gare de destination et avant le
  picto express** : le picto termine la ligne, la pastille se lit avec le nom ;
- **rien sur un train supprimé** — il n'existe plus pour le voyageur ;
- sur une ligne express, la pastille longue et le picto ne tiennent pas
  ensemble dans la colonne (mesuré) : c'est le **picto** qui s'efface, son
  information étant déjà écrite en toutes lettres et dans les deux langues
  sur la ligne de note juste en dessous.

**Qui déclare, et quand ça part.** La caisse **et** la supervision, la
dernière écriture gagnant ; le journal d'exploitation trace qui. L'écriture
est **immédiate**, hors brouillon et hors « Publier » — même exception
assumée, et même raison, que l'heure de départ réelle d'un train
supplémentaire (§2.7) : on constate au guichet qu'on ne vend plus, avec des
voyageurs déjà sur le quai. En contrepartie l'échec est dit franchement,
par un message persistant, et l'écran de saisie garde son état précédent.

**UN SEUL ENDROIT, l'onglet « Places »**, pour la supervision comme pour le
guichet. Il liste les départs restants de la journée en cours — montées et
descentes, dans l'ordre de l'heure — avec, par ligne : l'heure, le libellé
canonique (« TRAIN 9 »), le sens, la rame, la destination, la mention
EXPRESS s'il y a lieu, le sélecteur à trois positions, et **qui a déclaré et
quand**. Un sélecteur de gare filtre la liste et fait afficher l'heure de
départ **de cette gare** ; il est retenu par poste, « toutes les gares » par
défaut. Sont exclus les trains supprimés, les courses à vide, les facultatifs
non activés et les départs déjà passés — un train parti n'a plus de places à
déclarer.

**NAVIGUER DANS LES JOURS.** L'onglet porte la **même barre de date que
Circulations** (◀ · date · ▶ · Aujourd'hui · Demain), pour une raison
précise : la caisse n'a **pas** l'onglet Circulations, et sans cette barre
elle ne pourrait déclarer que le jour même — jamais préparer le lendemain.
La date affichée est **la même pour les deux onglets** : changer de jour
dans Places change aussi Circulations, et réciproquement.

Ce que la liste montre dépend de la date :

| Date        | Liste                    | Saisie                              |
| ----------- | ------------------------ | ----------------------------------- |
| aujourd'hui | les **départs restants** | ouverte (journée ouverte)           |
| à venir     | **tous les trains**      | ouverte si la journée est ouverte   |
| passée      | **tous les trains**      | **fermée** — consultation seulement |
| hors saison | aucun train              | sans objet, et sans reproche        |

Le jour même, un train parti n'a plus de places à vendre : la liste ne garde
que ce sur quoi on peut encore agir. Les **autres dates n'ont pas d'heure
courante** à laquelle se comparer — filtrer y viderait la liste dès le
milieu de l'après-midi, et la caisse qui prépare le lendemain ne verrait
rien. Une date **passée** se consulte : on lit ce qui a été déclaré, avec
sa signature, on ne réécrit pas ce qui s'est passé — pour tout le monde,
supervision comprise.

**Journée pas encore ouverte.** Une journée à venir n'existe en base qu'une
fois **ouverte par l'exploitation** : RLS réserve la table `jours` à la
supervision (et au technique pour la réinitialisation), la caisse ne peut pas
l'ouvrir. Dans ce cas la liste reste **affichée** — refuser d'écrire n'est
pas refuser de montrer, et la caisse doit voir les trains de la date qu'elle
prépare — mais les sélecteurs sont **éteints** et un bandeau dit quoi faire :
« Journée pas encore ouverte par l'exploitation — les places ne peuvent pas
encore être déclarées pour cette date. Demandez à la supervision d'ouvrir la
journée. » Dès que la supervision ouvre la journée, le **signal temps réel**
rend la main au guichet, sans rechargement.

Le refus est **calculé une seule fois** et sert au rendu comme à l'écriture :
un bouton dégrisé dans l'inspecteur n'écrit rien. Le vrai verrou reste RLS —
ce calcul ne fait que l'annoncer avant le clic, plutôt qu'après l'erreur.

Le remplissage se déclarait auparavant à deux endroits (une colonne dans
Circulations, une carte dans Bandeau). Pourquoi pas Circulations : cet onglet
vit autour du brouillon et de « Publier », et n'y montrer qu'une commande à la
caisse obligerait à conditionner chaque autre commande à un droit, une par
une, pour toujours. Pourquoi pas Bandeau : ce n'est pas son sujet. La règle du
lieu est **un onglet = un droit**, et le droit `affluence` existait sans
onglet. Circulations garde en revanche le **filet de rangée** rouge ou ambre :
c'est une information, pas une commande.

_(Décisions de l'exploitant du 09/09/2026 pour l'affichage, du 10/09/2026 pour
l'onglet dédié et pour la navigation dans les jours. La jauge de remplissage
graduée est réservée à la version alimentée par l'API de réservation : elle
n'est pas dans ce lot.)_

### 2.9 Train spécial — course affrétée (`circulations.nature = 'special'`)

Un groupe loue un train. Il circule, il est **affiché en gare** — un voyageur
qui voit passer une rame doit savoir qu'elle n'est pas pour lui — et il porte
la mention **« privé »**, bilingue.

**UNE NATURE, PAS DEUX BOOLÉENS.** `circulations.nature` vaut `grille`,
`supplementaire` ou `special`. Un second booléen à côté de `supplementaire`
aurait rendu représentable la combinaison « sup ET spécial », qui n'existe
pas en exploitation et que rien n'aurait empêchée en base. Les deux natures
hors grille portent **leurs propres passages** — sans quoi elles seraient
invisibles partout.

**Trois formes** (décision de l'exploitant du 10/09/2026) :

| Forme                  | Ce que ça donne                                          |
| ---------------------- | -------------------------------------------------------- |
| aller-retour           | montée + descente, qui repart après un **battement** estimé |
| aller simple           | la montée **seule** — aucune ligne de descente             |
| stationnement en haut  | montée + descente, dont l'**heure de départ est saisie**   |

Le stationnement long n'est pas un battement très long déguisé : l'heure est
**convenue avec l'affréteur**, pas déduite. C'est aussi ce qui a rendu
atteignable un défaut qui dormait — un battement négatif produisait en
silence une descente partant avant l'arrivée de la montée. Le contrôle existe
désormais et refuse.

**Numérotation : série propre, à partir de 201.** Les renforts occupent
101–199, la grille 1–99, et la base le vérifie (contrainte
`circulations_nature_numero`) : ce n'était qu'une convention du front tant que
seule la supervision écrivait cette table, et elle devient porteuse dès
qu'`admin` peut y insérer des spéciaux. La **parité reste liée au sens** dans
toutes les plages — impair = montée, pair = descente ; 201 est impair.
Le numéro pair est **réservé même pour un aller simple** : le déclencheur
`sync_rame_descente` recopie la rame de toute montée dans `numero + 1` sans
vérifier qu'elle appartient au même train.

**Libellés.** « SPÉCIAL 1 », « SPÉCIAL 2 »… sur le modèle de « TRAIN SUP 1 » —
un seul spécial dans la journée donne « SPÉCIAL » sans rang. Le badge de
l'écran de gare écrit **« SPÉ 1 »** : mesuré à 1280×720, il occupe 68,0 px
contre 71,3 px pour « SUP 1 », donc la même empreinte que la série existante
et aucun décalage du nom de gare. « SP » ferait la même largeur mais ne
diffère de « SUP » que d'une lettre, à lire de loin sur un quai.

**Qui le crée : la supervision ET l'admin.** L'admin n'obtient PAS le droit
`circulations` — la séparation de §5.5 reste entière — mais un droit propre,
`circulations.special`, et trois politiques RLS bornées aux lignes
`nature = 'special'`. L'onglet Circulations s'ouvre à lui **en lecture seule**,
à la seule exception du bouton « + Train supplémentaire ou spécial ».

**Terminus : aucune limite, l'agent choisit.** Mais l'écran de création ne se
tait pas : si le terminus sort de la section du jour, ou dépasse Bellevue un
jour de bascule, un **avertissement non bloquant** dit ce que l'écran
annoncera (« Ligne fermée » au-delà, ou signalement « à traiter »).

**Les dessertes suivent « express »** (décision du 12/09/2026) : cocher la case
décoche Col de Voza et Bellevue — c'est la définition d'un express sur cette
ligne — et la décocher les recoche, sur la montée comme sur la descente. Les
cases restent MODIFIABLES : c'est une aide à la saisie, pas une barrière, et
l'agent peut recocher Bellevue sur un express. Une gare de terminus l'emporte
toujours : une course qui finit à Bellevue y va, express ou non.

**Réglages gardés** : rame imposée, express, vélos. **Facultatif retiré** — un
train affrété qu'on n'activerait pas n'a pas de sens. Un spécial reste soumis
à `sans_voyageurs` : une course à vide ne s'affiche nulle part, spéciale ou
non.

**Commanditaire** (`circulations.commanditaire`) : qui a affrété le train.
Colonne PROPRE et non `motif`, qui porte déjà la raison d'une suppression et
celle d'un retard. Champ **interne** — visible en supervision et dans le
journal, jamais servi aux écrans : le droit de SELECT est retiré à `anon` par
droit de colonne, comme pour `affluence.maj_par`.

**Ce que l'écran de gare montre.** Pastille « PRIVÉ / PRIVATE » entre le nom
de la gare et le picto express : elle répond à « ce train est-il pour moi ? »,
qui passe avant « y reste-t-il de la place ». En crème sur marine — ni le
rouge du complet ni l'ambre des dernières places, le privé n'étant pas un
niveau de remplissage. La ligne de note porte « Train privé / Private
charter » **lorsqu'elle a la place**, c'est-à-dire quand aucune mention
express ou « sans arrêt » ne l'occupe déjà : mesuré à 1280×720, les deux
mentions ensemble remplissent la ligne à 456,5 px pour 456,5 px disponibles,
sans marge. La pastille, elle, est toujours là.

_(« Ne prend pas de voyageurs / No boarding » a été écarté : c'est faux pour
le groupe affrété qui monte à bord, et deux fois trop long pour cohabiter avec
la mention express.)_

**Pas de pastille de remplissage sur un spécial**, et pas de spécial dans
l'onglet « Places » : un train affrété ne vend pas ses places au comptoir. Les
deux pastilles ne tiendraient d'ailleurs pas ensemble — mesuré, 140 px de
débordement à 1920×1080, qui tronqueraient le nom de la gare.

_(Décisions de l'exploitant du 10/09/2026 ; mise en œuvre du 11/09/2026.
Migrations `2026-09-train-special-A.sql` puis `-B.sql`, à jouer de part et
d'autre du déploiement du front.)_

### 2.10 Libellé libre d'une course hors grille (`circulations.libelle`)

Un train spécial ou un renfort peut porter un **nom d'affichage** choisi par
l'agent — « SCOLAIRE », « NAVETTE », « T17 » — à la place de « SPÉ n » ou
« SUP n ».

**FACULTATIF.** Sans libellé, le badge affiche « SPÉ n » / « SUP n » comme
avant : rien ne change pour qui n'en veut pas.

**VERBATIM.** Quand il existe, il remplace mot pour mot ce que rendent
`libelleTrain()` et `libelleTrainCourt()` — en supervision, sur la grille du
jour et sur le badge de l'écran de gare. Aucun préfixe ajouté, aucun
reformatage : l'agent a écrit « T17 », la gare affiche « T17 ». Sinon le nom
qu'il a choisi ne serait pas celui qu'il lit. Les deux fonctions restent les
seules sources du nom ; il n'existe pas de troisième chemin.

**Il MASQUE le numéro, il ne le remplace pas.** Le numéro technique reste dans
sa plage (spécial ≥ 201, renfort 101–199, contrainte `circulations_nature_numero`)
et continue d'apparier la montée à sa descente. Les deux lignes d'une rotation
portent le même libellé : c'est le même train, et le voyageur doit lire le même
nom des deux côtés.

**Une borne en LARGEUR, pas en caractères.** Le badge de l'écran de gare est
étroit, et la largeur dépend des glyphes : « MARIAGE » et « 12345678 » ont huit
caractères et pas la même largeur. Mesuré le 12/09/2026 sur la ligne la plus
chargée (« Nid d'Aigle » + pastille « Privé » + picto express), six capitales
larges débordaient là où neuf chiffres tenaient. La saisie mesure donc le texte
avec la **police réelle du badge** et refuse au-delà de **4,9 em** ; la CSS
plafonne à 5 em avec ellipse, en **filet** — l'ellipse ne doit jamais se
déclencher sur un libellé accepté, un badge tronqué étant un identifiant à
moitié affiché.

_(Deux « MARIAGE MARTIN » et « MARIAGE DUPONT » tronqués s'afficheraient
identiques : le badge ne remplirait plus sa seule fonction, distinguer un train
d'un autre.)_

**La police doit être chargée.** Un repli n'est pas une approximation : Arial
rend « WWWWII » plus **étroit** que Lato, donc une mesure tombée sur le repli
accepterait un libellé que Lato déborde. Si la police manque, c'est le
**libellé** qui est refusé — jamais la création du train. Le libellé est
facultatif, et bloquer une course d'exploitation pour un souci d'affichage se
produirait un matin de perturbation, au pire moment.

**UNIQUE dans la journée.** Deux trains du même jour ne peuvent pas porter le
même nom, comparaison faite sur la forme **courte** (celle du badge), sans
tenir compte de la casse ni des espaces de bord : « t17 » et « T17 » sont le
même nom. La comparaison couvre la journée **entière** — y compris les
facultatifs non activés et les courses à vide, sans quoi un libellé jugé unique
entrerait en collision le jour où l'exploitant active le facultatif.

**Modifiable après création**, dans la ligne de la course (bouton « Nommer » /
« Renommer »), avec la même validation. Vidé, le train reprend « SPÉ n ».

_(Décision de l'exploitant du 12/09/2026. Migration
`2026-09-libelle-course.sql`, ADDITIVE — elle n'enlève rien — à passer en
production AVANT la fusion : le front demande `libelle` nommément et PostgREST
refuse la requête entière si la colonne manque.)_

### 2.11 Cycle du bandeau — l'important, puis les autres

Le bandeau du pied d'écran **alterne** dès qu'un message « importante » est en
cours :

- **chaque** message important occupe SEUL toute la largeur pendant **deux
  parts** du cycle ;
- les messages normaux défilent ensemble pendant **une part** ;
- puis on recommence. Deux tiers / un tiers, décidé par l'exploitant le
  09/09/2026.

L'unité d'une part est **un passage complet** du contenu normal, jamais une
durée arbitraire : un créneau qui s'arrêterait au milieu d'une course couperait
le message. Un créneau important qui défile fait donc un nombre ENTIER de ses
propres passages, le plus proche de sa part.

Deux défauts que ce cycle répare, relevés à la recette du 09/09/2026 :

1. un seul message important **écartait** tous les autres du bandeau — un avis
   posé le matin effaçait l'information sur les vélos jusqu'à ce que quelqu'un
   pense à le désactiver ;
2. un message important trop long était **tronqué en silence** par
   `overflow: hidden` (1 645,8 px perdus, mesurés à 1920 × 1080 ; la moitié
   anglaise n'apparaissait jamais). Le voyageur lisait « Circulation
   interrompue entre Col de Voza et Bellevue — service de substitution par
   route depuis Sa » et croyait savoir.

D'où la règle : **le mode immobile n'est accordé qu'à ce qui TIENT.** Un
message important trop long défile, comme les autres — visuellement moins
saillant, mais entier. La largeur se mesure sur le RENDU (`debordeBandeau()`,
`src/pages/affichage-commun.ts`), jamais sur un modèle : la place offerte
dépend du pavé météo, qui varie, et le texte mêle deux graisses (français 700,
anglais 400).

**PLUSIEURS IMPORTANTS** : chacun reçoit son créneau et le cycle s'allonge. On
ne partage pas un créneau entre eux (cinq messages lus à un cinquième, c'est
aucun des cinq) et on ne plafonne pas leur nombre (faire disparaître le
cinquième recréerait le défaut nº 1). Les messages normaux reviennent alors
moins souvent : c'est le coût VISIBLE d'un abus de la priorité, corrigible par
l'exploitation plutôt que caché par le code.

**En supervision** (onglet Bandeau) : l'aperçu appelle la MÊME fonction que les
écrans, il montre donc le cycle réel, bilingue, expirations comprises. Il est
dimensionné en **modèle réduit de l'écran de gare le plus étroit** (30,9 em,
minimum mesuré 30,94 em à 1024 × 768 ; un 16/9 en offre 45,47), ce qui lui
permet de rendre le même verdict « immobile ou défile ». Le champ de saisie dit
en direct si le message tiendra — **information, jamais refus** : un message
long n'est pas une faute, et si la mesure est impossible le champ se tait.
### 2.12 Accès d'une course — public, privé, mixte (`circulations.acces`)

« D'où vient ce train » (`nature` : grille, renfort, spécial) et « à qui il est
vendu » (`acces` : public, privé, mixte) sont **deux questions indépendantes**.
Jusqu'au 12/09/2026 elles n'en faisaient qu'une : « Privé » se **déduisait** de
`nature = 'special'`. Un spécial était donc forcément privé, et un privé
forcément spécial — or l'exploitation connaît deux cas que ce modèle ne savait
pas dire :

1. un **spécial partiellement ouvert** : une partie de la rame réservée, le
   reste en vente au guichet. Il était annoncé « Privé » en gare et retiré du
   comptoir — des places invendues, et un voyageur à qui l'écran dit de ne pas
   monter ;
2. la **privatisation d'un train de grille** : le TRAIN 11 de ce mercredi est
   affrété, à la montée seulement, ou à la descente, ou aux deux. C'était
   **impossible** — `circulations_nature_numero` borne `special` aux numéros
   ≥ 201, et cette plage porte le sens ; elle n'est pas relâchée.

D'où une colonne propre, sur **toute** circulation quelle que soit sa nature.
**Un champ à trois états, jamais deux booléens** — même raison que `nature` :
« privé ET mixte » n'existe pas en exploitation et rien ne l'empêcherait.

La montée et la descente sont **déjà** deux lignes (`numero`, `numero + 1`) :
« affrété à la montée seulement » se représente sans rien inventer, et rien
n'est propagé automatiquement à la course appariée.

| Point | Règle |
| --- | --- |
| Création d'un spécial | L'accès est un **choix obligatoire**, sans défaut : le formulaire refuse tant qu'il n'est pas fait. Un défaut à « public » ferait partir au guichet un train affrété ; un défaut à « privé » retirerait de la vente des places qui se vendent. |
| Renfort | Toujours public, sans choix : il est créé pour absorber une affluence, c'est-à-dire pour vendre. |
| Privatiser un train de grille | Onglet **Circulations**, colonne « Accès », sur la ligne du train. |
| Montée / descente | **Chaque ligne indépendamment.** |
| Droits | **admin et supervision.** Ni la caisse, ni le technique. |
| Commanditaire | Saisissable aussi sur un train de grille privatisé — même champ interne, jamais lisible en gare. |
| Écran, `prive` | Le train **reste affiché**, avec la pastille « Privé / Private ». Un trou de quarante minutes dans les départs inquiète plus qu'une pastille. |
| Écran, `mixte` | **Rien de particulier** : il s'affiche comme les autres, avec sa pastille « Complet » ou « Dernières places » si elle est déclarée. Le voyageur peut monter, rien ne doit lui dire le contraire. |
| Onglet Places | `public` et `mixte` présents, `prive` absent. |
| Libellé libre | Reste réservé aux courses hors grille : un train de grille privatisé garde **« TRAIN 11 »**. |

**La déclaration d'affluence SURVIT à la privatisation.** Elle est seulement
masquée tant que la course est `prive`, et reparaît telle quelle si elle
redevient publique. *Écart assumé* avec la réinitialisation d'une journée, qui
refuse au contraire de reconduire un « complet » : la différence est le temps
écoulé — ici le guichet a compté ses places il y a une heure et l'affrètement
peut être annulé dans la foulée ; là, c'est une journée entière régénérée.

**La caisse n'écrit toujours pas dans `circulations`.** C'est la raison d'être
de la table `affluence` (§2.8) et ce lot ne l'ouvre pas : le guichet voit la
course privatisée quitter son onglet Places, et c'est tout.

#### Comment l'écriture est bornée

`admin` possède le droit de privatiser mais **pas** `circulations`, et cette
séparation est délibérée (§5.5). Aucun des deux mécanismes habituels ne
convenait :

- les **droits de colonne** ne distinguent pas nos rôles applicatifs — admin,
  supervision et caisse sont le **même** rôle PostgreSQL (`authenticated`),
  seul `anon` s'en sépare ;
- une **politique RLS** filtre des lignes, jamais des colonnes : « admin peut
  modifier une circulation de grille » lui ouvrirait du même coup `statut`,
  `retard_min`, `terminus` et `passages`, c'est-à-dire les horaires des six
  gares.

L'écriture passe donc par `public.definir_acces`, `SECURITY DEFINER`, qui
vérifie le rôle applicatif dans son corps et n'écrit que `acces` et
`commanditaire`. **Aucune politique RLS n'est ajoutée à `circulations`** — un
UPDATE direct de l'admin sur un train de grille reste refusé, et la recette
`supabase/tests/roles-rls.sql` l'éprouve. La supervision emprunte la même
porte, bien qu'elle pût écrire directement : deux chemins pour la même
commande, ce sont deux règles à tenir d'accord, et l'une des deux finit par
dériver.

C'est la **seule** dérogation à la règle « aucune fonction `SECURITY DEFINER`
dans le schéma `public` », parce que seules les fonctions de `public` sont
exposées en RPC par PostgREST. Elle porte en contrepartie trois garanties
vérifiées par `src/data/securite.test.ts` : révoquée à `public` **et** à
`anon`, `search_path` verrouillé, contrôle du rôle applicatif dans le corps.

_(Décision de l'exploitant du 12/09/2026. Migration `2026-09-acces-course.sql`,
ADDITIVE, à passer en production AVANT la fusion — le front demande `acces`
nommément. Les trains spéciaux DÉJÀ en base y sont repris en `prive` : ils
portaient la pastille par déduction, et les laisser `public` les ferait
reparaître au guichet.)_

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
4. **Pied rouge** : messages FR • EN — la durée d'un tour est CALCULÉE
   (durée = largeur du texte ÷ `vitesse_ticker_px_s`), de sorte que la vitesse
   de lecture reste constante quelle que soit la longueur du bandeau ; un
   message sans traduction s'affiche en français seul, sans séparateur. Le
   bandeau ALTERNE quand un message important est en cours — voir §2.11. Pavé
   météo sommet (température + ciel, saisi en supervision).
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

Reproduit `maquettes/supervision.html`. Connexion obligatoire ; les RÔLES de
l’agent, multiples et cumulables, déterminent les onglets et les commandes
accessibles (§5.5 ci-dessous, et docs/02 sécurité).

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
   **Veille de nuit** : le réglage GLOBAL relève du rôle technique, la veille
   propre à un poste de l’exploitation. Un réglage GLOBAL en tête de
   l'onglet (heure de début / heure de fin), et sur chaque carte la
   possibilité de lui donner son propre horaire. La carte indique clairement
   « Suit le réglage global » ou « Réglage propre 19:00 → 06:30 », et un
   bouton « Revenir au global » efface la surcharge. Les DEUX heures sont
   requises pour qu'une surcharge compte — une seule ne décrit pas une
   fenêtre, et l'écran resterait dans un état indécis. Chaque écran apprend
   sa veille par son propre signal de vie : la modification est prise en
   compte sans rechargement, au plus tard au cycle suivant (60 s).
   _(Évolution validée par l'exploitant le 29/08/2026.)_
5. **Paramètres** : Machines (ajouter/renommer/couleur/en service/retirer) ;
   délai **« à quai » en gare d'origine** (`a_quai_origine_s`, défaut 5 min,
   §3). RÈGLE DE RANGEMENT (06/09/2026) : ce qu'on touche EN COURS DE JOURNÉE
   n'est pas dans Paramètres, et un onglet = un droit. Les Motifs sont donc
   passés en fin d'onglet Circulations (repliés) et les États du ciel sous la
   météo de l'onglet Bandeau — au contact de ce qui les consomme ; en ajouter
   un pendant une perturbation n'oblige plus à quitter l'onglet. Chaque carte
   n'apparaît qu'aux rôles qui peuvent l'écrire : le paramétrage
   d'exploitation au chef d'exploitation.
6. **Utilisateurs** : comptes et rôles (§5.5), droit `comptes.lire`.
7. **Journal** : journal d'exploitation en lecture seule (§7), droit
   `journal` ; la purge reste réservée au rôle technique
   (`journal.purger`). Onglet DÉDIÉ depuis le 06/09/2026 : « Paramètres »
   exigeait `comptes.lire` ou `journal.purger`, si bien que la caisse —
   pourtant titulaire du droit `journal` — n'atteignait le journal par aucun
   chemin.

   **Pastille de la base servie** (en-tête, à gauche des autres) :
   « PRODUCTION » en rouge, « BASE DE TEST » en jaune, « DÉMONSTRATION » en
   gris. Rien à l'écran ne disait sur quelle base on travaillait, alors que
   la mise au point d'une évolution fait alterner les deux projets Supabase.
   Tout ce qui n'est pas la production est annoncé comme un essai : une base
   inconnue n'est jamais présentée comme la vraie.

### 5.5 Utilisateurs et droits — rôles MULTIPLES et CUMULABLES

Une personne porte un **ensemble** de rôles, pas un seul. Un droit est accordé
si **au moins un** de ses rôles le donne (union). **Aucun rôle n'en implique un
autre** : « technique » ne donne pas l'exploitation, et réciproquement.

Ce modèle existe parce que les fonctions se cumulent et se séparent selon les
personnes : le chef d'exploitation assure aussi, temporairement, la
responsabilité informatique ; le prestataire informatique ne sera pas
exploitant ; son successeur à l'exploitation ne sera pas informaticien. Une
hiérarchie linéaire ne sait dire aucune de ces trois situations.

| Rôle | Pour qui | Ce qu'il ouvre |
| --- | --- | --- |
| **Technique** | Responsable informatique, prestataire | Grilles horaires ; identité des écrans (déclarer, oublier) ; rechargement et veille d'un poste ; veille de nuit globale et durée du cache ; réinitialisation d'une journée ; comptes techniques ; journal, y compris les lignes de rôles, et sa purge |
| **Administrateur** | Chef d'exploitation | Comptes d'exploitation ; bibliothèque de modèles ; médias et cycle d'affichage ; machines, motifs, états du ciel, délai « à quai » ; grilles horaires ; bandeau ; **accès d'une course** (§2.12) ; journal, y compris les lignes de rôles |
| **Supervision** | Exploitation courante | Circulations et journées ; grilles horaires ; bandeau ; médias ; rechargement et veille d'un poste ; réinitialisation d'une journée ; publication |
| **Caisse** | Guichet | Bandeau voyageurs : messages, météo du sommet, vitesse de défilement ; médias et cycle d'affichage ; rechargement et veille d'un poste ; journal ; grille du jour en lecture |

Trois droits sont **délibérément partagés** avec l'exploitation — grilles,
rechargement d'un écran, réinitialisation d'une journée : un matin de service,
l'exploitation ne doit jamais attendre l'informatique. Ne restent exclusifs au
rôle technique que les réglages d'infrastructure, qui n'ont pas d'urgence
d'exploitation.

**Le guichet suit le même principe** _(06/09/2026)_. La caisse a gagné les
médias et la commande d'écran : l'agent est souvent seul en gare le matin, et
un écran resté en veille ne s'attrape pas par téléphone. Aucun droit nouveau
n'a été créé pour l'occasion — `medias` et `ecrans.commander` existaient déjà
et étaient portés par d'autres rôles. La caisse voit donc **cinq onglets sur
huit** : Horaires (lecture seule), Bandeau, Médias, Écrans, Journal.

Ce qu'elle **ne** gagne pas, et qui reste vérifié en base
(`supabase/tests/roles-rls.sql`) : les circulations et les journées, le délai
« à quai », les rames, motifs et états du ciel, la veille de nuit **globale**
(à distinguer de la veille d'un poste), les comptes et les rôles. Elle
**commande** un écran sans pouvoir le **déclarer**, l'oublier, ni changer sa
gare ou son type : cette séparation est tenue par un déclencheur, pas
seulement par une politique, parce que RLS ne sait pas quelles colonnes
changent.

**Visibilité des onglets — à ne pas confondre avec les droits** _(06/09/2026)_.
La matrice ci-dessus dit ce que chaque rôle **peut faire**. Une seconde table,
réglable depuis la supervision (Utilisateurs → carte « Onglets visibles par
rôle », droit `parametres.technique`), dit ce que chaque rôle **voit** dans la
barre de navigation. L'exploitant range ainsi ses onglets sans livraison de
code, et revient sur sa décision en trois clics.

> **Ce réglage ne peut que RETRANCHER, jamais étendre.** La matrice droit ×
> rôle et les politiques RLS restent le plafond : un onglet ne peut être rendu
> visible à un rôle que si ses droits l'ouvraient déjà. **Ce n'est donc pas une
> barrière de sécurité, c'est du rangement d'interface** — aucune écriture
> nouvelle ne devient possible, la base refuse exactement ce qu'elle refusait.
> Une ligne écrite à la main qui accorderait « Circulations » à la caisse ne
> produit rien du tout.

_(10/09/2026)_ Un NEUVIÈME onglet, **Places**, s'insère après Circulations :
il porte le droit `affluence` et lui seul, et s'ouvre donc à `admin`,
`supervision` et `caisse` — pas au technique. Il remplace la colonne
Remplissage de Circulations et la carte du guichet dans Bandeau : voir §2.8.

Première valeur livrée : **la caisse ne voit plus l'onglet Horaires**. Le
choix est passé par la table plutôt que par le code, précisément pour qu'il
soit réversible sans livraison — la caisse garde par ailleurs le droit
`bandeau` qui lui ouvrait cet onglet, c'est un masquage et non un retrait.

Deux replis, tous deux vers la matrice du code et jamais vers « aucun onglet » :
réglage indisponible (base injoignable, table absente ou vide), et rôle dont
aucune ligne n'a été enregistrée — un rôle créé plus tard naîtrait sinon
aveugle. L'exploitation ne doit jamais attendre l'informatique un matin de
service.

Garde-fou : au moins un rôle capable de rouvrir ce réglage doit garder l'onglet
Utilisateurs. La case correspondante est grisée dans l'écran, et **la base
refuse le geste** (déclencheur de contrainte différé) — l'interface n'est qu'un
confort. Supprimer TOUTES les lignes d'un rôle le fait retomber sur la matrice
du code : c'est la porte de secours, et c'est pourquoi seul le réglage partiel
est refusé. Chaque onglet accordé ou masqué laisse une ligne au journal.

**Qui attribue quoi.** Le rôle technique s'attribue depuis un compte technique ;
les rôles admin, supervision et caisse depuis un compte administrateur. Personne
d'autre n'attribue rien, et **personne ne modifie ses propres rôles**. Renommer,
désactiver ou supprimer un compte exige de pouvoir attribuer **tous** ses rôles :
un administrateur ne touche donc pas au compte du prestataire informatique, et
réciproquement.

**Garde-fous.** Il doit toujours rester **au moins un compte actif Technique et
un compte actif Administrateur** : la base refuse le retrait, la désactivation
ou la suppression du dernier — y compris depuis le tableau de bord Supabase.
Pour transmettre un rôle, on l'**attribue d'abord** à la personne suivante, on
le retire ensuite.

**Dans l'écran.** Une ligne d'utilisateur porte autant de badges que de rôles et
quatre cases à cocher. Seules les cases que l'agent connecté a le droit
d'attribuer sont actives ; une case verrouillée dit pourquoi au survol (rôle
hors de son périmètre, propre compte, dernier détenteur). Les onglets et les
cartes suivent la même règle. Ce n'est qu'un confort : la base refuse de toute
façon ce qu'elle doit refuser.

_(Modèle validé par l'exploitant le 05/09/2026 ; détail technique docs/02 §5.)_
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

7. **Journal d'exploitation** (onglet Journal, lecture seule). Puisqu'une valeur
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
