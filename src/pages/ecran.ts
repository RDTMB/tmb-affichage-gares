// Écran de gare — étapes 2 (rendu maquette), 4 (résilience) et 7 (médias).
// Paramètres d'URL : gare (obligatoire), ecran (identifiant physique, défaut
// <gare>-1), simule=HH:MM, zoom, cache=N (minutes, tests du mode dégradé) et
// en mode mock terminus=N (bascule « à partir du TRAIN N »).
import '@fontsource/amaranth/400.css';
import '@fontsource/amaranth/700.css';
import '@fontsource/lato/300.css';
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import '@fontsource/lato/900.css';
import '../styles/tokens.css';
import '../styles/ecran.css';

import {
  compteARebours,
  dateSuivante,
  etatTronconFerme,
  finDeService,
  formatHeure,
  heureVersSecondes,
  passagesPourGare,
  prochaineArrivee,
  serviceActif,
} from '../core/horaires';
import { ORDRE_GARES } from '../core/types';
import type {
  FinDeService,
  GareId,
  Grille,
  Jour,
  Machine,
  Media,
  Message,
  Params,
  PassageGare,
} from '../core/types';
import { creeProvider } from '../data';
import { creeTicker, echapper, messagesVisibles, meteoHtml } from './affichage-commun';
import { creeSourceHeure } from './horloge-source';
import { identifiantEcran } from './supervision-logique';
import {
  creeSynchronisation,
  demarreAntiBurnIn,
  enregistreServiceWorker,
  SEUIL_BADGE_MS,
  type Synchronisation,
} from './resilience';

// Flèches obliques ↗ / ↙ de la maquette (inline, aucune ressource externe)
const FLECHE_UP =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M7 17 L17 7 M17 7 H9.5 M17 7 V14.5" stroke="#BDDCF4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FLECHE_DOWN =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M17 7 L7 17 M7 17 H14.5 M7 17 V9.5" stroke="#8FB2D4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const RAME_INCONNUE: Machine = { nom: '?', couleur: '#708DA4', en_service: true };

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Élément #${id} introuvable`);
  return el;
}

