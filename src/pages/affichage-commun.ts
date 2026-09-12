// Éléments d'affichage partagés entre l'écran de gare et la grille du jour :
// échappement HTML, pied de page (messages défilants + météo sommet).
import type { Affluence, GareId, Grille, Message, Params, PassageGare } from '../core/types';
import { dureeDefilementS, VITESSE_TICKER_DEFAUT, vitesseTickerValide } from '../core/ticker';

// ---------------------------------------------------------------------------
// Affluence — la jointure (date, numéro), hors du moteur horaires
// ---------------------------------------------------------------------------
// `src/core/horaires.ts` reste PUR et IGNORANT du remplissage : il calcule ce
// que la grille et la journée disent des trains, rien d'autre. Le
// rapprochement se fait ici, APRÈS `passagesPourGare()`, sur la seule clé qui
// vaille — le NUMÉRO de train. Un TRAIN 9 complet l'est dans toutes les gares
// qu'il doit encore desservir, jamais dans une seule : c'est pourquoi la
// jointure ne regarde pas la gare.
//
// La date n'est pas comparée : les deux jeux viennent de la MÊME journée
// (`getAffluence(dateJour)` à côté de `getJour(dateJour)`). La comparer
// donnerait l'illusion d'un contrôle sans en être un — il faudrait pour cela
// que la page mélange deux dates, ce qu'elle ne fait nulle part.

/** Niveaux acceptés. Toute autre valeur venue de la base est IGNORÉE. */
const NIVEAUX_AFFLUENCE = new Set(['limite', 'complet']);

/**
 * Recopie le remplissage déclaré sur les lignes d'affichage. Rend un NOUVEAU
 * tableau : les passages viennent du moteur, on ne les mute pas.
 *
 * Un niveau inconnu (base plus récente que ce déploiement) est ignoré plutôt
 * que recopié : mieux vaut une pastille absente qu'une classe CSS inventée.
 */
export function appliqueAffluence(
  passages: PassageGare[],
  affluence: readonly Affluence[],
): PassageGare[] {
  const parNumero = new Map<number, PassageGare['affluence']>();
  for (const a of affluence) {
    if (NIVEAUX_AFFLUENCE.has(a.niveau)) parNumero.set(a.numero, a.niveau);
  }
  if (parNumero.size === 0) return passages.map((p) => ({ ...p, affluence: null }));
  return passages.map((p) => ({ ...p, affluence: parNumero.get(p.numero) ?? null }));
}

