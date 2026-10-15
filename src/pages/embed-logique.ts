// Page d'horaires pour le SITE WEB (embed.html, dans une iframe) — rendu PUR.
//
// Tout ce que la page montre se décide et s'écrit ici, sans DOM : `embed.ts`
// ne fait que charger les données, poser cette chaîne et câbler les clics.
// C'est ce qui permet de verrouiller par un test la règle la plus importante
// de la page (aucune fermeture annoncée), en rendant VRAIMENT la page plutôt
// qu'en cherchant des mots dans son code.
//
// UNE SEULE SOURCE POUR LES RÈGLES. Rien n'est recalculé ici : quels trains,
// dans quel ordre, barrés jusqu'à quand, en retard de combien, privés,
// complets, quelles gares hors section, quels messages — tout vient des
// fonctions qu'appellent déjà l'écran de gare et la grille du jour
// (`passagesPourGare`, `appliqueAffluence`, `mentionCourse`, `compteARebours`,
// `etatTronconFerme`, `messagesVisibles`, `tableHtml`…). Ce module ne garde
// que la MISE EN PAGE propre à un site web.
import {
  A_QUAI_ORIGINE_DEFAUT_S,
  compteARebours,
  etatTronconFerme,
  fermetureGare,
  finDeService,
  formatHeure,
  libelleTrainCourt,
  messageTronconDefaut,
  passagesPourGare,
  positionsTrains,
  sectionComplete,
  sectionDuJour,
  trainsDuJour,
  type FermetureGare,
  type VueJournee,
} from '../core/horaires';
import { garesSautees } from '../core/train-sup';
import { courseFermee, horsGrille, ORDRE_GARES } from '../core/types';
import type {
  Affluence,
  GareId,
  Grille,
  Jour,
  Message,
  Params,
  PassageGare,
  Sens,
  TrainJour,
} from '../core/types';
import {
  appliqueAffluence,
  echapper,
  LIBELLE_MENTION,
  mentionCourse,
  messagesVisibles,
  styleRame,
} from './affichage-commun';
import { RAME_INCONNUE, tableHtml } from './grille-tableau';

// ---------------------------------------------------------------------------
// Constantes de la page
// ---------------------------------------------------------------------------

/** Départs montrés par sens, dans l'onglet d'une gare (décision du 15/10/2026). */
export const DEPARTS_PAR_SENS = 4;

/**
 * Relecture des données. JAMAIS de temps réel : un canal par visiteur, sur le
 * projet Supabase des six écrans de gare, pourrait épuiser le quota de
 * connexions simultanées et empêcher un écran de se reconnecter.
 */
export const INTERVALLE_RELECTURE_MS = 60_000;

/**
 * Re-rendu local (compte à rebours, trains qui passent), sans requête. Dix
 * secondes : la page se consulte, elle ne se lit pas sur un quai — l'écran de
 * gare, lui, se rafraîchit chaque seconde.
 */
export const INTERVALLE_RENDU_MS = 10_000;

/** Type du message envoyé à la page parente pour ajuster la hauteur de l'iframe. */
export const TYPE_MESSAGE_HAUTEUR = 'tmb-embed-hauteur';

// ---------------------------------------------------------------------------
// Les mots
// ---------------------------------------------------------------------------
// Les mentions de course viennent de `LIBELLE_MENTION`, partagée avec l'écran
// de gare et la grille. Les mots ci-dessous sont écrits dans `ecran.ts`, au
// fil de son gabarit, et ne sont pas exportés : ils sont donc RECOPIÉS ici,
// et un test (`embed.test.ts`) vérifie que l'écran de gare emploie toujours
// chacun d'eux. Si l'écran change un mot, le test tombe et force l'alignement.

export const MOTS_EMBED = {
  supprime: { fr: 'Supprimé', en: 'Cancelled' },
  retard: { fr: 'Retard', en: 'Delayed' },
  aLHeure: { fr: "À l'heure", en: 'On time' },
  theorique: 'théorique',
  express: 'EXPRESS — sans arrêt / non-stop : Col de Voza & Bellevue',
  sansArret: 'SANS ARRÊT — non-stop : ',
  terminusExceptionnel: 'Terminus exceptionnel / Exceptional terminus',
  departConfirme: 'Horaire confirmé / Departure confirmed',
  velos: 'Vélos acceptés / Bikes allowed',
  prive: 'Train privé / Private charter',
  montee: 'Montée / Ascent',
  descente: 'Descente / Descent',
  serviceTermine: 'Service terminé',
} as const;

