# Audit de sécurité — TMB Affichage voyageurs en gare

**Date** : 30 août 2026 · **Périmètre** : état du dépôt au commit `fbdb7a3` (branche `main`, 33 commits)
**Nature** : audit en lecture seule. Aucun fichier de code n'a été modifié — ce document est le seul livrable.

---

## 1. Comment lire ce rapport

### Méthode

Le code a été lu, jamais la documentation seule. Chaque constat porte une preuve `fichier:ligne`
réellement ouverte. Dix axes ont été audités en parallèle — RLS, Edge Functions, Storage, XSS front,
authentification/session, secrets (historique git compris), chaîne de construction et dépendances,
poste kiosque, disponibilité/mode dégradé, conception phase 2 — puis **chaque constat a été soumis à
un vérificateur adversarial** dont la consigne était de le *réfuter*, pas de le confirmer : ouvrir le
fichier cité, dérouler le scénario, chercher activement ce qui le bloque ailleurs (contrainte `CHECK`,
policy RLS, `GRANT` de colonnes, typage, test existant), et trancher vers « ne tient pas » en cas de
doute non levé.

| | |
|---|---|
| Constats bruts levés | 105 |
| **Écartés à la vérification adversariale** | **25** (§7) |
| Retenus | 80 |
| Ajoutés par la critique de complétude (chaînes d'attaque, fichiers non couverts) | 5 |
| **Total retenu**, après fusion des doublons inter-axes | **69** |

### Hiérarchie des enjeux appliquée à la notation

1. **Intégrité de l'information voyageurs** — un horaire faux affiché en gare. C'est le pire scénario,
   et c'est le critère qui décide de la gravité. Un défaut qui n'atteint que la confidentialité ne peut
   pas être classé CRITIQUE dans ce projet.
2. **Disponibilité des écrans** — écran noir ou figé.
3. **Confidentialité** — faible. Horaires, messages et médias sont publics par destination.

### Décisions déjà actées : elles tiennent

Les trois décisions documentées ont été re-testées, pas redécouvertes :

- **La clé publishable est publique par conception** — confirmé. Elle ne donne aucun droit d'écriture
  sur les tables d'affichage : les policies d'écriture sont toutes `to authenticated`.
- **L'UPDATE anonyme sur `ecrans`** — la portée n'a **pas** dérivé. Les 5 colonnes du `GRANT` sont
  écrites verbatim dans `docs/02-spec-technique.md:168-169`, `recharger_demande_at` en est bien exclu,
  et `trg_signal_de_vie` force l'horodatage serveur. Une hypothèse de XSS par `ecrans.reseau` /
  `version_app` a été explicitement testée et **réfutée** : ces valeurs passent par `echapper()`
  (`src/pages/supervision.ts:1881,1884-1885`). Une seule nuance subsiste, en M-01 : la justification
  écrite promet qu'un tiers ne peut mentir *que* dans le sens de la fausse alerte — le code permet
  aussi l'inverse.
- **Lecture publique assumée** — confirmée, sans conséquence nouvelle.

---

## 2. Synthèse

**Le modèle de droits est solide.** `private.role_courant()` est correctement écrit (SECURITY DEFINER,
`search_path` vide, `revoke` puis `grant` ciblé) et filtre bien sur `actif` : un agent désactivé perd
ses droits d'écriture immédiatement. Les deux Edge Functions sensibles — `inviter-utilisateur` et
`supprimer-utilisateur` — **vérifient bien le rôle admin de l'appelant côté serveur**
(`index.ts:22-32` dans les deux fichiers) ; la question centrale posée à l'audit reçoit donc une
réponse rassurante. `profils` n'expose pas les agents à un non-admin. **Aucun secret n'a jamais été
commité** : l'historique des 33 commits est intégralement propre, y compris les objets inaccessibles
(`git fsck`). Les dépendances de production sont à jour et sans vulnérabilité connue. Aucune
contribution externe ne peut déclencher un déploiement.

**Les vrais risques ne sont pas là où on les cherche d'habitude.** Ils portent presque tous sur
l'enjeu n°1 — l'intégrité de l'information voyageurs — et viennent de trois familles :

1. **Un défaut d'échappement unique**, sur une valeur écrivable par le rôle le *moins* privilégié
   (`caisse`), qui donne l'exécution de JavaScript arbitraire sur les 6 écrans, et donc le pouvoir de
   réécrire les heures de départ (C-01).
2. **Des replis silencieux** : quand quelque chose manque, le système invente plutôt que de se taire.
   Sans `config.js`, il affiche des horaires de démonstration comportant un retard et une suppression
   inventés (C-02). Avec une horloge fausse, il juge ses données fraîches et affiche la journée de la
   veille (C-03). Ces chemins contredisent directement la règle « jamais d'horaires potentiellement
   faux ».
3. **Un poste kiosque non verrouillé** : les outils de développement de Chromium sont accessibles au
   clavier USB dans une gare ouverte au public, et le cache du service worker permet d'y rendre une
   modification persistante (C-04).

**Répartition des 69 constats retenus**

| Gravité | Nombre | Dont phase 2 seule |
|---|---|---|
| CRITIQUE | 4 | 0 |
| ÉLEVÉ | 7 | 2 |
| MOYEN | 21 | 5 |
| FAIBLE | 16 | 1 |
| INFORMATIF | 21 | 0 |
| **Total** | **69** | **8** |

Quatorze constats sont marqués **⚠️ à vérifier** : le code ne permet pas de les trancher, ils dépendent
d'un réglage hors dépôt. Ils sont repris en §9 sous forme de questions fermées.

---

## 3. Tableau des constats CRITIQUES et ÉLEVÉS

| ID | Gravité | Ph. | Titre | Coût |
|---|---|---|---|---|
| C-01 | CRITIQUE | 1+2 | Le rôle `caisse` obtient l'exécution de JavaScript arbitraire sur les 6 écrans via `params.meteo_sommet.t` — et, par chaînage, la session de l'administrateur | 1 h |
| C-02 | CRITIQUE | 1 | Sans `config.js`, repli silencieux sur des horaires de démonstration : un retard et une suppression **inventés** s'affichent en gare | 1 h |
| C-03 | CRITIQUE | 1+2 | L'horloge du Raspberry décide seule de la fraîcheur : ni badge, ni écran neutre, horaires d'un autre jour | 1 j |
| C-04 | CRITIQUE | 1 | Poste kiosque non verrouillé : outils de développement ouverts, navigation libre, cache du service worker empoisonnable durablement | 2 h |
| E-01 | ÉLEVÉ | 1 | Le bouton « Quitter » ne déconnecte pas : la session survit intacte dans `localStorage` | 1 h |
| E-02 | ÉLEVÉ | 1 | Aucun cycle de vie du mot de passe, et le lien d'invitation ouvre une session sur n'importe quelle page — `ecran.html` comprise | 3 h |
| E-03 | ÉLEVÉ | 1+2 | Échec dur au démarrage : l'écran reste sur un tableau des départs **vide**, jamais sur l'écran neutre | 1 h |
| E-04 | ÉLEVÉ | 1+2 | `?simule=HH:MM` ne laisse aucune trace visible : un écran de gare peut afficher un horaire décalé et crédible | 1 h |
| E-05 | ÉLEVÉ | 1+2 | SSH avec un mot de passe unique partagé par les 6 Pi, gravé dans l'image standard | 2 h |
| E-06 | ÉLEVÉ | 2 | SQLite n'a pas de RLS : toute l'autorisation est à réécrire en Node — décider **maintenant** la couche unique et le test par route × rôle | 2-3 j |
| E-07 | ÉLEVÉ | 2 | Perte de la base SQLite = régénération de la grille théorique : les trains supprimés réapparaissent comme circulants | 1 j |

Les 58 constats MOYEN, FAIBLE et INFORMATIF sont détaillés en §5, §6 et §7.

---

## 4. Constats CRITIQUES et ÉLEVÉS — détail

### C-01 — CRITIQUE — Le rôle `caisse` obtient l'exécution de JavaScript arbitraire sur les 6 écrans

**Phase 1 et 2 · Coût : 1 h · Attaquants (c) agent de caisse, (d) ancien agent resté `actif`**

*Trois axes de l'audit — RLS, XSS front, critique de complétude — sont arrivés indépendamment sur ce
défaut. C'est le constat le plus grave du rapport.*

**Preuve**

- `src/pages/affichage-commun.ts:117` — `` return `<div class="t">${meteo.t}°C${releve}</div>` `` :
  c'est la **seule** interpolation du pavé météo qui ne passe pas par `echapper()`. Les lignes 115 et
  118, juste autour, l'appellent correctement.
- `supabase/schema.sql:228-236` (et à l'identique `supabase/ajout-bandeau-veille.sql:37-45`, qui est la
  version en service) — policy « affichage tous roles » : `for all to authenticated using/with check
  (cle in ('meteo_sommet','vitesse_ticker_px_s') and private.role_courant() in
  ('admin','supervision','caisse'))`. Le prédicat porte sur la **clé** et le **rôle**, jamais sur le
  **contenu** de `valeur`.
- `supabase/schema.sql:102-106` — `params.valeur jsonb not null` : aucune contrainte `CHECK`. Vérifié
  par recherche sur l'ensemble de `supabase/*.sql`.
- `src/data/supabase.ts:248` — `(valeurs.get('meteo_sommet') as Params['meteo_sommet'])` : simple
  transtypage TypeScript, effacé à la compilation. Le `t: number` de `src/core/types.ts` n'existe pas à
  l'exécution.
- `src/pages/ecran.ts:324` et `src/pages/grille.ts:245` — `$('meteo').innerHTML = meteoHtml(params, grille);`
- `supabase/schema.sql:566-567` — `params` est publiée en Realtime ; et même sans Realtime, le repli par
  scrutation 30 s (`src/data/supabase.ts:282`, `src/pages/ecran.ts:557`) recharge les paramètres.
- Aucune CSP : recherche de `Content-Security-Policy` / `http-equiv` sur `ecran.html`, `grille.html`,
  `index.html`, `supervision.html` — aucun résultat.
- Aucun test ne couvre `meteoHtml` : `grep -rn "meteoHtml" src/` ne renvoie que la définition et les
  deux appels.

**Scénario**

Un agent de caisse — le rôle le moins privilégié, censé ne gérer que les messages — dispose d'une
session valide et de la clé publishable (publique par conception). Il contourne l'interface de
supervision, qui coerce pourtant correctement la saisie (`supervision.ts:2374`, `Number(...) || 0`), et
s'adresse directement à PostgREST :

```
PATCH /rest/v1/params?cle=eq.meteo_sommet
{"valeur":{"t":"<img src=x onerror=…>","ciel_fr":"Beau","ciel_en":"Fine"}}
```

RLS accepte : la clé est dans la liste autorisée, le rôle est autorisé, et rien ne regarde le contenu.
La charge atteint les 6 écrans en quelques secondes. Un `<img src=x onerror=…>` inséré par `innerHTML`
déclenche bien son gestionnaire — contrairement à `<script>` — et aucune CSP ne s'y oppose.

Le script s'exécute alors dans le contexte de la page, 18 h/jour, et peut réécrire le tableau des
départs (`#corps`, `ecran.ts:280`) : annoncer le dernier départ du Nid d'Aigle à 17:20 quand il part à
16:50, ou masquer une suppression. **C'est l'enjeu n°1 atteint depuis le rôle le moins privilégié.**
L'écran ne basculera jamais en mode neutre, puisque les données sont fraîches, et le journal
d'exploitation ne consignera qu'un banal changement de météo (`trg_journal_params`).

**Chaînage — vol de la session administrateur.** La supervision ouvre elle-même `ecran.html` /
`grille.html` dans un onglet de **même origine**, via les boutons « Aperçu » (`supervision.ts:2790`) et
« voir » (`supervision.ts:2036`), depuis un onglet où la session admin vit en clair dans `localStorage`.
La charge attend donc, en base, le prochain clic de l'administrateur, puis exfiltre son jeton d'accès et
son jeton de rafraîchissement. Ce que l'attaquant obtient n'est plus le contrôle du DOM de six écrans,
c'est **le compte administrateur**.

**Correctif** — les deux premiers verrous, pas un seul

1. *(10 min)* `src/pages/affichage-commun.ts:117` — ne jamais interpoler `meteo.t` brut. Une température
   n'est pas du texte, et `—` vaut mieux qu'un `NaN°C` :
   ```ts
   const t = Number(meteo.t);
   const temperature = Number.isFinite(t) ? String(Math.round(t)) : '—';
   return `<div class="t">${temperature}°C${releve}</div>` + …;
   ```
2. *(20 min)* Verrouiller côté base — c'est la vraie frontière, pour que l'interface ne soit pas le seul
   garde-fou :
   ```sql
   alter table params add constraint params_meteo_typee check (
     cle <> 'meteo_sommet' or (
       jsonb_typeof(valeur->'t') = 'number'
       and jsonb_typeof(valeur->'ciel_fr') = 'string'
       and jsonb_typeof(valeur->'ciel_en') = 'string'
       and length(valeur->>'ciel_fr') <= 40 and length(valeur->>'ciel_en') <= 40));
   alter table params add constraint params_ticker_typee check (
     cle <> 'vitesse_ticker_px_s' or jsonb_typeof(valeur) = 'number');
   ```
3. *(20 min)* Poser une CSP en `<meta http-equiv>` dans les 4 pages — voir I-07 et I-14 : GitHub Pages
   n'autorise aucune en-tête HTTP, mais la balise fonctionne pour `script-src`, et le code actuel est
   compatible (aucun script inline dans les 4 fichiers HTML).
4. *(10 min)* Test de non-régression : `meteoHtml` avec `t: '<img src=x onerror=1>'` ne doit contenir ni
   `<img` ni `onerror`.

---

### C-02 — CRITIQUE — Sans `config.js`, repli silencieux sur des horaires de démonstration

**Phase 1 · Coût : 1 h · Aucun attaquant : c'est un défaut de robustesse *fail-open***

*Cinq axes de l'audit sont arrivés sur ce défaut indépendamment.*

**Preuve**

- `.github/workflows/deploy.yml:36-42` — la branche `else` ne renvoie **aucun code d'erreur** :
  `echo "Variables absentes : déploiement en mode mock (démo)"`. L'étape sort en 0, le build et le
  déploiement continuent, le workflow est **vert**.
- `.gitignore:6` — `public/config.js` n'est jamais commité : sans génération par la CI, le fichier est
  absent du site publié.
- `ecran.html:56`, `grille.html:54`, `supervision.html:536` — `<script src="./config.js"></script>` :
  404 sur GitHub Pages, sans `onerror`, `window.TMB_CONFIG` reste indéfini.
- `src/data/index.ts:14-19` — deux branches, aucune troisième : `return new MockProvider(optionsMock);`.
  Repli muet, aucune trace, aucun appelant n'interroge le mode obtenu.
- `src/data/mock.ts:370-380` — le mock charge les **vraies grilles officielles** depuis
  `public/grilles/*.json`. L'affichage est donc parfaitement crédible.
- `src/data/mock.ts:404-412` — et y peint une journée de démonstration, **pour n'importe quelle date** :
  `TRAIN 11` → `retard_min: 10`, motif « Météo » ; `TRAIN 16` (descente, départ Nid d'Aigle 14:13:30) →
  `statut: 'supprime'`, motif « Météo » ; plus 6 trains facultatifs (3, 4, 9, 10, 17, 18) annoncés actifs.
- `public/sw.js:70-79` — le service worker ne sauve pas : `reseauDabord` ne se rabat sur le cache que si
  `fetch` **jette**. Un 404 est une réponse valide non-`ok` : l'ancien `config.js` correct reste inutilisé.
- `public/sw.js:10-22` — `config.js` n'est pas dans `PRECACHE`.
- Aucun bandeau, aucun badge : recherche de `mock|démo|demo` sur `src/pages/*.ts` et les fichiers HTML —
  rien qui distingue cet affichage d'un affichage réel.
- Build vérifié : `npx vite build` réussit sans `public/config.js`, et `dist/ecran.html` conserve la balise.

**Scénario**

Aucun attaquant n'est impliqué. Lors d'une opération d'exploitation ordinaire — rotation du projet
Supabase, renommage d'une variable, valeur posée par erreur dans « Secrets » au lieu de « Variables »
(les deux sont dans le même écran GitHub, ce que le commentaire `deploy.yml:2-3` rappelle lui-même),
transfert ou restauration du dépôt, premier déploiement avant configuration —
`vars.VITE_SUPABASE_URL` ou `vars.VITE_SUPABASE_PUBLISHABLE_KEY` se retrouve vide.

`npm test` passe (aucun test ne couvre `creeProvider`), l'étape sort en 0, GitHub Pages publie. Au
rechargement suivant — au plus tard au redémarrage de 04:30 —, les 6 écrans en gare affichent la vraie
grille officielle du jour, **avec le TRAIN 11 annoncé en retard de 10 minutes alors qu'il est à
l'heure, la descente TRAIN 16 annoncée SUPPRIMÉE alors qu'elle circule, et six trains facultatifs
annoncés actifs alors qu'ils ne viendront pas.**

Aucune suppression réelle, aucun terminus Bellevue, aucun message d'exploitation ne les atteint plus.
Et comme le mock ne tombe jamais en panne, ni le badge « données de HH:MM » ni l'écran neutre ne se
déclenchent : les protections de mode dégradé sont hors-jeu.

**La supervision bascule dans le même mock** et ne peut pas détecter la panne : l'agent qui supprime le
TRAIN 25 et clique « Publier » voit le message « ✓ Publié — les 6 gares sont synchronisées »
(`supervision.ts:2811`) alors que la modification n'est partie que dans le `localStorage` de son propre
navigateur. Les seuls indices, non explicites et contredits par ce message, sont « 0/— écrans en ligne »
et « aucun écran connecté ».

En mode mock, la connexion à la supervision accepte en outre **n'importe quel mot de passe**, le rôle
étant déduit du début de l'adresse e-mail (`mock.ts:527-533`).

**Correctif** — trois verrous, tous petits

1. `deploy.yml:40-42` — transformer le repli en échec dur. Un déploiement de production ne doit jamais
   partir sans configuration :
   ```
   else
     echo "::error::VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY absentes : déploiement refusé."
     exit 1
   fi
   ```
2. `src/data/index.ts` — interdire le mock en production :
   `if (import.meta.env.PROD && !(config?.supabaseUrl && config.supabaseKey)) throw new Error('config.js absent');`
   puis, dans `src/pages/ecran.ts:517` et `src/pages/grille.ts:327`, attraper cette erreur pour appeler
   l'`afficheErreur()` **déjà existant** (`ecran.ts:400-403`) avec un message bilingue « Écran non
   configuré » — c'est-à-dire ne rien afficher plutôt qu'afficher du faux.
3. Si le mode démonstration doit rester accessible en production, le rendre **visible** : bandeau
   permanent « DÉMONSTRATION — horaires non contractuels » sur les écrans, et bandeau rouge « MODE DÉMO
   — rien n'est envoyé aux écrans » dans l'en-tête de supervision.

*Complément : ajouter `'./config.js'` à `PRECACHE` (`public/sw.js:10-22`) pour qu'un démarrage hors
ligne dispose au moins de la dernière configuration connue.*

---

### C-03 — CRITIQUE — L'horloge du Raspberry décide seule de la fraîcheur des données

**Phase 1 et 2 · Coût : 1 journée · Sans attaquant (le plus probable), ou attaquant (b)**

*Quatre constats de trois axes différents décrivent la même racine : toute la protection « mode
dégradé » repose sur une horloge locale à laquelle le serveur, lui, a déjà cessé de faire confiance.*

**Preuve**

- `src/pages/horloge-source.ts:39-42` — `secondesParis()` dérive de `new Date()`, horloge locale.
- `src/pages/resilience.ts:38` (`quand: Date.now()`), `:57` (`derniereSynchroMs = Date.now()`), `:81`
  (`ageMs: () => … Date.now() - derniereSynchroMs`) — la fraîcheur est la différence de **deux lectures
  de la même horloge**, donc structurellement aveugle à la dérive.
- `src/pages/resilience.ts:81` — la soustraction n'est **jamais bornée à zéro** : un âge négatif est
  traité comme un âge très faible, donc comme une donnée fraîche.
- `src/pages/resilience.ts:43-50` — `lit()` fait `JSON.parse(brut) as { quand: number; donnees: T }` :
  aucune validation de l'horodatage relu depuis `localStorage`.
- Conséquences : `src/pages/ecran.ts:433-434` (badge) et `:451` (`mode-neutre`) ; **même défaut sur la
  page grille**, `src/pages/grille.ts:269-270` et `:276`.
- `supabase/schema.sql:326-329` — côté serveur, `trg_signal_de_vie` force `derniere_vue := now()`
  précisément *parce que* l'horloge du Raspberry n'est pas fiable. La défiance existe déjà, mais elle
  s'arrête au signal de vie et ne protège pas l'affichage.
- `docs/kiosque.md:19-20, 96, 101` — NTP vérifié une seule fois à la fabrication de l'image, aucune
  surveillance continue, aucun serveur NTP imposé.
- Règle violée : `docs/01-spec-fonctionnelle.md:544-550` (§7).

**Scénario**

Un Raspberry Pi **n'a pas d'horloge sauvegardée par pile**. Coupure secteur en gare — le cas est
explicitement prévu au Nid d'Aigle, alimenté en solaire (`docs/kiosque.md:96`) — puis redémarrage avec
le réseau encore indisponible : le Pi repart sur `fake-hwclock`, c'est-à-dire approximativement à
l'instant de la coupure.

Chromium recharge la page depuis le service worker, `demarre()` échoue sur le réseau et retombe sur
l'instantané `localStorage` en reprenant `derniereSynchroMs = instantane.quand`. Comme `quand` et
`Date.now()` proviennent de la **même horloge fausse**, `ageMs()` est quasi nul — ou **négatif** si
l'horloge a reculé. Ni le badge « données de HH:MM » (à +2 min), ni l'écran neutre (à +15 min) ne se
déclenchent.

L'écran affiche donc, dans une gare ouverte au public, **la journée d'exploitation de la veille — ses
suppressions, ses retards, ses trains facultatifs — présentée comme fraîche**, avec un compte à rebours
calé sur une heure figée. Exactement ce que la règle « jamais d'horaires potentiellement faux »
interdit. La fenêtre d'exposition vaut (recul d'horloge + 15 min) : de l'ordre de la minute si NTP
revient vite, de l'ordre de l'heure ou davantage s'il ne revient pas.

**Variante attaquant (b)** : bloquer UDP/123 sur le lien intercalé puis couper l'alimentation du Pi. Il
redémarre sur `fake-hwclock` et n'a plus aucun moyen de se recaler. Le décalage devient arbitraire et
permanent.

**La supervision ne le voit pas.** Le point reste vert : il ne dépend que de `derniere_vue`, forcée par
le serveur. Et l'état de fraîcheur affiché reste « à jour » tant qu'aucune publication n'a eu lieu dans
l'onglet ouvert (`supervision.ts:155` → `supervision-logique.ts:203`, `referenceMajMs === null`). Seul
indice résiduel : la sous-ligne « données de HH:MM » (`supervision.ts:1872-1884`), écrite avec l'horloge
dérivée, qu'un superviseur devrait penser à comparer à sa propre heure.

**Correctif**

1. *(10 min — à faire tout de suite)* `src/pages/resilience.ts:81` — un âge négatif doit compter comme
   un âge **inconnu**, jamais comme une donnée fraîche :
   `ageMs: () => (derniereSynchroMs === null ? null : Math.max(0, Date.now() - derniereSynchroMs))`
2. *(30 min)* `src/pages/resilience.ts:43-50` — valider l'instantané relu : rejeter si
   `typeof quand !== 'number'`, si `quand > Date.now() + 60_000` (postdaté) ou si
   `Date.now() - quand > 24 h`.
3. *(½ journée)* Comparer l'horloge locale à une horloge serveur. L'en-tête HTTP `Date` est
   *CORS-safelisted*, donc lisible sans configuration Supabase : dans `synchronise()`, faire un
   `fetch(urlSupabase + '/rest/v1/', {method:'HEAD', cache:'no-store'})`, lire
   `reponse.headers.get('Date')` et exposer `ecartHorlogeMs()`. Dans `src/pages/ecran.ts:427 rendre()`,
   si `Math.abs(ecartHorlogeMs()) > 60_000`, basculer sur l'écran neutre **déjà existant** plutôt que
   d'afficher des horaires.
4. *(½ journée, sur les 6 postes)* Imposer un serveur NTP non négociable côté Pi :
   `sudo timedatectl set-ntp true`, `/etc/systemd/timesyncd.conf` → `NTP=fr.pool.ntp.org`,
   `FallbackNTP=`, et refuser les serveurs NTP fournis par le DHCP de la gare. Documenter dans
   `docs/kiosque.md §1`.

---

### C-04 — CRITIQUE — Poste kiosque non verrouillé : outils de développement, navigation libre, cache empoisonnable

**Phase 1 · Coût : 2 h · Attaquant (b), physiquement devant l'écran**

**Preuve**

- `docs/kiosque.md:39-41` — ligne de lancement Chromium :
  `chromium-browser --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble
  --check-for-update-interval=31536000 --autoplay-policy=no-user-gesture-required`. **Aucun drapeau ne
  restreint les outils de développement, ni la navigation.**
- Aucun fichier de politique Chromium dans le dépôt : recherche `policies|managed|DeveloperTools` — les
  seules occurrences (`docs/02-spec-technique.md:239,245`,
  `docs/03-plan-de-developpement.md:97`) parlent des *policies RLS Postgres*, pas de Chromium.
- `public/sw.js:9` — `const VERSION = 'tmb-v1';`, constante **jamais** dérivée du build (vérifié dans
  `.github/workflows/deploy.yml:32-44` et `vite.config.ts:16-21`).
- `public/sw.js:33-40` — la purge à l'activation est conditionnée à `c !== VERSION` : la version ne
  changeant jamais, **le cache n'est jamais purgé**.
- `public/sw.js:61-68` — `cacheDabord` : `if (trouve) return trouve;`, sans revalidation ni péremption.
- `vite.config.ts:36` — `manualChunks: { supabase: [...] }` : le chunk fournisseur a un nom haché
  **stable d'un déploiement à l'autre**, tant que la dépendance ne change pas.
- `docs/kiosque.md:76-82` — redémarrage quotidien à 04:30 ; `docs/kiosque.md:94-103` — checklist de pose
  sans aucune protection physique du boîtier ni des ports USB.

**Scénario**

Une personne branche un clavier USB sur le Raspberry, dans une gare ouverte au public. Rien ne l'en
empêche : les boîtiers ne sont pas mentionnés comme scellés, les ports USB ne sont pas obturés.

*Effet immédiat* — `Ctrl+L`, `F6` ou `Ctrl+T` donnent accès à la barre d'adresse : l'écran public de la
Régie peut afficher n'importe quelle page web. `F12` ouvre les outils de développement : le contenu
affiché est modifiable à volonté.

*Effet durable — le point réellement grave.* Depuis la console :

```js
caches.open('tmb-v1').then(c => c.put(
  '/tmb-affichage-gares/assets/supabase-<hash>.js',
  new Response('/* code qui fabrique des horaires */', {headers:{'Content-Type':'text/javascript'}})))
```

Le nom haché se lit dans l'onglet Réseau. À partir de là, `cacheDabord` sert **sa** version à chaque
chargement, réseau présent ou non, **y compris après le redémarrage de 04:30**. Le HTML, lui, est bien
rafraîchi (réseau d'abord), mais il continue de référencer ce même nom haché.

La cible durable est le chunk **fournisseur** `supabase-<hash>.js`, figé par `manualChunks` : viser le
chunk applicatif `ecran-<hash>.js` ne survivrait pas à un déploiement qui le modifie (nouveau hachage =
défaut de cache = retour au réseau). Le chunk fournisseur, lui, ne change qu'à une montée de version de
`@supabase/supabase-js`.

Conséquence : **un écran qui affiche des horaires fabriqués, de façon persistante, sans que rien dans la
supervision ne le signale** — le signal de vie continue d'être envoyé normalement. Le seul remède est
une réinstallation ou une purge manuelle du cache sur place.

*Précision honnête : les grilles horaires JSON ne sont pas un vecteur ici — elles sont demandées en
`cache: 'no-store'` (`src/data/supabase.ts:95-97`) et échappent donc au service worker (`sw.js:45`).*

**Correctif**

1. *(30 min — la vraie barrière)* Poser une politique Chromium sur les 6 Pi, et l'ajouter à l'image
   standard et à `docs/kiosque.md §1` :
   ```bash
   sudo mkdir -p /etc/chromium/policies/managed
   printf '{"DeveloperToolsAvailability": 2, "IncognitoModeAvailability": 1,
   "URLBlocklist": ["*"], "URLAllowlist": ["https://<organisation>.github.io/tmb-affichage-gares/"]}' \
     | sudo tee /etc/chromium/policies/managed/tmb.json
   ```
   (`DeveloperToolsAvailability: 2` = outils de développement interdits.) Vérifiable ensuite sur
   l'écran via `chrome://policy`.
2. *(1 h)* Rendre le cache jetable : remplacer `public/sw.js:9` par `const VERSION = '__BUILD_ID__';`,
   substitué au déploiement par `${{ github.sha }}`. Chaque déploiement purge alors intégralement le
   cache — ce qui corrige aussi M-06 et F-12.
3. *(30 min + matériel)* Sceller les boîtiers par un moyen exigeant un outil, obturer les ports USB
   inutilisés, et l'écrire dans la checklist de pose.

---

### E-01 — ÉLEVÉ — Le bouton « Quitter » ne déconnecte pas

**Phase 1 · Coût : 1 h**

**Preuve** — `src/pages/supervision.ts:2835-2848` : le bouton fait `sessionStorage.clear();
window.location.reload();` et **n'appelle jamais le provider**. Or `src/data/provider.ts:47-111` : le
contrat `DataProvider` expose `signIn` mais **aucune méthode de déconnexion**, et
`src/data/supabase.ts:86` crée le client sans options d'authentification — donc avec les valeurs par
défaut `persistSession: true` et un stockage dans **`localStorage`**, que `sessionStorage.clear()` ne
touche pas. Au rechargement (`supervision.ts:2856-2866`), `getProfil()` réussit et `apresConnexion()`
rouvre l'interface complète, sans mot de passe.

**Scénario** — Poste de supervision partagé dans les locaux de la Régie. L'agent A termine son service
et clique « Quitter » ; la page recharge et rouvre aussitôt l'interface complète sur son compte. L'agent
B, ou toute personne ayant accès à ce poste, dispose alors de ses droits d'écriture : passer le TRAIN 25
— dernière descente — au statut « supprimé », modifier un terminus, publier. RLS accepte, puisque le JWT
de A est authentique, et le journal impute l'action à A (`schema.sql:418`). *Nuance : la reconnexion
n'est pas invisible — l'interface réapparaît. Le risque est celui d'un faux sentiment de déconnexion.*

**Correctif** — Ajouter `signOut(): Promise<void>` au contrat (`provider.ts`), l'implémenter dans
`supabase.ts` avec `await this.client.auth.signOut({ scope: 'global' })` — la portée globale révoque
aussi les jetons de rafraîchissement des autres onglets — en vidant `profilCache` **et** `roleCache`
(voir I-10), l'implémenter dans `mock.ts`, puis remplacer `supervision.ts:2846` par
`void provider.signOut().finally(() => { sessionStorage.clear(); window.location.replace('supervision.html'); });`.
Ajouter un test qui échoue si `signOut` disparaît du contrat.

---

### E-02 — ÉLEVÉ — Aucun cycle de vie du mot de passe, et le lien d'invitation ouvre une session sur `ecran.html`

**Phase 1 · Coût : 3 h · ⚠️ à vérifier (dépend des « Redirect URLs » du tableau de bord)**

**Preuve** — `supabase/functions/inviter-utilisateur/index.ts:39` :
`admin.auth.admin.inviteUserByEmail(email)` **sans `redirectTo`**. `src/data/supabase.ts:665` :
`resetPasswordForEmail(email)` **sans `redirectTo`**. `src/data/supabase.ts:86` : client créé sans
options, donc `detectSessionInUrl: true` et `flowType: 'implicit'` par défaut. **Aucune occurrence de
`updateUser`, `setSession`, `verifyOtp` ou `signOut` dans tout `src/`** — vérifié. Et
`src/pages/supervision.ts:2634-2635` affiche « Réinitialisation du mot de passe envoyée ».

**Scénario** — *(1)* Un agent invité ne peut poser **aucun mot de passe** : aucune page n'appelle
`updateUser`. Son compte n'est utilisable que par le lien e-mail, indéfiniment ; quiconque atteint sa
boîte entre dans la supervision. Pire, l'administrateur qui clique « Réinitialiser le mot de passe »
reçoit une confirmation alors qu'**aucun mot de passe n'est réinitialisé** : il croit avoir révoqué un
accès compromis qui reste valable. *(2)* `detectSessionInUrl: true` est actif sur **toutes** les pages,
`ecran.html` et `grille.html` comprises, alors qu'elles ne se connectent jamais. Un lien de
récupération ouvert par erreur sur un écran de gare y installerait une session persistante dans le
`localStorage` du Raspberry.

**Correctif** — Ajouter une page `mot-de-passe.html` appelant `client.auth.updateUser({ password })`, et
passer explicitement `redirectTo` à `resetPasswordForEmail` (`supabase.ts:665`) et à
`inviteUserByEmail` (`inviter-utilisateur/index.ts:39`). Créer le client des pages d'affichage avec
`{ auth: { detectSessionInUrl: false, persistSession: false, autoRefreshToken: false } }` : ces pages
ne se connectent jamais, elles n'ont aucune raison de capter un jeton. Restreindre les « Redirect URLs »
côté tableau de bord (§8).

---

### E-03 — ÉLEVÉ — Échec dur au démarrage : tableau des départs **vide** au lieu de l'écran neutre

**Phase 1 et 2 · Coût : 1 h**

**Preuve** — `src/pages/ecran.ts:596` : `void demarre();` — **sans `.catch()`** ; idem
`src/pages/grille.ts:390`. Le premier rendu est séquestré derrière un `await sync.demarre()`
(`ecran.ts:552`) qui n'est pas borné dans le temps, et la boucle de rendu périodique n'est armée
qu'**après** (`ecran.ts:590-593`).

**Scénario** — Si une erreur survient avant l'armement de la boucle — `getGrilles()` qui rejette sur un
JSON malformé, une exception dans `applique()`, une promesse qui ne se résout jamais faute de délai
d'attente —, `demarre()` ne rend jamais la main. La boucle de rendu n'est jamais armée, `afficheErreur()`
n'est jamais appelée, et **l'écran neutre prévu par la spécification ne s'affiche pas** : le poste reste
sur la coquille HTML, tableau des départs vide, horloge figée. En gare, un tableau vide se lit comme
« plus aucun train aujourd'hui » — ce qui est une information fausse, pas une absence d'information.

**Correctif** — Armer la boucle de rendu et l'horloge **avant** le premier `await`, borner
`sync.demarre()` par un délai d'attente (`Promise.race` avec un `setTimeout` de 10 s), et ajouter
`.catch((e) => afficheErreur('Écran indisponible / Screen unavailable', …))` sur `void demarre()` dans
les deux pages.

---

### E-04 — ÉLEVÉ — `?simule=HH:MM` ne laisse aucune trace visible

**Phase 1 et 2 · Coût : 1 h**

**Preuve** — `src/pages/horloge-source.ts:14` déclare `simulee: boolean`, `:52` le passe à `true`, `:55`
le retourne — **et aucune page ne le lit** : recherche de `simulee` dans `src/pages/*.ts` hors
`horloge-source.ts`, aucun résultat. `:56-57` : `maintenantS()` **et** `maintenantMs()` sont tous deux
décalés. Le paramètre est lu en `src/pages/ecran.ts:94` et `src/pages/grille.ts:65`.

**Scénario** — Le drapeau existe, il est correctement calculé, et personne ne s'en sert. Un écran lancé
avec `?simule=14:00` affiche donc un tableau des départs parfaitement crédible mais **décalé**, sans
aucune marque. Deux chemins réalistes : *(a)* une URL de test laissée par erreur dans
`/home/tmb/kiosque.sh` après un dépannage — le script est écrit une fois, à la pose, et n'est plus
relu ; *(b)* attaquant (b), qui modifie l'URL au clavier USB (voir C-04). Comme `maintenantMs()` est
décalé aussi, le calcul de fraîcheur suit et l'écran ne bascule jamais en mode dégradé.

**Correctif** — Consommer le drapeau déjà disponible : dans `ecran.ts` et `grille.ts`, si
`heure.simulee`, afficher un bandeau permanent et non masquable « HEURE SIMULÉE — AFFICHAGE DE TEST /
SIMULATED TIME — TEST DISPLAY ». Complémentairement, n'accepter `?simule=`, `?cache=` et `?terminus=`
que hors production (`import.meta.env.DEV`), et vérifier les URL réellement lancées sur les 6 postes (§8).

---

### E-05 — ÉLEVÉ — SSH avec un mot de passe unique partagé par les 6 Pi

**Phase 1 et 2 · Coût : 2 h · ⚠️ à vérifier · Attaquants (b) et (d)**

**Preuve** — `docs/kiosque.md:10-11`, vérifié mot pour mot : « nom d'hôte `tmb-ecran`, utilisateur `tmb`
+ mot de passe de la Régie, Wi-Fi si besoin, **SSH activé** ». `docs/kiosque.md:88` : « Flasher une
carte SD depuis l'image standard » — donc le même mot de passe sur les 6 postes. Le document ne
mentionne ni authentification par clé, ni rotation, ni `PasswordAuthentication no`, ni désactivation du
`sudo` sans mot de passe (`NOPASSWD`, qui est le défaut de Raspberry Pi Imager).

**Scénario** — Attaquant (d), ancien agent : le mot de passe qu'il connaissait reste valable sur les six
postes après son départ, et rien dans la procédure ne prévoit de le changer. Attaquant (b) : depuis le
réseau de la gare, il peut tenter ce compte en SSH. Dans les deux cas, l'accès obtenu est un shell
`sudo` sans mot de passe : l'URL lancée par `kiosque.sh` est modifiable (voir E-04), et le contenu
affiché avec elle.

**Correctif** — Passer à l'authentification par clé (`PasswordAuthentication no`,
`PermitRootLogin no`), un mot de passe **distinct par poste** conservé au coffre, retirer
`/etc/sudoers.d/010-tmb-nopasswd`, et lier la rotation au départ d'un agent dans la procédure
d'exploitation. À défaut d'accès distant réel, désactiver SSH sur les postes qui ne s'en servent pas.

---

### E-06 — ÉLEVÉ — Phase 2 : SQLite n'a pas de RLS, toute l'autorisation est à réécrire

**Phase 2 · Coût : 2 à 3 jours maintenant — contre ~3 semaines après coup, sans jamais la certitude d'être exhaustif**

**Preuve** — `supabase/schema.sql:195-297` : **20 politiques déclaratives** portent aujourd'hui
l'intégralité du modèle de droits, adossées à `private.role_courant()` (`schema.sql:153-160`). Ce n'est
pas du code applicatif : c'est la base qui refuse. `docs/02-spec-technique.md:407` prévoit
`Node.js LTS + Fastify + better-sqlite3` — **SQLite n'a aucun équivalent de RLS**.

**Scénario** — Ce n'est pas une faille présente, c'est le risque n°1 de la phase 2. Chacune des routes
miroir du `DataProvider` devra reproduire à la main un contrôle que Postgres appliquait
inconditionnellement, y compris aux corrections faites directement en SQL. **Une seule route oubliée et
un agent de caisse écrit un horaire** — l'enjeu n°1, atteint par omission plutôt que par attaque. Le
risque n'est pas hypothétique : la phase 1 elle-même montre que le modèle est subtil (deux politiques
permissives qui se cumulent en OU sur `params`, `for all` qui inclut le DELETE, `caisse` autorisé sur
deux clés seulement).