export function echapper(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Couleurs de rame — validées, jamais seulement échappées
// ---------------------------------------------------------------------------
// Les couleurs de pastille (`machines.couleur`, `machines.cercle`) sont
// PARAMÉTRABLES en supervision, et elles finissent dans un attribut `style=""`
// construit par concaténation. `echapper()` n'y suffirait PAS : il empêche de
// sortir de l'attribut, mais laisse passer une injection CSS. Une valeur comme
// `red;position:fixed;inset:0;z-index:9999` transforme une pastille d'un
// centimètre en rectangle plein écran qui masque le tableau des départs — sur
// les six écrans à la fois, sans que personne en gare puisse rien y faire.
// C'est la FORME hexadécimale qui ferme le trou, pas l'échappement.
//
// Périmètre : l'écriture sur `machines` est réservée au rôle admin par RLS, le
// scénario suppose donc un compte admin détourné ou resté actif. Ça reste à
// corriger — c'est trois lignes — mais ce n'est pas une urgence.

/** Hexadécimal strict à six chiffres : la seule forme que la charte utilise. */
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Couleur de rame sûre : hexadécimal strict, sinon le bleu-gris de la charte. */
export function couleurSure(v: string | null | undefined, repli = '#708DA4'): string {
  return v && HEX.test(v) ? v : repli;
}

/**
 * Couleur d'ANNEAU sûre — `null` quand il n'y a pas d'anneau à dessiner.
 *
 * `cercle` est facultatif et son ABSENCE veut dire quelque chose : seule
 * Marguerite porte un anneau (charte 2026), les trois autres rames n'en ont
 * pas. Lui donner un repli comme à `couleur` dessinerait donc un anneau
 * bleu-gris autour de Marie, Anne et Jeanne — un faux, là où l'on corrige
 * justement les faux. Une valeur mal formée est traitée comme une absence :
 * pas d'anneau vaut mieux qu'un anneau inventé.
 */
export function anneauSur(v: string | null | undefined): string | null {
  return v && HEX.test(v) ? v : null;
}

/**
 * Le message est-il diffusable À CET INSTANT, indépendamment de toute gare ?
 *
 * Extrait de `messagesVisibles()` pour l'aperçu de la supervision, qui n'a pas
 * de gare : il montrait jusqu'ici les messages `actif` SANS regarder leur
 * expiration, et annonçait donc un message que plus aucun écran ne portait.
 */
export function messageEnCours(m: Message, maintenantMs: number): boolean {
  if (!m.actif) return false;
  return !(m.expire_at && new Date(m.expire_at).getTime() < maintenantMs);
}

/**
 * Messages visibles pour une gare (cible toutes / gares / train encore
 * desservi, non expirés à l'heure simulable). `gare` null (grille sans
 * paramètre) : seuls les messages « toutes » s'affichent.
 */
export function messagesVisibles(
  messages: Message[],
  gare: GareId | null,
  passagesRestants: PassageGare[],
  maintenantMs: number,
): Message[] {
  return messages.filter((m) => {
    if (!messageEnCours(m, maintenantMs)) return false;
    if (m.cible_type === 'gares') return gare !== null && (m.gares ?? []).includes(gare);
    if (m.cible_type === 'train') {
      return gare !== null && passagesRestants.some((p) => p.numero === m.train_numero);
    }
    return true;
  });
}

/**
 * Ce dont le bandeau a besoin pour composer une ligne : les deux textes, rien
 * d'autre. La supervision mesure la largeur d'un message EN COURS DE SAISIE,
 * qui n'est pas encore un `Message` (ni id, ni cible, ni priorité) — c'est le
 * TYPE qui s'ouvre à ce qu'il lit vraiment, pas l'appelant qui forge une
 * coquille de `Message` pour satisfaire une signature trop large.
 */
export interface TexteBilingue {
  texte_fr: string;
  texte_en: string;
}

/**
 * Contenu du bandeau : « FR • EN » quand la traduction existe, français SEUL
 * sinon — pas de séparateur « • » orphelin ni de bloc anglais vide (la
 * traduction indisponible ne doit jamais produire de faux anglais).
 */
export function contenuTicker(affiches: readonly TexteBilingue[]): string {
  return affiches
    .map((m) => {
      const en = m.texte_en.trim();
      const fr = echapper(m.texte_fr);
      return en ? `${fr}<span class="sep">•</span><span class="en">${echapper(en)}</span>` : fr;
    })
    .join('<span class="sep">◆</span>');
}

// ---------------------------------------------------------------------------
// Bandeau ALTERNÉ : l'important, puis les autres (docs/01 §2.11)
// ---------------------------------------------------------------------------

/**
 * Largeur réellement offerte au bandeau, à cet instant, en pixels.
 *
 * Elle se LIT sur le parent, jamais sur une constante : elle dépend du pavé
 * météo, qui varie (la température fait un ou trois caractères, le nom du ciel
 * change), et de la résolution de l'écran.
 */
export function largeurBandeau(element: HTMLElement): number {
  return element.parentElement?.clientWidth ?? 0;
}

/**
 * LE contenu posé dans `element` déborde-t-il de la place offerte ?
 *
 * SEUL ORACLE de « ça tient » dans tout le projet — les écrans de gare, la
 * grille du jour et l'aperçu de la supervision l'appellent tous les trois. Un
 * second oracle (un modèle au canevas, par exemple) serait faux par
 * construction : le texte du bandeau mêle deux graisses — le français en 700,
 * l'anglais en 400 — et une mesure à police unique se tromperait là où le
 * navigateur, lui, a déjà tout mis en page.
 *
 * `scrollWidth` inclut le rembourrage ; on le retire pour ne comparer que le
 * texte. Sans cela, le `padding-left: 100vw` du mode défilant ferait conclure
 * « déborde » pour n'importe quel texte, même vide.
 *
 * LARGEUR NON MESURABLE (élément dans un onglet masqué, feuille de style pas
 * encore là) : on répond « déborde ». L'inverse — répondre « ça tient » à une
 * largeur de zéro — accorderait le mode immobile à N'IMPORTE QUELLE longueur,
 * et c'est exactement la troncature silencieuse que ce lot supprime. Le doute
 * doit faire DÉFILER, jamais figer.
 */
export function debordeBandeau(element: HTMLElement): boolean {
  const large = largeurBandeau(element);
  if (large <= 0) return true;
  const rembourrage = parseFloat(getComputedStyle(element).paddingLeft) || 0;
  return element.scrollWidth - rembourrage > large;
}

/**
 * Place offerte au bandeau sur l'écran de gare LE PLUS ÉTROIT, en em de sa
 * propre police. Mesurée au navigateur le 12/09/2026 sur `ecran.html` :
 *
 * | Écran       | Rapport | Bandeau  | Police   | Budget     |
 * | ----------- | ------- | -------- | -------- | ---------- |
 * | 1920 × 1080 | 16/9    | 1424 px  | 31,32 px | 45,47 em   |
 * | 1366 × 768  | 16/9    | 1013 px  | 22,27 px | 45,48 em   |
 * | 1280 × 1024 | 5/4     |  862 px  | 27,84 px | 30,96 em   |
 * | 1024 × 768  | 4/3     |  689 px  | 22,27 px | **30,94 em** |
 * |  800 × 600  | 4/3     |  539 px  | 17,40 px | 30,98 em   |
 *
 * Deux régimes seulement, et chacun INVARIANT par résolution : c'est le bloc
 * de transcription `--u` de `ecran.css` (≤ 4/3) qui fait la marche. On retient
 * 30,9 em, arrondi VERS LE BAS du minimum mesuré — l'arrondi doit se tromper
 * dans le sens qui annonce « défilera » à tort, jamais « tient » à tort.
 *
 * Sert à la supervision, qui n'a aucun écran de gare sous la main : son aperçu
 * est un MODÈLE RÉDUIT à cette échelle (`.apercu-ticker`, supervision.css), ce
 * qui lui permet d'appeler le même `debordeBandeau()` et d'obtenir le même
 * verdict que l'écran le plus étroit. Verrouillé par `bandeau-alterne.test.ts`.
 */
export const BUDGET_BANDEAU_MIN_EM = 30.9;

/** Un créneau du cycle du bandeau. */
export interface PhaseBandeau {
  /** Messages de ce créneau, dans l'ordre. */
  messages: Message[];
  /** `important` = un message prioritaire seul ; `normaux` = tous les autres. */
  nature: 'important' | 'normaux';
  /**
   * Part du cycle. DEUX pour un créneau important, UNE pour les normaux :
   * c'est la règle des deux tiers / un tiers, décidée par l'exploitant le
   * 09/09/2026. Elle est définie PAR MESSAGE IMPORTANT, pas globalement —
   * voir `cycleBandeau()`.
   */
  parts: number;
}

/**
 * Composition du cycle du bandeau.
 *
 * DÉFAUT CORRIGÉ (relevé par l'exploitant le 09/09/2026) : un seul message
 * « importante » faisait DISPARAÎTRE tous les autres du bandeau —
 * `importantes.length > 0 ? importantes : visibles` les écartait purement et
 * simplement. Un avis posé le matin effaçait donc l'information sur les vélos
 * jusqu'à ce que quelqu'un pense à le désactiver.
 *
 * Le bandeau ALTERNE désormais : chaque message important occupe seul toute la
 * largeur pendant deux parts, les messages normaux défilent pendant une part,
 * puis on recommence. Rien n'est perdu, et l'urgent revient toutes les
 * quelques secondes au lieu d'une fois par minute.
 *
 * PLUSIEURS IMPORTANTS : chacun reçoit son propre créneau de deux parts, et le
 * cycle s'ALLONGE. On ne partage pas un créneau unique entre eux — un message
 * d'urgence lu à moitié ne sert à rien, et diviser le temps par cinq
 * reviendrait à ne montrer aucun des cinq. On ne plafonne pas non plus leur
 * nombre : faire disparaître le cinquième serait recréer exactement le défaut
 * qu'on répare. La conséquence — les messages normaux reviennent moins souvent
 * — est le coût VISIBLE d'un abus de la priorité, et c'est ce qui le rend
 * corrigible par l'exploitation plutôt que caché par le code.
 *
 * PURE : c'est elle qui garantit que la supervision et les écrans montrent le
 * même cycle (l'aperçu de la supervision l'appelle aussi).
 */
export function cycleBandeau(visibles: Message[]): PhaseBandeau[] {
  const importants = visibles.filter((m) => m.priorite === 'importante');
  const normaux = visibles.filter((m) => m.priorite !== 'importante');
  if (importants.length === 0) {
    // Comportement d'avant, inchangé : un seul créneau qui défile.
    return normaux.length === 0 ? [] : [{ messages: normaux, nature: 'normaux', parts: 1 }];
  }
  const phases: PhaseBandeau[] = importants.map((m) => ({
    messages: [m],
    nature: 'important' as const,
    parts: 2,
  }));
  if (normaux.length > 0) phases.push({ messages: normaux, nature: 'normaux', parts: 1 });
  return phases;
}

/**
 * Signature du CONTENU du cycle — jamais de la phase en cours.
 *
 * Le bandeau est rafraîchi toutes les secondes : si la signature changeait au
 * fil du cycle, celui-ci redémarrerait à chaque seconde et ne montrerait
 * jamais que son premier créneau. C'est le piège concret de ce lot.
 */
export function signatureCycle(phases: readonly PhaseBandeau[]): string {
  return phases
    .map(
      (p) =>
        `${p.nature}:${p.parts}:` +
        p.messages.map((m) => `§${m.id}§${m.texte_fr}§${m.texte_en}`).join(''),
    )
    .join('||');
}

/**
 * Durée d'un créneau, en secondes.
 *
 * L'UNITÉ DU CYCLE EST UN PASSAGE COMPLET, jamais une durée arbitraire : un
 * créneau qui s'arrêterait au milieu de la course d'un message le couperait,
 * et ce serait le même défaut que celui qu'on répare, déplacé d'un cran. La
 * durée suit donc la vitesse paramétrée (`vitesse_ticker_px_s`) par
 * l'intermédiaire de `dureeDefilementS()`.
 *
 *  - créneau NORMAUX : exactement un passage ;
 *  - créneau IMPORTANT immobile : deux passages des normaux — c'est la règle
 *    des deux tiers, et le message ne bouge pas, donc rien à terminer ;
 *  - créneau IMPORTANT qui DÉFILE : le nombre ENTIER de ses propres passages
 *    qui atteint ou dépasse deux passages des normaux. Jamais coupé, et
 *    toujours au moins aussi long que sa part.
 *  - aucun message normal : il n'y a rien à alterner, mais les importants
 *    tournent entre eux — deux passages du créneau lui-même.
 */
export function dureePhaseS(e: {
  nature: 'important' | 'normaux';
  /** Durée d'UN passage complet du contenu de cette phase. */
  passageS: number;
  /** Durée d'un passage complet du contenu NORMAL, `null` s'il n'y en a pas. */
  passageNormauxS: number | null;
  /** Cette phase défile-t-elle (le texte déborde) ? */
  defile: boolean;
}): number {
  if (e.nature === 'normaux') return e.passageS;
  const cible = 2 * (e.passageNormauxS ?? e.passageS);
  if (!e.defile) return cible;
  // ARRONDI AU PLUS PROCHE, pas au supérieur : mesuré le 15/09, un message
  // important de 56,2 s par passage contre 30 s pour les normaux donnait, en
  // arrondissant au supérieur, deux passages soit 112 s — 79 % du cycle au
  // lieu des deux tiers décidés. Au plus proche, un passage suffit et le
  // partage retombe à 65 / 35. Le plancher d'UN passage garantit qu'un
  // message n'est jamais coupé en route, ce qui reste la règle intouchable.
  const passages = Math.max(1, Math.round(cible / Math.max(e.passageS, 0.001)));
  return passages * e.passageS;
}

/**
 * Bandeau de messages : le cycle ALTERNÉ (docs/01 §2.11).
 *
 * Reconstruit uniquement quand le CONTENU change — jamais au fil du cycle —
 * pour ne pas réinitialiser l'animation à chaque seconde. Un cycle relancé
 * toutes les secondes ne montrerait jamais que son premier créneau.
 *
 * La décision « immobile ou défile » est prise SUR LE RENDU, pas sur un
 * modèle : on compare la largeur réelle du contenu à celle réellement offerte
 * par le bandeau. Cette largeur dépend du pavé météo, qui varie (la
 * température fait un ou trois caractères, le nom du ciel change) — une
 * constante mentirait. Et le texte mêle deux graisses (le français en 700,
 * l'anglais en 400) : un modèle au canevas, avec une seule police, se
 * tromperait là où le navigateur, lui, a déjà tout mis en page.
 */
export function creeTicker(
  element: HTMLElement,
): (visibles: Message[], vitessePxS?: unknown) => void {
  let derniereSignature: string | null = null;
  let derniereVitesse = VITESSE_TICKER_DEFAUT;
  let phases: PhaseBandeau[] = [];
  let indexPhase = 0;
  let minuterie: ReturnType<typeof setTimeout> | null = null;

  /** Largeur réellement offerte au bandeau, à cet instant. */
  const largeurDisponible = (): number => largeurBandeau(element);

  /** Le contenu POSÉ déborde-t-il ? Oracle UNIQUE — voir `debordeBandeau()`. */
  const deborde = (): boolean => debordeBandeau(element);

  /** Durée d'UN passage complet du contenu posé, à la vitesse en vigueur. */
  const passageS = (defile: boolean): number =>
    defile
      ? // Le défilement translate l'élément de sa PROPRE largeur
        // (`translateX(-100%)`), rembourrage compris : c'est donc elle, la
        // distance parcourue.
        dureeDefilementS(element.offsetWidth, derniereVitesse)
      : // Immobile : le temps qu'il METTRAIT à traverser. Il suit la même
        // vitesse de lecture, donc le même réglage d'exploitation.
        dureeDefilementS(element.scrollWidth + largeurDisponible(), derniereVitesse);

  /** Pose une phase et rend la durée de son créneau. */
  const poseLaPhase = (phase: PhaseBandeau, passageNormauxS: number | null): number => {
    element.classList.remove('fixe');
    element.innerHTML = contenuTicker(phase.messages);
    // AUCUNE TRONCATURE SILENCIEUSE : le mode immobile n'est accordé qu'à ce
    // qui tient. Un message d'urgence à moitié affiché est pire qu'absent — le
    // voyageur lit « Circulation interrompue entre Voza et » et croit savoir.
    const immobile = phase.nature === 'important' && !deborde();
    element.classList.toggle('fixe', immobile);
    const duree = passageS(!immobile);
    element.style.animationDuration = immobile ? '' : `${duree}s`;
    return dureePhaseS({
      nature: phase.nature,
      passageS: duree,
      passageNormauxS,
      defile: !immobile,
    });
  };

  /**
   * Durée d'un passage des messages NORMAUX — l'unité du cycle. Mesurée en
   * posant leur contenu hors écran : le créneau des importants vaut deux fois
   * celui-là (règle des deux tiers), et il faut donc le connaître avant de
   * poser la première phase.
   */
  const mesurePassageNormaux = (): number | null => {
    const normaux = phases.find((p) => p.nature === 'normaux');
    if (!normaux) return null;
    const etatClasse = element.className;
    const etatHtml = element.innerHTML;
    element.classList.remove('fixe');
    element.innerHTML = contenuTicker(normaux.messages);
    const mesure = dureeDefilementS(element.offsetWidth, derniereVitesse);
    element.className = etatClasse;
    element.innerHTML = etatHtml;
    return mesure;
  };

  const avance = (): void => {
    if (phases.length === 0) return;
    const phase = phases[indexPhase % phases.length];
    if (!phase) return;
    const duree = poseLaPhase(phase, mesurePassageNormaux());
    // UN SEUL créneau : rien à alterner, donc aucune minuterie — le bandeau
    // se comporte exactement comme avant ce lot.
    if (phases.length < 2) return;
    minuterie = setTimeout(() => {
      indexPhase = (indexPhase + 1) % phases.length;
      avance();
    }, duree * 1000);
  };

  // Les polices arrivent après le premier rendu : la largeur change, donc la
  // durée doit être recalculée (sinon la vitesse serait fausse au démarrage).
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (derniereSignature !== null && !element.classList.contains('fixe')) {
        element.style.animationDuration = `${dureeDefilementS(element.offsetWidth, derniereVitesse)}s`;
      }
    }).observe(element);
  }

  return (visibles, vitessePxS) => {
    const vitesse = vitesseTickerValide(vitessePxS);
    const prochaines = cycleBandeau(visibles);
    const signature = signatureCycle(prochaines);

    if (signature !== derniereSignature) {
      derniereSignature = signature;
      derniereVitesse = vitesse;
      phases = prochaines;
      indexPhase = 0;
      if (minuterie !== null) clearTimeout(minuterie);
      minuterie = null;
      if (phases.length === 0) {
        element.classList.remove('fixe');
        element.innerHTML = '';
        return;
      }
      avance();
      return;
    }
    // Contenu inchangé : la vitesse peut avoir été modifiée en supervision
    // (prise en compte sans rechargement de l'écran). Le cycle, lui, NE
    // REDÉMARRE PAS — c'est tout l'objet de la signature.
    if (vitesse !== derniereVitesse) {
      derniereVitesse = vitesse;
      if (!element.classList.contains('fixe')) {
        element.style.animationDuration = `${dureeDefilementS(element.offsetWidth, vitesse)}s`;
      }
    }
  };
}