/** « 7:00 am » — format du texte anglais de la maquette. */
function formatHeureEN(secondes: number): string {
  const total = ((secondes % 86400) + 86400) % 86400;
  const h24 = Math.floor(total / 3600);
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${h24 < 12 ? 'am' : 'pm'}`;
}

// ---------------------------------------------------------------------------
// Paramètres d'URL et état de la page
// ---------------------------------------------------------------------------

const url = new URLSearchParams(window.location.search);
const gareParam = url.get('gare');
const heure = creeSourceHeure(url.get('simule'));

const zoom = url.get('zoom');
if (zoom && Number(zoom) > 0) document.body.style.setProperty('zoom', zoom);

// Identifiant physique de l'écran (heartbeat) : le type de page en fait
// partie, sinon l'écran des départs et l'écran grille d'une même gare
// s'écrasent dans « État des écrans ».
const idEcran = identifiantEcran('ecran', gareParam, url.get('ecran'));
document.body.dataset.ecran = idEcran;

($('logo') as HTMLImageElement).src = __LOGO_ROND__;
($('logo-neutre') as HTMLImageElement).src = __LOGO_ROND_BLANC__;

interface DonneesEcran {
  grilles: Grille[];
  jour: Jour;
  params: Params;
  messages: Message[];
  medias: Media[];
}

let grille: Grille | null = null;
let jour: Jour | null = null;
let grilleDemain: Grille | null = null;
let params: Params | null = null;
let messages: Message[] = [];
let medias: Media[] = [];
let dernierEtatSpecial = '';
let sync: Synchronisation | null = null;
const majTicker = creeTicker($('ticker'));

// Cycle médias (étape 7)
let mediaCourant: Media | null = null;
let mediaFinMs = 0;
/** Fixée à la première synchro, avec la vraie valeur de duree_horaires_s. */
let prochaineBasculeMs: number | null = null;
let indexMedia = 0;

function nomGare(id: GareId): string {
  return grille?.gares.find((g) => g.id === id)?.nom ?? id;
}

function machineDe(nomRame: string): Machine {
  return params?.machines.find((m) => m.nom === nomRame) ?? { ...RAME_INCONNUE, nom: nomRame };
}

function motifBilingue(fr: string): string {
  const en = params?.motifs.find((m) => m.fr === fr)?.en;
  return en ? `${fr} / ${en}` : fr;
}

/** Durée du cache avant écran neutre (paramètre, surchargée par ?cache=N pour les tests). */
function dureeCacheMs(): number {
  const surcharge = Number(url.get('cache'));
  const minutes = surcharge > 0 ? surcharge : (params?.duree_cache_min ?? 15);
  return minutes * 60_000;
}

// ---------------------------------------------------------------------------
// Rendu du tableau (port fidèle du gabarit de la maquette)
// ---------------------------------------------------------------------------

function chipHtml(depart_s: number, maintenant_s: number): string {
  const c = compteARebours(depart_s, maintenant_s);
  const cls =
    c.type === 'quai' || c.type === 'imminent'
      ? ' quai'
      : c.type === 'minutes' && c.minutes <= 5
        ? ' proche'
        : '';
  return `<span class="chip${cls}">${c.libelle}</span>`;
}

function ligneHtml(p: PassageGare, maintenant_s: number): string {
  const supprime = p.statut === 'supprime';
  const retard = p.statut === 'retard';
  const machine = machineDe(p.rame);

  const pastille = `<span class="pastille" style="background:${machine.couleur};${
    machine.cercle ? `box-shadow:0 0 0 .4vh ${machine.cercle};` : ''
  }"></span>`;

  let note = p.express
    ? '<span class="exp">EXPRESS — sans arrêt / non-stop : Col de Voza &amp; Bellevue</span>'
    : p.sens === 'montee'
      ? 'Montée / Ascent'
      : 'Descente / Descent';
  if (p.terminusExceptionnel && p.sens === 'montee') {
    note += ' · <b>Terminus exceptionnel / Exceptional terminus</b>';
  }
  if (p.velos) note += ' · Vélos acceptés / Bikes allowed';
  if (retard && p.motif) note += ` · <b>${echapper(motifBilingue(p.motif))}</b>`;
  if (supprime) {
    note = `<span class="motif-supprime">${echapper(motifBilingue(p.motif ?? 'Supprimé'))}</span>`;
  }

  const depart =
    retard && p.depart_s !== null
      ? `${formatHeure(p.depart_s)}<span class="retard-old">théorique ${formatHeure(p.depart_theorique_s)}</span>`
      : formatHeure(p.depart_theorique_s);

  const statut = supprime
    ? '<span class="st-supp">Supprimé<small>Cancelled</small></span>'
    : retard
      ? `<span class="st-retard">Retard +${p.retard_min} min<small>Delayed</small></span>`
      : '<span class="st-ok">À l&#39;heure<small>On time</small></span>';

  const motrice = p.express
    ? `<img class="motrice-dest" src="${__MOTRICE_BLANC__}" alt="Express" />`
    : '';

  return `<div class="gridrow rangee${supprime ? ' supprime' : ''}">
    <div class="r-arr">${p.arrivee_s !== null ? formatHeure(p.arrivee_s) : '<span class="tiret">—</span>'}</div>
    <div class="r-dep">${depart}</div>
    <div class="r-dest">
      <div class="fleche ${p.sens === 'montee' ? 'up' : 'down'}">${p.sens === 'montee' ? FLECHE_UP : FLECHE_DOWN}</div>
      <div class="txt"><div class="dest">${echapper(nomGare(p.destination))}${motrice}</div><div class="note${
        p.express ? ' note-exp' : ''
      }">${note}</div></div>
    </div>
    <div class="r-train">${pastille}<div class="txt"><span class="nom-rame">${echapper(p.rame)}</span><span class="num">TRAIN ${p.numero}</span></div></div>
    <div>${supprime || p.depart_s === null ? '' : chipHtml(p.depart_s, maintenant_s)}</div>
    <div class="r-statut">${statut}</div>
  </div>`;
}

function afficheEtatSpecial(html: string): void {
  $('corps').style.display = 'none';
  $('entetes').style.visibility = 'hidden';
  const special = $('etat-special');
  special.style.display = 'flex';
  if (dernierEtatSpecial !== html) {
    dernierEtatSpecial = html;
    special.innerHTML = html;
  }
}