**Décision à prendre avant la première ligne du serveur** — Une **couche d'autorisation unique**
traversée par toutes les routes (une table `route × rôle` déclarative, un hook Fastify `preHandler`
appliqué globalement, et un garde au démarrage qui **refuse de démarrer** si une route déclarée n'a pas
d'entrée d'autorisation), plus un **générateur de tests** produisant automatiquement un cas par route et
par rôle. Écrite d'abord, cette couche coûte 2 à 3 jours ; ajoutée après coup, c'est une relecture ligne
à ligne de plusieurs semaines, et le risque résiduel reste entier tant que le test par route et par rôle
n'existe pas.

---

### E-07 — ÉLEVÉ — Phase 2 : perte de la base SQLite = les trains supprimés réapparaissent

**Phase 2 · Coût : 1 journée maintenant**

**Preuve** — `docs/02-spec-technique.md:413-415` : « sauvegarde quotidienne SQLite + médias » est la
**seule** mention. Aucune méthode, aucune procédure de restauration, aucun objectif de reprise.
`docs/03-plan-de-developpement.md:193` reprend la même formule sans la préciser.

**Scénario** — La base SQLite contiendra l'**état d'exploitation** : suppressions, retards, motifs,
terminus, facultatifs activés, trains supplémentaires. Les grilles JSON, elles, ne contiennent que la
grille **théorique**. Si la base est perdue ou corrompue — disque défaillant, ou copie du fichier à
chaud pendant une écriture, ce qui corrompt une base SQLite — et que le service redémarre sur une base
reconstruite, les écrans repartent de la grille théorique : **les trains supprimés réapparaissent comme
circulants**. C'est exactement le pire scénario du cahier des charges, et il survient sans aucun
attaquant, un matin de saison.

**Décisions à prendre maintenant** — Sauvegarde par `VACUUM INTO` ou l'API de sauvegarde en ligne
(**jamais** une copie de fichier à chaud) ; fréquence horaire en saison, pas quotidienne ; destination
**hors de la tour** (partage réseau ou NAS) ; mode WAL ; et surtout **une restauration réellement testée
et chronométrée** avant la mise en service. Fixer avec l'exploitant l'objectif de reprise (proposition :
repartir en moins de 30 min, avec au plus 1 h de données d'exploitation perdues).

---

## 5. Constats MOYENS

#### M-01 — Le signal de vie anonyme peut mentir dans le sens « tout va bien » — la justification écrite affirme l'inverse *(recoupe 1 constat(s) du même défaut trouvés par d'autres axes)*
**Gravité** MOYEN · **Phase** 1 · **Coût** 10 min + 1 journée

**Preuve** — supabase/schema.sql:257-258 — `grant update (derniere_vue, donnees_maj, date_affichee, version_app, reseau) on ecrans to anon;` (vérifié) supabase/schema.sql:288-289 — `create policy "signal de vie" on ecrans for update to anon using (true) with check (true);` : aucun filtre de ligne (vérifié) supabase/schema.sql:202 — `create policy "lecture publique" on ecrans for select using (true);` : AJOUT — un anonyme énumère les identifiants des 6 écrans avant de les viser supabase/schema.sql:312-314 (= migrations/2026-08-signal-de-vie-serveur.sql:24-26) — `if new.derniere_vue is distinct from old.derniere_vue then new.derniere_vue := now(); end if;` : toute écriture d'un tiers est horodatée à…

**Scénario** — Scénario tenu, avec deux corrections de fond. 1) La requête annoncée `PATCH /rest/v1/ecrans?id=neq.` est incomplète (PostgREST exige une valeur de filtre, et refuse un UPDATE sans filtre). Formes réellement exécutables : `PATCH /rest/v1/ecrans?id=neq.aucun` (le filtre matche les 6 lignes), ou plus simplement `GET /rest/v1/ecrans?select=id` — autorisé par schema.sql:202 — puis un PATCH par identifiant. Corps `{"derniere_vue":"<n'importe quoi>","donnees_maj":"<now ISO>"}` : le déclencheur réécrit `derniere_vue := now()` et laisse `donnees_maj = now()` intact. Les 6 lignes passent en `a-jour`. 2) Portée réelle du dommage, à ne pas surestimer : l'attaquant ne modifie AUCUN horaire. Il ne peut écrire que sur `ecrans`, et seulement 5 colonnes ; `jours`, `circulations`, `messages` et `params` ne sont ouverts qu'en lecture à anon. L'horaire faux…

**Correctif** — Le vrai manque est l'IDENTITÉ par écran : aucun déclencheur ne peut distinguer un Raspberry légitime d'un tiers tant que l'écriture est anonyme. 1) Immédiat (10 min) — corriger schema.sql:282-285 et migrations/2026-08-signal-de-vie-serveur.sql:27-31 : le texte affirme une garantie que le code ne donne pas. Tant que la correction complète n'est pas faite, « Appliqué sur N/N » ne doit pas être présenté à l'exploitant comme une preuve. 2) Correction réelle (1 journée), applicable dès la phase 1 : provisionner un compte Supabase Auth PAR ÉCRAN (identifiants sur la carte SD du Pi), ajouter `ecrans.user_id uuid`, puis : ```sql revoke update on…

#### M-02 — Un média illisible masque les horaires en plein écran, et le service worker fige l'échec définitivement
**Gravité** MOYEN · **Phase** 1 et 2 · **Coût** 1 h

**Preuve** — src/pages/ecran.ts:354-357 (injection sans gestionnaire `error` ; seul `ended` est écouté, lignes 360-362 ; préchargement empoisonnant ligne 364) — src/styles/ecran.css:687-699 (`.media-plein` fixed/inset:0/#000/z-index:45 ; `body.mode-media .media-plein { display: flex }` ligne 697) — public/sw.js:9 (`VERSION = 'tmb-v1'` figée), 47-52 (routage cross-origin image/video vers cacheDabord), 61-68 (cache-first, `if (reponse.ok || reponse.type === 'opaque') cache.put(...)` ligne 66, sans revalidation ni péremption) — src/pages/resilience.ts:91-92 (SW actif en PROD). Éléments atténuants vérifiés : src/core/cycle-medias.ts:38-41 et 62-71 et 87 (cycle piloté par le temps, priorité absolue au départ…

**Scénario** — Aléa d'exploitation, sans attaquant. Un média est ajouté ; au premier chargement sur un écran (Nid d'Aigle en 5G, ou réseau chargé), Supabase Storage renvoie un 502 transitoire — ou le fichier a été supprimé à la main depuis le tableau de bord Storage alors que la ligne `medias` subsiste (la suppression par l'application, elle, retire les deux : src/data/supabase.ts:566-569). La requête étant `no-cors`, la réponse est opaque : son statut est illisible, et sw.js:66 l'écrit dans le cache `tmb-v1`. Le cache étant cache-first sans péremption ni revalidation (sw.js:63-64) et `VERSION` étant figée (sw.js:9), l'échec est rejoué à chaque tour, indéfiniment. Conséquence réelle, bornée : à chaque passage du cycle sur ce média, l'écran affiche un rectangle noir plein écran pendant `duree_s` (3 à 120 s, défaut 8 s), puis revient AUTOMATIQUEMENT aux…

**Correctif** — 1) Dans src/pages/ecran.ts rendMedia(), attacher un gestionnaire d'échec qui rend la main immédiatement au lieu de laisser le noir : `const el = conteneur.firstElementChild as HTMLImageElement | HTMLVideoElement; el?.addEventListener('error', () => { if (etatCycle) etatCycle = { ...etatCycle, finMs: heure.maintenantMs() }; });` (même mécanique que l'écouteur `ended` déjà présent ligne 360-362). 2) Ajouter `crossorigin="anonymous"` aux balises `<img>`/`<video>` (Supabase Storage renvoie `Access-Control-Allow-Origin: *` sur les objets publics) : la réponse cesse d'être opaque, son statut devient lisible, et le service worker peut alors refuser…

#### M-03 — Cast aveugle de params : une valeur non numérique en base désactive silencieusement l'écran neutre — horaires périmés affichés indéfiniment *(recoupe 1 constat(s) du même défaut trouvés par d'autres axes)*
**Gravité** MOYEN · **Phase** 1 et 2 · **Coût** 1 h (validation + ceinture front + contrainte + test de non-régression)

**Preuve** — src/data/supabase.ts:257-262 (casts nus, exacts tels que cités) ; conséquence en src/pages/ecran.ts:146-150 (`dureeCacheMs`) consommée en src/pages/ecran.ts:434 (`degrade`) et src/pages/ecran.ts:451 (`neutre`) — et NON 443-455 comme annoncé, la ligne 443 étant la veille nuit ; doublon en src/pages/grille.ts:101-104 et src/pages/grille.ts:270 / 276. Absence de contrainte : supabase/schema.sql:103-107 (`valeur jsonb not null`, aucun CHECK). Écriture réservée à l'admin : supabase/schema.sql:227-236 (policy `"affichage tous roles"`, bornée à `meteo_sommet`/`vitesse_ticker_px_s`) et supabase/schema.sql:237-238 (policy `"params admin"`). Absence de péremption du snapshot confirmée en…

**Scénario** — Scénario corrigé (le scénario annoncé surestime la facilité de déclenchement). Le mécanisme : `duree_cache_min` n'est écrit nulle part par l'application — aucun champ de la supervision ne l'expose, seul `seed.sql:27` la pose à `15`. Pour la corrompre il faut une intervention manuelle d'un compte ADMIN (policy `"params admin"`, schema.sql:237-238 ; la caisse et la supervision sont bloquées par la policy de la ligne 227). Contrairement à ce qu'annonce l'auditeur, la maladresse naïve échoue : `'15 min'::jsonb` est refusé par Postgres, et une chaîne numérique comme `"15"` continue de fonctionner (`"15" * 60_000 = 900000`). Il faut poser délibérément un JSON valide et non numérique — `"quinze"`, `"15 min"` (avec guillemets), `{}`. Alors, et seulement alors, `dureeCacheMs()` rend NaN : `age > NaN` et `age <= NaN` étant tous deux faux, ni le…

**Correctif** — Valider au SEUL point d'entrée des données, src/data/supabase.ts (getParams) : ```ts const nombre = (v: unknown, defaut: number): number => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) && n > 0 ? n : defaut; }; // ... duree_horaires_s: nombre(valeurs.get('duree_horaires_s'), 20), duree_cache_min: nombre(valeurs.get('duree_cache_min'), 15), a_quai_origine_s: nombre(valeurs.get('a_quai_origine_s'), A_QUAI_ORIGINE_DEFAUT_S), ``` Et une ceinture côté écran (ecran.ts:148, grille.ts idem), car un provider de phase 2 refera l'erreur : ```ts const brut = surcharge > 0 ? surcharge : Number(params?.duree_cache_min);…

#### M-04 — config.js est généré sans échappement JavaScript : une variable de dépôt contenant un guillemet injecte du code sur tous les écrans *(recoupe 1 constat(s) du même défaut trouvés par d'autres axes)*
**Gravité** MOYEN · **Phase** 1 · **Coût** 20 min

**Preuve** — .github/workflows/deploy.yml:38 (printf non échappé, exact) ; deploy.yml:33-35 (bloc env:, exact) ; deploy.yml:31 (npm test s'exécute AVANT la génération, donc ne couvre pas config.js) ; ecran.html:56, grille.html:54, supervision.html:536 (script classique `./config.js` avant le module, exact) ; src/data/index.ts:15-19 (`const config = window.TMB_CONFIG; if (config?.supabaseUrl && config.supabaseKey) … return new MockProvider(optionsMock);` — repli mock silencieux si config.js ne parse pas) ; src/data/mock.ts:1-7 (la démo mock contient retard +10 min TRAIN 11 et descente 16 supprimée) ; vite.config.ts (aucun traitement de public/, recopie verbatim).

**Scénario** — Scénario 1 (attaque, RETENU MAIS DÉCLASSÉ) : l'injection JS est techniquement réelle — une variable contenant un `"` sort du littéral et exécute du code sur les 6 kiosques et sur supervision.html. Mais elle exige le rôle admin du dépôt, qui donne déjà `contents: write` et donc l'injection par simple commit sur main (workflow déclenché sur push main, aucun CODEOWNERS, un seul auteur sur 33 commits, aucune revue). Aucun des attaquants a/b/c/d/e ne peut modifier une variable Actions. Seule escalade réelle, non démontrée ici : un jeton fine-grained portant `variables: write` sans `contents: write`. Scénario 2 (accident, LE VRAI RISQUE — à substituer) : lors de la configuration du dépôt, la valeur de `VITE_SUPABASE_URL` ou `VITE_SUPABASE_PUBLISHABLE_KEY` est collée avec un guillemet ou un retour à la ligne (les variables Actions acceptent le…

**Correctif** — Encoder en JSON au lieu de concaténer, et valider le format avant écriture. Dans deploy.yml, remplacer le `printf` par : ``` case "$SUPABASE_URL" in https://*.supabase.co) ;; *) echo "::error::URL Supabase invalide"; exit 1;; esac case "$SUPABASE_KEY" in sb_publishable_*) ;; *) echo "::error::clé publishable invalide"; exit 1;; esac jq -n --arg u "$SUPABASE_URL" --arg k "$SUPABASE_KEY" \ '"window.TMB_CONFIG = " + ({supabaseUrl:$u, supabaseKey:$k}|tostring) + ";"' -r > public/config.js ``` (`jq` est présent sur les runners `ubuntu-latest`). Les deux `case` bloquent aussi, au passage, une clé `sb_secret_…` collée par erreur dans la variable…

#### M-05 — `permissions:` déclaré au niveau du workflow : le job `build`, qui exécute du code tiers, reçoit `pages: write` et `id-token: write`
**Gravité** MOYEN · **Phase** 1 · **Coût** 10 min