/** Pavé météo sommet : température + « Nid d'Aigle · 2 412 m » + ciel FR/EN. */
export function meteoHtml(params: Params, grille: Grille): string {
  const meteo = params.meteo_sommet;
  const sommet = grille.gares.find((g) => g.id === 'nid-daigle');
  const lieu = sommet ? `${sommet.nom} · ${sommet.altitude_m.toLocaleString('fr-FR')} m` : '';
  // L'heure du relevé dit au voyageur si la température date de dix minutes
  // ou de la veille. Discrète : elle ne concurrence pas le chiffre.
  const releve =
    typeof meteo.heure_releve === 'string' && meteo.heure_releve !== ''
      ? `<span class="releve">relevé ${echapper(meteo.heure_releve)}</span>`
      : '';
  // La température vient du jsonb `params.valeur` : le type `number` ne vaut
  // qu'à la compilation. Ceinture ET bretelles — paramsValides() l'a déjà
  // neutralisée, mais la page ne doit jamais redevenir un point d'injection.
  // Test sur `typeof`, PAS sur `Number(...)` : Number(null), Number('') et
  // Number([]) valent tous 0, et afficher « 0 °C » pour une valeur corrompue
  // serait afficher une information FAUSSE. Rien vaut mieux que faux.
  const t =
    typeof meteo.t === 'number' && Number.isFinite(meteo.t) ? String(Math.round(meteo.t)) : '—';
  return `<div class="t">${echapper(t)}°C${releve}</div>
    <div>${echapper(lieu)}<small>${echapper(`${meteo.ciel_fr} / ${meteo.ciel_en}`)}</small></div>`;
}

