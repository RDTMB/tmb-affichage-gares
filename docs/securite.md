# Modèle de sécurité (phase 1)

Ce document décrit **comment la sécurité est conçue** dans le projet : les enjeux, qui
peut écrire quoi, les règles absolues et les risques assumés. Il ne contient volontairement
aucune liste de faiblesses (voir la dernière section).

Le dépôt est **public**. Tout ce qui est écrit ici est donc écrit pour être lu par n'importe
qui, y compris un attaquant : la sécurité ne repose sur aucun secret présent dans le code.

## 1. Enjeux, dans l'ordre

1. **Intégrité de l'information voyageurs.** Un horaire faux affiché en gare est le pire
   scénario : il envoie des gens sur un quai pour un train qui n'existe pas, en montagne, avec
   un dernier départ à ne pas manquer. Toute la conception donne la priorité à ce point.
2. **Disponibilité des écrans.** Un écran noir ou figé est presque aussi grave. D'où le mode
   dégradé (cache borné puis écran neutre) : **jamais d'horaire potentiellement faux plutôt
   qu'une absence d'affichage**.
3. **Confidentialité.** Faible. Horaires, messages et médias sont destinés au public. Les
   seules données personnelles sont les noms et e-mails du personnel (`profils`) et les traces
   du journal d'exploitation.

## 2. Rôles et écritures

Trois rôles (docs/02 §5), portés par la colonne `profils.role` et n'ayant d'effet que si
`profils.actif = true` :

- **Administrateur** — tout le paramétrage et toute l'exploitation.
- **Supervision** — l'exploitation quotidienne (journées, circulations, médias, messages,
  bandeau, écrans).
- **Caisse** — uniquement les messages et les clés d'affichage courantes (météo, vitesse du
  bandeau).

**La frontière réelle est RLS (Row Level Security), côté base.** L'interface masque des onglets
et des boutons selon le rôle, mais ce n'est qu'un **confort** : un agent qui contournerait
l'interface se heurte aux mêmes politiques. Ce que chaque rôle peut écrire :

| Table | anon | caisse | supervision | admin |
|---|---|---|---|---|
| `jours`, `circulations`, `medias` | — | — | ✔ | ✔ |
| `messages` | — | ✔ | ✔ | ✔ |
| `params` : `meteo_sommet`, `vitesse_ticker_px_s` | — | ✔ | ✔ | ✔ |
| `params` : autres clés | — | — | — | ✔ |
| `machines`, `motifs`, `modeles_messages` | — | — | — | ✔ |
| `profils` | — | — | — | ✔ |
| `ecrans` (signal de vie, colonnes bornées) | ✔ (voir §4) | ✔ | ✔ | ✔ |
| `ecrans` (déclaration, commande) | — | — | ✔ (commande) | ✔ |
| `publications` (journal des publications) | — | ✔ | ✔ | ✔ |
| `journal_exploitation` | écrit par déclencheur uniquement | | | |

Chacun ne lit son propre `profils` que via RLS ; l'administrateur lit et gère tous les profils.
Le **journal d'exploitation** n'est écrit par personne directement : il est alimenté par des
déclencheurs `SECURITY DEFINER`, ce qui le rend fidèle même à une correction faite en SQL.

**Lecture publique assumée.** Les tables d'affichage sont lisibles anonymement (`anon SELECT`) :
les écrans lisent sans compte. C'est un choix, pas un oubli — leur contenu est destiné au public.

## 3. Règles absolues

- **Aucun secret dans le dépôt.** L'URL et la clé publishable Supabase arrivent par les
  *variables* de dépôt (GitHub Actions → Variables) et sont écrites dans `public/config.js` au
  déploiement ; ce fichier n'est jamais commité.
- **La clé publishable (`sb_publishable_…`) est publique par conception.** Elle est dans le
  bundle JS, donc lisible par tous. Elle ne donne aucun droit d'écriture : la sécurité repose
  entièrement sur RLS.
- **La clé secrète (`sb_secret_…` / service_role) ne quitte jamais le serveur.** Elle n'existe
  que comme secret des Edge Functions ; elle n'apparaît ni dans le dépôt, ni dans le front, ni
  dans une réponse d'erreur.
- **Une Edge Function vérifie toujours le rôle de l'appelant côté serveur.** Connaître l'URL
  d'une fonction (elle est publique) ne suffit jamais à l'invoquer utilement :
  - `inviter-utilisateur`, `supprimer-utilisateur` — réservées à un administrateur actif ;
  - `traduire` — réservée à un profil actif (tous rôles), pour ne pas exposer le quota DeepL de
    la Régie à Internet.
  Ces fonctions n'acceptent en outre les requêtes que depuis les origines connues (CORS).

## 4. Risques assumés

Ces deux points sont des décisions prises en connaissance de cause, pas des défauts.

- **UPDATE anonyme sur `ecrans` (signal de vie).** Un poste en gare n'a pas de compte : il donne
  signe de vie anonymement. La portée est **strictement bornée** — cinq colonnes seulement, par
  des `GRANT` de colonnes ; `recharger_demande_at` en est exclu (un tiers ne peut pas ordonner
  le rechargement des écrans) ; et l'horodatage de la dernière vue est **forcé côté serveur** par
  un déclencheur, l'horloge du Raspberry n'entrant pas dans le calcul de fraîcheur.
  *Échéance :* fermeture en **phase 2**, où le micro-serveur interne prendra en charge les
  écritures des écrans et le rôle anonyme disparaîtra.
- **Pas de contrôle des mots de passe compromis (HaveIBeenPwned).** Cette vérification est une
  fonctionnalité du plan Supabase **Pro** ; le projet est sur l'offre gratuite. Compensation :
  une politique de mot de passe de **12 caractères minimum et quatre familles** de caractères.
  *Échéance :* à réévaluer si le projet passe au plan Pro.

## 5. Constats d'audit

Les constats d'un audit de sécurité qui ne sont pas encore corrigés **ne figurent pas dans ce
dépôt public** : les y publier reviendrait à distribuer une carte des portes à forcer avant
qu'elles ne soient fermées. Ils sont conservés **hors dépôt** (coffre de la Régie) et traités par
ordre de priorité. Ce fichier documente le modèle, pas les failles.