/**
 * Les deux messages de repli. AUCUN ne dit « fermé » : l'absence de grille en
 * ligne ne prouve pas que le Tramway ne roule pas — seules les grilles d'été
 * sont saisies à ce jour (constaté en production le 15/10/2026), et une
 * fermeture annoncée à tort sur le site public est pire qu'un horaire absent.
 */
export const MESSAGES_REPLI = {
  sansGrille: {
    fr: 'Horaires pas encore disponibles en ligne',
    en: 'Timetable not yet available online',
  },
  injoignable: {
    fr: 'Horaires en direct momentanément indisponibles',
    en: 'Live timetable temporarily unavailable',
  },
  lien: { fr: "Plus d'informations", en: 'More information' },
} as const;

// ---------------------------------------------------------------------------
// Paramètres d'URL
// ---------------------------------------------------------------------------

/**
 * `?gare=` retenu, ou `null`. Une valeur inconnue est IGNORÉE, sans écran
 * d'erreur : c'est une page publique, une faute de frappe dans le CMS ne doit
 * rien casser — l'onglet par défaut s'affiche.
 */
export function gareDemandee(valeur: string | null): GareId | null {
  return valeur !== null && (ORDRE_GARES as readonly string[]).includes(valeur)
    ? (valeur as GareId)
    : null;
}

export type VueEmbed = 'departs' | 'jour';

/** `?vue=jour` ouvre la grille complète ; toute autre valeur, les départs. */
export function vueDemandee(valeur: string | null): VueEmbed {
  return valeur === 'jour' ? 'jour' : 'departs';
}

/**
 * Lien vers la page d'informations du site, fourni AU BUILD par l'exploitant
 * (`VITE_EMBED_URL_INFOS`). Jamais inventé : absent ou mal formé, pas de lien.
 * `https:` seulement — un `javascript:` collé par erreur ne doit pas devenir
 * un lien cliquable.
 */