// ---------------------------------------------------------------------------
// Bandeau de SIMULATION — heure simulée (?simule=) et journée simulée (?jour=)
// ---------------------------------------------------------------------------

const FORMAT_JOUR_FR = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const FORMAT_JOUR_EN = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export interface BandeauSimulation {
  fr: string;
  en: string;
}

/**
 * Texte du bandeau permanent, ou `null` quand rien n'est simulé.
 *
 * Une journée simulée MENT PLUS QU'UNE HEURE simulée : un horaire décalé de
 * trois heures se remarque au premier coup d'œil, la grille de demain a l'air
 * parfaitement normale. Le bandeau doit donc dire LAQUELLE, en toutes lettres
 * et dans les deux langues — pas seulement « affichage de test ».
 *
 * PURE : c'est le seul moyen de verrouiller la formulation par un test, et
 * c'est la formulation qui porte l'honnêteté de l'écran.
 */
export function bandeauSimulation(e: {
  heureSimulee: boolean;
  jourSimule: string | null;
}): BandeauSimulation | null {
  if (!e.heureSimulee && e.jourSimule === null) return null;
  if (e.jourSimule === null) {
    // Formulation d'origine, conservée au mot près : elle est en gare.
    return { fr: 'Heure simulée — affichage de test', en: 'Simulated time — test display' };
  }
  // Midi UTC : le formatage tombe sur le même jour toute l'année.
  const quand = new Date(`${e.jourSimule}T12:00:00Z`);
  const enLettresFr = FORMAT_JOUR_FR.format(quand);
  const fr = e.heureSimulee ? 'Journée et heure simulées' : 'Journée simulée';
  const en = e.heureSimulee ? 'Simulated day and time' : 'Simulated day';
  return {
    fr: `${fr} : ${enLettresFr} — affichage de test`,
    en: `${en}: ${FORMAT_JOUR_EN.format(quand)} — test display`,
  };
}

