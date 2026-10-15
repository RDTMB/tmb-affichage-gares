// Horaires pour le SITE WEB du Tramway du Mont-Blanc (embed.html, en iframe).
//
// Ce que cette page N'EST PAS, et qui la distingue de `grille.html` :
//   - aucun canal temps réel. Un canal par VISITEUR, ouvert sur le même projet
//     Supabase que les six écrans de gare, pourrait épuiser le quota de
//     connexions simultanées (200 en Free, 500 en Pro) ; un écran de gare ne
//     pourrait alors plus se reconnecter après une micro-coupure. La page
//     relit les données toutes les 60 s, et seulement quand on la regarde ;
//   - aucun service worker : il n'a rien à faire dans le navigateur d'un
//     visiteur ;
//   - aucun signal de vie, ni lecture de `?ecran=` : ce n'est pas un poste ;
//   - rien du kiosque (anti-burn-in, curseur masqué, veille de nuit).
// Verrouillé par `embed.test.ts`.
//
// Le rendu entier vit dans `embed-logique.ts`, PUR et testé ; ici, seulement
// le chargement, les minuteurs, les clics et la hauteur de l'iframe.
//
// Paramètres d'URL : gare (onglet présélectionné ET cible des messages),
// vue=jour (grille complète), et pour les essais simule=HH:MM, jour=, demo=1.
import '@fontsource/amaranth/700.css';
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import '@fontsource/lato/900.css';
import '../styles/tokens.css';
import '../styles/embed.css';

import { dateSuivante, grillePourJour, serviceActif, vueJournee } from '../core/horaires';
import { etatHorloge } from '../core/horloge';
import { paramsValides } from '../core/params';
import type { Affluence, GareId, Grille, Jour, Message, Params } from '../core/types';
import { creeProviderReel } from '../data';
import { configSupabasePresente, estModeDemo, modeDonnees } from '../data/config';
import type { DataProvider } from '../data/provider';
import {
  avecDelai,
  badgeFraicheur,
  bandeauSimulation,
  DELAI_PREMIERE_SYNCHRO_MS,
  dureeCacheMinutes,
} from './affichage-commun';
import {
  etatEmbed,
  gareDemandee,
  INTERVALLE_RELECTURE_MS,
  INTERVALLE_RENDU_MS,
  rendEmbed,
  TYPE_MESSAGE_HAUTEUR,
  urlInfosValide,
  vueDemandee,
  type VueEmbed,
} from './embed-logique';
import { URL_INFOS_SITE } from './embed-reglages';
import { creeSourceHeure } from './horloge-source';
import { poseMarquePreversion } from './preversion';
import { creeSynchronisation, SEUIL_BADGE_MS, type Synchronisation } from './resilience';

// Préversion : cadre rouge, comme toutes les pages de `/preview/`.
poseMarquePreversion();

const racine = document.getElementById('embed');
if (!racine) throw new Error('Élément #embed introuvable');
const conteneur: HTMLElement = racine;

const url = new URLSearchParams(window.location.search);
const gareUrl = gareDemandee(url.get('gare'));
const heure = creeSourceHeure(url.get('simule'), url.get('jour'));
const simulation = bandeauSimulation({ heureSimulee: heure.simulee, jourSimule: heure.jourSimule });
const urlInfos = urlInfosValide(import.meta.env.VITE_EMBED_URL_INFOS || URL_INFOS_SITE);

interface DonneesEmbed {
  grilles: Grille[];
  jour: Jour;
  params: Params;
  messages: Message[];
  affluence: Affluence[];
}

let grilles: Grille[] = [];
let grille: Grille | null = null;
let grilleDemain: Grille | null = null;
let jour: Jour | null = null;
let params: Params | null = null;
let messages: Message[] = [];
let affluence: Affluence[] = [];
let sync: Synchronisation | null = null;
let fournisseur: DataProvider | null = null;
/** Mode « aucune source » : la page ne montre jamais d'horaire inventé. */
let sansSource = false;

let ongletDemande: GareId | null = gareUrl;
let vue: VueEmbed = vueDemandee(url.get('vue'));

// ---------------------------------------------------------------------------
// Hauteur automatique : la page parente ajuste l'iframe
// ---------------------------------------------------------------------------

let derniereHauteur = -1;

/**
 * Envoie la hauteur du contenu à la page parente, quand elle a changé. Le
 * message ne porte QUE ce nombre : la page parente est inconnue (cible `*`),
 * rien d'autre ne doit en sortir.
 */
