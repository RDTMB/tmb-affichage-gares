# Plan de développement v2 — 10 étapes avec prompts Claude Code

Une étape = une session Claude Code (faire `/clear` entre deux). Coller le
prompt tel quel, vérifier les critères d'acceptation, committer
(`etape-N-…`), passer à la suivante. Le contexte permanent est dans
`CLAUDE.md` et `docs/`.

> Prérequis : dépôt GitHub public initialisé avec la structure décrite dans
> `PROMPT-DE-DEMARRAGE.md` (CLAUDE.md, docs/, public/grilles/, public/logos/,
> maquettes/), Node.js LTS installé.

---

## Étape 1 — Socle + moteur horaires réels

```
Lis CLAUDE.md, docs/01-spec-fonctionnelle.md, docs/02-spec-technique.md et
les deux grilles public/grilles/*.json. Initialise le projet Vite +
TypeScript vanilla strict, multi-pages (index, ecran, grille, supervision —
squelettes avec bandeau charte), Prettier, Vitest. Crée src/core/types.ts
et src/core/horaires.ts : moteur PUR (heure injectée, jamais Date.now())
implémentant serviceActif(date), generationJour, passagesPourGare (arrivées
réelles des grilles, repli arret_intermediaire_s, « — » à l'origine), prochaineArrivee,
compteARebours, finDeService (grille du lendemain), positionsTrains,
appliqueTerminusBellevue (à partir du TRAIN N, journée entière = T1, pair
normalisé N−1) + expressATraiter. Tests Vitest
complets listés dans docs/02 §3 — utilise les vrais horaires (ex. : T9
express 10:30 → Saint-Gervais 10:45, Motivon 10:57, Nid d'Aigle 11:30,
absent à Col de Voza et Bellevue ; T1 07:00 → rame de T2 08:13).
npm test et npm run build doivent passer.
```

**Acceptation** : ≥ 20 tests verts couvrant express/facultatif/terminus/
retard/suppression/rotation ; aucun accès réseau dans `src/core/`.

## Étape 2 — Écran de gare

```
Lis docs/01 §3 et ouvre maquettes/ecran-gare.html : reproduis fidèlement ce
rendu dans ecran.html (tokens charte dans src/styles/tokens.css, polices
@fontsource amaranth + lato auto-hébergées, logos de public/logos/ inlinés
au build). Branche un DataProvider factice (src/data/mock.ts) rejouant la
grille grand service + l'état du jour de la maquette (facultatifs
3/4/9/10/17/18 activés, retard +10 Météo sur le 11, descente 16 supprimée).
Implémente toutes les règles de docs/01 §3 : colonnes Arrivée/Départ,
flèches obliques ↗/↙, express avec GRAND picto motrice à droite du nom de
la destination + texte bilingue sur une ligne, libellés « TRAIN X »
(majuscules, sans n°), cases de compte à rebours toutes de la même taille,
vélos, À QUAI clignotant, retard avec « théorique HH:MM », supprimé barré,
prochaine arrivée avec rame colorée, messages défilants lents, météo, fin
de service et terminus Bellevue avec logo blanc, veille nuit. Paramètres URL gare/ecran/simule/zoom (erreur
claire si gare absente). Vérifie avec ?simule=10:18, 16:50, 21:30 et le
drapeau terminus.
```

**Acceptation** : rendu identique à la maquette en 1920×1080 ; états
spéciaux corrects ; aucune requête réseau externe (polices/logos locaux).

## Étape 3 — Grille du jour

```
Lis docs/01 §4 et maquettes/grille-horaire.html : implémente grille.html
(mêmes tokens, moteur, mock) : tableaux montée/descente avec N° de train,
pictos motrice/vélos, badges retard/supprimé, « | » express, colonnes
passées atténuées, prochain départ surligné, position des trains (point
pulsant couleur rame), altitudes de la grille JSON, légende, pied messages
+ météo. Facultatifs non activés absents.
```

**Acceptation** : identique à la maquette ; cohérence totale avec
ecran.html sur les mêmes données mock.

## Étape 4 — Résilience, écran neutre, kiosque

```
Lis docs/01 §7 et docs/02 §4. Service worker (précache app + polices +
logos, network-first config.js) ; snapshot données en localStorage ; badge
« données de HH:MM » au-delà de 2 min sans synchro ; au-delà de
duree_cache_min (15 min, paramètre) BASCULE EN ÉCRAN NEUTRE (logo, horloge,
message bilingue « informations momentanément indisponibles ») — jamais
d'horaires périmés ; retour auto ; démarrage hors-ligne géré ; anti-burn-in
1 px/h ; curseur masqué ; index.html = portail listant les écrans des 6
gares. Documente les tests manuels (DevTools offline) dans
docs/tests-manuels.md.
```

**Acceptation** : offline < 15 min → horaires + badge ; > 15 min (simulé en
réduisant le paramètre) → écran neutre ; retour online → reprise sans
rechargement.

## Étape 5 — Supabase (données réelles)

```
Lis docs/02 §1, §2, §5. Crée src/data/provider.ts (interface exacte),
src/data/supabase.ts, sélection par window.TMB_CONFIG (mock si vide).
Fournis supabase/schema.sql (TOUTES les tables + fonction role_courant() +
policies RLS par rôle du §2, + bucket medias) et supabase/seed.sql
(machines, motifs, params, jour de démonstration). Realtime : canal unique
+ refresh complet + repli polling 30 s. Heartbeat 30 s + commande
recharger. Aucune clé dans le code. Rédige le brouillon
docs/mise-en-service.md (création Supabase pas à pas, non-développeur).
```

