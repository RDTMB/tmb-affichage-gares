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

Quatre rôles **multiples et cumulables** (docs/01 §5.5, docs/02 §5), portés par la table de
liaison `profils_roles` et n'ayant d'effet que si `profils.actif = true`. Un droit est accordé si
**au moins un** des rôles de la personne le donne — union, jamais héritage. **Aucun rôle n'en
implique un autre.**

- **Technique** — responsable informatique ou prestataire : grilles horaires, identité et
  réglages des écrans, paramètres d'infrastructure, comptes techniques, purge du journal.
- **Administrateur** — chef d'exploitation : comptes d'exploitation, paramétrage métier,
  médias, bibliothèque de modèles, grilles, bandeau.
- **Supervision** — l'exploitation quotidienne (journées, circulations, grilles, médias,
  bandeau, commandes des écrans).
- **Caisse** — le bandeau voyageurs : messages et clés d'affichage courantes (météo, vitesse).

Ce modèle existe parce que les fonctions se cumulent et se séparent selon les personnes : le
chef d'exploitation assure aussi, temporairement, la responsabilité informatique ; le prestataire
informatique ne sera pas exploitant ; son successeur à l'exploitation ne sera pas informaticien.

**La frontière réelle est RLS (Row Level Security), côté base**, doublée de déclencheurs — car
RLS ne s'applique ni à `service_role` ni au propriétaire des tables. L'interface masque des
onglets et des boutons selon les rôles, mais ce n'est qu'un **confort** : un agent qui
contournerait l'interface se heurte aux mêmes politiques. Ce que chaque rôle peut écrire :

| Table | anon | caisse | supervision | admin | technique |
|---|---|---|---|---|---|
| `jours`, `circulations` | — | — | ✔ | — | réinitialisation seule |
| `medias` (+ objets du bucket) | — | — | ✔ | ✔ | — |
| `messages` | — | ✔ | ✔ | ✔ | — |
| `params` : `meteo_sommet`, `vitesse_ticker_px_s` | — | ✔ | ✔ | ✔ | — |
| `params` : `mode_medias`, `duree_horaires_s` | — | — | ✔ | ✔ | — |
| `params` : `a_quai_origine_s` | — | — | — | ✔ | — |
| `params` : `veille_nuit`, `duree_cache_min`, toute clé inconnue | — | — | — | — | ✔ |
| `machines`, `motifs`, `ciels`, `modeles_messages` | — | — | — | ✔ | — |
| `grilles` | — | — | ✔ | ✔ | ✔ |
| `profils`, `profils_roles` | — | — | — | ✔ (voir ci-dessous) | ✔ (voir ci-dessous) |
| `roles` (catalogue) | — | — | — | — | éditeur SQL seul |
| `ecrans` (signal de vie, colonnes bornées) | ✔ (voir §4) | — | ✔ | — | ✔ |
| `ecrans` (rechargement, veille du poste) | — | — | ✔ | — | ✔ |
| `ecrans` (déclarer, oublier, changer de gare) | — | — | — | — | ✔ |
| `publications` (journal des publications) | — | ✔ | ✔ | ✔ | ✔ |
| `journal_exploitation` | écrit par déclencheur uniquement | | | | |

Trois droits sont **délibérément partagés** avec l'exploitation — grilles, rechargement d'un
écran, réinitialisation d'une journée : un matin de service, l'exploitation ne doit jamais
attendre l'informatique. Ne restent exclusifs au rôle technique que les réglages
d'infrastructure, qui n'ont pas d'urgence d'exploitation.

**Attribution des rôles.** Le rôle technique s'attribue depuis un compte technique, les rôles
admin, supervision et caisse depuis un compte administrateur ; personne d'autre n'attribue rien.
**Personne ne modifie ses propres rôles ni son propre profil.** Renommer, désactiver ou supprimer
un compte exige de pouvoir attribuer **tous** ses rôles : un administrateur ne touche donc pas au
compte du prestataire informatique, et réciproquement. La règle « qui attribue quoi » est une
**donnée** du catalogue `roles`, lisible d'un simple SELECT, que seul l'éditeur SQL modifie.

**Garde-fou d'invariant.** Il doit toujours rester au moins un compte actif « technique » et un
compte actif « admin ». Un déclencheur de contrainte différé le vérifie à la fin de chaque
transaction, sur tous les chemins : interface, Edge Function, éditeur SQL, et cascade déclenchée
par la suppression d'un compte depuis le tableau de bord Supabase. Un verrou consultatif
sérialise deux retraits concurrents. Pour transmettre un rôle, on l'**attribue d'abord**, on le
retire ensuite. Un compte banni ou supprimé côté Auth ne tient pas lieu de détenteur.

Chacun ne lit son propre `profils` que via RLS ; les comptes technique et admin lisent tous les
profils. Le **journal d'exploitation** n'est écrit par personne directement : il est alimenté par
des déclencheurs `SECURITY DEFINER`, ce qui le rend fidèle même à une correction faite en SQL.
L'auteur d'une écriture y est résolu depuis **le jeton** de l'agent, non depuis `profils.email` :
personne ne peut réécrire une adresse pour faire imputer ses écritures à un collègue. Les lignes
qui tracent les comptes et les rôles ne sont lisibles que par les rôles technique et admin.

**Procédure de secours (éditeur SQL).** Si plus aucun compte technique n'était joignable — départ,
compte banni —, l'attribution se rattrape depuis l'éditeur SQL Supabase. Une écriture « sans
visage » doit être **revendiquée**, faute de quoi elle est refusée : c'est ce qui empêche une Edge
Function compromise d'attribuer un rôle. Commande exacte, à copier telle quelle :

```sql
begin;
  set local tmb.attribution_systeme = 'secours';
  insert into profils_roles (user_id, role)
  select p.user_id, 'technique'
    from profils p join auth.users u on u.id = p.user_id
   where lower(u.email) = lower('prenom.nom@tramwaydumontblanc.fr')
  on conflict do nothing;
commit;
-- Contrôle :
select p.email, array_agg(pr.role order by pr.role)
  from profils p join profils_roles pr using (user_id)
 group by p.email;
```

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
- **Une Edge Function vérifie toujours les rôles de l'appelant côté serveur.** Connaître l'URL
  d'une fonction (elle est publique) ne suffit jamais à l'invoquer utilement :
  - `inviter-utilisateur` — l'appelant doit être actif et habilité à attribuer **chacun** des
    rôles demandés ; la règle est lue dans le catalogue `roles`, jamais recopiée dans le code ;
  - `supprimer-utilisateur` — l'appelant doit pouvoir attribuer **tous** les rôles de la cible ;
  - `traduire` — réservée à un profil actif portant au moins un rôle, pour ne pas exposer le
    quota DeepL de la Régie à Internet.
  Ces fonctions n'acceptent en outre les requêtes que depuis les origines connues (CORS).
- **La clé secrète ne sert qu'aux appels Auth qui l'exigent.** Créer ou supprimer un compte
  passe par elle ; toute écriture dans `profils` et `profils_roles` passe, elle, par un client
  portant **le jeton de l'agent**, de sorte que RLS, les déclencheurs et le journal s'appliquent
  comme depuis la supervision. La vérification faite en TypeScript n'est qu'un premier filtre.
  Si l'écriture du profil échoue après une invitation, le compte Auth est supprimé : sinon il
  resterait un compte fantôme, invisible de la supervision et impossible à réinviter.

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