function afficheTableau(lignes: string[]): void {
  dernierEtatSpecial = '';
  $('etat-special').style.display = 'none';
  $('corps').style.display = 'flex';
  $('entetes').style.visibility = 'visible';
  $('corps').innerHTML = lignes.join('');
}

function htmlTronconFerme(): string {
  return `<h2>Tronçon Bellevue – Nid d'Aigle fermé</h2>
    <p>En raison des conditions météorologiques, les trains ont pour terminus Bellevue.<br>
    <span class="en">Due to weather conditions, trams terminate at Bellevue.</span></p>
    <img class="logo-fin" src="${__LOGO_ROND_BLANC__}" alt="" />`;
}

function htmlFinDeService(fin: FinDeService): string {
  const contenu =
    fin.premierDepart_s !== null
      ? `Premier départ demain à <b style="color:#fff">${formatHeure(fin.premierDepart_s)}</b><br>
    <span class="en">Service ended — first departure tomorrow at ${formatHeureEN(fin.premierDepart_s)}</span>`
      : `Reprise selon le calendrier saisonnier<br>
    <span class="en">Service ended — see seasonal timetable</span>`;
  return `<h2>Service terminé</h2>
    <p>${contenu}</p>
    <img class="logo-fin" src="${__LOGO_ROND_BLANC__}" alt="" />`;
}

// ---------------------------------------------------------------------------
// Prochaine arrivée, messages, météo
// ---------------------------------------------------------------------------

function rendsArrivee(gare: GareId, maintenant_s: number): void {
  if (!grille || !jour) return;
  // Tolérance maquette : l'arrivée reste affichée 1 min après l'heure réelle.
  const prochaine = prochaineArrivee(grille, jour, gare, maintenant_s - 60);
  const lbl = '<span class="lbl">Prochaine arrivée / Next arrival</span>';
  if (!prochaine) {
    $('arrivee').innerHTML = `${lbl}<span>— demain / tomorrow</span>`;
    return;
  }
  const machine = machineDe(prochaine.rame);
  const halo = machine.cercle ? `text-shadow:0 0 4px ${machine.cercle};` : '';
  $('arrivee').innerHTML = `${lbl}
    <b>${formatHeure(prochaine.heure_s)}</b> — <span class="rame-col" style="color:${machine.couleur};${halo}">${echapper(prochaine.rame)}</span>
    <span>(TRAIN ${prochaine.numero}), en provenance de ${echapper(nomGare(prochaine.provenance))}</span>`;
}

function rendsMeteo(): void {
  if (!params || !grille) return;
  $('meteo').innerHTML = meteoHtml(params, grille);
}

// ---------------------------------------------------------------------------
// Cycle médias plein écran (docs/01 §2.5 — étape 7)
// ---------------------------------------------------------------------------

function mediasAffichables(): Media[] {
  const nowMs = heure.maintenantMs();
  return medias.filter(
    (m) => m.actif && (!m.expire_at || new Date(m.expire_at).getTime() >= nowMs),
  );
}

function quitteMedia(): void {
  if (!mediaCourant) return;
  mediaCourant = null;
  document.body.classList.remove('mode-media');
  $('media-plein').innerHTML = '';
  indexMedia += 1;
  prochaineBasculeMs = Date.now() + (params?.duree_horaires_s ?? 20) * 1000;
}

function entreMedia(liste: Media[]): void {
  const media = liste[indexMedia % liste.length];
  if (!media) return;
  mediaCourant = media;
  mediaFinMs = Date.now() + media.duree_s * 1000;
  const conteneur = $('media-plein');
  conteneur.innerHTML =
    media.type === 'video'
      ? `<video src="${echapper(media.url)}" muted playsinline autoplay></video>`
      : `<img src="${echapper(media.url)}" alt="" />`;
  document.body.classList.add('mode-media');
  conteneur.querySelector('video')?.addEventListener('ended', () => quitteMedia());
  // Préchargement du média suivant (les vidéos sont mises en cache par le SW)
  const suivant = liste[(indexMedia + 1) % liste.length];
  if (suivant && suivant.type === 'image') new Image().src = suivant.url;
}