// ---------------------------------------------------------------------------
// Badge de fraîcheur — âge des données ET nature de la journée (F-16)
// ---------------------------------------------------------------------------

export interface EtatBadgeFraicheur {
  visible: boolean;
  /** Texte bilingue, une seule ligne. Vide quand le badge est masqué. */
  texte: string;
}

/**
 * Ce que dit le badge du coin, quand il dit quelque chose.
 *
 * Deux faits peuvent le réclamer, et ils peuvent COEXISTER :
 *
 *  - l'ÂGE des données. Le badge le disait déjà : « Données de HH:MM ». Il
 *    répond à « ce que je lis était-il vrai il y a longtemps ? ».
 *  - la NATURE de la journée (F-16). `Jour.enregistre` existe, le provider le
 *    renseigne, et aucun écran ne le lisait. À faux, les écrans servent la
 *    grille THÉORIQUE : journée jamais ouverte en supervision (début de
 *    saison, week-end) ou génération interrompue entre les deux requêtes. Ce
 *    ne sont pas des horaires inventés — c'est l'absence de signal quand
 *    l'application SAIT qu'elle ne sert pas la journée d'exploitation. Aucun
 *    retard, aucune suppression, aucun terminus exceptionnel n'y a été saisi,
 *    parce que personne n'a ouvert la journée.
 *
 * §5.C — QUI GAGNE. La nature passe devant l'âge : « Données de 07:12 » laisse
 * conclure que l'information est vraie et vieille de trois minutes, ce qui est
 * plus trompeur qu'utile si la journée n'a jamais été confirmée. Mais l'âge
 * n'est pas écrasé en SILENCE — c'est le défaut qu'on corrige ici : quand les
 * deux s'appliquent, UN seul badge porte les DEUX faits, la nature d'abord.
 * Un écran de gare ne doit pas devenir un mur de bandeaux, donc jamais deux.
 *
 * Trois cas où le badge se TAIT, et chacun pour sa raison :
 *  - veille de nuit ou écran neutre : il n'y a aucun horaire à l'écran, donc
 *    rien à qualifier. Le badge y peindrait par-dessus (z-index 60 contre 50
 *    pour la veille) — un défaut qui existait déjà pour l'âge seul ;
 *  - hors saison : `enregistre` est faux pour une raison LÉGITIME (aucune
 *    journée n'est créée quand rien ne circule) et l'écran porte déjà son
 *    état « aucun service aujourd'hui » ;
 *  - données fraîches sur une journée confirmée : rien à signaler.
 *
 * DATE FUTURE CONSULTÉE VOLONTAIREMENT. Ce cas n'existait pas quand ces
 * lignes ont été écrites : les écrans n'affichaient que la date courante.
 * `?jour=AAAA-MM-JJ` l'a créé le 11/09/2026. Le badge n'a PAS été adapté,
 * parce qu'il dit déjà la vérité : une journée à venir non ouverte en
 * supervision a `enregistre` à faux, et « Horaires théoriques — journée non
 * confirmée » est exactement ce qu'il faut lire. Ouverte, elle passe à vrai et
 * le badge se tait. Vérifié au navigateur, pas supposé. Le bandeau de
 * simulation, lui, dit la DATE regardée — voir `bandeauSimulation()`.
 */