**Acceptation** : modification en base visible sur écran < 2 s ; anonyme
rejeté en écriture (tester via l'API REST) ; `git grep` sans secret ; mode
mock intact.

## Étape 6 — Supervision : onglets Circulations / Messages / Écrans

```
Lis docs/01 §5 et maquettes/supervision.html : implémente
supervision.html : connexion Supabase Auth + rôle (profils), en-tête et
onglets fidèles à la maquette. Onglet Circulations : navigation par date
(calendrier + Aujourd'hui/Demain), génération idempotente du jour, service
affiché selon la date, bascule Terminus Bellevue (« à partir du TRAIN N »,
montées uniquement ; pré-remplit la colonne Terminus, express signalés
« à traiter »),
ORDRE APPARIÉ montée puis descente de la même rotation (rame choisie sur la
montée seulement, héritée par la descente ; libellés TRAIN X), colonne
Terminus par train (montées non express : Nid d'Aigle/Bellevue, descente
appariée « Départ de Bellevue »), facultatif Activé/Non activé, statuts,
retard ±5, motif, badges, confirmation suppression, export CSV. Onglet
Messages : liste avec bouton Modifier (édition en place) + formulaire avec
traduction EN automatique à la saisie (Edge Function DeepL + dictionnaire
de repli, docs/02 §5) et cible toutes/gares/train, priorité, expiration.
Onglet Écrans : déclaration préalable des postes, cartes temps réel (en ligne si vu < 150 s), recharger.
Publier = logPublication + toast ; compteur de modifications.
```

**Acceptation** : scénario complet < 2 min : connexion → activer le
facultatif n° 23 → retarder le 11 de 10 min Météo → publier → l'écran
mock… réel affiche tout < 2 s ; un compte « caisse » ne voit que Messages.

## Étape 7 — Médias

```
Lis docs/01 §2.5 et §3.6, docs/02 §2 (table medias, bucket). Onglet Médias
en supervision : réglage duree_horaires_s, upload (image JPG/PNG, vidéo MP4
muette, max 20 Mo), liste avec durée/gares/actif/expiration/aperçu/
suppression. Côté écrans : cycle horaires⇄médias plein écran (préchargement,
vidéo muted playsinline, jamais pendant un À QUAI ≤ 2 min avant départ),
uniquement médias actifs non expirés ciblant la gare ; sans média → horaires
en continu ; les médias sont dans le précache du service worker après
première lecture (rejeu hors-ligne).
```

**Acceptation** : une image et une vidéo uploadées tournent sur l'écran aux
durées réglées ; expiration retire le média ; hors-ligne, le cycle continue
avec les médias déjà vus.

## Étape 8 — Paramètres, utilisateurs et rôles

```
Lis docs/01 §5.5 et docs/02 §2/§5. Onglet Paramètres (admin uniquement) :
Machines (CRUD nom/couleur/cercle/en service — répercuté partout),
Motifs (CRUD fr/en), Utilisateurs (liste des profils, création par
invitation email, rôle, désactivation, réinit. mot de passe), Saisons
(grilles présentes + périodes, lecture seule + veille nuit), Météo sommet
(t°, ciel FR/EN). Applique le filtrage par rôle sur TOUS les onglets
(interface ET policies déjà en place — vérifier les deux).
```

**Acceptation** : un compte supervision ne voit pas Paramètres ; une
machine renommée/re-colorée apparaît sur les écrans < 2 s ; création d'un
utilisateur caisse fonctionnelle de bout en bout.

## Étape 9 — Déploiement GitHub Pages + docs d'exploitation

```
Lis docs/02 §6. Crée .github/workflows/deploy.yml (npm ci, test, build,
base Vite correcte, config.js depuis les variables de dépôt, déploiement
Pages). Finalise docs/mise-en-service.md (checklist complète illustrée,
non-développeur : GitHub, Supabase, comptes, variables, Pages,
vérifications) et docs/kiosque.md (Raspberry Pi OS Lite : Chromium --kiosk
via systemd avec URL de la gare, unclutter, NTP, reboot 04:30, échange
standard 10 min, checklist de pose en gare : alimentation, RJ45/wifi,
orientation, test plein soleil). README.md court avec liens.
```

**Acceptation** : URL Pages opérationnelle sur les 4 pages ; échec de test
= pas de déploiement ; un Pi suivant kiosque.md démarre seul sur sa gare.

## Étape 10 (phase 2, plus tard) — Serveur interne Windows + SSO AD

```
Lis docs/02 §7. Crée server/ : Fastify + better-sqlite3 + SSE /api/events,
routes miroir du DataProvider, service des fichiers dist/ et
server/medias/, sessions cookie. Authentification : comptes locaux argon2
ET option LDAP Active Directory (ldapts) avec mapping groupes AD → rôles
(config server/config.json). src/data/api.ts (ApiProvider, SSE + repli
polling). Scripts : import-supabase.mjs (données + médias), creer-compte.mjs.
Rédige docs/phase2-windows.md : Node LTS sur Windows Server 2019, service
via nssm, port 8080, pare-feu intranet, sauvegardes quotidiennes, bascule
des écrans (config.js), VPN Fortinet (Nid d'Aigle + accès distant, à
paramétrer par le prestataire), retour arrière cloud. Aucun changement dans
src/ hors src/data/.
```

**Acceptation** : `node server` sert tout sans internet ; écriture
supervision → écran < 2 s via SSE ; import Supabase rejouable sans
doublon ; connexion par compte local ET par LDAP simulé.

---

## Conseils d'utilisation de Claude Code

- Relire chaque diff ; refuser toute dépendance imprévue (CLAUDE.md).
- Tester chaque étape avec `?simule=` et les écrans des 6 gares.
- Les horaires viennent des JSON officiels : si un test « attend » une
  autre heure, c'est le test qui a tort — corriger le test, pas la grille.
- En cas de doute métier : docs/01 fait foi, puis demander à l'exploitant.
