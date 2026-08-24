# TMB — Affichage voyageurs en gare (v2)

Application web d'information voyageurs pour le Tramway du Mont-Blanc (Régie
Départementale, Haute-Savoie) : écrans dynamiques dans 6 gares + poste de
supervision. Ligne à crémaillère, voie unique, 12,8 km, Le Fayet (580 m) →
Nid d'Aigle (été seulement), 4 rames : Marie, Anne, Jeanne, Marguerite.

## Documents de référence (à lire avant de coder)

- `docs/01-spec-fonctionnelle.md` — quoi afficher, règles métier, cas limites
- `docs/02-spec-technique.md` — architecture, schéma de données, sécurité, déploiement
- `docs/03-plan-de-developpement.md` — étapes ordonnées avec critères d'acceptation
- `public/grilles/2026-ete-grand-service.json` et `2026-ete-petit-service.json`
  — horaires OFFICIELS été 2026 (générés depuis l'Excel de la Régie) : ne
  jamais modifier les heures à la main
- `public/logos/` — logos officiels SVG (logo rond, logo rond blanc, picto
  motrice express blanc et marine)
- `maquettes/` — maquettes HTML **validées par l'exploitant** : REPRODUIRE
  fidèlement leur rendu (elles font foi pour le visuel)

## Charte graphique 2026 (obligatoire)

- Couleurs : rouge `#E52A23`, bleu clair `#BDDCF4`, bleu-gris `#708DA4`,
  rouge foncé `#8B1419`, crème `#F1E5D1`, marine `#213B57`.
- Rames (pastilles) : Marie `#2E74B5`, Anne `#7FA51E`, Jeanne `#C2447A`,
  Marguerite blanc cerclé rouge `#E52A23` — modifiables dans Paramètres.
- Typographies : **Amaranth** (titres, noms de gares) + **Lato** (textes,
  heures) — auto-hébergées via @fontsource, JAMAIS de CDN (les écrans
  doivent démarrer sans internet).
- Logo : uniquement les fichiers de `public/logos/`, jamais redessiné,
  jamais déformé (interdits de la charte).

## Stack et contraintes

- **Vite + TypeScript, sans framework** (vanilla). Cibles : Raspberry Pi en
  navigateur kiosque (écrans) + navigateurs récents (supervision).
- Multi-pages : `index.html` (portail de test), `ecran.html`, `grille.html`,
  `supervision.html`.
- **Couche d'accès aux données interchangeable** : interface `DataProvider`
  (`src/data/provider.ts`). Phase 1 `SupabaseProvider`, phase 2 `ApiProvider`
  (micro-serveur Windows). AUCUN appel Supabase hors de `src/data/`.
- Bundle JS < 400 Ko gzippé hors polices ; re-rendu 1×/s max ; pas de fuite
  mémoire (18 h/jour d'affichage).

## Conventions

- UI voyageurs bilingue FR + EN ; code en anglais ; commentaires en français.
- TypeScript `strict`, Prettier. Fuseau Europe/Paris, format `HH:MM`
  (les secondes des horaires officiels — ex. 07:27:30 — sont tronquées à
  l'affichage mais conservées dans les calculs).
- Gares (ordre de la ligne) : `le-fayet`, `saint-gervais`, `motivon`,
  `col-de-voza`, `bellevue`, `nid-daigle`.
- Toute logique horaire vit dans `src/core/horaires.ts`, PURE et testée
  (Vitest) ; l'heure y est toujours injectée (jamais `Date.now()` dans
  `src/core/`) pour permettre l'heure simulée `?simule=HH:MM`.

## Règles métier qui piègent (ne pas improviser)

- **Trains numérotés** 1–25 impairs = montées, 2–26 pairs = descentes.
  Libellé affiché partout : « TRAIN 9 » (majuscules, sans « n° »).
- **Rames appariées** : la rame se choisit sur la montée UNIQUEMENT ; la
  descente de la même rotation hérite automatiquement (non modifiable).
  En supervision, montée et descente d'une rotation sont affichées l'une
  sous l'autre.
- **Terminus par train** : chaque montée (hors express) peut être limitée à
  Bellevue individuellement (colonne Terminus) ; sa descente appariée part
  alors de Bellevue. La bascule « Terminus Bellevue » s'exprime « à partir
  du TRAIN N » (N = montée, impair ; pair normalisé vers N−1) et PRÉ-REMPLIT
  la colonne des rotations dont la montée porte un numéro ≥ N — la colonne
  reste prioritaire et ajustable ; journée entière = à partir du T1.
- **Express** : passages absents à col-de-voza et bellevue (rien à afficher
  dans ces gares) ; GRAND picto motrice à droite du nom de la destination +
  ligne « EXPRESS — sans arrêt / non-stop : Col de Voza & Bellevue ». Un
  express n'est JAMAIS tronqué à Bellevue : dans une plage limitée, il
  circule normalement et est signalé « à traiter » (suppression ou
  requalification manuelle en supervision) ; sa descente appariée non
  express part, elle, de Bellevue.
- **Facultatif** : n'apparaît sur AUCUN écran tant qu'il n'est pas activé en
  supervision ; une fois activé, il s'affiche normalement.
- **Terminus Bellevue** (météo, à partir du TRAIN N, et service hiver =
  à partir du T1) : montées ≥ N → destination « Bellevue — terminus
  exceptionnel », express signalés « à traiter » (jamais retirés
  automatiquement), écran du Nid d'Aigle → état « tronçon fermé » bilingue
  avec logo dès qu'il n'a plus aucun passage à afficher.
- **Arrivée + départ** affichés pour chaque passage ; arrivée intermédiaire
  = départ − `arret_intermediaire_s` (60 s, dans la grille JSON) ; « — » au
  point d'origine.
- **Suppression** : le train reste affiché barré avec motif jusqu'à son
  heure théorique, puis disparaît.
- **Mode dégradé** : cache ≤ 15 min avec badge « données de HH:MM », puis
  ÉCRAN NEUTRE (logo + horloge + message bilingue) — jamais d'horaires
  potentiellement faux.
- **Compte à rebours** : cases (« chips ») toutes de la même taille.
- **Messages** : modifiables après création ; traduction anglaise générée
  automatiquement (service de traduction) puis éditable.
- **Rotation** : la rame d'une montée assure la descente suivante (ex.
  T1 07:00 → arrivée 08:05:30 → repart T2 08:13:30).

## Sécurité — règles absolues

- Jamais de secret dans le code (dépôt public) : URL/clé Supabase via
  variables de dépôt → `config.js` généré au build. Le projet utilise la
  nouvelle génération de clés Supabase : la clé « publishable »
  (`sb_publishable_…`, voir `supabase/INFOS-PROJET.md`) est PUBLIQUE par
  conception — la sécurité repose sur RLS ; la clé « secret »
  (`sb_secret_…`) ne doit JAMAIS apparaître nulle part côté front.
- Écrans en lecture seule ; écritures réservées aux sessions authentifiées
  (RLS) ; rôles Administrateur / Supervision / Caisse (voir docs/02 §5).
- Supervision derrière connexion obligatoire.

## Commandes

```bash
npm run dev / build / test / preview
```

## Definition of done (chaque étape)

1. `npm run build` et `npm run test` sans erreur ni warning TS.
2. Critères d'acceptation de l'étape (docs/03) vérifiés, y compris avec
   `?simule=` et en coupant le réseau quand c'est pertinent.
3. Rendu conforme aux maquettes (couleurs charte, colonnes alignées).
4. Aucun secret commité.