function signaleHauteur(): void {
  if (window.parent === window) return;
  const hauteur = Math.ceil(conteneur.getBoundingClientRect().height);
  if (hauteur === derniereHauteur) return;
  derniereHauteur = hauteur;
  window.parent.postMessage({ type: TYPE_MESSAGE_HAUTEUR, hauteur }, '*');
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

function dureeCacheMs(): number {
  return dureeCacheMinutes(url.get('cache'), params?.duree_cache_min) * 60_000;
}

function rendre(): void {
  if (jour && jour.date !== heure.dateISO()) sync?.resynchronise(); // passage de minuit

  // Mêmes conditions que les écrans pour des données INUTILISABLES : trop
  // vieilles, ou horloge du visiteur trop fausse pour qu'un compte à rebours
  // dise vrai (l'écart se mesure sur l'en-tête `Date` des réponses).
  const age = sansSource ? null : (sync?.ageMs() ?? null);
  const horloge = etatHorloge(fournisseur?.ecartHorlogeMs() ?? null);
  const utilisables = age !== null && age <= dureeCacheMs() && horloge !== 'ecart-bloquant';
  const etat = etatEmbed(utilisables, utilisables ? vueJournee(grilles, jour, grille) : null);

  const badge = badgeFraicheur({
    ageMs: age,
    seuilBadgeMs: SEUIL_BADGE_MS,
    dureeCacheMs: dureeCacheMs(),
    heureSync: sync?.heureSync() ?? null,
    jour,
    veille: etat !== 'horaires',
  });

  // Le focus clavier survit au re-rendu : un onglet choisi au clavier ne doit
  // pas perdre la main toutes les dix secondes.
  const focus = document.activeElement as HTMLElement | null;
  const cleFocus = focus?.dataset.gare ?? focus?.dataset.vue ?? null;

  conteneur.innerHTML = rendEmbed({
    etat,
    grille,
    grilleDemain,
    jour,
    params,
    messages,
    affluence,
    gareUrl,
    ongletDemande,
    vue,
    maintenant_s: heure.maintenantS(),
    maintenantMs: heure.maintenantMs(),
    dateLongue: heure.dateLongue(),
    heureSync: sync?.heureSync() ?? null,
    badge: badge.visible ? badge.texte : '',
    simulation,
    urlInfos,
  });

  if (cleFocus) {
    const cible = conteneur.querySelector<HTMLElement>(
      `[data-gare="${CSS.escape(cleFocus)}"], [data-vue="${CSS.escape(cleFocus)}"]`,
    );
    cible?.focus();
  }
  signaleHauteur();
}

conteneur.addEventListener('click', (ev) => {
  const cible = (ev.target as HTMLElement).closest<HTMLElement>('[data-gare], [data-vue]');
  if (!cible) return;
  if (cible.dataset.gare) ongletDemande = gareDemandee(cible.dataset.gare);
  if (cible.dataset.vue) vue = vueDemandee(cible.dataset.vue);
  rendre();
});

// ---------------------------------------------------------------------------
// Données
// ---------------------------------------------------------------------------

/** Relecture, seulement si quelqu'un regarde la page. */
function relis(): void {
  if (document.visibilityState === 'visible') sync?.resynchronise();
}

async function fournisseurDemo(): Promise<DataProvider> {
  // Chargé À LA DEMANDE : le fournisseur de démonstration (et ses grilles de
  // référence) n'a rien à faire dans le bundle servi aux visiteurs.
  const { MockProvider } = await import('../data/mock');
  return new MockProvider();
}

async function demarre(): Promise<void> {
  rendre(); // « indisponible » tant que rien n'est chargé : jamais un tableau vide

  // C-02 — sans configuration et sans démonstration demandée, on n'invente
  // RIEN : la page reste sur son message de repli.
  const mode = modeDonnees(configSupabasePresente(), estModeDemo(url));
  if (mode === 'aucune') {
    sansSource = true;
    rendre();
    return;
  }
  const provider =
    mode === 'demo'
      ? await fournisseurDemo()
      : creeProviderReel(window.TMB_CONFIG!.supabaseUrl!, window.TMB_CONFIG!.supabaseKey!);
  fournisseur = provider;

  const charge = async (): Promise<DonneesEmbed> => {
    const dateJour = heure.dateISO();
    const [g, p, m, j] = await Promise.all([
      provider.getGrilles(),
      provider.getParams(),
      // Tous les messages actifs : le ciblage se fait au rendu.
      provider.getMessages(gareUrl ?? 'le-fayet'),
      provider.getJour(dateJour),
    ]);
    // Le remplissage est secondaire : son échec garde le dernier connu, il
    // n'emporte pas la page (même choix que la grille du jour).
    const aff = await provider.getAffluence(dateJour).catch(() => affluence);
    return { grilles: g, params: p, messages: m, jour: j, affluence: aff };
  };

  const applique = (d: DonneesEmbed): void => {
    grilles = d.grilles;
    jour = d.jour;
    params = d.params;
    messages = d.messages;
    affluence = d.affluence ?? [];
    grille = grillePourJour(d.grilles, d.jour);
    grilleDemain = serviceActif(d.grilles, dateSuivante(d.jour.date));
    rendre();
  };

  sync = creeSynchronisation<DonneesEmbed>({
    cleSnapshot: 'tmb-embed',
    charge,
    applique,
    valide: (d) => ({ ...d, params: paramsValides(d.params) }),
  });
  await avecDelai(sync.demarre(), DELAI_PREMIERE_SYNCHRO_MS, false);

  window.setInterval(relis, INTERVALLE_RELECTURE_MS);
  window.setInterval(() => {
    if (document.visibilityState === 'visible') rendre();
  }, INTERVALLE_RENDU_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      relis();
      rendre();
    }
  });
  window.addEventListener('online', relis);
  rendre();
}

// La hauteur suit aussi ce que le rendu ne déclenche pas (polices chargées,
// largeur de l'iframe qui change avec la fenêtre du visiteur).
if ('ResizeObserver' in window) new ResizeObserver(() => signaleHauteur()).observe(conteneur);
window.addEventListener('load', signaleHauteur);

void demarre().catch(() => {
  sansSource = true;
  rendre();
});
