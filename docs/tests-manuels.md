# Tests manuels — résilience et modes dégradés (étape 4)

Prérequis : `npm run build` puis `npm run preview` (le service worker n'est
enregistré qu'en build — le mode dev reste sans cache). Ouvrir
http://localhost:4173/ecran.html?gare=saint-gervais.

## 1. Coupure réseau < 15 min → horaires + badge

1. Charger l'écran, attendre l'affichage des horaires.
2. DevTools → Network → cocher **Offline**.
3. Attendre 2 minutes : un badge orange « Données de HH:MM / Data from
   HH:MM » apparaît en haut à droite. Les horaires restent affichés.
4. Décocher Offline : le badge disparaît en ≤ 30 s (resynchronisation
   périodique + événement `online`), **sans rechargement de la page**.

## 2. Coupure > `duree_cache_min` → ÉCRAN NEUTRE

Pour ne pas attendre 15 min, réduire le paramètre via l'URL de test :
`ecran.html?gare=saint-gervais&cache=0.05` (0.05 min = 3 s).

1. Passer Offline : après ~3 s + le délai du badge, l'écran bascule sur
   l'écran neutre (logo blanc, horloge, message bilingue « Informations
   momentanément indisponibles »). Aucun horaire n'est plus visible.
2. Repasser Online : retour automatique aux horaires (≤ 30 s), sans
   rechargement.

En production le seuil vient du paramètre `duree_cache_min` (défaut 15 min,
réglable en supervision).

## 3. Démarrage hors ligne

1. Visiter l'écran une fois en ligne (le SW précache l'application, les
   polices et les logos ; les données — grilles horaires comprises, lues en
   base — vont dans l'instantané localStorage).
2. Passer Offline, puis recharger la page (F5) :
   - snapshot récent (< 15 min) → horaires affichés avec badge ;
   - snapshot ancien → écran neutre ;
   - jamais visité → page inaccessible (aucun cache) : comportement attendu.

## 4. Divers

- Veille nuit : `?simule=21:30` → écran noir + horloge discrète.
- Anti-burn-in : le rendu se décale d'1 px toutes les heures (vérifiable en
  inspectant `body.style.transform`).
- Curseur : masqué sur ecran.html et grille.html (pages kiosque).
- Grille : mêmes tests avec grille.html (badge + écran neutre identiques).
- Cycle médias : ajouter une image dans Supervision → Médias ; l'écran
  alterne horaires (`duree_horaires_s`) → média (sa durée) → horaires ;
  jamais de média quand un départ est à moins de 2 min (chip « proche »,
  « < 1 min » ou « À QUAI »).

## 5. Barre de publication — les trois états

En démonstration (`supervision.html?demo=1`), aucune écriture réelle.

- **Rien à publier** : liseré neutre, pastille verte « ✓ », bouton inerte, et
  la ligne grise dit l'heure de l'état réellement affiché dans les six gares.
- **Modifications en cours** : liseré bleu de 4 px, pastille ronde bleue
  portant le compte, résumé de ce qui a changé — en langue d'exploitation
  (« TRAIN 5 — retard +5 min »), jamais en noms de colonnes.
- **Échec partiel** : `supervision.html?demo=1&echec=1`, faire une
  modification puis « Publier ». Attendu : liseré rouge de 4 px, barre plus
  haute, pastille ronde « ! », la CAUSE conservée dans son encart, le bouton
  qui devient « Réessayer la publication », et la mention que le message reste
  affiché jusqu'à la prochaine publication réussie.

Le troisième état ne se provoque pas autrement : sans ce drapeau, il serait
découvert un matin, en production, par un agent seul en gare. Il est
inopérant dès qu'une base réelle est configurée (docs/01 §1).