/** JAMAIS de média pendant un « À QUAI » ni dans les 2 min avant un départ. */
function gereMedias(departs: PassageGare[], maintenant_s: number): void {
  const departProche = departs.some(
    (p) => p.statut !== 'supprime' && p.depart_s !== null && p.depart_s - maintenant_s <= 120,
  );
  if (mediaCourant) {
    if (departProche || Date.now() >= mediaFinMs || !mediaCourant.actif) quitteMedia();
    return;
  }
  prochaineBasculeMs ??= Date.now() + (params?.duree_horaires_s ?? 20) * 1000;
  const liste = mediasAffichables();
  if (liste.length > 0 && !departProche && Date.now() >= prochaineBasculeMs) {
    entreMedia(liste);
  }
}

// ---------------------------------------------------------------------------
// États d'erreur et veille nuit
// ---------------------------------------------------------------------------

function afficheErreur(titre: string, detail: string): void {
  document.body.classList.add('mode-erreur');
  $('erreur-config').innerHTML = `<h2>${echapper(titre)}</h2><p>${detail}</p>`;
}

function majHorloge(maintenant_s: number): void {
  $('horloge').innerHTML =
    `${formatHeure(maintenant_s)}<span class="sec">${String(maintenant_s % 60).padStart(2, '0')}</span>`;
  $('date-jour').textContent = heure.dateLongue();
}

function enVeille(maintenant_s: number): boolean {
  if (!params) return false;
  const debut = heureVersSecondes(params.veille_nuit.debut);
  const fin = heureVersSecondes(params.veille_nuit.fin);
  return debut <= fin
    ? maintenant_s >= debut && maintenant_s < fin
    : maintenant_s >= debut || maintenant_s < fin;
}

// ---------------------------------------------------------------------------
// Boucle principale — re-rendu 1×/s maximum (contrainte CLAUDE.md)
// ---------------------------------------------------------------------------

function rendre(gare: GareId): void {
  const maintenant = heure.maintenantS();
  majHorloge(maintenant);

  // Badge d'âge des données calculé AVANT toute sortie : sinon il resterait
  // peint par-dessus l'écran neutre ou la veille nuit (z-index supérieur).
  const age = sync?.ageMs() ?? null;
  const degrade = age !== null && age > SEUIL_BADGE_MS && age <= dureeCacheMs();
  document.body.classList.toggle('mode-degrade', degrade);
  if (degrade) {
    const quand = sync?.heureSync() ?? '--:--';
    $('badge-cache').textContent = `Données de ${quand} / Data from ${quand}`;
  }

  // 1. Veille nuit (écran noir + horloge discrète)
  const veille = enVeille(maintenant);
  document.body.classList.toggle('mode-veille', veille);
  if (veille) {
    $('horloge-veille').textContent = formatHeure(maintenant);
    quitteMedia();
    return;
  }

  // 2. Écran neutre au-delà de duree_cache_min — JAMAIS d'horaires périmés.
  const neutre = age === null || age > dureeCacheMs();
  document.body.classList.toggle('mode-neutre', neutre);
  if (neutre) {
    $('horloge-neutre').textContent = formatHeure(maintenant);
    quitteMedia();
    return;
  }

  if (!grille || !jour) return;

  if (jour.hors_saison) {
    // Hors saison : aucun service ne circule — jamais de repli sur une autre grille
    quitteMedia();
    afficheEtatSpecial(`<h2>Aucun service aujourd'hui</h2>
    <p>Reprise selon le calendrier saisonnier<br>
    <span class="en">No service today — see seasonal timetable</span></p>
    <img class="logo-fin" src="${__LOGO_ROND_BLANC__}" alt="" />`);
    $('arrivee').innerHTML =
      '<span class="lbl">Prochaine arrivée / Next arrival</span><span>— voir calendrier / see timetable</span>';
    majTicker(
      messagesVisibles(messages, gare, [], heure.maintenantMs()),
      params?.vitesse_ticker_px_s,
    );
    return;
  }

  const passages = passagesPourGare(grille, jour, gare, maintenant);
  const departs = passages.filter((p) => p.depart_s !== null).slice(0, 5);

  const tronconFerme = etatTronconFerme(grille, jour, gare, maintenant);
  const fin = tronconFerme ? null : finDeService(grille, jour, gare, maintenant, grilleDemain);
  if (tronconFerme) afficheEtatSpecial(htmlTronconFerme());
  else if (fin) afficheEtatSpecial(htmlFinDeService(fin));
  else afficheTableau(departs.map((p) => ligneHtml(p, maintenant)));

  // Les médias ne recouvrent JAMAIS un état spécial (tronçon fermé, fin de
  // service) : l'information voyageur prime.
  if (tronconFerme || fin) quitteMedia();
  else gereMedias(departs, maintenant);

  rendsArrivee(gare, maintenant);
  majTicker(
    messagesVisibles(messages, gare, passages, heure.maintenantMs()),
    params?.vitesse_ticker_px_s,
  );
}

