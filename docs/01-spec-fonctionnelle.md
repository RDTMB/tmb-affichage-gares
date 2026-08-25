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
facultatif_actif (défaut false), statut
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

### 2.5 Médias

Fichiers image (JPG/PNG) ou vidéo muette (MP4 H.264, 16:9 1920×1080
conseillé). Champs : nom, type, `duree_s`, gares cibles, `actif`,
`expire_at`. Réglage global : `duree_horaires_s` (temps d'affichage de la
page horaires entre deux médias, défaut 20 s). Cycle sur les écrans :
horaires → média 1 → horaires → média 2 → … (uniquement les médias actifs,
non expirés, ciblant la gare). Sans média actif : horaires en continu.

### 2.6 Machines (rames) et motifs

Paramétrables en supervision : machines (nom, couleur, en service) —
défaut Marie/Anne/Jeanne/Marguerite avec les couleurs de CLAUDE.md ;
motifs (défaut : Météo, Croisement, Technique, Affluence, Exploitation).

## 3. Écran de gare (`ecran.html`)

Reproduit `maquettes/ecran-gare.html` :

1. **Bandeau crème** : logo officiel à gauche ; nom de gare (Amaranth) +
   « ALTITUDE X M » (rouge) centrés au milieu de l'écran ; horloge
   HH:MM:SS + date à droite ; liseré rouge.
2. **Tableau marine** — colonnes strictement alignées :
   Arrivée (discrète) · Départ (grosse) · Destination · Train · Départ dans · Statut.
   - Arrivée = heure réelle du document d'exploitation (« — » à l'origine
     du train ; repli départ − `arret_intermediaire_s` si l'arrivée manque) ;
   - Destination : flèche oblique ↗ (montée) / ↙ (descente) dans un carré ;
     terminus (« Nid d'Aigle », « Le Fayet », ou « Bellevue » si terminus
     exceptionnel) ; pour un express, GRAND picto motrice blanc (~7 % de la
     hauteur d'écran) à droite du nom de la destination ; sous-ligne :
     « Montée / Ascent » ou « Descente / Descent », remplacée pour un
     express par « EXPRESS — sans arrêt / non-stop : Col de Voza &
     Bellevue » (taille réduite pour tenir sur une ligne) ; « Vélos
     acceptés / Bikes allowed » si train vélos ; motif en orange si retard.
   - Train : pastille couleur rame + nom + « TRAIN X » (majuscules, sans n°).
   - Compte à rebours (rendu exact de la maquette) : « n min » (mis en
     évidence à 5 min ou moins) ; « n h mm » si ≥ 60 min ; « < 1 min »
     clignotant de T−1 min au départ, puis « À QUAI » clignotant jusqu'au
     retrait ; ligne retirée 2 min après départ (immédiatement à l'heure
     théorique pour un supprimé). Les cases du compte à rebours ont TOUTES
     la même taille (largeur fixe, centré).
   - Statut : À l'heure/On time (vert) · Retard +n min/Delayed (orange,
     heure réelle affichée + « théorique HH:MM ») · Supprimé/Cancelled
     (rouge, heure et destination barrées).
   - 5 lignes max, tri par heure de départ, deux sens mélangés ; seuls les
     passages AVEC départ figurent dans le tableau (au terminus d'un train,
     son arrivée n'apparaît que via la ligne « prochaine arrivée »).
3. **Prochaine arrivée** : « HH:MM — <Rame en SA couleur> (train n° X), en
   provenance de … ». Marguerite (blanche) : léger halo rouge pour rester
   lisible.
4. **Pied rouge** : messages défilants lents (~80 s/boucle) FR • EN ;
   pavé météo sommet (température + ciel, saisi en supervision).
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
2. **Messages** : liste + formulaire (FR requis ; EN **généré
   automatiquement à la saisie** puis modifiable ; cible toutes/gares/
   train, priorité, expiration) ; **bouton Modifier** sur chaque message
   (édition en place) : le formulaire RESTITUE la cible et l'expiration du
   message édité — une correction de texte ne peut donc jamais transformer
   un message ciblé en message diffusé partout ; le formulaire affiché est
   exactement ce qui sera enregistré (l'expiration peut être retirée en
   choisissant « jamais ») ; retrait en un clic.
3. **Médias** : réglage `duree_horaires_s` ; envoi de fichier (taille max
   20 Mo, formats §2.5) ; par média : durée, **gares ciblées et expiration
   modifiables après création** (aucune gare cochée = toutes), actif,
   aperçu, suppression. La liste montre TOUS les médias, y compris ceux
   désactivés (sinon ils ne seraient plus réactivables).
4. **Écrans** : cartes (gare, type, en ligne/hors ligne — silence > 90 s,
   réseau fibre/5G, mention alimentation solaire pour le Nid d'Aigle,
   dernière vue, version) ; bouton « Recharger l'écran ».
5. **Paramètres** (admin) : Machines (ajouter/renommer/couleur/en service/
   retirer) ; Motifs (liste modifiable) ; Utilisateurs (créer, attribuer un
   rôle, réinitialiser mot de passe, désactiver — v1 : rôles Administrateur
   / Supervision / Caisse ; le détail fin des droits par catégorie et la
   création de nouvelles catégories — Gestionnaire, Lecteur… — sont prévus
   dans le modèle mais seront précisés plus tard avec l'exploitant) ;
   Saisons et services (grilles chargées + périodes, veille nuit
   HH:MM→HH:MM) ; météo sommet (température + ciel FR/EN).
6. **Publication** : les modifications s'appliquent immédiatement ; le
   bouton « Publier » journalise un résumé horodaté (auteur + contenu) dans
   l'historique ; compteur de modifications de la session ; « Aperçu
   écrans » ouvre l'écran d'une gare dans un nouvel onglet.

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
- Heartbeat 30 s (id écran, gare, horodatage, version, user-agent).

## 8. Hors périmètre v1 (extensions)

Annonces sonores, météo automatique, géolocalisation des rames, page
publique voyageurs, alertes email écran hors ligne, statistiques.