export function badgeFraicheur(e: {
  ageMs: number | null;
  seuilBadgeMs: number;
  dureeCacheMs: number;
  heureSync: string | null;
  jour: { enregistre?: boolean; hors_saison?: boolean } | null;
  veille: boolean;
}): EtatBadgeFraicheur {
  const masque = { visible: false, texte: '' };
  const neutre = e.ageMs === null || e.ageMs > e.dureeCacheMs;
  if (e.veille || neutre) return masque;

  const donneesAgees = e.ageMs !== null && e.ageMs > e.seuilBadgeMs;
  const nonConfirmee = e.jour?.enregistre === false && e.jour?.hors_saison !== true;
  if (!donneesAgees && !nonConfirmee) return masque;

  const quand = e.heureSync ?? '--:--';
  const age = `Données de ${quand} / Data from ${quand}`;
  if (!nonConfirmee) return { visible: true, texte: age };
  const nature =
    'Horaires théoriques — journée non confirmée / Theoretical timetable — day not confirmed';
  return { visible: true, texte: donneesAgees ? `${nature} · ${age}` : nature };
}

/**
 * Cadence du signal de vie. Le seuil « hors ligne » de la supervision
 * (SEUIL_HORS_LIGNE_MS) en dérive : il vaut deux cycles et demi, de quoi
 * absorber un cycle manqué sans déclarer un écran mort à tort.
 */
