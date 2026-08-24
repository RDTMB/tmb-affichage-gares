// Écran de gare (étape 2) — reproduit fidèlement maquettes/ecran-gare.html.
// Paramètres d'URL : gare (obligatoire), ecran (identifiant physique, défaut
// <gare>-1), simule=HH:MM (heure simulée), zoom (facteur), et en mode mock
// terminus=N (bascule Terminus Bellevue « à partir du TRAIN N »).
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
  Message,
  Params,
  PassageGare,
} from '../core/types';
import { creeProvider } from '../data';
import { creeSourceHeure } from './horloge-source';

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

function echapper(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

// Identifiant physique de l'écran (heartbeat à l'étape 5)
document.body.dataset.ecran = url.get('ecran') ?? `${gareParam ?? 'ecran'}-1`;

($('logo') as HTMLImageElement).src = __LOGO_ROND__;

let grille: Grille | null = null;
let jour: Jour | null = null;
let grilleDemain: Grille | null = null;
let params: Params | null = null;
let messages: Message[] = [];
let dernierEtatSpecial = '';
let derniereSignatureTicker: string | null = null;

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

/** Messages visibles dans cette gare (cible toutes / gares / train encore desservi). */
function messagesVisibles(gare: GareId, passagesRestants: PassageGare[]): Message[] {
  // Expiration comparée à l'heure simulable, comme tout le reste de l'écran
  const nowMs = heure.maintenantMs();
  return messages.filter((m) => {
    if (!m.actif) return false;
    if (m.expire_at && new Date(m.expire_at).getTime() < nowMs) return false;
    if (m.cible_type === 'gares') return (m.gares ?? []).includes(gare);
    if (m.cible_type === 'train') {
      return passagesRestants.some((p) => p.numero === m.train_numero);
    }
    return true;
  });
}

function rendsTicker(gare: GareId, passagesRestants: PassageGare[]): void {
  const visibles = messagesVisibles(gare, passagesRestants);
  const importantes = visibles.filter((m) => m.priorite === 'importante');
  const affiches = importantes.length > 0 ? importantes : visibles;
  const signature = `${importantes.length > 0 ? 'fixe' : 'defile'}:${affiches.map((m) => m.id).join('|')}`;
  if (signature === derniereSignatureTicker) return;
  derniereSignatureTicker = signature;
  const ticker = $('ticker');
  ticker.classList.toggle('fixe', importantes.length > 0);
  ticker.innerHTML = affiches
    .map(
      (m) =>
        `${echapper(m.texte_fr)}<span class="sep">•</span><span class="en">${echapper(m.texte_en)}</span>`,
    )
    .join('<span class="sep">◆</span>');
}

function rendsMeteo(): void {
  if (!params || !grille) return;
  const meteo = params.meteo_sommet;
  const sommet = grille.gares.find((g) => g.id === 'nid-daigle');
  const altitude = sommet ? `${sommet.nom} · ${sommet.altitude_m.toLocaleString('fr-FR')} m` : '';
  $('meteo').innerHTML = `<div class="t">${meteo.t}°C</div>
    <div>${echapper(altitude)}<small>${echapper(`${meteo.ciel_fr} / ${meteo.ciel_en}`)}</small></div>`;
}

// ---------------------------------------------------------------------------
// États d'erreur et veille nuit
// ---------------------------------------------------------------------------

function afficheErreur(titre: string, detail: string): void {
  document.body.classList.add('mode-erreur');
  $('erreur-config').innerHTML = `<h2>${echapper(titre)}</h2><p>${detail}</p>`;
}

/** Horloge seule (états d'erreur) : l'écran garde toujours une heure vivante. */
function demarreHorlogeSeule(): void {
  const maj = (): void => {
    const maintenant = heure.maintenantS();
    $('horloge').innerHTML =
      `${formatHeure(maintenant)}<span class="sec">${String(maintenant % 60).padStart(2, '0')}</span>`;
    $('date-jour').textContent = heure.dateLongue();
  };
  maj();
  window.setInterval(maj, 1000);
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

  $('horloge').innerHTML =
    `${formatHeure(maintenant)}<span class="sec">${String(maintenant % 60).padStart(2, '0')}</span>`;
  $('date-jour').textContent = heure.dateLongue();

  const veille = enVeille(maintenant);
  document.body.classList.toggle('mode-veille', veille);
  if (veille) {
    $('horloge-veille').textContent = formatHeure(maintenant);
    return; // écran noir : rien d'autre à mettre à jour
  }

  if (!grille || !jour) return;

  const passages = passagesPourGare(grille, jour, gare, maintenant);
  const departs = passages.filter((p) => p.depart_s !== null).slice(0, 5);

  if (etatTronconFerme(grille, jour, gare, maintenant)) {
    afficheEtatSpecial(htmlTronconFerme());
  } else {
    const fin = finDeService(grille, jour, gare, maintenant, grilleDemain);
    if (fin) afficheEtatSpecial(htmlFinDeService(fin));
    else afficheTableau(departs.map((p) => ligneHtml(p, maintenant)));
  }

  rendsArrivee(gare, maintenant);
  rendsTicker(gare, passages);
}

async function demarre(): Promise<void> {
  if (!gareParam || !(ORDRE_GARES as readonly string[]).includes(gareParam)) {
    const liste = ORDRE_GARES.map((g) => `<code>${g}</code>`).join(' · ');
    afficheErreur(
      'Écran non configuré / Screen not configured',
      `Le paramètre <code>?gare=</code> est manquant ou inconnu. / The <code>?gare=</code> parameter is missing or unknown.<br><br>Gares valides / valid stations : ${liste}<br><br>Exemple / example : <code>ecran.html?gare=saint-gervais</code>`,
    );
    demarreHorlogeSeule();
    return;
  }
  const gare = gareParam as GareId;

  let provider: ReturnType<typeof creeProvider>;
  let rechargementEnCours = false;

  async function chargeDonnees(): Promise<void> {
    const dateJour = heure.dateISO();
    const [grilles, chargeParams, chargeMessages, chargeJour] = await Promise.all([
      provider.getGrilles(),
      provider.getParams(),
      provider.getMessages(gare),
      provider.getJour(dateJour),
    ]);
    jour = chargeJour;
    params = chargeParams;
    messages = chargeMessages;
    grille = grilles.find((g) => g.version === chargeJour.grille_version) ?? grilles[0] ?? null;
    grilleDemain = serviceActif(grilles, dateSuivante(dateJour));
    derniereSignatureTicker = null; // le bandeau sera reconstruit
  }

  /** Au changement de date (minuit), recharge le jour d'exploitation courant. */
  function verifieChangementDeDate(): void {
    if (!jour || rechargementEnCours || jour.date === heure.dateISO()) return;
    rechargementEnCours = true;
    void chargeDonnees()
      .catch(() => {}) // l'affichage garde le dernier état connu (mode dégradé à l'étape 4)
      .finally(() => {
        rechargementEnCours = false;
      });
  }

  try {
    const terminusParam = url.get('terminus');
    provider = creeProvider(
      terminusParam !== null && Number(terminusParam) > 0
        ? { terminusAPartirDuTrain: Number(terminusParam) }
        : {},
    );
    await chargeDonnees();
  } catch (erreur) {
    afficheErreur(
      'Informations momentanément indisponibles',
      `Real-time information temporarily unavailable — adressez-vous au personnel.<br><code>${echapper(String(erreur))}</code>`,
    );
    demarreHorlogeSeule();
    return;
  }

  if (!grille) {
    afficheErreur('Aucune grille horaire', 'No timetable available.');
    demarreHorlogeSeule();
    return;
  }

  document.title = `TMB — ${nomGare(gare)}`;
  $('gare-nom').textContent = nomGare(gare);
  const altitude = grille.gares.find((g) => g.id === gare)?.altitude_m;
  $('gare-alt').textContent =
    altitude !== undefined ? `Altitude ${altitude.toLocaleString('fr-FR')} m` : '';

  rendsMeteo();
  provider.onChange(() => {
    void chargeDonnees().then(() => rendsMeteo());
  });

  rendre(gare);
  window.setInterval(() => {
    verifieChangementDeDate();
    rendre(gare);
  }, 1000);
}

void demarre();