export function urlInfosValide(valeur: string | undefined | null): string | null {
  const brute = (valeur ?? '').trim();
  if (brute === '') return null;
  try {
    const u = new URL(brute);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Ce que la page peut montrer
// ---------------------------------------------------------------------------

/**
 * - `horaires` : une grille couvre la journée ;
 * - `sans-grille` : `vueJournee()` répond `fermee` OU `indisponible`. Les écrans
 *   de gare distinguent les deux ; le site NON, par décision de l'exploitant
 *   du 15/10/2026 : seules les grilles saisies existent, et « fermé » serait
 *   faux pour toute période d'exploitation pas encore saisie ;
 * - `injoignable` : aucune donnée, ou données trop vieilles (`duree_cache_min`),
 *   ou horloge du visiteur trop fausse pour qu'un compte à rebours dise vrai.
 *
 * `vueJournee()` n'est PAS modifiée : c'est cette page qui traduit sa réponse.
 */
export type EtatEmbed = 'horaires' | 'sans-grille' | 'injoignable';

export function etatEmbed(donneesUtilisables: boolean, vue: VueJournee | null): EtatEmbed {
  if (!donneesUtilisables || vue === null) return 'injoignable';
  return vue === 'horaires' ? 'horaires' : 'sans-grille';
}

/** Un onglet de gare : son nom officiel, et sa fermeture du moment s'il y en a une. */
export interface OngletGare {
  id: GareId;
  nom: string;
  /**
   * Non nul quand l'écran de cette gare afficherait « ligne fermée » à cet
   * instant (`etatTronconFerme`) : hors de la section exploitée, ou Nid d'Aigle
   * sous le terminus Bellevue. L'onglet est alors grisé, et non cliquable.
   */
  inactif: FermetureGare | null;
}

export function ongletsGares(grille: Grille, jour: Jour, maintenant_s: number): OngletGare[] {
  const nomGare = (id: GareId): string => grille.gares.find((g) => g.id === id)?.nom ?? id;
  return ORDRE_GARES.map((id) => ({
    id,
    nom: nomGare(id),
    inactif: etatTronconFerme(grille, jour, id, maintenant_s)
      ? (fermetureGare(jour, id, nomGare) ?? null)
      : null,
  }));
}

/** L'onglet affiché : celui demandé s'il est actif, sinon le premier actif de la ligne. */
export function ongletRetenu(
  onglets: readonly OngletGare[],
  demande: GareId | null,
): GareId | null {
  const actif = (id: GareId | null): boolean =>
    id !== null && onglets.some((o) => o.id === id && o.inactif === null);
  if (actif(demande)) return demande;
  return onglets.find((o) => o.inactif === null)?.id ?? null;
}

/** Les prochains départs d'une gare, par sens — mêmes trains, même ordre que l'écran de gare. */
export interface DepartsGare {
  montee: PassageGare[];
  descente: PassageGare[];
  /** Le sens existe-t-il AUJOURD'HUI à cette gare (Le Fayet n'a pas de descente) ? */
  sensDuJour: Record<Sens, boolean>;
}

export function departsParSens(
  grille: Grille,
  jour: Jour,
  gare: GareId,
  maintenant_s: number,
  affluence: readonly Affluence[],
): DepartsGare {
  // EXACTEMENT la liste de l'écran de gare (`ecran.ts`, `rendre()`), avant sa
  // coupe à cinq lignes : mêmes trains, même ordre, mêmes trains barrés.
  const departs = appliqueAffluence(
    passagesPourGare(grille, jour, gare, maintenant_s),
    affluence,
  ).filter((p) => p.depart_s !== null);
  const duJour = passagesPourGare(grille, jour, gare).filter((p) => p.depart_s !== null);
  const pourSens = (sens: Sens): PassageGare[] =>
    departs.filter((p) => p.sens === sens).slice(0, DEPARTS_PAR_SENS);
  return {
    montee: pourSens('montee'),
    descente: pourSens('descente'),
    sensDuJour: {
      montee: duJour.some((p) => p.sens === 'montee'),
      descente: duJour.some((p) => p.sens === 'descente'),
    },
  };
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

/** Tout ce que la page a chargé ou décidé, et dont le rendu a besoin. */
export interface EntreeRendu {
  etat: EtatEmbed;
  /** Grille de la journée — non nulle quand `etat === 'horaires'`. */
  grille: Grille | null;
  /** Grille du lendemain, pour « premier départ demain ». */
  grilleDemain: Grille | null;
  jour: Jour | null;
  params: Params | null;
  messages: readonly Message[];
  affluence: readonly Affluence[];
  /** Gare de `?gare=` : cible des messages. `null` = seuls les messages « toutes gares ». */
  gareUrl: GareId | null;
  /** Onglet demandé (clic ou `?gare=`). */
  ongletDemande: GareId | null;
  vue: VueEmbed;
  maintenant_s: number;
  maintenantMs: number;
  /** « Mercredi 15 juillet ». */
  dateLongue: string;
  /** « HH:MM » de la dernière lecture réussie. */
  heureSync: string | null;
  /** Badge de fraîcheur (`badgeFraicheur()`), vide s'il se tait. */
  badge: string;
  /** Bandeau d'heure ou de journée simulée (`bandeauSimulation()`). */
  simulation: { fr: string; en: string } | null;
  urlInfos: string | null;
}

function bilingue(fr: string, en: string, balise = 'span'): string {
  return `<${balise} class="fr">${echapper(fr)}</${balise}> <${balise} class="en" lang="en">${echapper(en)}</${balise}>`;
}

function lienInfos(url: string | null): string {
  if (url === null) return '';
  return `<p class="infos"><a href="${echapper(url)}" target="_top">${bilingue(
    MESSAGES_REPLI.lien.fr,
    MESSAGES_REPLI.lien.en,
  )}</a></p>`;
}

function messagesHtml(e: EntreeRendu): string {
  // MÊMES règles de ciblage et d'expiration que le bandeau des écrans : une
  // gare précise (`?gare=`), ou seulement les messages « toutes gares ». Les
  // passages restants servent aux messages ciblant un TRAIN.
  const passages =
    e.etat === 'horaires' && e.grille && e.jour && e.gareUrl
      ? passagesPourGare(e.grille, e.jour, e.gareUrl, e.maintenant_s)
      : [];
  const visibles = messagesVisibles([...e.messages], e.gareUrl, passages, e.maintenantMs);
  if (visibles.length === 0) return '';
  const items = visibles
    .map((m) => {
      const en = (m.texte_en ?? '').trim();
      return `<li class="message${m.priorite === 'importante' ? ' importante' : ''}"><span class="fr">${echapper(
        m.texte_fr,
      )}</span>${en ? ` <span class="en" lang="en">${echapper(en)}</span>` : ''}</li>`;
    })
    .join('');
  return `<ul class="messages">${items}</ul>`;
}

function enteteHtml(e: EntreeRendu): string {
  const simulation = e.simulation
    ? `<p class="simulation">${bilingue(e.simulation.fr, e.simulation.en)}</p>`
    : '';
  const maj =
    e.etat !== 'injoignable' && e.heureSync
      ? `<span class="maj">Mis à jour à ${echapper(e.heureSync)} · <span lang="en">Updated ${echapper(e.heureSync)}</span></span>`
      : '';
  return `${simulation}<header class="entete"><h1>${bilingue('Horaires en direct', 'Live timetable')}</h1><p class="date"><span class="jour">${echapper(e.dateLongue)}</span>${maj}</p></header>`;
}

function repliHtml(fr: string, en: string, url: string | null): string {
  return `<div class="repli" role="status"><p class="titre">${echapper(fr)}</p><p class="en" lang="en">${echapper(en)}</p>${lienInfos(url)}</div>`;
}

/** Retard, ou suppression, avec son motif dans les deux langues quand il est connu. */
function motifBilingue(params: Params | null, fr: string): string {
  const en = params?.motifs.find((m) => m.fr === fr)?.en;
  return en ? `${fr} / ${en}` : fr;
}

function ligneDepart(
  p: PassageGare,
  e: EntreeRendu,
  grille: Grille,
  trains: Map<number, TrainJour>,
  nomGare: (id: GareId) => string,
): string {
  const supprime = p.statut === 'supprime';
  const retard = p.statut === 'retard';
  const machine = e.params?.machines.find((m) => m.nom === p.rame) ?? {
    ...RAME_INCONNUE,
    nom: p.rame,
  };

  const heure =
    retard && p.depart_s !== null
      ? `${formatHeure(p.depart_s)}<s class="theorique" aria-label="${MOTS_EMBED.theorique}">${formatHeure(p.depart_theorique_s)}</s>`
      : formatHeure(p.depart_theorique_s);

  const statut = supprime
    ? `<span class="statut supp">${bilingue(MOTS_EMBED.supprime.fr, MOTS_EMBED.supprime.en)}</span>`
    : retard
      ? `<span class="statut retard">${bilingue(`${MOTS_EMBED.retard.fr} +${p.retard_min} min`, MOTS_EMBED.retard.en)}</span>`
      : `<span class="statut ok">${bilingue(MOTS_EMBED.aLHeure.fr, MOTS_EMBED.aLHeure.en)}</span>`;

  // Compte à rebours : la MÊME fonction que la case de l'écran de gare, qui
  // dit « PARTI » d'un train encore listé — sans elle, un train parti depuis
  // une minute se lirait comme le prochain.
  let rebours = '';
  if (!supprime && p.depart_s !== null) {
    const c = compteARebours(
      p.depart_s,
      e.maintenant_s,
      p.arrivee_s,
      e.params?.a_quai_origine_s ?? A_QUAI_ORIGINE_DEFAUT_S,
    );
    const contenu = c.libelle_en
      ? `${echapper(c.libelle)} <span class="en" lang="en">${echapper(c.libelle_en)}</span>`
      : echapper(c.libelle);
    rebours = `<span class="rebours ${c.type}">${contenu}</span>`;
  }

  const mention = mentionCourse({ supprime, acces: p.acces, affluence: p.affluence });
  const pastilleMention = mention
    ? `<span class="mention ${mention}">${echapper(LIBELLE_MENTION[mention].fr)} <span lang="en">${echapper(LIBELLE_MENTION[mention].en)}</span></span>`
    : '';

  // Gares non desservies par un train hors grille : même calcul que l'écran.
  let sansArret = '';
  const train = trains.get(p.numero);
  if (train && horsGrille(train)) {
    try {
      const sautees = garesSautees(
        grille,
        train.sens,
        train.passages.map((x) => x.gare),
      );
      if (sautees.length > 0) {
        sansArret = `${MOTS_EMBED.sansArret}${sautees.map(nomGare).join(' & ')}`;
      }
    } catch {
      // grille inexploitable : on n'invente rien
    }
  }

  const notes: string[] = [];
  if (supprime) {
    notes.push(motifBilingue(e.params, p.motif ?? MOTS_EMBED.supprime.fr));
  } else {
    if (courseFermee(p)) notes.push(MOTS_EMBED.prive);
    notes.push(
      p.express
        ? MOTS_EMBED.express
        : sansArret || (p.sens === 'montee' ? MOTS_EMBED.montee : MOTS_EMBED.descente),
    );
    if (p.terminusExceptionnel && p.sens === 'montee') notes.push(MOTS_EMBED.terminusExceptionnel);
    if (p.departConfirme) notes.push(MOTS_EMBED.departConfirme);
    if (p.velos) notes.push(MOTS_EMBED.velos);
    if (retard && p.motif) notes.push(motifBilingue(e.params, p.motif));
  }

  const badge = libelleTrainCourt({ numero: p.numero, nature: p.nature, libelle: p.libelle }, [
    ...trains.values(),
  ]);

  return `<li class="depart${supprime ? ' supprime' : ''}${retard ? ' en-retard' : ''}">
<span class="heure">${heure}</span>
<span class="corps"><span class="dest"><span class="badge-train">${echapper(badge)}</span> <span class="nom-dest">${echapper(nomGare(p.destination))}</span>${pastilleMention}${
    p.express ? '<span class="express">EXPRESS</span>' : ''
  }</span><span class="note">${notes.map(echapper).join(' · ')}</span><span class="rame"><span class="pastille" style="${styleRame(machine)}"></span>${echapper(p.rame)}</span></span>
<span class="etat">${rebours}${statut}</span>
</li>`;
}

function ongletsHtml(onglets: readonly OngletGare[], retenu: GareId | null): string {
  const boutons = onglets
    .map((o) => {
      if (o.inactif) {
        const raison = `${o.inactif.texte_fr} / ${o.inactif.texte_en}`;
        return `<button type="button" role="tab" class="onglet inactif" disabled aria-disabled="true" aria-selected="false" title="${echapper(raison)}">${echapper(o.nom)}</button>`;
      }
      const choisi = o.id === retenu;
      return `<button type="button" role="tab" class="onglet${choisi ? ' choisi' : ''}" data-gare="${o.id}" aria-selected="${choisi}">${echapper(o.nom)}</button>`;
    })
    .join('');
  return `<nav class="onglets" role="tablist" aria-label="Gares / Stations">${boutons}</nav>`;
}

function bandeauSectionHtml(jour: Jour, nomGare: (id: GareId) => string): string {
  // Même formulation que les écrans et la grille du jour : le message saisi en
  // supervision, à défaut le texte construit sur la section réelle.
  if (sectionComplete(jour)) return '';
  const { debut, fin } = sectionDuJour(jour);
  const defaut = messageTronconDefaut(debut, fin, nomGare);
  const fr = (jour.message_troncon_fr ?? '').trim() || defaut.fr;
  const en = (jour.message_troncon_en ?? '').trim() || defaut.en;
  return `<p class="bandeau-section">${bilingue(fr, en)}</p>`;
}

function departsHtml(
  e: EntreeRendu,
  grille: Grille,
  jour: Jour,
  gare: GareId,
  nomGare: (id: GareId) => string,
): string {
  const d = departsParSens(grille, jour, gare, e.maintenant_s, e.affluence);
  const trains = new Map(trainsDuJour(grille, jour).map((t) => [t.numero, t]));

  if (d.montee.length === 0 && d.descente.length === 0) {
    // Plus aucun départ ici aujourd'hui : la même décision que l'écran de gare
    // (`finDeService`), avec le premier départ du lendemain quand une grille
    // le couvre.
    const fin = finDeService(grille, jour, gare, e.maintenant_s, e.grilleDemain);
    const demain =
      fin && fin.premierDepart_s !== null
        ? bilingue(
            `Premier départ demain à ${formatHeure(fin.premierDepart_s)}`,
            `First departure tomorrow at ${formatHeure(fin.premierDepart_s)}`,
          )
        : bilingue('Plus de départ aujourd’hui', 'No more departures today');
    return `<div class="fin-service"><p class="titre">${bilingue(MOTS_EMBED.serviceTermine, 'Service ended')}</p><p>${demain}</p></div>`;
  }

  const bloc = (sens: Sens, liste: PassageGare[]): string => {
    if (!d.sensDuJour[sens]) return '';
    const titre =
      sens === 'montee'
        ? bilingue('Vers le Nid d’Aigle', 'Uphill')
        : bilingue('Vers Le Fayet', 'Downhill');
    const corps =
      liste.length > 0
        ? `<ol class="liste-departs">${liste.map((p) => ligneDepart(p, e, grille, trains, nomGare)).join('')}</ol>`
        : `<p class="vide">${bilingue('Plus de départ aujourd’hui dans ce sens', 'No more departures today in this direction')}</p>`;
    return `<section class="sens sens-${sens}"><h2>${titre}</h2>${corps}</section>`;
  };
  return `<div class="departs">${bloc('montee', d.montee)}${bloc('descente', d.descente)}</div>`;
}

function grilleJourHtml(
  e: EntreeRendu,
  grille: Grille,
  jour: Jour,
  gare: GareId | null,
  nomGare: (id: GareId) => string,
): string {
  // LE MÊME CODE que `grille.html` (`grille-tableau.ts`) : colonnes triées à
  // l'heure, trains barrés, retards, mentions, gares hors section retirées,
  // colonne du prochain départ de la gare choisie.
  const ctx = {
    grille,
    jour,
    gare,
    machines: e.params?.machines ?? [],
    affluence: e.affluence,
  };
  const positions = new Map(
    positionsTrains(grille, jour, e.maintenant_s).map((p) => [p.numero, p.gare]),
  );
  const { debut, fin } = sectionDuJour(jour);
  const tableau = (sens: Sens): string => {
    const [de, a] = sens === 'montee' ? [debut, fin] : [fin, debut];
    const titre =
      sens === 'montee'
        ? bilingue(`Montée — ${nomGare(de)} → ${nomGare(a)}`, 'Ascent')
        : bilingue(`Descente — ${nomGare(de)} → ${nomGare(a)}`, 'Descent');
    return `<section class="sens-jour"><h2>${titre}</h2><div class="defile" tabindex="0"><table class="grille">${tableHtml(ctx, sens, e.maintenant_s, positions)}</table></div></section>`;
  };
  const rames = (e.params?.machines ?? [])
    .filter((m) => m.en_service)
    .map(
      (m) =>
        `<span class="item"><span class="pastille" style="${styleRame(m)}"></span>${echapper(m.nom)}</span>`,
    )
    .join('');
  const legende = `<p class="legende">${rames}<span class="item">| ${bilingue('express sans arrêt', 'non-stop')}</span><span class="item retard">${bilingue('retard', 'delay')}</span><span class="item supp">${bilingue('supprimé', 'cancelled')}</span><span class="item"><span class="train-pos"></span>${bilingue('en ligne', 'running')}</span></p>`;
  return `<div class="jour-complet">${tableau('montee')}${tableau('descente')}${legende}</div>`;
}

/** Le contenu ENTIER de la page, dans l'état décidé. */
export function rendEmbed(e: EntreeRendu): string {
  const entete = enteteHtml(e);
  const messages = messagesHtml(e);
  const badge = e.badge ? `<p class="fraicheur">${echapper(e.badge)}</p>` : '';

  if (e.etat === 'injoignable') {
    return `${entete}${repliHtml(MESSAGES_REPLI.injoignable.fr, MESSAGES_REPLI.injoignable.en, e.urlInfos)}`;
  }
  if (e.etat === 'sans-grille' || !e.grille || !e.jour) {
    // Les messages restent : c'est là que l'exploitation peut annoncer ses
    // dates, comme sur la grille du jour hors saison.
    return `${entete}${messages}${repliHtml(MESSAGES_REPLI.sansGrille.fr, MESSAGES_REPLI.sansGrille.en, e.urlInfos)}`;
  }

  const grille = e.grille;
  const jour = e.jour;
  const nomGare = (id: GareId): string => grille.gares.find((g) => g.id === id)?.nom ?? id;
  const onglets = ongletsGares(grille, jour, e.maintenant_s);
  const retenu = ongletRetenu(onglets, e.ongletDemande);
  const bascule =
    e.vue === 'jour'
      ? `<button type="button" class="bascule" data-vue="departs">${bilingue('Prochains départs', 'Next departures')}</button>`
      : `<button type="button" class="bascule" data-vue="jour">${bilingue('Toute la journée', 'Full day')}</button>`;

  const corps =
    e.vue === 'jour'
      ? grilleJourHtml(e, grille, jour, retenu, nomGare)
      : `${ongletsHtml(onglets, retenu)}${retenu ? departsHtml(e, grille, jour, retenu, nomGare) : ''}`;

  return `${entete}${badge}${messages}${bandeauSectionHtml(jour, nomGare)}<div class="barre">${bascule}</div>${corps}`;
}