export const INTERVALLE_HEARTBEAT_MS = 60_000;

/**
 * Bornes de `duree_cache_min`, identiques à la contrainte SQL. La surcharge
 * d'URL `?cache=N` n'était bornée NULLE PART : `?cache=99999` repoussait
 * l'écran neutre de plusieurs mois, et le poste affichait des horaires
 * périmés indéfiniment.
 */
export const CACHE_MIN_MINUTES = 3;
export const CACHE_MAX_MINUTES = 60;

/**
 * Durée du cache retenue, en minutes. La surcharge d'URL n'est appliquée que
 * si elle est FINIE et dans les bornes ; sinon on retombe sur le paramètre de
 * base, lui-même borné par la contrainte SQL. PURE et testée : c'est elle qui
 * décide quand l'écran passe en neutre.
 */
export function dureeCacheMinutes(surchargeUrl: string | null, base: number | undefined): number {
  const n = Number(surchargeUrl);
  if (
    surchargeUrl !== null &&
    surchargeUrl.trim() !== '' &&
    Number.isFinite(n) &&
    n >= CACHE_MIN_MINUTES &&
    n <= CACHE_MAX_MINUTES
  ) {
    return n;
  }
  return base ?? 15;
}

/**
 * Promesse bornée dans le temps. La PREMIÈRE synchronisation ne doit jamais
 * pouvoir bloquer indéfiniment : tant qu'elle n'a pas rendu la main, la boucle
 * de rendu n'est pas armée et l'écran reste sur la coquille HTML — tableau
 * VIDE, ce qui se lit en gare comme « plus aucun train aujourd'hui ».
 *
 * L'expiration vaut ÉCHEC de synchronisation, donc écran neutre : jamais un
 * tableau vide. Le minuteur est toujours nettoyé (18 h d'affichage par jour).
 */
export function avecDelai<T>(promesse: Promise<T>, delaiMs: number, siExpire: T): Promise<T> {
  return new Promise<T>((resoud) => {
    const minuteur = window.setTimeout(() => resoud(siExpire), delaiMs);
    void promesse.then(
      (v) => {
        window.clearTimeout(minuteur);
        resoud(v);
      },
      () => {
        window.clearTimeout(minuteur);
        resoud(siExpire);
      },
    );
  });
}

/** Au-delà, la première synchronisation est abandonnée (écran neutre). */
export const DELAI_PREMIERE_SYNCHRO_MS = 10_000;

/**
 * Un signal de vie en échec ne doit JAMAIS interrompre l'affichage
 * voyageurs : on trace UNE fois par cause (un kiosque tourne 18 h par jour,
 * pas question d’inonder la console) et le cycle suivant réessaie.
 */
export function creeJournalHeartbeat(): (erreur: unknown) => void {
  const vues = new Set<string>();
  return (erreur) => {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    if (vues.has(message)) return;
    vues.add(message);
    console.warn(`[TMB] signal de vie non enregistré, réessai au prochain cycle : ${message}`);
  };
}