**Preuve** — .github/workflows/deploy.yml:12-15 (bloc `permissions:` en colonne 0, niveau workflow) ; .github/workflows/deploy.yml:22-23 et 49-51 (aucun bloc `permissions:` propre aux jobs `build` et `deploy` : ils héritent donc tous deux des trois permissions racine) ; .github/workflows/deploy.yml:30-31 (`- run: npm ci` / `- run: npm test`) ; .github/workflows/deploy.yml:45-47 (`actions/upload-pages-artifact@v3` / `path: dist`) ; .github/workflows/deploy.yml:52-54 (`environment: github-pages` présent UNIQUEMENT sur le job `deploy`) ; package-lock.json:1228 (`"hasInstallScript": true` sur esbuild 0.28.2) ; package.json:29-31 (bloc `allowScripts` inerte : aucun outil `@lavamoat/allow-scripts` installé,…

**Scénario** — Manquement au moindre privilège dans la chaîne d'intégration, à corriger, mais dont l'apport propre est un durcissement en défense en profondeur — PAS la cause du risque d'horaire faux. Pré-condition (hors modèles a–e, à assumer comme telle) : compromission en amont d'un des 105 paquets `dev` du lockfile. Son script d'installation s'exécute pendant `npm ci` (deploy.yml:30), sans `--ignore-scripts` ni allow-scripts effectif. À partir de là, deux voies, d'inégale valeur : VOIE (i), la seule pleinement démontrée — le code malveillant écrit des fichiers arbitraires dans `dist/` avant l'étape 45, qui les empaquette et les publie tels quels sur les 6 écrans ; l'attaquant contrôle alors le HTML/JS servi et peut afficher les horaires qu'il veut. Cette voie fonctionne INDÉPENDAMMENT du bloc `permissions:` et relève du constat « épinglage SHA +…

**Correctif** — Supprimer le bloc racine (lignes 12-15) et redescendre les permissions par job : ```yaml jobs: build: runs-on: ubuntu-latest permissions: contents: read steps: ... deploy: needs: build runs-on: ubuntu-latest permissions: pages: write id-token: write environment: ... ``` Après ce changement, une compromission du job `build` ne donne plus de jeton capable de déployer ; il reste la voie (i) via `dist`, traitée par l'épinglage SHA et `--ignore-scripts`.

#### M-06 — Le service worker met en cache DÉFINITIVEMENT les réponses opaques, erreurs comprises, sans version ni expiration *(recoupe 1 constat(s) du même défaut trouvés par d'autres axes)*
**Gravité** MOYEN · **Phase** 1 · **Coût** 1 h · ⚠️ **à vérifier** (non tranchable depuis le code seul)

**Preuve** — public/sw.js:66 (exact) ; public/sw.js:47-51 (au lieu de 50-53) ; public/sw.js:9 et 33-38 (exacts) ; src/pages/ecran.ts:356-357 (balises sans `crossorigin`) ; src/pages/resilience.ts:91-92 (SW enregistré en PROD) ; src/data/supabase.ts:333-334 (le rechargement à distance ne vide pas le cache) ; RÉFUTATION du scénario annoncé : supabase/schema.sql:570-577 (bucket `medias` créé `public = true`, l'URL publique ne traverse pas RLS) et src/data/supabase.ts:544-547 (upload vérifié avant insertion de la ligne).

**Scénario** — Le déclencheur n'est PAS une policy RLS manquante (impossible : bucket public, schema.sql:570-577) ni un objet absent (impossible : upload vérifié avant insert, supabase.ts:544-547), mais une simple ERREUR HTTP TRANSITOIRE. Un écran affiche pour la première fois un média récemment publié ; à cet instant précis Supabase Storage renvoie un 429 (rate-limit / quota d'egress du plan gratuit) ou un 5xx. La requête, partie en `no-cors` faute d'attribut `crossorigin` sur la balise (ecran.ts:356-357), produit une réponse opaque de status 0 que sw.js:66 juge cachable. Le service revient à la normale une minute plus tard, mais ce Raspberry-là est le seul des six à servir indéfiniment le corps d'erreur : `cacheDabord` (sw.js:61-64) répond depuis le cache avant tout réseau, `VERSION` ne change jamais (sw.js:9) donc `activate` ne purge rien…

**Correctif** — 1) Ne mettre en cache que les succès : ```js if (reponse.ok) cache.put(requete, reponse.clone()); ``` et demander explicitement le CORS pour les médias Supabase (le bucket public renvoie `Access-Control-Allow-Origin: *`), en ajoutant `crossorigin="anonymous"` aux balises `<img>`/`<video>` produites par `rendMedia` dans src/pages/ecran.ts : la réponse devient alors `type: 'cors'` avec un vrai `status`, et les erreurs cessent d'être cachables. 2) Versionner le cache et le purger. Injecter la version au build plutôt que la figer : ```js const VERSION = 'tmb-' + (self.__VERSION_BUILD__ || 'dev'); ``` ou, sans outillage supplémentaire, remonter…

#### M-07 — Aucun contrôle d'intégrité des grilles horaires officielles : une modification d'un horaire passe la CI si elle n'est pas dans les rares heures ancrées par les tests
**Gravité** MOYEN · **Phase** 1 et 2 · **Coût** 1 h

**Preuve** — .github/workflows/deploy.yml:30-31 (`npm ci`, `npm test`) et :43-47 (`npm run build`, upload de `dist`) — seules barrières avant publication, aucune vérification d'empreinte des grilles. `git ls-files | grep -iE 'sha|sum|checksum|integrit|hash'` : aucun résultat. .prettierignore:11-12 (`# Horaires OFFICIELS : ne jamais reformater ni modifier à la main` / `public/grilles/`) — commentaire, pas contrôle. Aucune validation à l'exécution : src/data/supabase.ts:99 et src/data/mock.ts:379 font `return (await reponse.json()) as Grille` (cast effacé à la compilation). Seul ancrage horaire réel cité : src/core/horaires.test.ts:344-345 (`expect(fin?.premierDepart_s).toBe(h('07:00:00'))` /…

**Scénario** — Scénario recentré sur ce qui est réellement démontrable. Cas principal (erreur humaine ou outil, non malveillant) : la grille est régénérée depuis l'Excel de la Régie, ou retouchée à la main malgré l'interdiction de CLAUDE.md, et une heure part de travers — par exemple le départ du TRAIN 26 au Nid d'Aigle (public/grilles/2026-ete-grand-service.json:912, « 17:13:30 »), dernière descente de la journée. Vérifié : aucun des 85 tests n'ancre cette valeur, `npm test` et `tsc` passent, le déploiement est vert, les 6 écrans et grille.html affichent l'heure fausse, et aucune alerte n'est levée. Un voyageur se présente au Nid d'Aigle après le dernier départ réel : c'est le pire scénario du cahier des charges. C'est ce cas-là qui justifie le constat. Cas malveillant (à requalifier, pas à retenir tel quel) : l'attaquant (d) disposant encore d'un…

**Correctif** — Poser une empreinte de référence et la vérifier avant chaque publication. 1) Créer une fois le fichier de référence, hors CI : ```bash cd C:/Dev/tmb-affichage-gares sha256sum public/grilles/*.json > public/grilles/SHA256SUMS git add public/grilles/SHA256SUMS && git commit -m "Empreintes des grilles officielles" ``` 2) Ajouter l'étape dans .github/workflows/deploy.yml, entre les lignes 31 et 32 : ```yaml - name: Intégrité des grilles horaires officielles run: | cd public/grilles && sha256sum -c SHA256SUMS ``` Toute modification d'un horaire fait alors échouer le déploiement, et sa validation devient un acte explicite (régénérer SHA256SUMS…

#### M-08 — L'identifiant de gare vit sur la partition FAT de démarrage, et rien dans la procédure de pose ne protège physiquement le boîtier ni les ports USB
**Gravité** MOYEN · **Phase** 1 et 2 · **Coût** 30 min (doc) + coût matériel des bouchons/vis

**Preuve** — docs/kiosque.md:24-26 (gare.txt sur /boot/firmware, « seul élément qui change d'un Pi à l'autre ») ; docs/kiosque.md:34 (`GARE=$(tr -d ' \r\n' < /boot/firmware/gare.txt)`) ; docs/kiosque.md:88-89 (échange standard : flasher la SD, écrire gare.txt à la main) ; docs/kiosque.md:96-103 (checklist de pose complète, sans aucune ligne de sécurité physique) ; absence confirmée dans tout le dépôt par grep (docs/, supabase/, README.md) et par docs/02-spec-technique.md:398-403 (section Poste écran Raspberry Pi, muette sur le sujet). Garde-fou applicatif existant mais inopérant ici : src/pages/ecran.ts:502 (allowlist ORDRE_GARES — `bellevue` est valide). Auto-étiquetage atténuant :…

**Scénario** — Modèle (b), sous la prémisse — NON établie par le dépôt — que le Raspberry soit physiquement atteignable en gare. Quiconque ouvre le boîtier et retire la carte SD tient le poste entier, pas seulement gare.txt : la partition FAT /boot/firmware est modifiable sur n'importe quel PC sans mot de passe, et de là on obtient la racine du système (le dépôt ne le prouve pas — c'est une propriété connue de Raspberry Pi OS). Deux niveaux d'impact, très inégaux. Niveau bas, celui décrit par le constat et intégralement vérifié : remplacer `saint-gervais` par `bellevue` dans gare.txt. L'écran de Saint-Gervais sert alors les horaires de Bellevue — mais il l'ANNONCE : src/pages/ecran.ts:543-547 écrit « Bellevue » en en-tête, le titre de page, et « Altitude 1 801 m ». L'incohérence est visible à 2 m. Et src/pages/ecran.ts:102 recalcule l'identifiant du…

**Correctif** — Deux volets, aucun ne relevant du code. (1) Ajouter à la checklist docs/kiosque.md §6 deux lignes contraignantes : « [ ] Boîtier fermé par vis inviolable ou cadenas, carte SD inaccessible sans outil » et « [ ] Ports USB non utilisés obturés (bouchons ou colle époxy), clavier/souris jamais laissés branchés ». (2) Faire de la divergence une alerte et non une simple absence : la supervision sait déjà qu'un écran est hors ligne (src/pages/supervision-logique.ts:162 `SEUIL_HORS_LIGNE_MS`) — ajouter à la procédure d'exploitation la consigne qu'un écran hors ligne plus de 10 min pendant le service déclenche un déplacement en gare.