async function demarre(): Promise<void> {
  if (!gareParam || !(ORDRE_GARES as readonly string[]).includes(gareParam)) {
    const liste = ORDRE_GARES.map((g) => `<code>${g}</code>`).join(' · ');
    afficheErreur(
      'Écran non configuré / Screen not configured',
      `Le paramètre <code>?gare=</code> est manquant ou inconnu. / The <code>?gare=</code> parameter is missing or unknown.<br><br>Gares valides / valid stations : ${liste}<br><br>Exemple / example : <code>ecran.html?gare=saint-gervais</code>`,
    );
    window.setInterval(() => majHorloge(heure.maintenantS()), 1000);
    return;
  }
  const gare = gareParam as GareId;

  enregistreServiceWorker();
  demarreAntiBurnIn();

  const terminusParam = url.get('terminus');
  const provider = creeProvider(
    terminusParam !== null && Number(terminusParam) > 0
      ? { terminusAPartirDuTrain: Number(terminusParam) }
      : {},
  );

  const charge = async (): Promise<DonneesEcran> => {
    const dateJour = heure.dateISO();
    const [grilles, p, m, j, med] = await Promise.all([
      provider.getGrilles(),
      provider.getParams(),
      provider.getMessages(gare),
      provider.getJour(dateJour),
      provider.getMedias(gare),
    ]);
    return { grilles, params: p, messages: m, jour: j, medias: med };
  };

  const applique = (d: DonneesEcran): void => {
    jour = d.jour;
    params = d.params;
    messages = d.messages;
    medias = d.medias;
    grille = d.grilles.find((g) => g.version === d.jour.grille_version) ?? d.grilles[0] ?? null;
    grilleDemain = serviceActif(d.grilles, dateSuivante(d.jour.date));
    if (!grille) return;
    document.title = `TMB — ${nomGare(gare)}`;
    $('gare-nom').textContent = nomGare(gare);
    const altitude = grille.gares.find((g) => g.id === gare)?.altitude_m;
    $('gare-alt').textContent =
      altitude !== undefined ? `Altitude ${altitude.toLocaleString('fr-FR')} m` : '';
    rendsMeteo();
  };

  sync = creeSynchronisation<DonneesEcran>({ cleSnapshot: `tmb-ecran-${gare}`, charge, applique });
  await sync.demarre(); // sans réseau ni cache : la boucle affiche l'écran neutre

  // Resynchronisation : temps réel (onChange), périodique 30 s, retour réseau,
  // et changement de date (minuit) détecté dans la boucle.
  provider.onChange(() => sync?.resynchronise());
  window.setInterval(() => sync?.resynchronise(), 30_000);
  window.addEventListener('online', () => sync?.resynchronise());

  // Heartbeat 30 s (id écran, gare, version) — la commande « recharger »
  // est honorée par le provider. JAMAIS en mode aperçu (?apercu=1) : un
  // onglet de supervision battrait sous l'identifiant du Raspberry Pi,
  // fausserait sa dernière vue et consommerait son ordre de rechargement.
  if (url.get('apercu') !== '1') {
    const bat = (): void => {
      void provider
        .heartbeat({ id: idEcran, gare, type: 'ecran', version_app: import.meta.env.MODE })
        .catch(() => {});
    };
    bat();
    window.setInterval(bat, 30_000);
  }

  rendre(gare);
  window.setInterval(() => {
    if (jour && jour.date !== heure.dateISO()) sync?.resynchronise(); // passage de minuit
    rendre(gare);
  }, 1000);
}

void demarre();