#### M-09 — Aucune mise à jour de sécurité du système après la fabrication de l'image
**Gravité** MOYEN · **Phase** 1 et 2 · **Coût** 1 h (doc + refabrication de l'image)

**Preuve** — docs/kiosque.md:15 `sudo apt update && sudo apt full-upgrade -y`, placé sous le titre docs/kiosque.md:7 « ## 1. Préparer la carte SD (une fois, image standard) » — exécuté une seule fois, à la fabrication de l'image. docs/kiosque.md:78-81 ne programme qu'un redémarrage (`30 4 * * * /sbin/reboot`) et docs/kiosque.md:84 en précise le but : « (Recharge l'application — mises à jour déployées — et purge la mémoire.) », soit les mises à jour de l'APPLICATION. docs/kiosque.md:88 fait repartir chaque échange standard de l'image figée « conservée au dépôt ». Grep vérifié sur l'ensemble de docs/ : `unattended-upgrades|apt-get upgrade|apt upgrade|full-upgrade|apt update` ne renvoie que…

**Scénario** — Modèles (b) et (e). Le Pi est figé à la date de fabrication de l'image (docs/kiosque.md:7 et :88) et accumule les failles publiées de sa pile logicielle sur toute sa durée de vie. SSH est exposé (docs/kiosque.md:11) avec un mot de passe partagé entre tous les postes, sans clé, sans fail2ban ni filtrage. Une personne ayant accès au câble RJ45 de la gare — les gares sont ouvertes au public — exploite une vulnérabilité OpenSSH ou réseau publiée après l'imagerie, ou force le mot de passe commun (aucun mécanisme de limitation n'est documenté), et obtient l'exécution de code sur le poste. Conséquences : contrôle total de ce qui est peint sur l'écran voyageurs, donc affichage d'horaires faux ou écran éteint (enjeux n°1 et n°2), et point d'appui sur le réseau de la gare — aggravé en phase 2 où les gares sont fibrées en direct vers la tour…

**Correctif** — Ajouter à docs/kiosque.md §1, après la ligne 17 : `sudo apt install -y unattended-upgrades` puis `sudo dpkg-reconfigure -plow unattended-upgrades`, et créer `/etc/apt/apt.conf.d/52tmb` contenant `Unattended-Upgrade::Automatic-Reboot "false";` et `Unattended-Upgrade::Automatic-Reboot-WithUsers "false";` — les correctifs s'installent, le reboot de 04:30 (docs/kiosque.md:81) les active. Ajouter une consigne d'exploitation : refabriquer l'image standard tous les 6 mois, sinon le stock de cartes de rechange se périme.

#### M-10 — Aucun chien de garde : `Restart=always` ne relève pas un Chromium vivant mais figé
**Gravité** MOYEN · **Phase** 1 et 2 · **Coût** 2 h · ⚠️ **à vérifier** (non tranchable depuis le code seul)

**Preuve** — docs/kiosque.md:54-63 (bloc [Service] : Restart=always / RestartSec=5, ExecStart=/usr/bin/startx) ; docs/kiosque.md:39 (--noerrdialogs) ; docs/kiosque.md:79-81 (reboot 04:30) ; absence de chien de garde confirmée par `grep -rn -i "watchdog|chien de garde"` sans résultat sur tout le dépôt ; absence d'auto-guérison applicative : src/pages/ecran.ts:501-593 (aucun window.onerror ni rechargement périodique) et src/pages/resilience.ts:28-110 ; rechargement distant inopérant si la boucle est gelée : src/data/supabase.ts:333-334 ; détection passive : src/pages/affichage-commun.ts:126 et src/pages/supervision-logique.ts:162 (150 s) ; média vidéo : src/pages/ecran.ts:355-356.

**Scénario** — Sans attaquant. En cours de journée, le processus de RENDU de Chromium meurt (mémoire épuisée après plusieurs heures, décodage d'un média vidéo servi depuis Supabase Storage, src/pages/ecran.ts:355-356) ou X se fige. Le processus navigateur lancé par kiosque.sh reste vivant, donc `startx` ne se termine pas et `Restart=always` (docs/kiosque.md:59) ne relance RIEN. Résultat le plus probable : écran de gare MORT pour la journée — page d'erreur Chromium neutralisée visuellement par --noerrdialogs (docs/kiosque.md:39), ou dernière image gelée. Le repli « écran neutre » qui doit empêcher tout horaire périmé (src/pages/ecran.ts:434-455) ne s'exécute pas, puisqu'il vit dans la même boucle de 1 s qui est gelée (src/pages/ecran.ts:590-593) ; l'horloge et les compteurs restent figés, ce qui rend l'écran visiblement anormal plutôt que faussement…

**Correctif** — Deux lignes. (1) Chien de garde matériel du Raspberry : `echo 'RuntimeWatchdogSec=15' | sudo tee -a /etc/systemd/system.conf` + `dtparam=watchdog=on` dans /boot/firmware/config.txt — un noyau bloqué redémarre le Pi tout seul. (2) Chien de garde applicatif, pour le cas « processus vivant, page morte » : un timer systemd toutes les 2 min qui lit un fichier d'activité écrit par la page. Concrètement, le plus simple sans serveur local est de s'appuyer sur ce qui existe déjà — l'échec du signal de vie est déjà journalisé (src/pages/affichage-commun.ts:139) : ajouter dans docs/kiosque.md §6 une ligne de checklist « [ ] Alerte supervision : un…

#### M-11 — Mise en pause du projet Supabase gratuit hors saison : 6 écrans neutres le jour de la reprise, rien dans le dépôt ne l'anticipe
**Gravité** MOYEN · **Phase** 1 · **Coût** 1 h · ⚠️ **à vérifier** (non tranchable depuis le code seul)

**Preuve** — .github/workflows/ ne contient qu'un fichier, deploy.yml:6-9 — `on: push: branches: [main]` + `workflow_dispatch`, aucun `schedule:`. src/data/supabase.ts:96 — `cache: 'no-store'` sur le fetch des grilles. public/sw.js:45 — `if (requete.cache === 'no-store') return;`. src/pages/ecran.ts:525 — `const [grilles, p, m, j, med] = await Promise.all([...])`. src/pages/resilience.ts:69-79 — `demarre()` retombe sur l'instantané et fixe `derniereSynchroMs = instantane.quand`. src/pages/ecran.ts:450-455 — `const neutre = age === null || age > dureeCacheMs();` → `mode-neutre`. CORRECTIONS DE PREUVE : docs/mise-en-service.md ne s'arrête PAS à la section E — sections F (ligne 99) et G (ligne 119)…

**Scénario** — Scénario resserré et débarrassé de ses exagérations. À la fin d'une période d'exploitation, si — et seulement si — les 6 Raspberry sont mis hors tension, que la supervision n'est ouverte par personne et qu'aucun accès de développement n'a lieu pendant plus de 7 jours consécutifs, le projet Supabase (offre gratuite, indice : supabase/schema.sql:547) est mis en pause par l'hébergeur ; le réveil est un geste manuel au tableau de bord. Au redémarrage des écrans, `charge()` (src/pages/ecran.ts:525) échoue en bloc, et `demarre()` (src/pages/resilience.ts:69-79) ne dispose au mieux que d'un instantané vieux de plusieurs semaines, dont l'âge dépasse `duree_cache_min` : les 6 écrans affichent l'écran neutre (src/pages/ecran.ts:450-455) jusqu'à réactivation manuelle du projet. Le comportement du code est CORRECT (aucun horaire faux). Deux…

**Correctif** — Requête de maintien en éveil, gratuite, dans un dépôt qui utilise déjà GitHub Actions. Créer .github/workflows/maintien-eveil.yml : ```yaml name: Maintien en éveil Supabase on: schedule: - cron: '0 6 * * 1' # tous les lundis 06:00 UTC workflow_dispatch: jobs: ping: runs-on: ubuntu-latest steps: - name: Lecture d'une clé de params run: | code=$(curl -s -o /dev/null -w '%{http_code}' \ "${{ vars.VITE_SUPABASE_URL }}/rest/v1/params?select=cle&limit=1" \ -H "apikey: ${{ vars.VITE_SUPABASE_PUBLISHABLE_KEY }}") echo "HTTP $code" [ "$code" = "200" ] || exit 1 ``` La clé publishable étant publique par conception, ce workflow n'expose rien de neuf ;…

#### M-12 — Deux boucles de resynchronisation 30 s concurrentes, actives 24 h/24 : le plafond d'egress gratuit est atteignable en pleine saison
**Gravité** MOYEN · **Phase** 1 · **Coût** 1 journée · ⚠️ **à vérifier** (non tranchable depuis le code seul)

**Preuve** — src/pages/ecran.ts:557 — `window.setInterval(() => sync?.resynchronise(), 30_000);` (vérifié). src/data/supabase.ts:282-283 — commentaire « Repli polling 30 s si le temps réel est indisponible » puis `window.setInterval(() => this.notifie(), 30_000);` (vérifié) ; `notifie()` supabase.ts:289-296 appelle tous les abonnés, donc `sync.resynchronise()`. src/pages/resilience.ts:52 — `if (enCours) return false;` : ne fusionne que des appels réellement concurrents ; supabase.ts:290 (`if (this.notifieId !== null) return;`) ne débounce que 300 ms. Les deux minuteurs déphasés produisent donc bien 4 synchros/min. src/pages/ecran.ts:441-448 — `const veille = estEnVeille(maintenant); … if (veille) { ……

**Scénario** — En pleine saison, 6 écrans + la supervision. Chaque écran lance DEUX boucles de resynchronisation 30 s indépendantes (page + provider), soit 4 synchros/min × 7 requêtes PostgREST, 24 h/24 — la veille nuit fait sortir `rendre()` mais n'arrête aucun minuteur. Chiffrage mesuré (et non estimé) : la charge dominante, les 26 circulations du jour, fait 9,1 Ko bruts mais 988 octets une fois gzippée par la passerelle Supabase (ratio 9,2:1). Une synchro coûte donc ~2,5 Ko de corps compressés + ~1 Ko d'en-têtes sur 7 réponses ≈ 3,3 Ko facturés. 1 écran : 5 760 synchros × 3,3 Ko ≈ 19 Mo/jour. 6 écrans : ≈ 114 Mo/jour → ≈ 3,4 Go sur 30 jours. Signaux de vie : ≈ 0,1 Go/mois. Supervision + WebSocket Realtime : quelques centaines de Mo. Médias Storage : négligeable en régime établi (le service worker les sert en cache-d'abord). Total réaliste : 3,5 à 4…

**Correctif** — Trois mesures, cumulables, qui divisent le volume par 4 à 5 sans rien changer à la réactivité perçue. 1) Supprimer le doublon (−50 %). src/data/supabase.ts:283 fait le même travail que src/pages/ecran.ts:557. Le repli polling appartient légitimement au provider : supprimer plutôt src/pages/ecran.ts:557 et src/pages/grille.ts:360, et laisser le provider seul maître de la cadence (le mock, lui, n'a pas de polling : ajouter alors un `setInterval` équivalent dans MockProvider.onChange pour ne pas changer le comportement de démo). 2) Suspendre pendant la veille et hors service (−40 % supplémentaires). Dans src/pages/ecran.ts:557, remplacer par :…

#### M-13 — Version de grille inconnue : repli SILENCIEUX sur la première grille chargée, et liste des grilles codée en dur
**Gravité** MOYEN · **Phase** 1 · **Coût** 1 h

**Preuve** — src/pages/ecran.ts:540 — `grille = d.grilles.find((g) => g.version === d.jour.grille_version) ?? d.grilles[0] ?? null;` (vérifié) src/pages/grille.ts:348 — ligne identique (vérifié) src/pages/supervision.ts:204 — `return grilles.find((g) => g.version === jour?.grille_version) ?? grilles[0] ?? null;` — MÊME repli, non cité par l'auditeur src/data/supabase.ts:93-94 et src/data/mock.ts:373-374 — liste `['2026-ete-grand-service', '2026-ete-petit-service']` codée en dur ; l'ordre fait de `grilles[0]` le GRAND service src/data/supabase.ts:95 — chargement par NOM DE FICHIER, alors que la comparaison porte sur le champ `version` du JSON : les deux peuvent diverger src/data/supabase.ts:122 et 158 —…

**Scénario** — Scénario réellement exécutable (le scénario annoncé est remplacé) : la Régie corrige une erreur dans public/grilles/2026-ete-petit-service.json et, pour tracer la correction, passe le champ `version` de « 2026-ete-petit-service » à « 2026-ete-petit-service-v2 » — le nom de FICHIER, seul élément lu par src/data/supabase.ts:95, reste inchangé, donc le fichier se charge normalement et rien ne signale quoi que ce soit. Toutes les lignes `jours` déjà créées en base (créées automatiquement par getJour dès qu'un superviseur ouvre une date, supabase.ts:141-147) portent encore l'ancienne chaîne, et l'upsert `ignoreDuplicates` de genererJour (supabase.ts:394-399) ne la réécrira jamais. Le 1er septembre — jour de petit service — l'écran reçoit `grille_version = '2026-ete-petit-service'`, `find()` échoue, `?? d.grilles[0]` renvoie le GRAND SERVICE…

**Correctif** — 1) Ne jamais replier sur une grille arbitraire. src/pages/ecran.ts:540 et src/pages/grille.ts:348 : ```ts const trouvee = d.grilles.find((g) => g.version === d.jour.grille_version); if (!trouvee) { console.error(`[TMB] grille « ${d.jour.grille_version} » introuvable`); grille = null; // → src/pages/ecran.ts:459 `if (!grille || !jour) return;` throw new Error('grille inconnue'); // fait échouer la synchro → instantané puis écran neutre } grille = trouvee; ``` Lever ici est le bon geste : `synchronise()` (src/pages/resilience.ts:55-61) attrape déjà, l'instantané précédent est conservé et l'écran neutre survient au bout de `duree_cache_min` —…

#### M-14 — `?cache=N` : la garde des 15 minutes est désactivable depuis l'URL, sans borne
**Gravité** MOYEN · **Phase** 1 et 2 · **Coût** 10 min

**Preuve** — src/pages/ecran.ts:146-149 (`function dureeCacheMs()`, avec `const surcharge = Number(url.get('cache'));` en 147 et le ternaire en 148) et src/pages/grille.ts:101-104 (identique, lignes 102-103) ; consommateurs : src/pages/ecran.ts:434 (badge) et src/pages/ecran.ts:450-452 (écran neutre), src/pages/grille.ts:270 et 276-279 ; seuil badge : src/pages/resilience.ts:13 ; persistance de l'instantané horodaté : src/pages/resilience.ts:38 et 73 ; rechargement distant conservant la query string : src/data/supabase.ts:334 et src/data/mock.ts:508 ; garde `apercu` existante (non appliquée à `cache`) : src/pages/ecran.ts:564, src/pages/grille.ts:365.

**Scénario** — Le paramètre `?cache=N` est documenté comme réservé aux tests (src/pages/ecran.ts:3 ; docs/tests-manuels.md:19 propose `cache=0.05`, soit le sens fail-safe). La voie réaliste vers l'exploitation est l'erreur d'exploitation : un technicien qui teste la résilience avec une valeur volontairement grande et laisse le paramètre dans l'URL d'autostart du kiosque. La voie « personne devant l'écran » (modèle b) reste théorique : Chromium en `--kiosk` masque la barre d'adresse, et qui a un clavier sur le Pi a des moyens plus directs. Une fois le paramètre présent, si le backend devient inatteignable, l'écran n'atteint JAMAIS l'état neutre : `age > dureeCacheMs()` reste faux (ecran.ts:450-452), et il continue d'afficher le dernier instantané comme un tableau normal, avec des compteurs à rebours recalculés en temps réel sur des données périmées — un…

**Correctif** — Borner la surcharge et la réserver à l'aperçu. Dans src/pages/ecran.ts:146-150 et src/pages/grille.ts:101-105 : ```ts function dureeCacheMs(): number { const brut = Number(url.get('cache')); // Surcharge de test : uniquement en aperçu, et jamais au-delà d'une heure. const surcharge = url.get('apercu') === '1' && brut > 0 ? Math.min(60, brut) : 0; const minutes = surcharge > 0 ? surcharge : dureeCacheValide(params?.duree_cache_min); return minutes * 60_000; } ``` La condition `apercu === '1'` réutilise le garde-fou déjà en place pour le heartbeat (src/pages/ecran.ts:564), donc sans nouvelle notion à expliquer à l'exploitant.

#### M-15 — Journal d'exploitation : la garantie « infalsifiable » vient de triggers Postgres SECURITY DEFINER + auth.uid() — rien de tout cela n'existe en SQLite
**Gravité** MOYEN · **Phase** 2 · **Coût** 0,5 à 1 jour maintenant (triggers SQLite + UDF `agent_courant` + ACL append-only). Après : réécrire la journalisation dans 37 handlers déjà écrits, sans garantie d'exhaustivité,…

**Preuve** — supabase/schema.sql:418 (`select p.email into v_qui from public.profils p where p.user_id = auth.uid();` — identité prise par la base) ; supabase/schema.sql:385 (et non 383) : `create or replace function private.tracer_ecriture() returns trigger language plpgsql security definer set search_path = ''` ; supabase/schema.sql:368 (`revoke insert, update, delete, truncate on journal_exploitation from anon, authenticated;`) ; supabase/schema.sql:485-541 (8 déclencheurs, dont schema.sql:534-541 qui exclut explicitement derniere_vue/donnees_maj/version_app/reseau) ; docs/01-spec-fonctionnelle.md:523-524 (promesse « alimenté par la base elle-même (déclencheurs) : rien ne lui échappe ») ;…

**Scénario** — En phase 2 (aucune ligne encore écrite : pas de répertoire `server/`), les trois briques qui garantissent aujourd'hui le journal disparaissent : `security definer` (schema.sql:385), `auth.uid()` (schema.sql:418) et les GRANT par rôle (schema.sql:368). Le risque réellement démontrable est UN seul : l'identité de l'auteur, aujourd'hui lue par la base dans `profils`, devient une donnée que le code applicatif fournit (`INSERT INTO journal_exploitation (qui, ...) VALUES (?, ...)`). Un handler de route qui oublie d'appeler la journalisation produit un journal MUET ; un handler qui journalise l'identité qu'on lui passe produit un journal MENTEUR. Comme `src/data/provider.ts` n'expose aucune méthode d'écriture du journal (l'écriture est implicite côté base en phase 1), rien dans les « routes miroir du DataProvider » annoncées en docs/02:411 ne…

**Correctif** — Trois décisions à prendre avant d'écrire la première route : (1) reproduire le mécanisme par DÉCLENCHEURS SQLite (SQLite a des triggers AFTER INSERT/UPDATE/DELETE) plutôt que par des appels dispersés dans les handlers — un handler peut oublier, un trigger non ; (2) fournir l'identité au trigger sans la lui faire passer par la requête : enregistrer une fonction SQL personnalisée `agent_courant()` via `db.function('agent_courant', ...)` de better-sqlite3, qui lit l'identité de la requête en cours dans un `AsyncLocalStorage` — le trigger appelle `agent_courant()` exactement comme Postgres appelle `auth.uid()`, et une écriture faite hors requête…

#### M-16 — LDAP : la spec ne dit ni LDAPS, ni validation de certificat, ni où vit le mot de passe du compte de service — et le dépôt est PUBLIC
**Gravité** MOYEN · **Phase** 2 · **Coût** 1 à 2 h maintenant (choix du mode de bind + 3 lignes de .gitignore + 1 test qui interdit `ldap://` et `rejectUnauthorized: false`). Après : un mot de passe de compte de service…

**Preuve** — docs/02-spec-technique.md:409-411 (et non 410-412) : « comptes locaux argon2 **ou SSO Active Directory** : authentification LDAP (module `ldapts`) contre l'AD de la Régie, mapping groupes AD → rôles (paramétrable) » — aucune mention de LDAPS/StartTLS, de validation de certificat ni du mode de bind dans tout le §7. docs/03-plan-de-developpement.md:188-190 (et non 189-191) : « option LDAP Active Directory (ldapts) avec mapping groupes AD → rôles (config server/config.json) ». docs/03-plan-de-developpement.md:201 : critère d'acceptation = « connexion par compte local ET par LDAP simulé » (le vrai transport ne sera jamais testé). .gitignore:1-16 : n'ignore que node_modules/, dist/,…

**Scénario** — Reformulé, sans prétendre à une faille active. Aujourd'hui : aucune exploitation possible, le code d'authentification phase 2 n'existe pas (pas de `server/`, pas de `ldapts`). Le risque est celui d'une spécification muette qui laisse l'implémenteur (humain ou Claude Code suivant docs/03 étape 10) choisir seul le transport. Si `ldapts` est instancié avec `ldap://dc.tmb.local:389` sans StartTLS — ce que Windows Server 2019 accepte par défaut, le simple bind non chiffré n'étant pas rejeté tant que LDAP signing/channel binding ne sont pas imposés — le mot de passe Windows de chaque agent de supervision transite en clair sur le LAN de la Régie, exploitable par l'attaquant (e) via une capture réseau ou un port miroir. Variante `ldaps://` avec `rejectUnauthorized: false` : un attaquant interne capable de détourner la résolution DNS présente son…

**Correctif** — Quatre décisions à écrire avant la première ligne du module d'authentification : (1) LDAPS sur 636 (ou StartTLS sur 389) OBLIGATOIRE, jamais de repli silencieux en clair : le code doit refuser de démarrer si l'URL commence par `ldap://` ; (2) validation stricte du certificat du contrôleur de domaine — `tlsOptions: { rejectUnauthorized: true, ca: [fs.readFileSync('ca-tmb.pem')] }` avec l'autorité interne de la Régie ; jamais `rejectUnauthorized: false` (ajouter un test qui échoue si cette chaîne apparaît dans server/) ; (3) préférer le BIND DIRECT avec l'UPN de l'agent (`prenom.nom@tmb.local` + son mot de passe), puis lire ses groupes avec…

#### M-17 — Mapping groupes AD → rôles : le défaut `supervision` de la phase 1 ne doit surtout pas être reporté, et il faut fixer la fréquence de relecture des groupes
**Gravité** MOYEN · **Phase** 2 · **Coût** 2 h maintenant (choix de la fréquence de revalidation + 3 tests : aucun groupe → refus, deux groupes → rôle le plus élevé, compte désactivé → refus au bout du délai annoncé).… · ⚠️ **à vérifier** (non tranchable depuis le code seul)

**Preuve** — supabase/schema.sql:111-117 (exact, `default 'supervision'` en 115) ; supabase/schema.sql:153-156 (exact) ; docs/02-spec-technique.md:409-411 (et non 410-412) ; RÉFUTATIONS : supabase/functions/inviter-utilisateur/index.ts:22-32 et :43 (seul chemin de création, admin-gated, `role` toujours fourni) ; supabase/schema.sql:112 (unique référence à auth.users — aucun trigger de création automatique de profil) ; supabase/schema.sql:250-251 (écritures sur `profils` réservées à l'admin) ; docs/03-plan-de-developpement.md:189 (emplacement du mapping déjà spécifié : `config server/config.json`) et :199-201 (critère d'acceptation étape 10, qui ne couvre ni zéro-groupe ni multi-groupes ni révocation) ;…

**Scénario** — Scénario corrigé, débarrassé de la partie fausse. CE QUI N'EST PAS UN SCÉNARIO : « un agent membre d'aucun groupe se connecte et hérite du défaut schema.sql:115 ». En phase 1 ce défaut n'est atteignable par personne (aucun trigger sur auth.users, insertion uniquement par l'Edge Function admin-gated qui fournit toujours `role`, RLS admin-only sur `profils`). Et rien ne le transporte vers la phase 2, qui sera un schéma SQLite distinct. À retirer. CE QUI RESTE, et qui est le vrai sujet — attaquant (d), l'ancien agent, en PHASE 2 seulement. Aujourd'hui, un départ n'est effectif que si quelqu'un passe `actif=false` (ou supprime le compte) depuis l'onglet Utilisateurs ; oublié, le compte reste valide. La contrepartie positive, vérifiée : schema.sql:155 relit `profils` à chaque évaluation de politique, donc dès que le geste est fait la…

**Correctif** — Quatre décisions, toutes à prendre maintenant : (1) la table de correspondance vit dans la CONFIGURATION du serveur, hors du dépôt (cf. constat LDAP), pas en dur dans le code : `{ "TMB-Affichage-Admin": "admin", "TMB-Affichage-Supervision": "supervision", "TMB-Affichage-Caisse": "caisse" }` — et les groupes AD doivent être créés par le service informatique AVANT le développement, pas pendant la recette ; (2) aucun groupe reconnu = AUCUN accès (401/403 explicite « compte non habilité à l'affichage voyageurs »), JAMAIS de rôle par défaut : ne pas reporter le `default 'supervision'` de schema.sql:115 ; (3) plusieurs groupes = priorité explicite…

#### M-18 — HTTP interne ou HTTPS : ce choix décide À LA FOIS du cookie `Secure` et de la survie du service worker des écrans (précache hors-ligne)
**Gravité** MOYEN · **Phase** 2 · **Coût** 2 h de décision maintenant + une demi-journée de mise en œuvre au déploiement. Après : le certificat se déploie sur 7 machines réparties dans 6 gares de montagne (dont le Nid…

**Preuve** — src/pages/resilience.ts:89-94 (`enregistreServiceWorker`, garde `'serviceWorker' in navigator` + `.catch(() => {})`) ; src/pages/ecran.ts:513 et src/pages/grille.ts:323 (appels) ; public/sw.js:10-22 (précache coquille + grilles + logos) ; docs/02-spec-technique.md:341-342 (« Cache hors-ligne : service worker (précache app + logos + polices…) ») ; docs/02-spec-technique.md:401 (reboot 04:30) ; docs/02-spec-technique.md:408 (« sessions cookie ») ; docs/02-spec-technique.md:412 (« Sert `dist/` et les médias ») ; docs/02-spec-technique.md:413-414 (« port 8080, pare-feu intranet ») ; docs/02-spec-technique.md:415 (« bascule des écrans par `config.js` ») ; src/data/index.ts:10 (`TMB_CONFIG`…

**Scénario** — Scénario tenu, avec trois corrections de mécanisme et un ajout. (a) Disponibilité, aucun attaquant. La tour redémarre pour un Patch Tuesday à 03:30, les Raspberry redémarrent à 04:30 (docs/02:401) et le service Node met 4 min à repartir. En phase 1, le service worker sert la coquille depuis le cache (public/sw.js:10-22, `reseauDabord` avec repli cache pour les navigations) et l'écran affiche au pire l'écran neutre puis se resynchronise. En phase 2 sur `http://serveur:8080/ecran.html`, il n'y a aucun service worker — non pas parce que le `.catch(() => {})` avale une erreur, mais parce que Chromium n'expose même pas `navigator.serviceWorker` hors contexte sécurisé : la garde de resilience.ts:91 est fausse et `register()` n'est jamais appelé. Chromium reste sur `ERR_CONNECTION_REFUSED`. Et il n'en sort pas : `Restart=always`…

**Correctif** — Trancher maintenant, et une seule réponse est tenable : HTTPS interne. (1) Certificat émis par l'autorité interne de la Régie (AD CS) pour le nom `affichage.tmb.local`, déployé sur les 6 Raspberry (magasin de Chromium) et sur les postes de supervision par GPO ; à défaut, certificat auto-signé de 5 ans installé manuellement sur 7 machines (procédure de 10 min à écrire dans docs/kiosque.md). (2) Fastify écoute en TLS ; le port 8080 en clair, s'il est conservé, ne sert qu'à rediriger. (3) Cookie de session : `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, signé. (4) Écrire dans la recette un test explicite : « couper le service Node, redémarrer…

#### M-19 — Exposition sur l'intranet : interface d'écoute, pare-feu, et séparation lecture-écrans / écriture-supervision (jeton par écran, enfin possible)
**Gravité** MOYEN · **Phase** 2 · **Coût** 3 h maintenant (choix d'architecture + 10 lignes de règle pare-feu + format de `TMB_CONFIG`). Après : séparer les routes publiques des routes d'exploitation une fois les 45 routes…

**Preuve** — docs/02-spec-technique.md:412-414 (§7 = lignes 405-418) : « Installation en service Windows via `nssm` (doc `docs/phase2-windows.md` : installation, port 8080, pare-feu intranet, sauvegarde quotidienne SQLite + médias… » — trois mots sur le réseau ; §7 ne mentionne ni interface d'écoute, ni séparation lecture/écriture, ni identité d'écran. docs/03-plan-de-developpement.md:193 recopie la même formule. `docs/phase2-windows.md` n'existe pas (docs/ = 01, 02, 03, kiosque, mise-en-service, tests-manuels) et `server/` non plus. Engagement non instruit : supabase/schema.sql:288-290 « Fermeture définitive en phase 2 : le micro-serveur interne de la Régie prendra en charge les écritures des écrans et…

**Scénario** — Le scénario d'origine repose sur une erreur de fait à corriger : Fastify n'écoute pas sur `0.0.0.0` par défaut — son `host` par défaut est `localhost`/127.0.0.1. Le risque n'est donc pas l'inaction, c'est l'inverse : le serveur DEVANT être joignable depuis les 6 gares, celui qui écrira `server/` élargira nécessairement l'écoute, et faute de règle écrite dans docs/02 §7 il choisira le raccourci `0.0.0.0` — exposant `https://tour:8080/api/…` à tout poste du réseau de la Régie, y compris un poste bureautique compromis par courriel (attaquant e). La seconde partie du scénario d'origine (débrancher le RJ45 d'un écran en gare pour entrer dans l'intranet) est à retirer du constat : elle est vraie, mais elle relève du port-security/802.1X/VLAN de la Régie, elle existe indépendamment de cette application, et aucune ligne de ce dépôt ne la…

**Correctif** — Décider maintenant l'architecture réseau et de surface, avant la première route : (1) écoute sur l'IP de l'interface intranet, jamais `0.0.0.0` (`fastify.listen({ host: '10.x.y.z', port: 8443 })`) ; (2) règle de pare-feu Windows entrante nominative : autoriser le sous-réseau de supervision + les 6 IP fixes des écrans, tout le reste refusé — et non « pare-feu intranet » ; (3) deux routeurs distincts et deux préfixes : `/api/public/*` (GET seulement : grilles, jour, messages, médias, params) et `/api/exploitation/*` (session requise), le préfixe public étant physiquement incapable d'écrire (aucune requête d'écriture importée dans ce module) ;…

#### M-20 — Injection de formule dans les DEUX exports CSV : un texte de message écrit par la caisse devient une formule exécutée dans Excel sur le poste de l'administrateur
**Gravité** MOYEN · **Phase** 1 et 2 · **Coût** 45 min (fonction partagée + 2 exports + test)

**Preuve** — src/pages/etat-publiable.ts:323-341 — `export function journalVersCsv(entrees: EntreeJournalCsv[]): string { const echappe = (v: string | null): string => `"${(v ?? '').replace(/"/g, '""')}"`; ... }` : l'échappement traite UNIQUEMENT le guillemet CSV. Aucune neutralisation des caractères d'amorce de formule (`=`, `+`, `-`, `@`, tabulation, retour chariot). Les colonnes exportées sont `quand;qui;objet;cle;champ;avant;apres;date_service` (ligne 326), et `avant`/`apres` passent par `echappe` (lignes 334-335). src/pages/etat-publiable.ts:340 — `return ` ${lignes.join('\r\n')}`;` : BOM ajouté explicitement « pour qu'Excel francophone ouvre le fichier sans l'assistant d'importation » (commentaire…

**Scénario** — Attaquant (c), agent de caisse en poste — le rôle le moins privilégié, et le seul rôle non-exploitation qui écrit les messages voyageurs. 1. Il crée un message voyageurs dont le texte français commence par une formule, par exemple `=cmd|' /c powershell -w hidden -c "…"'!A1` (ou une variante DDE/HYPERLINK selon la version d'Excel). Le message peut être anodin à l'écran s'il est ensuite désactivé : peu importe, la trace est déjà écrite. 2. Le déclencheur `trg_journal_messages` consigne la valeur telle quelle dans `journal_exploitation.apres` (ajout-journal-exploitation.sql:110-111). 3. Un administrateur ouvre l'onglet Journal — le seul rôle à qui l'interface le présente — et clique « Exporter CSV » (supervision.ts:2501). Le fichier est produit avec un BOM, précisément pour s'ouvrir d'un double-clic dans Excel (etat-publiable.ts:319-322,…

**Correctif** — Neutraliser l'amorce de formule dans les DEUX exports, et quoter partout. 1) src/pages/etat-publiable.ts:324 — remplacer `echappe` par : ```ts const echappe = (v: string | null): string => { const t = (v ?? '').replace(/\r|\n/g, ' '); // Excel/LibreOffice interprètent =, +, -, @ et la tabulation comme le début // d'une formule : on préfixe d'une apostrophe, qui force le texte. const sur = /^[=+\-@\t]/.test(t) ? `'${t}` : t; return `"${sur.replace(/"/g, '""')}"`; }; ``` 2) src/pages/etat-publiable.ts:328-338 — passer AUSSI `e.quand`, `libelleObjet(e.table_cible)` et `e.date_service` par `echappe` (aujourd'hui bruts, lignes 329, 331, 336) : le…

#### M-21 — setTerminusBellevue : la « libération » remet TOUTES les montées à Nid d'Aigle, effaçant en silence les limitations posées à la main, et les trois écritures ne sont pas atomiques
**Gravité** MOYEN · **Phase** 1 et 2 · **Coût** 1 h

**Preuve** — src/data/supabase.ts:490-529, lu intégralement. Trois écritures indépendantes, sans transaction : - 492-499 : `await this.client.from('jours').update({ terminus_bellevue_a_partir_du_train: v === false ? null : v.a_partir_du_train }).eq('date', date).select();` puis `exigeLignes(resultat, 'journée absente en base');` - 510-516 : `const liberation = await this.client.from('circulations').update({ terminus: 'nid-daigle' }).eq('date', date).eq('sens', 'montee').eq('terminus', 'bellevue'); verifie(liberation.error); // 0 ligne est normal ici : rien n'était limité` — le filtre ne porte PAS sur la plage : il vise TOUTES les montées limitées, y compris celles posées à la main hors plage. - 518-529…

**Scénario** — Aucun attaquant : erreur d'exploitation induite par le code, avec conséquence directe sur l'information voyageurs. Cas nominal du matin en montagne. Mauvais temps au sommet : le chef d'exploitation coche « Terminus Bellevue à partir du TRAIN 1 » et publie — toutes les montées passent à Bellevue. En milieu de matinée le temps se lève partiellement : il ramène la plage « à partir du TRAIN 15 », mais laisse volontairement le TRAIN 11 limité à Bellevue (colonne Terminus, geste que l'interface propose explicitement — src/pages/supervision.ts:562-565). À la publication, `setTerminusBellevue` exécute la libération globale (supabase.ts:510-516) : TOUTES les montées repassent à `nid-daigle`, TRAIN 11 compris ; puis re-pose `bellevue` sur les numéros ≥ 15 seulement. Le TRAIN 11 est donc annoncé « destination Nid d'Aigle » sur les 6 écrans alors…

**Correctif** — 1) (15 min) Borner la libération à ce qui sort réellement de la plage — src/data/supabase.ts:510-516 : ```ts let liberation = this.client .from('circulations') .update({ terminus: 'nid-daigle' }) .eq('date', date) .eq('sens', 'montee') .eq('terminus', 'bellevue'); // Décocher libère tout (voulu) ; rétrécir ne doit libérer que sous le seuil, // sinon une limitation posée à la main hors plage disparaît sans trace. if (v !== false) liberation = liberation.lt('numero', seuil); verifie((await liberation).error); ``` 2) (30 min) Rendre l'ensemble atomique et fidèle au résumé : déplacer les trois écritures dans une fonction Postgres `security…

---

## 6. Constats FAIBLES

#### F-01 — private.purge_journal_exploitation() est exécutable par tout compte « authenticated », sans contrôle de rôle, et efface TOUT le journal si mois <= 0
**Gravité** FAIBLE · **Phase** 1 et 2 · **Coût** 10 min · ⚠️ **à vérifier** (non tranchable depuis le code seul)

**Preuve** — supabase/schema.sql:551-563 (fonction sans test de rôle ni borne + `grant execute ... to authenticated`), à comparer à supabase/schema.sql:158-160 (seul autre GRANT sur `private`, lui justifié « INDISPENSABLE ») ; supabase/schema.sql:150-151 (`revoke all on schema private from public` / `grant usage ... to authenticated`) ; supabase/schema.sql:145-148 (le commentaire qui pose `private` comme non exposé à PostgREST) ; supabase/schema.sql:368 (protection directe de la table) ; duplication identique dans supabase/ajout-journal-exploitation.sql:229-241

**Scénario** — Le scénario « un agent de caisse efface sa trace » est FAUX en phase 1 et doit être retiré : l'attaquant (c) ne dispose que d'un JWT, or `private` n'est pas exposé par PostgREST et le rôle Postgres `authenticated` est NOLOGIN — il n'existe aucun chemin d'appel. Deux constats réels le remplacent. (1) Sur-privilège latent : `grant execute on function private.purge_journal_exploitation(int) to authenticated` (schema.sql:563) est le seul GRANT de `private` sans justification, alors que la fonction est documentée comme « à lancer à la main une fois par an » par un administrateur. Il n'apporte rien aujourd'hui et arme un effacement total du journal d'exploitation par n'importe quel compte connecté — caisse, compte sans ligne dans `profils`, compte `actif = false` — le jour où `private` est ajouté aux « Exposed schemas » du dashboard,…

**Correctif** — ```sql revoke execute on function private.purge_journal_exploitation(int) from authenticated; -- et borner l'argument, pour que même un administrateur ne puisse pas tout effacer par erreur create or replace function private.purge_journal_exploitation(mois int default 12) returns bigint language plpgsql security definer set search_path = '' as $fn$ declare supprimees bigint; begin if mois is null or mois < 12 then raise exception 'Rétention minimale : 12 mois (reçu %)', mois; end if; delete from public.journal_exploitation where quand < now() - make_interval(months => mois); get diagnostics supprimees = row_count; return supprimees; end $fn$;…

#### F-02 — publications.qui est fourni par le client : un agent peut signer une publication au nom d'un autre
**Gravité** FAIBLE · **Phase** 1 et 2 · **Coût** 20 min

**Preuve** — supabase/schema.sql:137-142 (`qui text` sans défaut ni contrainte, `quand` avec simple `default now()`) ; supabase/schema.sql:332-333 (WITH CHECK sur le rôle seul) ; supabase/securite-advisors.sql:133-136 (recrée les mêmes policies sans durcissement) ; src/data/supabase.ts:708-717 (`insert({ resume, qui: auth.user?.email ?? 'inconnu' })`) ; absence de trigger sur `publications` et absence de GRANT de colonnes (à comparer à supabase/schema.sql:256-259 et 368-369) ; contraste correct : supabase/ajout-journal-exploitation.sql:96. Preuves de la réfutation d'impact : src/data/supabase.ts:681-690 (`.select('quand')` seul) ; src/pages/supervision.ts:367-370 et 2804-2808 (seuls usages, horodatage…

**Scénario** — Attaquant (c), agent `caisse` actif : `POST /rest/v1/publications` avec `{"resume":"...","qui":"chef.exploitation@tramwaydumontblanc.fr","quand":"2030-01-01T00:00:00Z"}`. La policy accepte, aucun GRANT de colonnes ni trigger ne borne l'insert, et l'absence de policy UPDATE/DELETE rend la ligne indélébile depuis l'application. MAIS l'attribution falsifiée n'est affichée NULLE PART : l'application ne relit jamais `qui` ni `resume`, et le journal consulté en supervision est `journal_exploitation`, dont le `qui` est résolu côté serveur et dont les écritures sont révoquées à `authenticated` — le retour d'expérience après incident s'appuie donc sur une trace intacte. Impact réel, limité : (1) une table d'horodatage polluée, trompeuse seulement pour un administrateur qui l'inspecterait directement en Supabase Studio ; (2) plus concrètement, la…

**Correctif** — Forcer `qui` côté serveur, comme le fait déjà tracer_ecriture : ```sql create or replace function private.signe_publication() returns trigger language plpgsql security definer set search_path = '' as $fn$ begin select p.email into new.qui from public.profils p where p.user_id = auth.uid(); new.qui := coalesce(new.qui, 'inconnu'); return new; end $fn$; revoke all on function private.signe_publication() from public; create trigger trg_signe_publication before insert on publications for each row execute function private.signe_publication(); ``` Puis, src/data/supabase.ts:714 : retirer `qui` de l'insert (et l'appel `auth.getUser()` ligne 709…

#### F-03 — Aucun REVOKE des droits d'écriture par défaut d'anon sur 10 des 12 tables : RLS est l'unique garde-fou, sans filet
**Gravité** FAIBLE · **Phase** 1 · **Coût** 20 min

**Preuve** — supabase/schema.sql:256 et supabase/schema.sql:368 (les DEUX seuls revoke portant sur une table ; repris respectivement dans supabase/securite-advisors.sql:151 et supabase/ajout-journal-exploitation.sql:46). Les 12 tables : supabase/schema.sql:9,20,51,65,79,86,92,103,111,119,137 + supabase/schema.sql:345. RLS effectivement activée sur toutes : supabase/schema.sql:182-192, supabase/schema.sql:360, supabase/ajout-journal-exploitation.sql:38, supabase/ajout-modeles.sql:24. Preuve interne que le GRANT ALL par défaut existe bel et bien : supabase/schema.sql:256 et 368 seraient sans objet sinon. Seule écriture anonyme de l'application : src/data/supabase.ts:298-318 (heartbeat, UPDATE de 5…

**Scénario** — Aucune exploitation possible aujourd'hui : les 12 tables ont bien `enable row level security` et aucune policy d'écriture ne vise `anon` (hors « signal de vie », bornée par des GRANT de colonnes). Le constat porte sur l'ABSENCE DE SECONDE COUCHE, pas sur une faille. Scénario corrigé (précisé après vérification) : le risque n'est pas l'oubli durable de RLS — Supabase le signale bruyamment dans ses advisors, et l'équipe traite ces advisors (supabase/securite-advisors.sql). Le risque est la FENÊTRE : (i) RLS désactivée volontairement le temps d'un débogage, (ii) une table créée depuis le Table Editor du tableau de bord entre deux passages d'advisors. Pendant cette fenêtre, tout attaquant de type (a) — n'importe qui sur Internet, la clé publishable étant dans le bundle JS — obtient INSERT/UPDATE/DELETE sur cette table sans aucune autre…

**Correctif** — Poser la seconde couche une fois pour toutes, puis re-accorder explicitement ce qui est voulu : ```sql revoke insert, update, delete, truncate on all tables in schema public from anon; alter default privileges in schema public revoke insert, update, delete on tables from anon; -- puis re-poser le seul droit anonyme voulu (schema.sql:257-258) grant update (derniere_vue, donnees_maj, date_affichee, version_app, reseau) on ecrans to anon; ``` Une écriture anonyme devient alors impossible même sur une table dont RLS serait absent ou désactivé. À ajouter à la fin de schema.sql et dans un script rejouable pour la base en service.

#### F-04 — L'Edge Function « traduire » n'effectue aucun contrôle de rôle, contrairement aux deux autres *(recoupe 2 constat(s) du même défaut trouvés par d'autres axes)*
**Gravité** FAIBLE · **Phase** 1 · **Coût** 30 min · ⚠️ **à vérifier** (non tranchable depuis le code seul)

**Preuve** — supabase/functions/traduire/index.ts:6-19 — `Deno.serve(async (req) => { ... const { texte } = (await req.json()) as { texte?: string }; const cle = Deno.env.get('DEEPL_API_KEY'); ... })` : aucune lecture de l'en-tête `Authorization`, aucune consultation de `profils`, et le fichier n'importe même pas `@supabase/supabase-js`. traduire/index.ts:7 — `'Access-Control-Allow-Origin': '*'`. traduire/index.ts:20-23 — `texte` relayé brut à `api-free.deepl.com/v2/translate`, sans plafond de longueur. À comparer à supabase/functions/inviter-utilisateur/index.ts:22-32 et supabase/functions/supprimer-utilisateur/index.ts:23-33 (`getUser(jwt)` puis `if (profil?.role !== 'admin' || !profil.actif) → 403`),…

**Scénario** — Attaquant (a), Internet : la clé publishable est publiée en clair dans le dépôt public (INFOS-PROJET.md:8) et embarquée dans le bundle. Il poste en boucle des textes de 5 000 caractères sur /functions/v1/traduire ; aucun plafond de longueur ni de débit n'existe dans traduire/index.ts, et ~100 requêtes suffisent à vider les 500 000 caractères/mois du plan DeepL Free (docs/02-spec-technique.md:372). Attaquants (c) et (d) réussissent de toute façon, même si la passerelle Supabase devait refuser la clé publishable : la fonction ne consulte jamais `profils`, donc ni un compte `caisse` ni un ancien agent passé `actif=false` — dont le JWT reste valide, cf. le garde-fou `and actif` de schema.sql:155 que les deux autres fonctions reproduisent et que celle-ci omet — n'est écarté. CONSÉQUENCE RÉELLE, plus limitée que ce qui était annoncé : pour le…

**Correctif** — Recopier dans traduire/index.ts le contrôle déjà écrit et éprouvé dans inviter-utilisateur/index.ts:22-32, en élargissant aux trois rôles (la caisse rédige des messages) : ```ts const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''; const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!); const { data: appelant } = await admin.auth.getUser(jwt); if (!appelant.user) return new Response('Non connecté', { status: 401, headers: entetes }); const { data: profil } = await admin.from('profils').select('role, actif') .eq('user_id', appelant.user.id).maybeSingle(); if (!profil?.actif)…

#### F-05 — supprimer-utilisateur absente de la procédure de déploiement documentée
**Gravité** FAIBLE · **Phase** 1 · **Coût** 10 min · ⚠️ **à vérifier** (non tranchable depuis le code seul)

**Preuve** — docs/mise-en-service.md:84 (titre « E. Edge Functions (traduction + invitations) ») et le bloc bash l.86-93 : seules `supabase functions deploy traduire` (l.90) et `supabase functions deploy inviter-utilisateur` (l.91) y figurent ; l.95-97 affirment que « sans ces fonctions, la supervision fonctionne quand même ». La fonction existe pourtant : supabase/functions/supprimer-utilisateur/index.ts (sa propre commande de déploiement n'est écrite qu'en commentaire, l.5) et elle est appelée sans repli par src/data/supabase.ts:648-654 (`functions.invoke('supprimer-utilisateur', …)` l.650, `if (error) throw new Error(error.message)` l.653) depuis src/pages/supervision.ts:2637-2648 (bouton défini…

**Scénario** — Modèle (d), départ d'un agent. L'administrateur clique « Supprimer » (src/pages/supervision.ts:2267) et confirme (l.2638). Si la fonction n'a jamais été déployée — ce que la procédure de mise en service ne demande nulle part — la passerelle répond 404, `functions.invoke` remonte une erreur, src/data/supabase.ts:653 lève, et supervision.ts:2648 `.catch(erreurVersToast)` affiche un toast d'erreur ; la liste n'étant pas rechargée, la ligne de l'agent reste affichée. C'est un ÉCHEC BRUYANT ET VISIBLE, pas un échec silencieux : l'administrateur voit que la suppression n'a pas eu lieu. Conséquence réelle, plus étroite que celle annoncée : le bouton de l'interface est inopérant, pas l'effacement lui-même. (1) Les droits du partant se coupent immédiatement avec la case « Actif » de la même ligne (supervision.ts:2265 → supabase.ts:637-645), car…

**Correctif** — Ajouter la ligne manquante dans docs/mise-en-service.md, bloc de l'étape E (après la l.91) : `supabase functions deploy supprimer-utilisateur`. Vérifier dans le tableau de bord Supabase → Edge Functions que les trois fonctions sont bien listées. Compléter aussi la phrase des l.94-97 qui prétend que « sans ces fonctions la supervision fonctionne quand même » : c'est vrai pour la traduction et l'invitation, faux pour la suppression de compte.

#### F-06 — Le type MIME contrôlé est celui DÉCLARÉ par le navigateur, jamais le contenu réel du fichier
**Gravité** FAIBLE · **Phase** 1 · **Coût** 1 h · ⚠️ **à vérifier** (non tranchable depuis le code seul)

**Preuve** — src/data/supabase.ts:546 — `const stockage = await this.client.storage.from('medias').upload(chemin, file);` : envoi sans option `contentType`. node_modules/@supabase/storage-js/dist/index.mjs:598-601 (`DEFAULT_FILE_OPTIONS`, contentType "text/plain;charset=UTF-8") et 622-626 (branche `fileBody instanceof Blob` → `new FormData()` + `body.append("", fileBody)`, ligne 626) : pour un File, `contentType` n'est jamais posé en en-tête — seule la branche `else` de la ligne 634 (`headers["content-type"] = options.contentType`) l'utilise. Le type retenu est donc `File.type`, déduit de l'extension. src/pages/supervision.ts:1718 — `const type = fichier.type.startsWith('video/') ? 'video' : 'image';` ;…

**Scénario** — Volet sécurité SUPPRIMÉ (réfuté) : l'INSERT sur `storage.objects` est réservé aux rôles admin/supervision (schema.sql:580-582), `image/svg+xml` n'est pas dans `allowed_mime_types` (schema.sql:572), et un contenu servi en `image/png` n'est pas exécuté par Chromium. Aucun gain pour les modèles (a), (b) ou (c) ; pour (d), c'est négligeable devant les droits d'écriture sur les circulations dont il dispose déjà. Volet exploitation RETENU mais recalibré : un agent admin/supervision téléverse un fichier dont l'extension ne correspond pas au contenu (typiquement une vidéo renommée .png, ce qui suppose un renommage délibéré — le sélecteur de supervision.html:320 ne propose pas ce fichier par défaut). Rien ne le bloque : `File.type` vaut image/png, `allowed_mime_types` valide le type déclaré, la colonne `medias.type` est écrite à « image »…

**Correctif** — Dans src/data/supabase.ts:544-546, lire les premiers octets avant l'envoi et refuser toute incohérence signature/type, puis forcer le type déduit de la signature : `const tete = new Uint8Array(await file.slice(0, 12).arrayBuffer());` — JPEG `FF D8 FF`, PNG `89 50 4E 47`, MP4 `....66 74 79 70` en octets 4-7 — puis `.upload(chemin, file, { contentType: typeDeduit })` et propager `typeDeduit` dans `meta.type` au lieu de `fichier.type` (src/pages/supervision.ts:1718). Cela ferme aussi le cas (ii), qui est le plus fréquent en exploitation.

#### F-07 — Fichiers orphelins : l'échec de suppression dans le stockage est ignoré, et l'envoi précède l'insertion en base
**Gravité** FAIBLE · **Phase** 1 et 2 · **Coût** 1 h

**Preuve** — src/data/supabase.ts:565-570 (deleteMedia : `error` du SELECT ligne 566 jeté, DELETE de la ligne ligne 567 AVANT le fichier, `remove()` ligne 569 sans `verifie()`) ; src/data/supabase.ts:544-557 (upload ligne 546 avant insert lignes 553-555, `verifie` ligne 556 ; `tousLesMedias()` ligne 551 peut aussi lever après l'envoi) ; node_modules/@supabase/storage-js/dist/index.mjs:483-498 et 320-332 (une panne réseau devient une StorageUnknownError RENVOYÉE, jamais levée : l'échec est donc bien silencieux) ; src/pages/supervision.ts:1639 (seule la table `medias` est rendue, aucun listage du bucket dans tout src/) ; supabase/schema.sql:571 (file_size_limit 20 Mo), 211 et 578-585 (écriture/suppression…

**Scénario** — Scénario d'attaque écarté, seul le scénario accidentel tient. Ni le rôle `caisse` (aucun droit sur `medias` ni sur `storage.objects`, schema.sql:211 et 578-585) ni un ancien agent désactivé (`role_courant()` filtre `and actif`, schema.sql:153-156) ne peuvent créer un orphelin ; et un agent `supervision` encore actif n'a pas besoin du bug pour saturer le quota, ses droits légitimes suffisent. Le scénario réel est donc : lors d'une suppression de média depuis le poste de supervision, une coupure réseau survenant entre le DELETE en base (ligne 567) et l'appel `remove()` (ligne 569) — ou avant le SELECT ligne 566 — laisse un fichier de 20 Mo au maximum dans le bucket, sans aucune ligne qui le référence, sans message d'erreur pour l'agent (l'interface affiche « média retiré », supervision.ts:1826-1829) et sans aucun écran de l'application…

**Correctif** — Dans src/data/supabase.ts:565-570, inverser l'ordre et vérifier : supprimer le fichier d'abord, `verifie((await this.client.storage.from('medias').remove([chemin])).error)`, puis seulement supprimer la ligne (un fichier orphelin est plus grave qu'une ligne pointant vers un fichier absent, cette dernière restant visible et resupprimable). Dans uploadMedia (544-557), envelopper l'insert : `try { verifie(error) } catch (e) { await this.client.storage.from('medias').remove([chemin]); throw e }`. Compléter par une requête de contrôle périodique : `select name from storage.objects o where o.bucket_id='medias' and not exists (select 1 from medias m…

#### F-08 — machines.couleur / machines.cercle injectés sans échappement dans des attributs style="…" et value="…" (6 emplacements, dont les écrans voyageurs)
**Gravité** FAIBLE · **Phase** 1 et 2 · **Coût** 45 min (fonction + 6 remplacements + contraintes SQL + test)

**Preuve** — src/pages/ecran.ts:212-214 et 316-318 ; src/pages/grille.ts:205 et 224-226 ; src/pages/supervision.ts:540-542 et 2237-2238 (six interpolations de machines.couleur/machines.cercle dans un attribut, sans echapper()). Puits innerHTML : src/pages/ecran.ts:280 et 317, src/pages/grille.ts:229, src/pages/supervision.ts:2233. Absence de contrainte : supabase/schema.sql:79-84. Écriture réservée admin : supabase/schema.sql:221-222 ; lecture publique seule pour anon : supabase/schema.sql:199. Absence de validation front : src/pages/supervision.ts:2527-2529. Absence de validation provider : src/data/supabase.ts:584-589 ; cast aveugle : src/data/supabase.ts:263. echapper() :…

**Scénario** — Scénario resserré aux seuls chemins réellement exécutables. L'écriture sur `machines` est verrouillée au rôle `admin` par RLS (schema.sql:221-222) : les modèles a (internaute avec clé publishable), b (personne devant l'écran, qui ne dispose que de cette même clé) et c (caisse) sont TOUS bloqués — `anon` n'a que le SELECT (schema.sql:199). Le seul modèle applicable est (d), un compte administrateur d'ancien agent resté actif, ou une session admin détournée. Cet admin envoie directement, hors IHM : PATCH /rest/v1/machines?nom=eq.Marie {"couleur":"red;position:fixed;inset:0;background:#0B2239;z-index:9999"} La pastille de rame de 1 cm devient un rectangle plein écran qui masque le tableau des départs sur les 6 écrans de gare (ecran.ts:212, grille.ts:205 et 224). Aucun guillemet n'est nécessaire : `echapper()` seul ne bloquerait pas cette…

**Correctif** — Fonction unique dans src/pages/affichage-commun.ts, utilisée aux 6 emplacements : ```ts const HEX = /^#[0-9a-fA-F]{6}$/; /** Couleur de rame sûre : hexadécimal strict, sinon le bleu-gris de la charte. */ export function couleurSure(v: string | null | undefined, repli = '#708DA4'): string { return v && HEX.test(v) ? v : repli; } ``` puis `style="background:${couleurSure(machine.couleur)}"`, `box-shadow:0 0 0 .4vh ${couleurSure(machine.cercle)}`, `value="${couleurSure(m.couleur)}"`. Un simple `echapper()` fermerait la sortie d'attribut mais laisserait passer l'injection CSS (le masquage d'un horaire) : c'est la validation hexadécimale qui…

#### F-09 — Le jeton de session est stocké sur l'origine partagée https://rdtmb.github.io, commune à tous les dépôts Pages de l'organisation
**Gravité** FAIBLE · **Phase** 1 · **Coût** 30 min (option a) / 2 h (option b) · ⚠️ **à vérifier** (non tranchable depuis le code seul)

**Preuve** — src/data/supabase.ts:86 `this.client = createClient(url, clePubliable);` (aucune option `auth`) ; node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:245 `this.storage = globalThis.localStorage;` ; node_modules/@supabase/supabase-js/dist/index.cjs:631 ``const defaultStorageKey = `sb-${baseUrl.hostname.split(".")[0]}-auth-token`;`` ; docs/mise-en-service.md:81 `https://<organisation>.github.io/tmb-affichage-gares/` ; `git remote -v` → https://github.com/RDTMB/tmb-affichage-gares.git ; aucun fichier CNAME dans le dépôt et `curl -L https://rdtmb.github.io/tmb-affichage-gares/` → 200 sans redirection ; aggravant vérifié : aucun `auth.signOut()` dans src/, src/pages/supervision.ts:2846…

**Scénario** — Exposition LATENTE, non exploitable aujourd'hui. Vérification faite : l'organisation RDTMB n'a qu'un seul dépôt public (celui-ci) et c'est le seul avec Pages actif — aucun second site ne partage donc actuellement l'origine https://rdtmb.github.io. Le scénario ne s'ouvre que si un second dépôt de l'organisation active Pages (vitrine, démo, dépôt de test confié à un prestataire) ; il faut alors un acteur disposant d'un droit d'écriture sur un dépôt de l'organisation — modèle (c) ou (d), et non le modèle (a) « n'importe qui sur Internet » annoncé. Dans ce cas seulement, une ligne de JS sur l'autre page lit `localStorage.getItem('sb-<ref>-auth-token')` dans le navigateur d'un agent ayant ouvert la supervision depuis la même machine, et comme aucun `auth.signOut()` n'existe dans le code, le jeton reste exploitable durablement pour écrire sur…

**Correctif** — Deux options, la seconde étant la vraie. (a) Réduire la fenêtre : passer la session en `sessionStorage` — `createClient(url, cle, { auth: { storage: window.sessionStorage } })` à src/data/supabase.ts:86 — ce qui ferme aussi, par effet de bord, la moitié du constat n°1 (la session meurt à la fermeture de l'onglet) ; à combiner avec le vrai `signOut()`. (b) Servir la supervision depuis un sous-domaine dédié (`supervision.tramwaydumontblanc.fr` en CNAME sur Pages), qui lui donne une origine propre — c'est de toute façon ce que la phase 2 imposera.

#### F-10 — Les 4 actions GitHub sont épinglées sur un TAG MOBILE (@v4/@v3), pas sur un SHA : le contenu des 6 écrans dépend de dépôts tiers modifiables
**Gravité** FAIBLE · **Phase** 1 · **Coût** 30 min

**Preuve** — .github/workflows/deploy.yml:25 — ` - uses: actions/checkout@v4` .github/workflows/deploy.yml:26 — ` - uses: actions/setup-node@v4` .github/workflows/deploy.yml:45 — ` - uses: actions/upload-pages-artifact@v3` .github/workflows/deploy.yml:57 — ` uses: actions/deploy-pages@v4` (preuve d'origine exacte, lignes confirmées ; seul workflow du dépôt) Éléments d'atténuation lus dans le code : public/sw.js:9 — `const VERSION = 'tmb-v1';` (constante, jamais dérivée du build) public/sw.js:16-17 — grilles JSON dans `PRECACHE` public/sw.js:57 — `evenement.respondWith(cacheDabord(requete));` (tout ce qui n'est pas navigation/config.js) public/sw.js:24-31 — `install` → `cache.addAll(PRECACHE)`, déclenché…

**Scénario** — Scénario corrigé (une variante retirée, attaquant requalifié) : Les tags `v4`/`v3` sont des pointeurs mutables : leur propriétaire peut les déplacer. Mais ici le propriétaire est l'organisation `actions/` de GitHub lui-même, pas un mainteneur indépendant. Le scénario suppose donc la compromission de l'org `actions/` — un adversaire qui n'entre dans aucun des modèles a) à e) retenus pour ce projet, et qui contrôlerait de toute façon déjà le runner, l'hébergement du dépôt et GitHub Pages (l'épinglage SHA n'en referme qu'une partie). Sous cette hypothèse, le déroulé matériellement possible est le suivant. Un commit piégé est publié sous le tag `v3` de `actions/upload-pages-artifact`. Au prochain push légitime sur `main`, `npm test` (ligne 31) passe sur le code sain, puis l'action réécrit `dist/assets/ecran-*.js` avant de créer le tar. Ces…

**Correctif** — Épingler sur SHA complet, avec le tag en commentaire pour rester lisible. Obtenir les SHA (à refaire au moment d'appliquer, ne pas recopier des valeurs de seconde main) : ```bash gh api repos/actions/checkout/git/ref/tags/v4 --jq .object.sha gh api repos/actions/setup-node/git/ref/tags/v4 --jq .object.sha gh api repos/actions/upload-pages-artifact/git/ref/tags/v3 --jq .object.sha gh api repos/actions/deploy-pages/git/ref/tags/v4 --jq .object.sha ``` (si le tag est annoté, le premier appel renvoie un objet `tag` : refaire `gh api repos/<o>/<r>/git/tags/<sha> --jq .object.sha` pour obtenir le commit.) Puis : ```yaml - uses:…

#### F-11 — `actions/checkout` laisse le GITHUB_TOKEN dans .git/config, lisible par `npm ci` et `npm test` qui s'exécutent juste après
**Gravité** FAIBLE · **Phase** 1 · **Coût** 10 min

**Preuve** — .github/workflows/deploy.yml:25 — `- uses: actions/checkout@v4`, sans bloc `with:` (donc `persist-credentials: true` par défaut, écrivant `http.https://github.com/.extraheader` dans `.git/config`). .github/workflows/deploy.yml:30-31 — `- run: npm ci` puis `- run: npm test`, même répertoire de travail. Contexte limitant, vérifié : deploy.yml:8-10 (déclencheurs `push: branches: [main]` et `workflow_dispatch` uniquement ; aucun autre fichier dans .github/workflows/, aucun trigger `pull_request`), deploy.yml:12-15 (`contents: read`, `pages: write`, `id-token: write`), deploy.yml:44-47 (`npm run build` puis `upload-pages-artifact`, postérieurs à npm ci/test dans le même job). Aucune commande…

**Scénario** — Scénario réduit à sa seule branche exécutable, et à son impact réel. Une dépendance npm compromise exécute un script d'installation pendant `npm ci` (l.30) — rien ne l'en empêche : le champ `allowScripts` de package.json est une convention @lavamoat/allow-scripts, absente des dépendances, donc inopérante. Ce script lit `.git/config`, décode l'en-tête `extraheader` et obtient le GITHUB_TOKEN du job, qu'il peut exfiltrer. Ce jeton porte `contents: read` (sans valeur : dépôt public), `pages: write` et `id-token: write`, et il est révoqué en fin de job. Ce que le scénario d'origine surestime : il ne permet PAS « de déployer ce qu'on veut sur les 6 écrans depuis l'extérieur » comme capacité nouvelle. Le même code hostile s'exécute l.30-31, avant `npm run build` (l.44) et `upload-pages-artifact` (l.45-47) du même job : il lui suffit d'altérer…

**Correctif** — ```yaml - uses: actions/checkout@<sha> # v4.x.y with: persist-credentials: false ``` Aucune étape du workflow ne pousse ni ne lit git après le checkout, la suppression des credentials persistés est sans effet de bord ici (vérifié : aucune commande `git` dans les étapes 26 à 47).

#### F-12 — Le précache du service worker est figé sur les grilles 2026 et `addAll` est tout-ou-rien : à la prochaine saison, plus de démarrage hors ligne, en silence
**Gravité** FAIBLE · **Phase** 1 · **Coût** 1 h

**Preuve** — public/sw.js:16-17 (noms de saison en dur dans PRECACHE) ; public/sw.js:24-31, en particulier :28 `.then((cache) => cache.addAll(PRECACHE))` dans le `waitUntil` de l'install ; public/sw.js:45 `if (requete.cache === 'no-store') return;` (et NON :47, qui est le test d'origine croisée) — c'est cette ligne qui prouve que les grilles précachées ne sont jamais servies ; src/data/supabase.ts:94-97 (`['2026-ete-grand-service', '2026-ete-petit-service']` puis `fetch(..., { cache: 'no-store' })`) et src/data/mock.ts:374-376 ; src/pages/resilience.ts:92 `void navigator.serviceWorker.register(...).catch(() => {});` ; public/sw.js:54-56 (navigations réseau d'abord) et public/sw.js:70-80 (`reseauDabord`,…

**Scénario** — Pas d'attaquant : dérive de maintenance datée. À l'été 2027, public/grilles/2026-ete-*.json sont renommés ou remplacés. Le développeur EST forcé de corriger src/data/supabase.ts:94, src/data/mock.ts:374 et les ~9 imports de tests (sinon `tsc` et `vitest` échouent et le déploiement est bloqué), mais public/sw.js:16-17 n'est ni typé, ni importé, ni testé : il reste sur les noms 2026. Le build passe, les tests passent, le déploiement part. Dès lors, `cache.addAll` reçoit un 404 sur ces deux URL, la promesse est rejetée, le `waitUntil` échoue et le NOUVEAU service worker n'est jamais installé — silencieusement, `.catch(() => {})` (src/pages/resilience.ts:92) n'en dit rien à personne, ni à la supervision. Conséquence RÉELLE, plus étroite que celle annoncée : - Sur les 6 Pi déjà en service, rien ne casse. L'ancien worker tmb-v1 reste actif et…

**Correctif** — Deux corrections, la première suffit à supprimer la bombe à retardement. 1) Retirer les deux lignes 16-17 de public/sw.js : elles n'apportent rien (requêtes `no-store`, jamais servies depuis le cache) et sont la seule partie de PRECACHE qui dépend d'un nom de saison. Le repli hors ligne des grilles est déjà assuré par l'instantané localStorage (src/pages/resilience.ts:68-75). 2) Rendre l'installation tolérante et observable : ```js self.addEventListener('install', (evenement) => { evenement.waitUntil( caches.open(VERSION).then(async (cache) => { // une URL manquante ne doit PAS empêcher l'installation de la coquille await Promise.all(…

#### F-13 — Média injoignable : une surface noire plein écran recouvre le tableau des départs, sans aucune gestion d'erreur
**Gravité** FAIBLE · **Phase** 1 · **Coût** 1 h

**Preuve** — src/pages/ecran.ts:354-357 (construction img/video sans gestion d'erreur), :358 (`mode-media` posé inconditionnellement avant tout chargement), :360-362 (seul `ended` écouté) ; src/styles/ecran.css:687-694 (`.media-plein` fixed/inset:0/background:#000/z-index:45) et :697-699 (`body.mode-media .media-plein { display: flex }`) ; src/core/cycle-medias.ts:39-42 (durée purement temporelle) et :88-97 (rejeu indéfini) ; src/data/supabase.ts:231 (URL distante `getPublicUrl`) ; public/sw.js:47-52 et :60-67 (`cacheDabord` : cache seulement après première lecture réussie, rejette sinon). Bornes non citées par l'auditeur : supabase/schema.sql:70 (`duree_s` 3-120 s), src/pages/ecran.ts:375-379 +…

**Scénario** — Un fichier est supprimé du bucket Storage sans que la ligne `medias` soit désactivée (cas le plus réaliste, permanent), ou la liaison 5G du Nid d'Aigle est partiellement dégradée (les requêtes Supabase passent, le fichier média non). Le cycle arrive sur ce média : `mode-media` est posé sans attendre le chargement (ecran.ts:358), la requête échoue, aucun écouteur `error` n'existe — l'écran affiche un rectangle NOIR plein écran pendant toute la durée annoncée du média (3 à 120 s, défaut 8 s, borné par schema.sql:70), puis revient aux horaires, et recommence à chaque tour. En mode « serie » avec plusieurs médias injoignables, les durées s'additionnent avant le retour aux horaires. Effet réel : l'écran clignote périodiquement en noir et paraît en panne à un voyageur ou à un agent, ce qui peut déclencher une intervention inutile en gare. Ce…

**Correctif** — Ne poser `mode-media` qu'une fois le média réellement décodé, et rendre la main à la première erreur. Dans src/pages/ecran.ts:345-365 : ```ts const abandonne = (): void => { // Média injoignable : on rend IMMÉDIATEMENT la place aux horaires. document.body.classList.remove('mode-media'); conteneur.innerHTML = ''; mediaAffiche = null; if (etatCycle) etatCycle = { ...etatCycle, finMs: heure.maintenantMs() }; }; const el = conteneur.firstElementChild as HTMLImageElement | HTMLVideoElement | null; el?.addEventListener('error', abandonne); el?.addEventListener('load', () => document.body.classList.add('mode-media')); // image…

#### F-14 — Reconstruction intégrale du DOM une fois par seconde, 24 h/24, sur un Raspberry Pi
**Gravité** FAIBLE · **Phase** 1 et 2 · **Coût** 1 h

**Preuve** — src/pages/ecran.ts:280 (`$('corps').innerHTML = lignes.join('');`), appelé sans condition depuis src/pages/ecran.ts:486, dans la boucle src/pages/ecran.ts:590-593. src/pages/grille.ts:301-302 (les deux `innerHTML = tableHtml(...)`) et src/pages/grille.ts:298-300 (`positionsTrains(...)` recalculé), dans la boucle src/pages/grille.ts:383-387. Volume réel : src/pages/grille.ts:121-141 (`colonnesDuSens` ne filtre aucun train) → 6 gares × ~13 colonnes ≈ 91 cellules par tableau, ~182 au total ; côté écran des départs, `slice(0, 5)` à src/pages/ecran.ts:478 limite à 5 lignes. Gardes existantes ailleurs dans le même code : src/pages/affichage-commun.ts:89 et src/pages/ecran.ts:269. Absence de…

**Scénario** — Scénario corrigé, débarrassé de la spéculation thermique : Les pages `ecran.html` et `grille.html` réécrivent inconditionnellement le contenu de leurs conteneurs à chaque tick d'une seconde, alors que le même dépôt applique déjà une garde par signature ailleurs (src/pages/affichage-commun.ts:89, src/pages/ecran.ts:269). La page grille est la plus exposée : elle n'a aucun mode veille nuit et sa resynchro toutes les 30 s empêche le mode neutre de servir de sortie anticipée, donc elle rebâtit ~182 cellules (~10 Ko de HTML) et recalcule `positionsTrains()` sur les 26 trains de la journée 86 400 fois par jour, entre deux redémarrages (docs/kiosque.md:81). Conséquence RÉELLE et observable, sur laquelle repose la gravité FAIBLE : la recréation du DOM chaque seconde redémarre les animations CSS portées par les nœuds recréés. Le point de position…

**Correctif** — Même remède que pour le constat sur le clignotement, appliqué aux deux pages : mémoriser le HTML produit et n'écrire dans le DOM que s'il a changé. src/pages/grille.ts:301-302 : ```ts let derniereMontee = '', derniereDescente = ''; // … const m = tableHtml('montee', maintenant, positions); if (m !== derniereMontee) { derniereMontee = m; $('tab-montee').innerHTML = m; } const d = tableHtml('descente', maintenant, positions); if (d !== derniereDescente) { derniereDescente = d; $('tab-descente').innerHTML = d; } ``` En complément, sortir plus tôt pendant la veille : dans src/pages/ecran.ts:590, tester la veille AVANT d'appeler `rendre()`, et…

#### F-15 — Windows Server 2019 : fin de support étendu le 9 janvier 2029, et le redémarrage du Patch Tuesday doit tomber hors exploitation
**Gravité** FAIBLE · **Phase** 2 · **Coût** 1 h maintenant (choix de la version du système + configuration de la fenêtre de mise à jour). Après : migrer le système d'exploitation d'un serveur en production, avec la base,…

**Preuve** — docs/02-spec-technique.md:405 (« ## 7. Phase 2 — micro-serveur interne (tour Windows Server 2019) ») et :412-413 (« Installation en service Windows via `nssm` ») — vérifiés mot pour mot ; §7 lu en entier (405-419) : aucune mention de cycle de vie, de Windows Update ni de fenêtre de maintenance. docs/02-spec-technique.md:401 (et NON 399) : « unclutter, NTP, reboot 04:30 ». supabase/schema.sql:133-134 : `veille_debut time` / `veille_fin time`, SANS valeur par défaut en base (132 = commentaire « Veille de nuit propre à ce poste ; nulles = suit params.veille_nuit »). Les défauts `21:00`/`06:00` sont côté client et portent sur le paramètre global `veille_nuit` : src/data/supabase.ts:253-256.…

**Scénario** — Deux échéances de nature différente, dont une surestimée. (a) Court terme, enjeu n°2, borné. Le Patch Tuesday tombe le deuxième mardi de chaque mois. Si aucune fenêtre de maintenance n'est décidée, le redémarrage d'installation des mises à jour peut tomber en pleine exploitation. Effet réel, déroulé sur le code : les 6 écrans perdent leur source ; tant que l'âge de la dernière synchro réussie reste sous `duree_cache_min` (15 min par défaut, src/pages/ecran.ts:148), ils continuent d'afficher des horaires JUSTES avec le badge « Données de HH:MM » (src/pages/ecran.ts:433-438) — aucun horaire faux n'est jamais montré, le code l'interdit explicitement. Ce n'est qu'AU-DELÀ de 15 minutes d'indisponibilité continue que bascule l'écran neutre (src/pages/ecran.ts:450-457) et que six gares se retrouvent sans information voyageurs. Un cumulative…

**Correctif** — (1) Poser la question maintenant, pendant que la tour n'est pas installée : si la machine est de toute façon à préparer, l'installer directement en Windows Server 2022 (support étendu jusqu'en octobre 2031) ou 2025 (jusqu'en 2034) coûte le même travail aujourd'hui et supprime une migration ; si 2019 est imposé par l'existant, INSCRIRE la migration au budget avant janvier 2029 et le noter dans docs/phase2-windows.md ; (2) fenêtre de maintenance explicite : Windows Update configuré (GPO ou WSUS) pour installer et redémarrer entre 02:00 et 04:00, soit pendant la veille de nuit des écrans et AVANT leur redémarrage de 04:30 (docs/02:399) — la…

#### F-16 — `Jour.enregistre = false` n'est lu par AUCUN écran : une journée non enregistrée en base est peinte comme une journée d'exploitation confirmée
**Gravité** FAIBLE · **Phase** 1 et 2 · **Coût** 1 h

**Preuve** — src/data/supabase.ts:136-154 — `if (!ligne || circulations.length === 0) { if (date >= dateAujourdhuiParis() && (await this.peutEcrireExploitation())) { ... cree.enregistre = true; return cree; } const defaut = generationJour(grille, date); if (ligne) defaut.terminus_bellevue = versFlag(ligne); defaut.enregistre = false; return defaut; }` — un écran ANONYME (qui n'a aucun droit d'écriture, cf. `peutEcrireExploitation`, supabase.ts:177-186) reçoit donc la grille THÉORIQUE marquée `enregistre: false`. src/core/types.ts (déclaration `enregistre?: boolean`, commentaire reconnaissant explicitement le cas « côté écrans anonymes »). LE DRAPEAU N'EST BRANCHÉ NULLE PART : `grep -n "enregistre"…

**Scénario** — Sans attaquant. Deux déclencheurs, tous deux d'exploitation : (a) une journée jamais ouverte en supervision (début de saison, week-end, poste d'exploitation indisponible) : les 6 écrans affichent la grille théorique — ce qui est JUSTE tant qu'aucune décision d'exploitation n'a été prise, mais rien ne distingue « horaire confirmé » de « horaire théorique non confirmé » ; (b) une génération de journée interrompue entre les deux requêtes de `genererJour` (supabase.ts:394-404) : la ligne `jours` existe, les 26 circulations non. Les écrans anonymes retombent sur la grille théorique jusqu'à ce qu'un compte admin/supervision rouvre la date. La conséquence n'est pas un horaire inventé — c'est l'ABSENCE de signal quand l'application sait qu'elle ne sert pas la journée d'exploitation. Le jour où la source de vérité est perdue (perte de base,…

**Correctif** — Brancher le drapeau existant, dans src/pages/ecran.ts (fonction `rendre`, avant la ligne 477) et symétriquement dans src/pages/grille.ts : ```ts // La journée servie n'est pas celle qui est enregistrée en exploitation : // on le DIT plutôt que de la présenter comme confirmée. if (jour && jour.enregistre === false && !jour.hors_saison && jour.date === heure.dateISO()) { document.body.classList.add('mode-degrade'); $('badge-cache').textContent = 'Horaire théorique — non confirmé / Theoretical timetable — unconfirmed'; } ``` Et, côté écriture, rendre `genererJour` insensible à la coupure : inverser l'ordre n'est pas possible (contrainte de clé…

---

## 7. Constats INFORMATIFS

*Cette section contient aussi les **résultats négatifs** : les points vérifiés qui ne présentent
aucun défaut. Ils sont utiles — ils disent ce qui a été regardé et ce qu'il ne faut pas casser.*

#### I-01 — private.sync_rame_descente() contourne RLS et écrit la ligne numero+1 sans vérifier son sens
**Gravité** INFORMATIF · **Phase** 1 et 2 · **Coût** 10 min

**Preuve** — supabase/schema.sql:164-179 (vérifié verbatim) ; définition identique en supabase/securite-advisors.sql:78-93 (vérifié verbatim) ; absence de FORCE RLS : aucun `force row level security` dans supabase/ ; journalisation de la cascade : supabase/ajout-journal-exploitation.sql:163-169 (colonne `rame` surveillée) ; parité non contrainte en base : supabase/schema.sql:24 et 45 ; policies d'écriture : supabase/schema.sql:208-210 ; numérotation disciplinée côté front : src/core/train-sup.ts:213-218 et src/pages/supervision.ts:959-988

**Scénario** — Scénario conservé sur le fond, corrigé sur deux points de précision. (a) Portée de la chaîne, légèrement surestimée dans le constat d'origine. Avec UNE seule ligne paire erronée (ex. numero 4 marquée `sens='montee'`), la propagation atteint exactement numero+1 et numero+2, puis s'arrête : le déclencheur écrit la rame sur 5, ce qui déclenche à nouveau la fonction sur 5 (impair, donc `montee`), qui écrit sur 6, laquelle est une `descente` et n'écrit plus rien. Il faut une SECONDE ligne paire erronée pour aller au-delà. « numero+2, +3… » doit donc se lire « numero+1 et numero+2 ». L'arrêt vient d'abord du `sens='descente'` de la ligne suivante ; le garde `rame is distinct from` n'est qu'un second filet (il empêche la récursion quand les valeurs convergent). (b) Précondition à nommer explicitement : la ligne paire marquée `montee` n'est…

**Correctif** — Une condition en plus, sur la ligne cible : ```sql update public.circulations set rame = new.rame where date = new.date and numero = new.numero + 1 and sens = 'descente' and rame is distinct from new.rame; ``` À appliquer dans schema.sql:168-169 ET securite-advisors.sql:82-83.

#### I-02 — messages.cree_par et medias.cree_par : colonnes d'attribution non contrôlées, aujourd'hui inutilisées
**Gravité** INFORMATIF · **Phase** 1 et 2 · **Coût** 10 min

**Preuve** — supabase/schema.sql:61 (`cree_par text,` dans `messages`) et supabase/schema.sql:75 (`cree_par text,` dans `medias`) — texte libre, sans défaut, sans CHECK, sans NOT NULL, sans déclencheur de remplissage. supabase/schema.sql:216-218 — policy « messages tous roles » : ne teste que `private.role_courant()`, jamais `cree_par`. Idem « exploitation » sur medias, supabase/schema.sql:211-213 (recréées à l'identique en supabase/securite-advisors.sql:108-114). Aucun `grant (colonnes)` ni trigger BEFORE sur ces tables ; les seuls triggers sont AFTER et traçants (supabase/schema.sql:500-508). Grep `cree_par` sur tout le dépôt : uniquement schema.sql:61 et 75, plus docs/02-spec-technique.md:102 et…

**Scénario** — Aucun scénario d'attaque aujourd'hui : les deux colonnes ne sont jamais écrites, jamais lues, jamais affichées — il n'y a rien à falsifier ni à croire. Le risque est purement différé et plus étroit que ne le dit le constat d'origine. D'une part il ne concerne `medias` qu'à partir du rôle `supervision` (la policy schema.sql:211-213 exclut `caisse`, contrairement à ce qu'affirme le scénario annoncé) ; seul `messages` est ouvert à la caisse. D'autre part, contrairement à `publications.qui`, la traçabilité ne « paraîtrait pas exister sans exister » : les triggers de journal de schema.sql:500-508 surveillent déjà toutes les colonnes de ces deux tables et attribuent chaque écriture à l'email tiré d'`auth.uid()` (ajout-journal-exploitation.sql:96), valeur que le client ne peut pas forger. Le jour où une page de supervision afficherait « message…

**Correctif** — Soit supprimer les deux colonnes mortes (`alter table messages drop column cree_par; alter table medias drop column cree_par;`), soit, si l'attribution est voulue, la remplir côté serveur par un déclencheur BEFORE INSERT calqué sur ajout-journal-exploitation.sql:96 — jamais depuis le client.

#### I-03 — inviter-utilisateur : role, nom et email non validés côté serveur, et l'erreur de l'upsert profils n'est PAS vérifiée — compte auth orphelin + réponse ok:true mensongère
**Gravité** INFORMATIF · **Phase** 1 · **Coût** 30 min

**Preuve** — supabase/functions/inviter-utilisateur/index.ts:34-44 (exact). l.34-38 assertion TS sans validation d'exécution ; l.39-42 `inviteUserByEmail(email)` avec erreur correctement testée ; l.43 `await admin.from('profils').upsert({...})` — valeur de retour JETÉE ; l.44 `return new Response(JSON.stringify({ ok: true }), ...)` inconditionnel. Contrôle d'appelant admin : index.ts:22-32. Contraintes base : supabase/schema.sql:113 `nom text not null`, :115 `check (role in ('admin','supervision','caisse'))`. Front : src/data/supabase.ts:656-661 (`inviteUser`), src/data/supabase.ts:632 (`listUsers` lit `profils`), src/pages/supervision.ts:2604 et :2609 (« Invitation envoyée à … » — le constat citait…

**Scénario** — Scénario corrigé (le scénario d'origine est exécutable mais son acteur et son impact sont surestimés). ACTEUR RÉEL : un administrateur actif — hors modèles a/b/c/d/e — car index.ts:30-32 renvoie 403 à tout autre rôle et 401 à l'anonyme. L'interface elle-même ne peut pas produire le payload décrit (supervision.html:439-443 = select fermé, supervision.ts:2598-2601 = nom/email obligatoires) : il faut une requête forgée à la main ou un script maison. DÉCLENCHEUR RÉALISTE, celui qui compte : pas le `role:"superadmin"`, mais un échec BÉNIN de l'upsert l.43 (coupure réseau ou timeout PostgREST entre la création du compte auth et l'écriture du profil). Déroulé : l.39 `inviteUserByEmail` réussit, la ligne `auth.users` est créée et l'e-mail d'invitation part → l.43 l'upsert échoue, l'erreur est jetée → l.44 la fonction répond `{ok:true}` →…

**Correctif** — Dans supabase/functions/inviter-utilisateur/index.ts, remplacer les lignes 34-44 par : ```ts const ROLES = ['admin', 'supervision', 'caisse'] as const; const { email, nom, role } = (await req.json()) as { email?: unknown; nom?: unknown; role?: unknown }; if (typeof email !== 'string' || email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return new Response('Adresse e-mail invalide', { status: 400, headers: entetes }); if (typeof nom !== 'string' || !nom.trim() || nom.length > 100) return new Response('Nom invalide', { status: 400, headers: entetes }); if (typeof role !== 'string' || !ROLES.includes(role as (typeof…

#### I-04 — CORS Access-Control-Allow-Origin: '*' sur les trois fonctions — impact réel NUL, justification
**Gravité** INFORMATIF · **Phase** 1 · **Coût** aucun

**Preuve** — supabase/functions/traduire/index.ts:7, supabase/functions/inviter-utilisateur/index.ts:8, supabase/functions/supprimer-utilisateur/index.ts:9 (joker CORS) ; traduire:12, inviter-utilisateur:13, supprimer-utilisateur:14 (Allow-Headers au préflight) ; inviter-utilisateur/index.ts:22-24 et supprimer-utilisateur/index.ts:23-25 (lecture du JWT, getUser, 401) ; inviter-utilisateur/index.ts:30-32 et supprimer-utilisateur/index.ts:31-33 (403 si non admin actif) ; src/data/supabase.ts:86 (createClient sans options → session en localStorage, pas de cookie) ; src/data/supabase.ts:650, 658, 671 (les trois seuls appels functions.invoke du front). Absence vérifiée : aucun supabase/config.toml, aucune…

**Scénario** — Le scénario est exact et exécutable tel que décrit : la requête cross-origin part sans Authorization, atteint supprimer-utilisateur/index.ts:23 avec `jwt = ''`, et la l.25 répond 401. Une seule nuance à corriger dans la dernière phrase, sur le « seul cas où le joker aurait un coût ». Même avec `verify_jwt` désactivé sur `traduire`, le joker CORS n'est PAS ce qui ouvre l'abus de quota DeepL : CORS est une politique de navigateur, elle n'a aucun effet sur un appel direct. N'importe qui pourrait alors épuiser le quota en une ligne de curl vers https://<projet>.supabase.co/functions/v1/traduire, sans que le moindre en-tête CORS n'entre en jeu — c'est plus simple et plus efficace que de passer par les navigateurs de visiteurs. Le joker n'ajoute, dans ce cas hypothétique, que la variante distribuée (POST application/json est préflighté, donc…

**Correctif** — Aucun changement nécessaire. Si l'on veut resserrer par principe, remplacer `'*'` par l'origine exacte du déploiement dans les trois fichiers — mais cela n'apporte rien tant que l'autorisation repose sur un en-tête Authorization et non sur un cookie, et cela casserait les tests depuis `npm run preview` (http://localhost:4173).

#### I-05 — Vérifié SANS défaut : pas d'écrasement possible d'un média existant, nom de fichier assaini, pas de traversée de chemin
**Gravité** INFORMATIF · **Phase** 1 · **Coût** —

**Preuve** — supabase/schema.sql:578-585 (SELECT 578-579, INSERT 580-582, DELETE 583-585 — aucune policy UPDATE) ; supabase/securite-advisors.sql:181-188 (recrée les mêmes trois, toujours aucune UPDATE) ; supabase/schema.sql:211-213 (policy `exploitation` sur `medias`, admin/supervision) ; supabase/schema.sql:153-156 (`private.role_courant()` filtre sur `actif`) ; src/data/supabase.ts:545 (assainissement du nom + préfixe `Date.now()`), :546 (`.upload(chemin, file)` sans options), :547 (erreur remontée en exception) ; src/pages/supervision.ts:96-100 (`caisse: ['bandeau']`) ; node_modules/@supabase/storage-js/dist/index.mjs:598-601 (`upsert:false` par défaut) et :620 (en-tête `x-upsert`).

**Scénario** — Modèle (c)/(d) : un agent de rôle supervision qui tenterait d'écraser le média d'un collègue par un envoi au même chemin reçoit un refus. Il peut en revanche SUPPRIMER n'importe quel objet du bucket puis en déposer un autre (policy DELETE de schema.sql:583-585, non restreinte au déposant) — mais c'est exactement le droit que son rôle lui accorde déjà sur la table `medias` (schema.sql:211-213), donc aucune escalade. La caisse, elle, est bloquée côté SERVEUR et pas seulement dans l'interface : la policy `exploitation` de schema.sql:211-213 exige `admin`/`supervision`, ce que src/pages/supervision.ts:96-100 (`caisse: ['bandeau']`) ne fait que refléter.

**Correctif** — Rien à faire. À conserver tel quel — et si une policy UPDATE devait être ajoutée un jour sur `storage.objects` pour ce bucket, elle rouvrirait l'écrasement silencieux : la refuser.

#### I-06 — Vérifié SANS défaut : l'URL publique injectée dans le HTML ne permet ni XSS ni schéma javascript: — et aucune CSP n'est utile ici
**Gravité** INFORMATIF · **Phase** 1 · **Coût** —

**Preuve** — src/pages/ecran.ts:354-357 (`conteneur.innerHTML =` ; `echapper(media.url)` en 356 et 357) et src/pages/supervision.ts:1639-1646 (`echapper(m.url)` en 1645-1646). src/pages/affichage-commun.ts:6-13 — `echapper()` remplace `&`, `<`, `>`, `"`, `'`. src/data/supabase.ts:225-232 — `LigneMedia extends Omit<Media, 'url'>` et `url` RECALCULÉE à chaque lecture depuis `m.chemin` ; src/data/supabase.ts:560 retire `url` avant écriture ; src/data/supabase.ts:545 assainit le nom de fichier à l'upload. node_modules/@supabase/storage-js/dist/index.mjs:1331-1339 (`getPublicUrl` → `encodeURI(\`${this.url}/object/public/${_path}\`)`) et :1594-1596 (`_getFinalPath` = `\`${this.bucketId}/${path.replace(/^\/+/,…

**Scénario** — Tentative de modèle (c)/(d) : un compte supervision écrit directement en PostgREST un `chemin` contenant `../` ou des guillemets. Résultat réel : `encodeURI` conserve `..` et `/`, le navigateur normalise le chemin AVANT l'envoi, donc au pire l'URL désigne un autre objet public du MÊME projet Supabase (il n'y en a qu'un, le bucket `medias`) ; les guillemets sont neutralisés par `echapper()` avant d'atteindre l'attribut. Aucune exécution de script sur l'origine de l'application n'est atteignable par ce chemin.

**Correctif** — Rien à faire, et surtout PAS de CSP à ce titre : il n'existe aucune injection HTML dans ce chemin de code, GitHub Pages ne permet pas de poser d'en-tête HTTP personnalisée, et un `<meta http-equiv="Content-Security-Policy">` dans ecran.html ne bloquerait rien de plus ici (il faudrait de toute façon autoriser img-src/media-src vers *.supabase.co, c'est-à-dire exactement la source des médias).

#### I-07 — Aucune Content-Security-Policy sur les quatre pages — rien ne rattrape une injection HTML si elle passe
**Gravité** INFORMATIF · **Phase** 1 et 2 · **Coût** 20 min (pose + vérification console sur les 4 pages)

**Preuve** — Absence de CSP confirmée : `grep -n "Content-Security-Policy\|http-equiv" *.html` sur ecran.html, grille.html, index.html, supervision.html ne renvoie AUCUNE ligne (correction : le constat annonçait qu'il renvoyait les meta charset/viewport — le motif `http-equiv` ne matche pas `<meta charset>`). Le `<head>` de ecran.html:3-6 ne contient que `<meta charset="UTF-8" />` (l.4), `<meta name="viewport" …>` (l.5) et `<title>` (l.6) ; idem sur les trois autres pages. Applicabilité vérifiée sur le build réel : dist/ecran.html:7 `<script type="module" crossorigin src="/assets/ecran-B7KWAD3P.js">` + dist/ecran.html:65 `<script src="./config.js">` ; dist/grille.html:7 et 62 ; dist/supervision.html:7…

**Scénario** — Scénario d'origine conservé (il est exact et honnête), avec deux précisions issues de la vérification : - La chaîne d'exécution est réelle : `meteo.t` non échappé (src/pages/affichage-commun.ts:117) → innerHTML (src/pages/ecran.ts:324). Avec `script-src 'self'`, l'attribut `onerror` d'un `<img src=x onerror=…>` ainsi injecté ne s'exécute pas — l'écran de gare affiche une image cassée à la place de la température au lieu de laisser un tiers réécrire le tableau des départs. C'est le seul bénéfice mesurable ici, et il est réel. - Nuance à ajouter sur `connect-src` : le joker `https://*.supabase.co` proposé n'empêche PAS l'exfiltration d'un jeton de session d'administrateur vers un AUTRE projet Supabase (tous partagent le suffixe `*.supabase.co`). La formulation d'origine (« ne pourrait pas exfiltrer vers un domaine tiers ») est donc trop…

**Correctif** — Ajouter dans le `<head>` des quatre fichiers HTML (juste après `<meta charset>`) : ```html <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.supabase.co; media-src 'self' https://*.supabase.co; font-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; worker-src 'self'; base-uri 'none'; form-action 'none'"> ``` Deux précisions de mise en œuvre : (a) l'origine Supabase exacte n'est connue qu'au build (config.js généré depuis les variables de dépôt, .github/workflows/deploy.yml:32-39) — d'où le joker…

#### I-08 — L'auteur d'une publication est fourni par le client : l'historique des publications est falsifiable
**Gravité** INFORMATIF · **Phase** 1 · **Coût** 30 min

**Preuve** — src/data/supabase.ts:708-716 (insert ligne 714 : `.insert({ resume, qui: auth.user?.email ?? 'inconnu' })`) ; supabase/schema.sql:137-142 (`qui text,` sans default) ; supabase/schema.sql:332-333 et supabase/securite-advisors.sql:133-134 (policy sur le rôle seul, aucun contrôle du contenu) ; absence de GRANT de colonnes sur `publications` (les seuls du dépôt : schema.sql:256-259 sur `ecrans`, :368-369 sur `journal_exploitation`) ; à comparer à supabase/schema.sql:418. Contre-preuve limitant la portée : src/data/supabase.ts:681-690, seule lecture de la table, `.select('quand')` — la colonne `qui` n'est lue nulle part dans src/.

**Scénario** — Modèle (c) ou (d). Un compte `caisse` (ou un ancien compte non désactivé) insère directement `insert into publications (resume, qui) values ('...', 'thomas.musset@tramwaydumontblanc.fr')` : la policy schema.sql:332-333 ne vérifie que le rôle, la ligne passe et porte un auteur choisi par l'attaquant. Effet réel s'arrêtant là : la ligne falsifiée n'est affichée sur AUCUNE page — `qui` n'est lu par aucun code (seule lecture : supabase.ts:684, `.select('quand')`) — et n'est consultable que par un administrateur via la console SQL Supabase. Elle est immédiatement contredite par `journal_exploitation`, qui trace les écritures sous-jacentes avec l'auteur résolu côté serveur et interdit toute écriture aux comptes authentifiés. Ni horaire faux affiché en gare, ni écran éteint. Sont RETIRÉS du scénario d'origine, faute de support dans le code : «…

**Correctif** — Rendre la colonne non écrivable et la remplir côté serveur : `alter table publications alter column qui set default (auth.jwt() ->> 'email');` puis `revoke insert (qui) on publications from authenticated;` (le GRANT de colonnes fonctionne ici comme sur `ecrans`). Retirer ensuite `qui` de l'objet inséré à src/data/supabase.ts:714. Variante sans GRANT de colonnes : un trigger `before insert` qui force `new.qui := (select email from public.profils where user_id = auth.uid())`, sur le modèle de `private.horodate_signal_de_vie()`.

#### I-09 — Les DELETE ne vérifient pas le nombre de lignes touchées : un refus RLS y passe pour un succès
**Gravité** INFORMATIF · **Phase** 1 · **Coût** 30 min

**Preuve** — src/data/supabase.ts:56-58 (`verifie` ne teste que `error`), 60-74 (`exigeLignes` et sa justification), 541 / 567 / 592 / 628 (les 4 DELETE sans `.select()`), + 410 non cité par l'auditeur (`jours`) ; à comparer à 621-624 et 748 qui appliquent bien `exigeLignes`. Réfutation : supabase/schema.sql:211-213 et 583-585 (conditions RLS identiques ligne/fichier), schema.sql:153-156 (`role_courant`), src/pages/supervision.ts:100, 1826-1828, 2548-2550, 2585-2587, 2801-2803 (relecture systématique de la base après chaque suppression), src/data/mock.test.ts:430-445.

**Scénario** — Scénario d'origine invalidé sur ses deux volets. Volet Storage : impossible — la policy de suppression du fichier (schema.sql:583-585) et celle de la ligne (schema.sql:211-213) exigent exactement le même rôle, et si la ligne a déjà disparu le `maybeSingle()` de supabase.ts:566 rend `chemin` undefined, donc `storage.remove` (569) n'est pas appelé ; aucun média orphelin, aucune image 404 sur l'écran. Volet « deux agents » : A supprime, B reclique, PostgREST répond 0 ligne sans erreur, B voit un toast de succès — mais le `.then(rechargeMedias/rechargeParams/chargeTout)` qui suit immédiatement relit la base, et l'objet réapparaît (ou reste absent, selon la réalité) dans la liste de B dans la même action. Scénario résiduel effectivement réalisable : un compte désactivé (role_courant() null) ou un futur durcissement de policy fait échouer…

**Correctif** — Remplacer `verifie((await … .delete().eq(…)).error)` par `exigeLignes(await … .delete().eq(…).select(), '<objet> introuvable ou suppression refusée')` aux quatre emplacements (supabase.ts:541, 567, 592, 628). Pour `deleteMedia` en particulier, faire l'`exigeLignes` AVANT `this.client.storage.from('medias').remove([chemin])` (supabase.ts:569), pour ne jamais retirer le fichier d'une ligne qui reste.

#### I-10 — `roleCache` n'est pas vidé par `signIn`, contrairement à `profilCache`
**Gravité** INFORMATIF · **Phase** 1 · **Coût** 5 min

**Preuve** — src/data/supabase.ts:173-174 (déclarations des deux caches) ; src/data/supabase.ts:354-358, `signIn`, avec le seul `this.profilCache = null;` en ligne 357 et aucune remise à zéro de `roleCache` ; src/data/supabase.ts:181 `this.roleCache ??= await this.getRole();` dans `peutEcrireExploitation()` ; src/data/supabase.ts:141 décision de `genererJour()` dans `getJour()` ; src/data/supabase.ts:384 `getRole()` qui délègue à `getProfil()` (court-circuité par le `??=`). Neutralisé aujourd'hui par : src/pages/supervision.ts:2835-2847 (déconnexion = `sessionStorage.clear()` + `window.location.reload()`) et src/pages/supervision.ts:2860 puis 2871 (formulaire câblé seulement après échec de…

**Scénario** — Scénario maintenu dans sa substance, avec deux précisions de références et un ajout de symétrie. Aujourd'hui : NON EXPLOITABLE, et pour une raison que j'ai vérifiée moi-même plus précisément que l'audit — il n'existe aucun `signOut()` dans tout src/ ; la seule déconnexion (src/pages/supervision.ts:2835) recharge la page (ligne 2847), ce qui détruit le provider et ses caches. Le formulaire de connexion n'est câblé (ligne 2871, et non 2872) que lorsque `getProfil()` a échoué au démarrage (ligne 2860), donc dans un état où `roleCache` est nécessairement nul. Amorce future (si une re-connexion sans rechargement est un jour introduite) — deux directions, pas une : (a) `supervision` puis `caisse` : le compte caisse hérite d'un `roleCache` 'supervision', `getJour()` (ligne 141) tente `genererJour()`, la policy jours…

**Correctif** — Ajouter `this.roleCache = null;` à côté de `this.profilCache = null;` dans `signIn` (src/data/supabase.ts:357), et faire de même dans le futur `signOut()`.

#### I-11 — docs/mise-en-service.md publie les trois adresses de connexion, dont celle de l'administrateur, et institue deux comptes partagés
**Gravité** INFORMATIF · **Phase** 1 · **Coût** 1 h

**Preuve** — docs/mise-en-service.md:54-57 (adresses + « mots de passe provisoires », « Auto Confirm User ») et :60-66 (bloc SQL posant role = 'admin') — VÉRIFIÉES EXACTES. supabase/INFOS-PROJET.md:5 (URL du projet) — VÉRIFIÉE EXACTE. supabase/schema.sql:418 `select p.email into v_qui from public.profils p where p.user_id = auth.uid();` — VÉRIFIÉE EXACTE. À AJOUTER, car cela change la portée : maquettes/supervision.html:533-535 publie déjà les trois mêmes adresses en dur dans le dépôt, et supervision.html:32 publie déjà le motif d'adresse (`placeholder="adresse@tramwaydumontblanc.fr"`). Éléments qui limitent la portée : supabase/schema.sql:155 (`private.role_courant()` exige `actif`),…

**Scénario** — Scénario réel, dépouillé de sa dramatisation : le dépôt étant public, un attaquant du modèle a) lit dans docs/mise-en-service.md:54-57 les trois adresses de connexion et sait laquelle porte le rôle `admin`. Le gain d'information est marginal : le même dépôt publie déjà ces trois adresses dans maquettes/supervision.html:533-535 et le motif d'adresse dans supervision.html:32, et il s'agit d'adresses professionnelles d'agents d'une régie publique, au format prenom.nom@domaine. Il lui manque le mot de passe, c'est-à-dire l'intégralité du facteur d'authentification : sans lui, aucune écriture n'est possible, `private.role_courant()` (schema.sql:155) ne renvoyant un rôle que pour une session authentifiée rattachée à un profil actif. AUCUN chemin vers l'affichage d'un horaire faux en gare n'est démontré ni atteignable par ce constat. Le vrai…

**Correctif** — 1. Dans docs/mise-en-service.md:54-57, remplacer les adresses réelles par des exemples génériques (`prenom.nom@…`) et ajouter la consigne explicite : mot de passe provisoire à changer à la première connexion. 2. Créer un compte NOMINATIF par agent (la fonction `inviter-utilisateur` existe déjà et le permet depuis Supervision → Paramètres), et supprimer les comptes `supervision@` / `caisse@` partagés — c'est la seule façon de rendre exploitable le champ `qui` du journal et de traiter un départ d'agent. 3. Activer la MFA sur le compte admin dans Supabase Auth.

#### I-12 — Aucun secret n'a jamais été commité : historique intégralement propre, et la distinction Variables / Secrets du workflow est correcte
**Gravité** INFORMATIF · **Phase** 1 · **Coût** 10 min

**Preuve** — Historique : `git for-each-ref` → `refs/heads/main` + `refs/remotes/origin/main` + `origin/HEAD` ; 33 commits ; `git stash list` vide ; `git fsck --full --unreachable --dangling` sans aucune sortie. Balayage exhaustif (contrôle renforcé) : `git grep -aInE "sb_secret_[A-Za-z0-9_-]{10}|eyJ[A-Za-z0-9_-]{25}|sbp_[a-f0-9]{20}|postgres(ql)?://…@|sk-…|ghp_…|AKIA…|DeepL-Auth-Key [A-Za-z0-9]{8}" $(git rev-list --all)` → AUCUN résultat sur tous les arbres de tous les commits. `git log --all --pretty=format: --name-only --diff-filter=A --no-renames | sort -u` → 88 fichiers (l'auditeur annonçait 86 ; `sort -u` en renvoie 89 lignes dont une vide) : aucun `.env`, `public/config.js`, `.pem`, `.key`,…

**Scénario** — Aucun scénario d'exploitation : c'est un résultat NÉGATIF, et il est important à consigner. Aucune clé `sb_secret_…`, aucun JWT `service_role`, aucun mot de passe de base et aucune clé DeepL n'a jamais transité par ce dépôt public — ni dans un commit courant, ni dans un commit ancien, ni dans un fichier supprimé, ni dans un objet inatteignable. Aucune rotation de clé n'est donc requise. Deux choix sont par ailleurs corrects et méritent d'être confirmés plutôt que « redécouverts » : (1) la clé publishable est placée dans les **Variables** de dépôt et non dans les Secrets (.github/workflows/deploy.yml:34-35) — c'est le bon choix, une valeur publique n'a rien à faire dans un magasin de secrets où elle donnerait une fausse impression de confidentialité ; (2) la portée de la décision « clé publishable publique » n'a pas dérivé : elle sert…

**Correctif** — Rien à corriger. Conserver la case de contrôle `git grep sb_secret ne renvoie rien` de docs/mise-en-service.md:110, et l'élargir aux motifs réellement discriminants, par exemple en ajoutant un job au workflow avant le build : `git log -p --all | grep -qiE "sb_secret_[A-Za-z0-9]|eyJhbGciOi|DeepL-Auth-Key [A-Za-z0-9]" && exit 1`, ou plus simplement activer GitHub **Secret scanning** + **Push protection** (gratuit sur un dépôt public) dans Settings → Code security.

#### I-13 — `npm ci` exécute les scripts d'installation des dépendances, et la clé `allowScripts` de package.json est INOPÉRANTE (l'outil qui la lit n'est pas installé)
**Gravité** INFORMATIF · **Phase** 1 · **Coût** 1 h · ⚠️ **à vérifier** (non tranchable depuis le code seul)

**Preuve** — package.json:27-29 (clé racine `allowScripts`, lue par aucun outil du dépôt) ; package-lock.json:1223-1228 (esbuild 0.28.2, `hasInstallScript: true` en 1228) ; package-lock.json:1303-1308 (fsevents 2.3.3, `hasInstallScript: true` en 1308, optional/darwin) ; package-lock.json:1644 (esbuild est dépendance directe de vite → exécuté au build de toute façon) ; .github/workflows/deploy.yml:30 (`- run: npm ci`), :31 (`npm test`), :44 (`npm run build`) ; absence de .npmrc à la racine ; absence de .github/dependabot.yml (seul .github/workflows/deploy.yml existe)

**Scénario** — Scénario corrigé — il ne s'agit PAS d'un vecteur d'attaque exploitable, mais d'une configuration morte trompeuse. En l'état, `npm ci` respecte l'`integrity` du lockfile : aucune exécution de code non prévu n'est possible aujourd'hui. Même lors d'une future mise à jour de dépendance, bloquer les scripts d'installation ne changerait rien ici : le seul paquet concerné réellement installé sur ubuntu-latest est esbuild, dépendance directe de vite (package-lock.json:1644), dont le code est de toute façon exécuté par `npm test` (deploy.yml:31) et `npm run build` (deploy.yml:44) dans le même job et avec les mêmes droits ; fsevents est optional/darwin et n'est pas installé. Le seul effet réel du défaut est humain : un relecteur qui voit `allowScripts` dans package.json conclut que les scripts d'installation sont bridés, alors que rien ne lit…

**Correctif** — Soit supprimer la clé morte et bloquer les scripts en CI, soit installer réellement l'outil. Le plus simple ici : 1) Supprimer les lignes 27-29 de package.json (clé sans effet). 2) Dans .github/workflows/deploy.yml ligne 30 : `- run: npm ci --ignore-scripts`. 3) VÉRIFIER que le build passe encore : esbuild place son binaire via son script d'installation. Sur ubuntu-latest, `@esbuild/linux-x64` fournit le binaire en `optionalDependency` et vite/esbuild le retrouvent en général sans le script, mais cela DOIT être testé avant d'être adopté (`npm ci --ignore-scripts && npm run build` sur un runner Linux propre). Si le build casse, revenir à `npm…

#### I-14 — GitHub Pages ne permet aucune en-tête de sécurité ; un `<meta http-equiv="Content-Security-Policy">` est possible et compatible avec le code actuel, mais frame-ancestors restera hors de portée
**Gravité** INFORMATIF · **Phase** 1 · **Coût** 1 journée · ⚠️ **à vérifier** (non tranchable depuis le code seul)

**Preuve** — Aucun script INLINE dans les 4 pages sources : supervision.html:536-537, ecran.html:56-57, grille.html:54-55 (annoncés 64-65 et 56-57 : décalés), index.html:34 (annoncé 33 ; index.html ne charge pas config.js). Sortie de build : dist/ecran.html:7 et :65, dist/supervision.html:7 et :544, dist/index.html:7, dist/grille.html:7 et :62 — aucun <script> sans src. Aucun eval / new Function, vérifié plus largement que l'annonce : 0 occurrence dans tout src/ ET dans les 9 bundles dist/assets/*.js, y compris dist/assets/supabase-vE8Vslc6.js. 50 attributs style= en dur dans supervision.html (0 dans les 3 autres) ; supervision.html:17 = `<div class="user" id="bloc-user" style="display: none">`, :73,…

**Scénario** — Constat de défense en profondeur confirmé, sans faille avérée — et la surface est plus étroite que ce qui était annoncé. Un attaquant du modèle (a), muni de la clé publishable, ne dispose que de DEUX colonnes de texte libre pour placer une charge utile (`version_app` et `reseau`), pas cinq : `date_affichee`, `derniere_vue` et `donnees_maj` sont typées date/timestamptz et Postgres rejette tout contenu HTML (supabase/schema.sql:122-127, 257-258). Ces deux colonnes ne sont rendues qu'en supervision, à src/pages/supervision.ts:1881, 1884, 1885, et les trois interpolations passent par `echapper()` : aujourd'hui l'attaque produit un texte inerte. Le risque est donc entièrement FUTUR : si une des interpolations `innerHTML` de supervision.ts oubliait un jour `echapper()` sur `reseau` ou `version_app`, le script s'exécuterait dans la session d'un…

**Correctif** — Ajouter dans le `<head>` des 4 fichiers HTML, en première position : ```html <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://<ref-projet>.supabase.co; media-src 'self' https://<ref-projet>.supabase.co; connect-src 'self' https://<ref-projet>.supabase.co wss://<ref-projet>.supabase.co; font-src 'self'; frame-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"> ``` Justification de chaque écart : `'unsafe-inline'` est OBLIGATOIRE sur `style-src` à cause des 50 attributs `style=` de supervision.html (les retirer au profit de…

#### I-15 — Déclencheurs du workflow : aucune contribution externe ne peut déclencher un déploiement ni lire les variables — point vérifié et SAIN
**Gravité** INFORMATIF · **Phase** 1 · **Coût** 0

**Preuve** — .github/workflows/deploy.yml:7-10 — `on:` / `push:` / `branches: [main]` / `workflow_dispatch:` : aucun `pull_request` ni `pull_request_target` sur l'intégralité des 57 lignes du fichier (fichier lu en entier). .github/workflows/deploy.yml:34-35 — `vars.VITE_SUPABASE_URL` et `vars.VITE_SUPABASE_PUBLISHABLE_KEY` ne sont lues que dans le bloc `env:` de l'étape nommée ligne 32. .github/workflows/deploy.yml:44 — seconde interpolation `${{ github.event.repository.name }}` dans un `run:` shell : non exploitable (nom de dépôt restreint par GitHub à [A-Za-z0-9._-], aucun métacaractère). Aucun autre fichier sous .github/ (`find .github -type f` → deploy.yml uniquement) : pas de second workflow, pas…

**Scénario** — Vérification demandée, résultat sain, à conserver tel quel. Un contributeur extérieur qui forke et ouvre une pull request ne déclenche RIEN : aucun workflow ne s'exécute sur `pull_request`, donc aucun accès aux variables `vars.*`, aucun accès au GITHUB_TOKEN du dépôt amont, aucun déploiement. `workflow_dispatch` exige le droit `write` sur le dépôt : un utilisateur externe ne peut pas le lancer. Il reste UNE voie réelle, mais qui suppose déjà un accès privilégié : une pull request FUSIONNÉE sur `main` déclenche le `push`, et son code s'exécute ensuite au sein du job — `npm test` (ligne 31) exécute les 16 fichiers `.test.ts` du dépôt via vitest, sans bac à sable, dans le job qui porte `pages: write`. Un fichier de test malveillant fusionné a donc exactement les capacités décrites au constat n°2. C'est la revue de code et la protection de…

**Correctif** — Rien à corriger dans le fichier. Ne PAS ajouter `pull_request_target` à ce workflow (c'est le déclencheur qui exposerait les secrets à du code de fork). Traiter la voie « PR fusionnée » par le constat n°2 (permissions par job) plus la protection de branche sur `main` (revue obligatoire d'au moins une personne, pas de contournement pour les administrateurs).

#### I-16 — Dépendances : aucune vulnérabilité connue, surface de production minuscule, dépendances de production à jour
**Gravité** INFORMATIF · **Phase** 1 · **Coût** 1 h

**Preuve** — package.json:15-19 — bloc `"dependencies"` : `@fontsource/amaranth ^5.2.5` (l.16), `@fontsource/lato ^5.2.5` (l.17), `@supabase/supabase-js ^2.112.4` (l.18). package.json:20-26 — 5 devDependencies (`@types/node`, `prettier`, `typescript ~5.9.2`, `vite ^7.1.0`, `vitest ^3.2.4`). package.json:27-29 — champ `"allowScripts": { "esbuild@0.28.2": true }`, inerte (aucun `@lavamoat/allow-scripts` dans package-lock.json). package-lock.json — `lockfileVersion: 3`, 116 entrées `"node_modules/` dont 105 `"dev": true` ; 116 champs `"integrity"` (100 %) et 0 `"resolved"` hors registry.npmjs.org ; esbuild 0.28.2 en package-lock.json:1223-1226. .github/workflows/deploy.yml:30 `- run: npm ci`, :31 `- run:…

**Scénario** — Scénario d'origine conservé (il n'y a pas de scénario d'exploitation, et c'est bien la conclusion correcte), avec deux amendements. 1) L'affirmation « les dépendances de développement ne finissent jamais dans le bundle » reste vraie pour le CODE servi, mais elle ne rend pas ces paquets inoffensifs : vite/vitest/typescript s'exécutent sur le runner GitHub Actions qui a `pages: write` et `id-token: write` (deploy.yml:12-15) et qui fabrique le contenu affiché en gare. Une compromission de la chaîne de build produirait un bundle malveillant capable d'afficher de FAUX horaires — enjeu n°1. Ce risque est aujourd'hui purement théorique (0 vulnérabilité, integrity sha512 sur les 116 archives, toutes issues du registre officiel), mais il justifie de traiter le retard d'outillage comme une dette à échéance, pas comme un sujet indifférent. 2) Le…

**Correctif** — Rien à corriger aujourd'hui. Mettre en place la surveillance plutôt qu'une mise à jour de masse : 1) `.github/dependabot.yml` avec deux écosystèmes, `npm` et `github-actions` (ce dernier est de toute façon nécessaire au constat n°3 pour maintenir les SHA épinglés). 2) Ajouter `- run: npm audit --audit-level=high` dans le workflow après la ligne 30, pour que l'apparition d'une faille bloque le déploiement au lieu d'attendre un audit manuel. 3) Planifier la montée de vite 7→8 et vitest 3→4 hors saison d'exploitation, pas en juillet.

#### I-17 — Le Pi ne détient aucun secret applicatif — le chiffrement de la carte SD n'apporterait rien et ne doit PAS être retenu
**Gravité** INFORMATIF · **Phase** 1 · **Coût** 0 (décision de ne pas faire) + 30 min de doc

**Preuve** — Preuves vérifiées une à une, toutes exactes : ecran.html:56 (`<script src="./config.js"></script>`, config téléchargée depuis GitHub Pages, non provisionnée sur la carte) ; .github/workflows/deploy.yml:34-38 (config.js ne contient que VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY) ; docs/mise-en-service.md:47-48 (clé publishable publique par conception) ; docs/kiosque.md:24-26 (gare.txt = identifiant en clair), :30-42 (kiosque.sh = URL publique), :11 (utilisateur `tmb` + mot de passe de la Régie, « Wi-Fi si besoin », SSH activé), :3-5 (démarrage autonome après coupure), :86-92 (échange standard) ; src/pages/ecran.ts:566-587 (charge utile du signal de vie sans jeton ni secret) ;…

**Scénario** — Modèle (b) : vol pur et simple du Raspberry ou de sa carte SD. Ce que l'attaquant obtient de neuf : rien du côté applicatif (la clé publishable, il l'a déjà en ouvrant le bundle JS depuis chez lui — modèle (a)), et rien du côté horaires (publics par nature). Ce qu'il obtient réellement : la PSK Wi-Fi de la Régie s'il y en a une, et une cible de cassage hors ligne pour le mot de passe `tmb` — qui, étant partagé (constat n°6), ouvre les 6 postes. ARBITRAGE demandé sur le chiffrement de la carte SD : il n'est PAS pertinent ici et je ne le recommande pas. La raison est structurelle, pas budgétaire : l'exigence n°1 de docs/kiosque.md:3-5 est « un Pi qui démarre SEUL […] sans clavier ni souris, et se remet en route après toute coupure de courant ». Un LUKS ne peut donc être déverrouillé qu'automatiquement, avec la clé stockée sur la même carte…

**Correctif** — Ne pas chiffrer. Traiter à la place les deux seuls secrets réellement présents : mot de passe distinct par poste et authentification par clé (constat n°6), et — si le Wi-Fi est utilisé — un SSID/PSK dédié aux écrans, isolé du reste du réseau de la Régie et distinct de tout autre usage, avec la consigne explicite dans docs/kiosque.md:11 : « Wi-Fi : réseau dédié aux écrans uniquement, jamais le Wi-Fi bureautique ».

#### I-18 — Veille, extinction d'écran et curseur : correctement traités
**Gravité** INFORMATIF · **Phase** 1 · **Coût** 0

**Preuve** — docs/kiosque.md:37 `xset s off -dpms s noblank` (économiseur off, DPMS off, pas de noircissement) ; docs/kiosque.md:38 `unclutter -idle 1 &` ; docs/kiosque.md:58 `ExecStart=/usr/bin/startx /home/tmb/kiosque.sh -- -nocursor` ; docs/kiosque.md:66-69 justification éprouvée de `PAMName=login` + `TTYPath=/dev/tty1`. Curseur masqué aussi côté application, sur 4 lignes que le constat d'origine n'avait pas citées : src/styles/ecran.css:29 et :623, src/styles/grille.css:28 et :425. Anti-rémanence : src/pages/resilience.ts:96-109 `demarreAntiBurnIn()` (cycle 4 positions, 3_600_000 ms), appelée depuis src/pages/ecran.ts:514 et src/pages/grille.ts:324 ; inoffensive vis-à-vis des surcouches `position:…

**Scénario** — Le constat reste valide (point de contrôle conforme), mais son « seul manque relatif » est à remplacer par un manque plus concret, à vérifier sur un Pi réel — a_verifier: true, je ne peux pas le trancher depuis le dépôt. docs/kiosque.md:16 installe le kiosque avec `--no-install-recommends` et la liste `xserver-xorg xinit chromium-browser unclutter fonts-dejavu`. La commande `xset` de la ligne 37 est fournie par le paquet `x11-xserver-utils`, absent de cette liste ; `--no-install-recommends` empêche justement qu'il soit tiré en Recommends. Si `xset` n'est pas installé, la ligne 37 échoue en `command not found`, le script n'a ni `set -e` ni contrôle de code retour, et l'`exec chromium-browser` de la ligne 39 s'exécute quand même : le kiosque démarre normalement, l'exploitant voit un écran correct à la pose, et la protection contre…

**Correctif** — Rien à corriger.

#### I-19 — Le précache des grilles par le service worker ne sert jamais : démarrage à froid hors ligne = écran neutre définitif
**Gravité** INFORMATIF · **Phase** 1 · **Coût** 30 min

**Preuve** — public/sw.js:16-17 (entrées PRECACHE des grilles) ; public/sw.js:45 (`if (requete.cache === 'no-store') return;`) ; src/data/supabase.ts:95-97 et src/data/mock.ts:375-377 (seuls appelants runtime, tous deux en `cache: 'no-store'`) ; public/sw.js:1-2 (commentaire « démarrage hors ligne … + grilles officielles » non réalisé). Contre-preuves : src/data/supabase.ts:112 (getJour attend getGrilles en interne), src/pages/ecran.ts:451 (`const neutre = age === null || age > dureeCacheMs()`), src/data/supabase.ts:101-107 (réinitialisation du cache de promesse sur échec), src/pages/ecran.ts:557-558 (resynchro 30 s et sur 'online').

**Scénario** — Il n'y a pas de scénario d'exploitation : c'est du code mort doublé d'un commentaire inexact. Formulation correcte : les deux entrées de grilles de public/sw.js:16-17 sont chargées à l'installation du service worker mais ne sont jamais lues, puisque les seuls appels runtime (src/data/supabase.ts:95-97, src/data/mock.ts:375-377) utilisent `cache: 'no-store'`, court-circuité par public/sw.js:45. Aucun comportement observable ne change si on les retire : hors ligne l'écran affiche l'écran neutre de toute façon, parce que le jour, les circulations et les paramètres viennent de Supabase et que src/data/supabase.ts:112 fait déjà dépendre getJour des grilles. Le seul geste justifié est de supprimer les deux lignes et de retirer « + grilles officielles » du commentaire public/sw.js:2, pour que l'intention écrite corresponde au code — et, côté…

**Correctif** — Choisir une intention et l'écrire. Option retenue (la plus sûre, et celle qui correspond au code actuel) : retirer les deux entrées de grilles de PRECACHE (public/sw.js:16-17) et corriger le commentaire public/sw.js:1-2, puisqu'aucun démarrage hors ligne n'est réellement offert. Ajouter en regard dans docs/kiosque.md, à la checklist de pose (ligne 94) : « Un poste posé sans réseau affiche l'écran neutre tant que la liaison n'est pas rétablie — c'est le comportement attendu, ce n'est pas une panne. » Si au contraire l'exploitant veut vraiment un démarrage hors ligne, le geste est le symétrique : passer les grilles en `cache: 'default'` (elles…

#### I-20 — Ce qui tient : les mécanismes de résilience effectivement vérifiés (à ne pas casser)
**Gravité** INFORMATIF · **Phase** 1 · **Coût** 1 journée

**Preuve** — Toutes les preuves d'origine vérifiées exactes, aucune correction nécessaire : src/pages/ecran.ts:508, 557, 586, 590 ; src/pages/grille.ts:319, 360, 380, 384 ; src/pages/resilience.ts:105 ; src/data/supabase.ts:283 gardé par src/data/supabase.ts:270 ; src/data/supabase.ts:289-296 (notifie → abonnés) ; src/pages/ecran.ts:535-549 (applique) ; src/data/supabase.ts:101-107 (grilles=null) ; src/pages/ecran.ts:583 + src/pages/affichage-commun.ts:133-141 ; src/pages/ecran.ts:431-438 (badge avant les return de 447/456/459) ; src/core/horaires.ts:653-656 et 658/666 (retours non-null) vs src/pages/ecran.ts:478 et 481 ; supabase/schema.sql:70 ; src/pages/supervision.ts:1764 ; public/sw.js:54-56 ;…

**Scénario** — Sans objet — constat de bonne santé, consigné pour qu'aucun de ces points ne soit défait par les correctifs proposés ci-dessus. En particulier : le correctif du constat sur l'egress propose de supprimer src/pages/ecran.ts:557 OU src/data/supabase.ts:283, jamais les deux — l'un des deux DOIT survivre, c'est lui qui garantit la resynchronisation complète après une chute du WebSocket.

**Correctif** — Verrouiller par des tests ce qui n'est aujourd'hui garanti que par des commentaires. src/pages/fraicheur.test.ts ne couvre que la vue supervision (`etatFraicheurEcran`, `resumeApplication`) : AUCUN test ne couvre `creeSynchronisation` de src/pages/resilience.ts, alors que c'est la pièce qui décide « cache ou écran neutre ». Ajouter src/pages/resilience.test.ts couvrant : réseau OK → true ; réseau KO + instantané → true avec `derniereSynchroMs` = `quand` de l'instantané ; réseau KO sans instantané → false ; localStorage indisponible (setItem qui lève) → pas de plantage ; âge négatif → traité comme périmé (constat n°3) ; `duree_cache_min`…

#### I-21 — Les trois Edge Functions ne sont ni compilées ni testées par la chaîne d'intégration : `tsconfig.include` s'arrête à `src`
**Gravité** INFORMATIF · **Phase** 1 · **Coût** 1 h

**Preuve** — tsconfig.json (lu intégralement) : `"include": ["src"]` — `supabase/functions/**` est hors du périmètre de `tsc`. `"strict": true`, `"noUnusedLocals": true`, `"noUnusedParameters": true` ne s'appliquent donc qu'à `src/`. package.json:9 — `"build": "tsc && vite build"` : la seule vérification de types du dépôt. .github/workflows/deploy.yml:30-31 et :44 — `npm ci`, `npm test`, `npm run build` : ce sont les trois seules barrières avant publication, et aucune ne regarde `supabase/functions/`. Aucun test : il n'existe aucun `*.test.ts` sous `supabase/` (vérifié par `git ls-files`, 88 fichiers listés : les seuls tests sont les 16 fichiers de `src/`). Conséquence observable dans le code déjà…

**Scénario** — Aucun scénario d'attaque. Constat de couverture : les trois fonctions serveur (`traduire`, `inviter-utilisateur`, `supprimer-utilisateur`), qui sont les seuls composants du projet à manipuler la clé `service_role`, sont écrites en TypeScript mais ne passent ni le compilateur ni les tests avant d'être déployées à la main (`supabase functions deploy`, docs/mise-en-service.md:90-91). Une régression y est donc invisible jusqu'à l'exécution en production. C'est le contexte qui explique que les correctifs proposés sur ces fichiers (contrôle d'appelant sur `traduire`, contrôle de l'erreur d'upsert sur `inviter-utilisateur`) doivent être vérifiés à la main : rien dans le dépôt ne les protégera d'une régression ultérieure. À ne pas surinterpréter : ces fichiers ciblent Deno et importent depuis `jsr:`/`npm:`, que `tsc` avec `moduleResolution:…

**Correctif** — Ajouter une vérification dédiée, hors du `tsconfig.json` de l'application : 1) `deno check supabase/functions/**/index.ts` dans une étape de workflow séparée (Deno est installable en une ligne sur `ubuntu-latest`), non bloquante au début puis bloquante ; 2) à défaut, un `tsconfig.functions.json` avec `"types": ["https://deno.land/x/..."]` est plus coûteux que le point 1 et n'apporte rien de plus ; 3) dans tous les cas, consigner dans docs/mise-en-service.md que toute modification d'une Edge Function doit être suivie d'un `supabase functions deploy <nom>` ET d'un essai réel, puisque la CI ne dira rien.

---

## 8. Constats écartés à la vérification adversariale

Ces 25 constats ont été levés puis **réfutés** après relecture du code. Ils figurent ici parce
qu'une hypothèse écartée avec sa raison a de la valeur : elle évite de la relever à nouveau, et
elle dit ce qui a été regardé.

| Axe | Hypothèse levée | Pourquoi elle tombe |
|---|---|---|
| RLS | Les colonnes anon-écrivables date_affichee, version_app et reseau ne sont couvertes par aucune justification écrite et… | La preuve fichier:ligne est exacte (schema.sql:257-258 pour le GRANT, 125-127 pour `date_affichee date / version_app text / reseau text`, supervision.ts:1881 et 1884-1885 pour le réaffichage échappé). Mais l'affirmation centrale du titre — « ne sont couvertes par aucune justification écrite » / « portée dérivée » — est FAUSSE,… |
| RLS | Un « caisse » peut SUPPRIMER les lignes params meteo_sommet et vitesse_ticker_px_s (la policy for all inclut le DELETE) | La PREUVE SQL est exacte, mais le constat tombe comme constat de sécurité : le DELETE n'apporte AUCUNE capacité que l'UPDATE délibérément accordé ne donne pas déjà. Ce que j'ai confirmé (contrôle 1) : ajout-bandeau-veille.sql:37-45 dit bien `create policy "affichage tous roles" on params for all to authenticated` avec le… |
| Edge Functions | Pas de supabase/config.toml : la portée de verify_jwt n'est pinnée nulle part dans le dépôt, alors que c'est la SEULE… | Les preuves matérielles sont exactes — je les ai toutes rouvertes — mais elles ne soutiennent aucun défaut PRÉSENT dans le code. 1. Preuves vérifiées, une seule correction de ligne. `supabase/` ne contient effectivement aucun `config.toml` (`find` sur tout le dépôt hors node_modules : zéro résultat ; `git ls-files supabase/` ne… |
| Edge Functions | Message d'erreur brut renvoyé à un appelant NON authentifié dans les deux fonctions d'administration — vérifié sans… | La preuve est EXACTE — j'ai ouvert les deux fichiers. inviter-utilisateur/index.ts:45-46 et supprimer-utilisateur/index.ts:47-48 contiennent bien mot pour mot `} catch (erreur) { return new Response(String(erreur), { status: 500, headers: entetes }); }`, le `try` ouvre bien aux l.17/l.18 et englobe donc… |
| Storage | Les limites de taille et de type MIME du bucket peuvent ne PAS être appliquées sur la base en service, et aucun script… | PREUVES : exactes, toutes vérifiées. schema.sql:570-573 porte bien `on conflict (id) do nothing` avec les trois restrictions ; securite-advisors.sql:175-189 ne touche que `storage.objects` (aucune écriture sur `storage.buckets` dans tout le dépôt, grep confirmé) ; docs/mise-en-service.md:40-41 ne mentionne pas la liste MIME ;… |
| Storage | Toute montée de version du service worker purge aussi les médias : 1,2 Go d'egress rejoués à chaque déploiement | Le MÉCANISME décrit est exact, mais le DÉCLENCHEUR et le CHIFFRAGE sont faux, ce qui vide le constat de sa substance. 1) Preuve vérifiée, partiellement imprécise. `public/sw.js:9` contient bien `const VERSION = 'tmb-v1';` ; `public/sw.js:33-39` purge bien tout cache `!== VERSION` à l'activation ; `public/sw.js:47-52` route bien… |
| Storage | Portée de la décision « bucket public » : non dérivée, mais la policy SELECT restreinte n'apporte aucune… | Les preuves sont TOUTES exactes, vérifiées ligne à ligne dans le code réel : schema.sql:570-571 crée bien le bucket avec `public = true` (`values ('medias','medias', true, 20971520, ...)`) ; schema.sql:69 déclare `chemin text not null` ; schema.sql:198 pose bien `create policy "lecture publique" on medias for select using… |
| Auth/session | Aucune révocation ni expiration d'inactivité : le refresh token d'un ancien agent reste utilisable indéfiniment | PREUVES (contrôle 1) : quasi toutes exactes, je les ai ouvertes. node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:17-18 dit bien `autoRefreshToken: true` / `persistSession: true` dans DEFAULT_OPTIONS, et src/data/supabase.ts:86 `createClient(url, clePubliable)` ne passe aucune option, donc les défauts s'appliquent.… |
| Auth/session | Le journal d'exploitation est réservé à l'administrateur par l'INTERFACE SEULE : la base l'ouvre aux trois rôles | Toutes les preuves citées existent et disent bien ce qui est prétendu (j'ai corrigé un décalage : initJournal() est appelé ligne 2831, pas 2832). Le constat tombe néanmoins sur le fond, pour deux raisons vérifiées dans le code et la spec. 1) IL N'Y A PAS DE DIVERGENCE base/intention. Le constat postule que le journal « est… |
| Secrets | supabase/.temp/ présent sur le disque : identifiant de connexion base et identifiant d'organisation, correctement… | Les PREUVES sont exactes (contrôle 1 : tout vérifié) mais le CONSTAT tombe sur les contrôles 2 et 4. 1) Preuves confirmées une à une. `.gitignore:15` = `supabase/.temp/`, `git check-ignore -v` renvoie bien `.gitignore:15:supabase/.temp/`. `git ls-files supabase/.temp/` : sortie vide. J'ai poussé plus loin que l'auditeur : `git… |
| Secrets | .claude/launch.json commité dans un dépôt public : révèle le nom de compte Active Directory de l'administrateur | Les DEUX preuves sont exactes, je les ai lues : `.claude/launch.json:6` contient bien `"runtimeExecutable": "C:\\Users\\MUSSETThomas-TRAMWAY\\AppData\\Local\\nodejs-portable\\node-v24.19.0-win-x64\\npm.cmd"`, le fichier est bien suivi (`git ls-files` → `.claude/launch.json`, ajouté au commit 893669c « Etape 2 - Ecran de gare… |
| Chaîne de build | `--base=/${{ github.event.repository.name }}/` : pas d'injection de commande exploitable ici, mais la règle générale… | La preuve est EXACTE : `.github/workflows/deploy.yml:43-44` contient bien `- name: Build (base = /nom-du-depot/)` puis `run: npm run build -- --base=/${{ github.event.repository.name }}/` (vérifié octet par octet via `cat -A`). Mais le constat tombe sur le contrôle n°2 : il n'y a AUCUN scénario exécutable, et l'auditeur le… |
| Kiosque | Le zoom clavier de Chromium est persistant : Ctrl+ suffit à casser durablement la mise en page d'un écran de gare | Les PRÉMISSES sont exactes, le DOMMAGE ne l'est pas. 1) Preuves vérifiées et confirmées : docs/kiosque.md:39-41 contient bien `exec chromium-browser --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --check-for-update-interval=31536000 --autoplay-policy=no-user-gesture-required "$URL"` — ni… |
| Kiosque | Dérive de portée du signal de vie anonyme : `date_affichee` et `reseau` permettent de faire paraître SAIN un écran en… | Les preuves citées existent toutes (vérifiées ligne à ligne), mais les deux affirmations qui portent le constat tombent. 1) « Dérive de portée » : FAUX. La liste des cinq colonnes est écrite VERBATIM dans la justification, pas seulement dans le SQL : docs/02-spec-technique.md:168-169 recopie `grant update (derniere_vue,… |
| Kiosque | MITM sur le câble de la gare : le TLS tient, un réseau hostile ne peut pas fabriquer d'horaires — il ne peut que couper | Toutes les preuves citées sont EXACTES, je les ai ouvertes une par une : docs/kiosque.md:39-41 lance bien `chromium-browser --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --check-for-update-interval=31536000 --autoplay-policy=no-user-gesture-required` — aucun `--ignore-certificate-errors` ni… |
| Disponibilité | Le clignotement « DÉPART IMMINENT » ne se joue jamais : le tableau est reconstruit chaque seconde | Les lignes citées existent bien (ecran.ts:280 `$('corps').innerHTML = lignes.join('');`, ecran.ts:486 l'appel à `afficheTableau`, ecran.ts:590-593 le `setInterval(..., 1000)`, ecran.css:391-396 `.chip.imminent { ... animation: clignote-imminent 1s step-end infinite; }`), et le mécanisme décrit est exact : `innerHTML` est bien… |
| Phase 2 | Nid d'Aigle en 5G : le tunnel, la coupure inévitable, et le fait que la tolérance de 15 min n'est PAS réglable écran… | La claim porteuse du constat est FAUSSE, vérifiée dans le code. 1) PREUVES : elles existent toutes, avec de légers décalages de lignes (docs/02:416-417 et non 417-418 ; ecran.ts:145-149 et non 143-149 ; ecran.ts:451 et non 450-457). supabase.ts:258, :283, :93, affichage-commun.ts:126, ecran.ts:557, schema.sql:118-134,… |
| Phase 2 | Migration phase 1 → phase 2 : interdire la double écriture, fixer l'ordre de bascule et le retour arrière avant… | Les preuves citées sont exactes (je les ai toutes ouvertes), mais elles ne prouvent aucun défaut : elles prouvent une ABSENCE de procédure dans un document, pour une phase qui n'est pas écrite. 1) Vérification des preuves. docs/02-spec-technique.md:414-416 dit bien « pare-feu intranet, sauvegarde quotidienne SQLite + médias,… |
| Phase 2 | Sessions : cookie, durée, stockage et CSRF — « sessions cookie » est la seule spécification existante | Vérification ligne par ligne. 1) PREUVE — la citation existe mais est décalée d'une ligne : c'est `docs/02-spec-technique.md:408` (« SSE `/api/events` ; routes miroir du DataProvider ; sessions cookie ; »), pas 409. Le fond est exact : un grep insensible à la casse sur `csrf|httponly|samesite|cookie` dans `docs/`, `src/` et… |
| Phase 2 | Compte de service Windows, droits sur les fichiers et redémarrage automatique du service | La preuve citée existe et dit bien ce qui est prétendu (docs/02-spec-technique.md:412-415 : « Installation en service Windows via `nssm` (doc `docs/phase2-windows.md` : installation, port 8080, pare-feu intranet, sauvegarde quotidienne SQLite + médias… ») — mais le constat tombe sur les contrôles 2 et 5. (1) AUCUN code ne peut… |
| Phase 2 | VPN Fortinet pour l'accès distant : nominatif, double facteur, segmentation vers le seul micro-serveur, et engagement… | PREUVE : exacte à 1-2 lignes près. docs/02-spec-technique.md:416-417 dit bien « Réseau : gares fibrées en direct ; Nid d'Aigle et accès distant par le VPN Fortinet existant (paramétrage prestataire) ou WireGuard dédié. » et :403 « Accès distant optionnel (phase 2 : via VPN Fortinet de la Régie). » Le §7 va de la ligne 405 à 417… |
| Phase 2 | Gestion des comptes sous AD : `inviteUser`, `resetMotDePasse` et `saveUser` doivent REFUSER explicitement, jamais… | Les preuves citées existent (légers décalages corrigés), mais le constat tombe sur trois points de fond. 1) LE SCÉNARIO N'EST PAS EXÉCUTABLE, MÊME EN THÉORIE. `src/data/api.ts` n'existe pas et `server/` non plus (vérifié : `find . -name "api.ts"` hors node_modules ne renvoie rien ; `src/data/` contient index.ts, mock.ts,… |
| Phase 2 | SQLite : mode WAL, `busy_timeout` et écrivain unique — à décider avec le flux SSE, pas après le premier verrou | Les preuves existent (à quelques lignes près) mais le SCÉNARIO N'EST PAS EXÉCUTABLE : il se contredit lui-même. 1) Le constat s'auto-réfute. Il pose comme facteur aggravant que « better-sqlite3 est SYNCHRONE : chaque requête bloque la boucle d'événements ». C'est vrai — et c'est précisément ce qui SUPPRIME le SQLITE_BUSY… |
| Phase 2 | Chaîne d'installation et de mise à jour hors ligne : Node LTS, module natif better-sqlite3, dépendances — sur une tour… | PREUVE (contrôle 1) : citations quasi exactes mais mal situées. docs/02-spec-technique.md:407 (et non 406) dit bien « `server/` dans le même dépôt : Node.js LTS + Fastify + better-sqlite3 + ». docs/03-plan-de-developpement.md:192-193 dit bien « Rédige docs/phase2-windows.md : Node LTS sur Windows Server 2019, service via nssm… |
| Phase 2 | LibreTranslate auto-hébergé : dimensionner la tour maintenant, ou acter le repli sur le dictionnaire local | Les FAITS cités sont exacts, mais le constat ne décrit AUCUN défaut : il tombe sur le fond, pas sur la preuve. 1) Vérification des preuves (toutes lues) : - docs/02-spec-technique.md:370-378 contient bien la phrase annoncée (le bloc commence ligne 370, pas 371 : décalage d'une ligne, corrigé). « phase 2 : LibreTranslate… |

---

## 9. HORS DÉPÔT — à vérifier par l'exploitant

Ces points ne sont pas contrôlables depuis le code. Chacun est formulé de sorte que la réponse soit
**oui** ou **non**. La colonne « réponse attendue » indique la réponse rassurante : toute réponse
contraire est à traiter comme un constat.

### 9.1 Tableau de bord Supabase — les plus urgents

| # | Question | Réponse attendue |
|---|---|---|
| S1 | Un appel `curl -X POST https://<projet>.supabase.co/functions/v1/traduire -H 'apikey: sb_publishable_…' -H 'Authorization: Bearer sb_publishable_…' -d '{"texte":"essai"}'` renvoie-t-il **401** (et non une traduction) ? | oui |
| S2 | Les trois Edge Functions sont-elles déployées avec « Verify JWT » **actif** (donc sans `--no-verify-jwt`) ? | oui |
| S3 | La fonction `supprimer-utilisateur` est-elle réellement déployée ? (elle est absente du bloc de commandes de `docs/mise-en-service.md:86-93` — voir F-05) | oui |
| S4 | Les inscriptions libres sont-elles **désactivées** (Authentication → Providers → Email → « Allow new users to sign up » sur OFF) ? | oui |
| S5 | Les connexions anonymes (Authentication → Providers → Anonymous sign-ins) sont-elles désactivées ? | oui |
| S6 | Le schéma `private` est-il **absent** de « Exposed schemas » (Settings → API → Data API) ? | oui |
| S7 | Le script `supabase/securite-advisors.sql` a-t-il bien été exécuté sur la base **en service**, et pas seulement `schema.sql` ? (sinon d'anciennes policies `heartbeat insert` peuvent subsister avec un INSERT anonyme ouvert) | oui |
| S8 | `select public, file_size_limit, allowed_mime_types from storage.buckets where id='medias';` renvoie-t-il exactement `true`, `20971520`, `{image/jpeg,image/png,video/mp4}` ? (le `on conflict (id) do nothing` de `schema.sql:570-573` n'aurait rien appliqué si le bucket avait été créé à la main **avant**) | oui |
| S9 | Les anciennes clés JWT « legacy » (anon / service_role) du projet sont-elles **désactivées** dans Settings → API Keys ? | oui |
| S10 | Les « Redirect URLs » et le « Site URL » sont-ils restreints à `https://<organisation>.github.io/tmb-affichage-gares/`, **sans joker** ? (voir E-02) | oui |
| S11 | `select cle, jsonb_typeof(valeur) from params;` — `duree_cache_min` est-il bien un **nombre**, et sa valeur comprise entre 1 et 60 ? (voir M-03) | oui |
| S12 | `select nom, couleur, cercle from machines;` — les couleurs sont-elles toutes des hexadécimaux à 6 chiffres ? (voir F-08) | oui |
| S13 | La clé `sb_secret_…` (service_role) est-elle utilisée **uniquement** dans les secrets des Edge Functions, et nulle part ailleurs (script d'import, tâche planifiée, poste de bureau) ? | oui |
| S14 | Le secret `DEEPL_API_KEY` correspond-il à un compte DeepL **Free** (le quota bloque, aucune facturation possible) et non à un compte Pro facturé à l'usage ? (voir F-04) | oui |
| S15 | La consommation d'egress du mois (Settings → Usage) reste-t-elle sous 2,5 Go, et une alerte est-elle configurée ? (voir M-12) | oui |
| S16 | Une expiration de session (« Time-box user sessions » / « Inactivity timeout ») est-elle configurée ? Rien n'existe côté code. | oui |
| S17 | La protection anti-abus (Captcha, limites de débit sur `/token` et `/recover`) est-elle activée ? Aucun verrouillage après N échecs n'existe côté code. | oui |
| S18 | Des restrictions réseau (« Network restrictions ») interdisent-elles une connexion directe au pooler depuis Internet ? | oui |
| S19 | L'accès au SQL Editor du tableau de bord est-il réservé aux personnes ayant le rôle `admin` dans `profils` ? (le SQL Editor s'exécute en `postgres` et **ignore totalement RLS**) | oui |
| S20 | Le projet est-il resté actif durant tout l'inter-saison précédent, sans mise en pause ? (voir M-11) | oui |

### 9.2 Comptes et personnes

| # | Question | Réponse attendue |
|---|---|---|
| P1 | Toutes les lignes `profils` d'agents ayant quitté la Régie sont-elles passées à `actif = false` ? (c'est le mécanisme qui neutralise l'attaquant (d) — le code est correct, mais rien ne garantit qu'il soit appliqué) | oui |
| P2 | Les mots de passe « provisoires » des trois comptes créés à `docs/mise-en-service.md:54-57` ont-ils tous été changés ? | oui |
| P3 | Les comptes `supervision@…` et `caisse@…` sont-ils **nominatifs**, et non partagés entre plusieurs agents ? (voir I-11) | oui |
| P4 | Des comptes de rôle `caisse` existent-ils réellement en production, et combien de personnes en détiennent les identifiants ? (c'est le point d'entrée de C-01) | *(à chiffrer)* |
| P5 | La MFA est-elle activée sur le compte administrateur du tableau de bord Supabase ? | oui |
| P6 | Le compte `caisse` est-il utilisé depuis un poste en gare dont la session reste ouverte sans surveillance ? (cela transforme l'attaquant (b) en attaquant (c), et C-01 devient atteignable depuis le guichet) | non |

### 9.3 Organisation GitHub

| # | Question | Réponse attendue |
|---|---|---|
| G1 | Ouvrir `https://<organisation>.github.io/tmb-affichage-gares/config.js` : le fichier contient-il bien `window.TMB_CONFIG` ? **Un 404 ou une page HTML signifie que les 6 écrans sont en mode démonstration en ce moment même** (C-02). | oui |
| G2 | Les variables `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` sont-elles renseignées dans Settings → Secrets and variables → Actions → **Variables** ? | oui |
| G3 | La branche `main` est-elle protégée par une règle exigeant au moins une revue avant fusion ? (le job `build` exécute le code du dépôt via `npm test`, aujourd'hui avec `pages: write` — voir M-05) | oui |
| G4 | Les administrateurs du dépôt sont-ils soumis à cette protection (« Do not allow bypassing the above settings ») ? | oui |
| G5 | L'authentification à deux facteurs est-elle exigée pour tous les membres de l'organisation ? | oui |
| G6 | « Secret scanning » et « Push protection » sont-ils activés (Settings → Code security) ? | oui |
| G7 | La liste des comptes ayant le droit `write` a-t-elle été revue, et les anciens agents en ont-ils été retirés ? | oui |
| G8 | L'organisation héberge-t-elle **d'autres** dépôts avec GitHub Pages activé, donc servis sur la même origine `https://<organisation>.github.io` ? (voir F-09 : le `localStorage` de session y serait partagé) | non |
| G9 | L'environnement `github-pages` porte-t-il une règle limitant les branches autorisées à `main` ? | oui |

### 9.4 Les 6 Raspberry Pi

| # | Question | Réponse attendue |
|---|---|---|
| R1 | La touche **F12** ouvre-t-elle les outils de développement sur un écran en service, clavier USB branché ? (C-04) | non |
| R2 | `Ctrl+L` ou `F6` donnent-ils accès à la barre d'adresse ? (C-04) | non |
| R3 | Existe-t-il un fichier dans `/etc/chromium/policies/managed/` sur au moins un Pi en service ? (vérifiable via `chrome://policy` sur l'écran) | oui |
| R4 | Sur chacun des 6 Pi, `timedatectl` affiche-t-il « System clock synchronized: **yes** » **et** « NTP service: **active** » ? (C-03) | oui |
| R5 | Le Pi accepte-t-il des serveurs NTP fournis par le DHCP de la gare, plutôt qu'un serveur imposé par la Régie ? (C-03) | non |
| R6 | Le Raspberry du Nid d'Aigle parvient-il à joindre un serveur NTP à travers la 5G (UDP/123 ouvert par l'APN) ? | oui |
| R7 | Le mot de passe du compte `tmb` est-il **identique** sur les 6 Pi ? (E-05) | non |
| R8 | Ce mot de passe a-t-il été changé depuis le départ du dernier agent ayant eu accès aux postes ? | oui |
| R9 | Le fichier `/etc/sudoers.d/010-tmb-nopasswd` (sudo sans mot de passe, défaut du Raspberry Pi Imager) existe-t-il sur les Pi en service ? | non |
| R10 | Les boîtiers sont-ils fermés par un moyen exigeant un outil, et les ports USB inutilisés obturés ? | oui |
| R11 | Le paquet `unattended-upgrades` est-il installé et actif (`systemctl status unattended-upgrades`) ? (M-09) | oui |
| R12 | Les URL réellement lancées par `/home/tmb/kiosque.sh` sur les 6 postes sont-elles exemptes de `simule=`, `cache=` et `terminus=` ? (E-04, M-14) | oui |
| R13 | Les 6 postes ont-ils bien été déclarés en Supervision → Écrans ? (sans quoi leur signal de vie n'est enregistré nulle part) | oui |
| R14 | Le câble RJ45 des écrans arrive-t-il sur un VLAN **isolé** de la bureautique de la Régie ? | oui |
| R15 | Les postes utilisent-ils le Wi-Fi (donc une PSK en clair sur la carte SD) plutôt que le RJ45, hors Nid d'Aigle ? | non |
| R16 | Existe-t-il une supervision qui **alerte** quand un écran cesse d'envoyer son signal de vie, sans avoir à passer devant la gare ? | oui |

### 9.5 Poste de supervision et Régie

| # | Question | Réponse attendue |
|---|---|---|
| T1 | Excel est-il l'application par défaut des `.csv` sur les postes de supervision ? (M-20 : injection de formule) | *(à établir)* |
| T2 | La politique de groupe désactive-t-elle DDE et l'exécution de formules externes dans Excel ? | oui |
| T3 | Le navigateur utilisé pour cliquer « Aperçu » est-il le **même profil** que celui où l'agent ouvre la supervision (donc partageant le `localStorage`) ? (C-01, chaînage) | non |

### 9.6 Phase 2 — décisions à obtenir avant d'écrire la première ligne

| # | Question | Réponse attendue |
|---|---|---|
| F1 | Le service informatique accepte-t-il de créer trois groupes AD dédiés (`TMB-Affichage-Admin`, `-Supervision`, `-Caisse`) **avant** le début du développement ? | oui |
| F2 | Les contrôleurs de domaine acceptent-ils LDAPS (636) ou StartTLS (389) ? (M-16 : un bind LDAP en clair expose les mots de passe du personnel sur le LAN) | oui |
| F3 | Existe-t-il une autorité de certification interne capable d'émettre un certificat pour le micro-serveur ? (M-18 : ce choix décide **à la fois** du cookie `Secure` et de la survie du service worker des écrans) | oui |
| F4 | Les 6 Raspberry peuvent-ils recevoir ce certificat interne dans le magasin de Chromium ? (sinon le démarrage hors-ligne des écrans est perdu) | oui |
| F5 | La procédure de départ d'un agent inclut-elle systématiquement la désactivation du compte AD, et sous quel délai ? | oui |
| F6 | Le micro-serveur peut-il recevoir une IP fixe sur un sous-réseau **distinct** de la bureautique, avec une règle de pare-feu ? (M-19) | oui |
| F7 | Les 6 écrans auront-ils des IP fixes ? (nécessaires à la règle de pare-feu et au jeton par écran) | oui |
| F8 | Un emplacement de sauvegarde **hors de la tour** (partage réseau ou NAS) est-il disponible pour le compte de service ? (E-07) | oui |
| F9 | L'exploitant accepte-t-il l'objectif de reprise proposé (repartir en moins de 30 min, au plus 1 h de données perdues) ? | oui |
| F10 | La tour sera-t-elle installée en Windows Server 2019 (fin de support étendu le **9 janvier 2029**) alors que l'installation doit vivre au-delà, ou peut-elle l'être directement en 2022/2025 ? (F-15) | 2022/2025 |
| F11 | Le service informatique peut-il fixer par GPO ou WSUS la fenêtre de mise à jour et de redémarrage entre 02:00 et 04:00 ? | oui |
| F12 | Un compte de service dédié (idéalement un gMSA) peut-il faire tourner le service Node, **sans** appartenance au groupe Administrateurs ? | oui |
| F13 | Le prestataire du FortiGate s'engage-t-il par écrit sur un délai d'application des correctifs FortiOS critiques, et qui le vérifie côté Régie ? | oui |
| F14 | Le FortiGate peut-il porter un profil VPN restreint à la seule IP:port du micro-serveur, sans accès au reste du LAN ? | oui |
| F15 | Le double facteur sera-t-il obligatoire pour la supervision hors site ? | oui |
| F16 | L'accès du Nid d'Aigle passera-t-il par un routeur 4G/5G portant lui-même le tunnel (et non par le Raspberry), afin de préserver la procédure d'échange standard en 10 minutes ? | oui |
| F17 | Quel est le plafond de données mensuel du forfait 5G du Nid d'Aigle, et le volume réel de l'écran a-t-il été mesuré sur 24 h avant de le souscrire ? | *(à chiffrer)* |
| F18 | L'exploitant accepte-t-il qu'au Nid d'Aigle une coupure 5G de plus de 15 min fasse passer l'écran en mode neutre (aucun horaire affiché), ou faut-il rendre cette tolérance réglable **par écran** avant la création du schéma SQLite ? | *(à trancher)* |
| F19 | La bascule des 6 écrans peut-elle être programmée hors saison, ou à défaut un jour de petit service ? | oui |
| F20 | Le projet Supabase sera-t-il conservé intact au moins une saison complète après la bascule, comme unique filet de retour arrière ? | oui |
| F21 | Un compte administrateur local de secours (indépendant de l'AD) est-il souhaité, pour pouvoir supprimer un train si l'annuaire est indisponible ? | *(à trancher)* |
| F22 | La tour aura-t-elle un accès sortant vers Internet, ou l'installation devra-t-elle se faire par archive préparée hors ligne (module natif `better-sqlite3`) ? | *(à établir)* |

---

## 10. TROIS CHOSES À FAIRE EN PREMIER

Classement par rapport entre le risque évité et l'effort. Les trois touchent l'**enjeu n°1** — un
horaire faux affiché en gare — et représentent **moins d'une journée de travail à elles trois**.

### 1. Fermer le repli silencieux vers les horaires de démonstration — 1 h · C-02

**Pourquoi en premier.** C'est le seul constat du rapport qui peut se déclencher **tout seul**, sans
attaquant, à la faveur d'une manipulation d'exploitation banale — et qui produit alors le scénario
exact que le cahier des charges cherche à éviter : une suppression et un retard **inventés** affichés
en gare, sur les six écrans, sans que la supervision puisse s'en apercevoir.

**Et il est peut-être déjà actif.** Avant toute correction, ouvrir
`https://<organisation>.github.io/tmb-affichage-gares/config.js` (question **G1**). Un 404 signifie que
les écrans affichent des horaires de démonstration en ce moment même.

**Ce qu'il y a à faire** : `exit 1` dans la branche `else` de `deploy.yml:40-42` ; refus du mock en
production dans `src/data/index.ts` avec bascule sur l'`afficheErreur()` **déjà écrit**
(`ecran.ts:400-403`). Ne rien afficher plutôt qu'afficher du faux.

### 2. Échapper la température et contraindre `params` en base — 1 h · C-01

**Pourquoi ensuite.** Un caractère manquant à une seule ligne (`affichage-commun.ts:117`) donne au rôle
le **moins** privilégié l'exécution de JavaScript arbitraire sur les six écrans — donc le pouvoir de
réécrire les heures de départ — puis, par le bouton « Aperçu » de la supervision, la session de
l'administrateur. Le rapport de risque à l'effort est le plus élevé de tout l'audit : dix minutes de
correctif front, vingt minutes de contrainte SQL.

**Poser les deux verrous, pas un seul.** L'échappement corrige le symptôme ; la contrainte `CHECK` sur
`params.valeur` rétablit la frontière côté serveur, pour que l'interface ne soit plus le seul garde-fou.
Ajouter dans la foulée la CSP en `<meta http-equiv>` (20 min, I-14) : elle ne coûte rien, elle est
compatible avec le code actuel, et elle rattrape la prochaine injection.

### 3. Ne plus faire confiance à l'horloge du Raspberry — 40 min pour l'essentiel · C-03

**Pourquoi malgré tout en trois.** C'est le constat dont le correctif complet est le plus long
(1 journée), mais **les deux tiers du risque se retirent en 40 minutes** :

- `Math.max(0, …)` sur `ageMs()` (`resilience.ts:81`) — **10 minutes**. Un âge négatif ne doit jamais
  compter comme une donnée fraîche. C'est la ligne qui, aujourd'hui, désactive **à la fois** le badge
  « données de HH:MM » et l'écran neutre après une coupure de courant.
- Validation de l'instantané relu depuis `localStorage` (`resilience.ts:43-50`) — **30 minutes**.

Le reste — écart d'horloge serveur via l'en-tête HTTP `Date`, NTP imposé sur les six postes — peut
suivre. Le principe est déjà admis dans le projet : le serveur a cessé de faire confiance à l'horloge du
Raspberry pour le signal de vie (`trg_signal_de_vie`). Il reste à en tirer la conséquence pour
l'affichage.

**Juste après, si le temps le permet** : la politique Chromium sur les six Pi (30 min, C-04). Elle ferme
d'un coup les outils de développement, la navigation libre et l'empoisonnement durable du cache — trois
constats pour une commande.
