// Grille du jour — étapes 3 (rendu maquette) et 4 (résilience).
// Deux tableaux (montée, descente) : colonnes = trains effectivement en
// circulation, lignes = gares avec altitudes officielles. Paramètres d'URL :
// gare (cible des messages), ecran, simule=HH:MM, zoom, cache=N (tests) et
// demo=1 (démonstration EXPLICITE : horaires fictifs, bandeau permanent) et,
// en mode démo, terminus=N (bascule « à partir du TRAIN N »).
import '@fontsource/amaranth/400.css';
import '@fontsource/amaranth/700.css';
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import '@fontsource/lato/900.css';
import '../styles/tokens.css';
import '../styles/grille.css';

import {
  formatHeure,
  libelleTrain,
  passagesPourGare,
  positionsTrains,
  trainsDuJour,
} from '../core/horaires';
import { paramsValides } from '../core/params';
import { ORDRE_GARES } from '../core/types';
import type {
  GareId,
  Grille,
  Jour,
  Machine,
  Message,
  Params,
  Sens,
  TrainJour,
} from '../core/types';
import { creeProviderDemo, creeProviderReel } from '../data';
import { configSupabasePresente, estModeDemo, modeDonnees } from '../data/config';
import {
  creeJournalHeartbeat,
  creeTicker,
  echapper,
  INTERVALLE_HEARTBEAT_MS,
  messagesVisibles,
  meteoHtml,
} from './affichage-commun';
import { creeSourceHeure } from './horloge-source';
import { identifiantEcran } from './supervision-logique';
import {
  creeSynchronisation,
  demarreAntiBurnIn,
  enregistreServiceWorker,
  SEUIL_BADGE_MS,
  type Synchronisation,
} from './resilience';

const RAME_INCONNUE: Machine = { nom: '?', couleur: '#708DA4', en_service: true };

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Élément #${id} introuvable`);
  return el;
}

// ---------------------------------------------------------------------------
// Paramètres d'URL et état de la page
// ---------------------------------------------------------------------------

const url = new URLSearchParams(window.location.search);
const gareParam = url.get('gare');
/** Gare d'installation de l'écran (cible des messages) — la grille reste celle de toute la ligne. */
const gare: GareId | null =
  gareParam && (ORDRE_GARES as readonly string[]).includes(gareParam)
    ? (gareParam as GareId)
    : null;
const heure = creeSourceHeure(url.get('simule'));

const zoom = url.get('zoom');
if (zoom && Number(zoom) > 0) document.body.style.setProperty('zoom', zoom);
// Identifiant physique : « <gare>-<type>-1 » (docs/01 §1) — l'écran grille
// et l'écran des départs d'une même gare sont ainsi distincts ; plusieurs
// écrans du même type se distinguent via ?ecran=.
const idEcran = identifiantEcran('grille', gareParam, url.get('ecran'));
document.body.dataset.ecran = idEcran;

($('logo') as HTMLImageElement).src = __LOGO_ROND__;
($('logo-neutre') as HTMLImageElement).src = __LOGO_ROND_BLANC__;

interface DonneesGrille {
  grilles: Grille[];
  jour: Jour;
  params: Params;
  messages: Message[];
}

let grille: Grille | null = null;
let jour: Jour | null = null;
let params: Params | null = null;
let messages: Message[] = [];
let sync: Synchronisation | null = null;
const majTicker = creeTicker($('ticker'));

function machineDe(nomRame: string): Machine {
  return params?.machines.find((m) => m.nom === nomRame) ?? { ...RAME_INCONNUE, nom: nomRame };
}

function dureeCacheMs(): number {
  const surcharge = Number(url.get('cache'));
  const minutes = surcharge > 0 ? surcharge : (params?.duree_cache_min ?? 15);
  return minutes * 60_000;
}

// ---------------------------------------------------------------------------
// Tableaux montée / descente (port fidèle du gabarit de la maquette)
// ---------------------------------------------------------------------------

interface ColonneTrain {
  train: TrainJour;
  decalage: number;
  departTheorique_s: number;
  departReel_s: number;
  supprime: boolean;
  retard: boolean;
  passe: boolean;
}

function colonnesDuSens(sens: Sens, maintenant_s: number): ColonneTrain[] {
  if (!grille || !jour) return [];
  return trainsDuJour(grille, jour)
    .filter((t) => t.sens === sens)
    .map((train) => {
      const decalage = train.statut === 'retard' ? train.retard_min * 60 : 0;
      const premier = train.passages[0];
      const dernier = train.passages[train.passages.length - 1];
      const departTheorique = premier?.depart_s ?? premier?.arrivee_s ?? 0;
      const finReelle = (dernier?.arrivee_s ?? dernier?.depart_s ?? 0) + decalage;
      return {
        train,
        decalage,
        departTheorique_s: departTheorique,
        departReel_s: departTheorique + decalage,
        supprime: train.statut === 'supprime',
        retard: train.statut === 'retard',
        passe: finReelle < maintenant_s, // colonne atténuée : train arrivé à son terminus
      };
    });
}

function classesColonne(colonne: ColonneTrain, estProchain: boolean): string {
  return [
    colonne.supprime ? 'supp' : '',
    colonne.retard ? 'retard' : '',
    colonne.passe ? 'passe' : '',
    estProchain ? 'next' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function tableHtml(sens: Sens, maintenant_s: number, positions: Map<number, GareId>): string {
  if (!grille) return '';
  const colonnes = colonnesDuSens(sens, maintenant_s);
  const gares = sens === 'montee' ? grille.gares : [...grille.gares].reverse();
  // Prochain départ (surligné) : plus petit départ RÉEL d'origine encore à
  // venir — un gros retard peut inverser l'ordre théorique des colonnes.
  let prochainIdx = -1;
  colonnes.forEach((c, i) => {
    if (c.supprime || c.passe || c.departReel_s <= maintenant_s) return;
    const meilleur = prochainIdx >= 0 ? colonnes[prochainIdx] : undefined;
    if (!meilleur || c.departReel_s < meilleur.departReel_s) prochainIdx = i;
  });

  let html = '<thead><tr><th class="col-gare">GARE / STATION</th>';
  colonnes.forEach((c, i) => {
    html += `<th class="${classesColonne(c, i === prochainIdx)}"><span class="num">${echapper(
      libelleTrain(
        c.train,
        colonnes.map((x) => x.train),
      ),
    )}</span>${formatHeure(c.departTheorique_s)}`;
    const pictos: string[] = [];
    if (c.train.express) {
      pictos.push(`<img class="motrice" src="${__MOTRICE_BLANC__}" alt="Express"> EXPRESS`);
    }
    if (c.train.velos) pictos.push('<span class="velo">🚲 vélos</span>');
    if (c.retard) {
      pictos.push(
        `<span class="badge" style="color:var(--retard)">+${c.train.retard_min} min</span>`,
      );
    }
    if (c.supprime)
      pictos.push('<span class="badge" style="color:var(--supprime)">SUPPRIMÉ</span>');
    if (pictos.length > 0) html += `<span class="picto">${pictos.join(' ')}</span>`;
    html += '</th>';
  });
  html += '</tr></thead><tbody>';

  for (const g of gares) {
    html += `<tr><th>${echapper(g.nom)}<small>${g.altitude_m.toLocaleString('fr-FR')} m</small></th>`;
    colonnes.forEach((c, i) => {
      const cls = classesColonne(c, i === prochainIdx);
      const passage = c.train.passages.find((p) => p.gare === g.id);
      if (!passage) {
        // « | » : passage express sans arrêt — « — » : gare non desservie (terminus Bellevue)
        html += `<td class="saute${cls ? ` ${cls}` : ''}">${c.train.express ? '|' : '—'}</td>`;
        return;
      }
      const heureCellule = (passage.depart_s ?? passage.arrivee_s ?? 0) + c.decalage;
      const point =
        positions.get(c.train.numero) === g.id
          ? `<span class="train-pos" style="background:${machineDe(c.train.rame).couleur}"></span>`
          : '';
      html += `<td class="${cls}">${formatHeure(heureCellule)}${point}</td>`;
    });
    html += '</tr>';
  }
  return `${html}</tbody>`;
}

// ---------------------------------------------------------------------------
// Légende, en-têtes, erreur
// ---------------------------------------------------------------------------

function rendsLegende(): void {
  if (!params) return;
  const rames = params.machines
    .filter((m) => m.en_service)
    .map(
      (m) =>
        `<span class="item"><span class="rame-dot" style="background:${m.couleur};${
          m.cercle ? `box-shadow:0 0 0 2px ${m.cercle};` : ''
        }"></span><b>${echapper(m.nom)}</b></span>`,
    )
    .join('');
  $('legende').innerHTML =
    rames +
    `<span class="item"><img class="motrice" src="${__MOTRICE_BLANC__}" alt=""> <b>Express</b> : sans arrêt / non-stop Col de Voza &amp; Bellevue ( | )</span>` +
    '<span class="item" style="color:var(--bleu-clair)">🚲 vélos / bikes</span>' +
    '<span class="item" style="color:var(--retard)">■ retard / delay</span>' +
    '<span class="item" style="color:var(--supprime)">■ supprimé / cancelled</span>' +
    '<span class="item">● en ligne / running</span>';
}

/** En-têtes et blocs statiques, réappliqués après CHAQUE synchronisation. */
function rendsEntetesEtPied(): void {
  if (!grille || !params) return;
  // « Today's timetable · Grand service » — libellé du service depuis la grille
  const service = jour?.hors_saison ? 'Hors saison' : (grille.libelle.split('—')[0]?.trim() ?? '');
  $('sous-titre').textContent = service ? `Today's timetable · ${service}` : "Today's timetable";
  rendsLegende();
  $('meteo').innerHTML = meteoHtml(params, grille);
}

function afficheErreur(titre: string, detail: string): void {
  document.body.classList.add('mode-erreur');
  $('erreur-config').innerHTML = `<h2>${echapper(titre)}</h2><p>${detail}</p>`;
}

function majHorloge(maintenant_s: number): void {
  $('horloge').innerHTML =
    `${formatHeure(maintenant_s)}<span class="sec">${String(maintenant_s % 60).padStart(2, '0')}</span>`;
  $('date-jour').textContent = heure.dateLongue();
}

/** Délai de réessai quand aucune source de données n'est disponible. */
const REESSAI_SANS_SOURCE_MS = 5 * 60_000;

/**
 * Écran neutre PERMANENT : logo, horloge et message bilingue déjà présents
 * dans la page, exactement comme au-delà de `duree_cache_min`. Aucun horaire
 * n'est affiché puisque aucune source fiable n'est disponible (C-02).
 *
 * Le rechargement périodique évite qu'un échec TRANSITOIRE de `config.js`
 * (coupure au démarrage) ne fige l'écran en neutre jusqu'à une intervention
 * sur place : `config.js` étant servi réseau d'abord, l'écran se répare seul.
 */
function afficheNeutrePermanent(): void {
  document.body.classList.add('mode-neutre');
  const tic = (): void => {
    const maintenant = heure.maintenantS();
    majHorloge(maintenant);
    $('horloge-neutre').textContent = formatHeure(maintenant);
  };
  tic();
  window.setInterval(tic, 1000);
  window.setTimeout(() => window.location.reload(), REESSAI_SANS_SOURCE_MS);
}

// ---------------------------------------------------------------------------
// Boucle principale — re-rendu 1×/s maximum (contrainte CLAUDE.md)
// ---------------------------------------------------------------------------

function rendre(): void {
  const maintenant = heure.maintenantS();
  majHorloge(maintenant);

  // Badge calculé AVANT toute sortie (sinon il resterait peint par-dessus
  // l'écran neutre), puis écran neutre au-delà de duree_cache_min.
  const age = sync?.ageMs() ?? null;
  const degrade = age !== null && age > SEUIL_BADGE_MS && age <= dureeCacheMs();
  document.body.classList.toggle('mode-degrade', degrade);
  if (degrade) {
    const quand = sync?.heureSync() ?? '--:--';
    $('badge-cache').textContent = `Données de ${quand} / Data from ${quand}`;
  }
  const neutre = age === null || age > dureeCacheMs();
  document.body.classList.toggle('mode-neutre', neutre);
  if (neutre) {
    $('horloge-neutre').textContent = formatHeure(maintenant);
    return;
  }

  if (!grille || !jour) return;

  if (jour.hors_saison) {
    // Hors saison : aucun service ne circule — jamais de repli sur une autre grille
    const message =
      '<tbody><tr><td style="padding:2vh;border:none;color:var(--texte-sec);font-weight:700">Aucun service ne circule à cette date / No service on this date</td></tr></tbody>';
    $('tab-montee').innerHTML = message;
    $('tab-descente').innerHTML = message;
    majTicker(
      messagesVisibles(messages, gare, [], heure.maintenantMs()),
      params?.vitesse_ticker_px_s,
    );
    return;
  }

  const positions = new Map(
    positionsTrains(grille, jour, maintenant).map((p) => [p.numero, p.gare]),
  );
  $('tab-montee').innerHTML = tableHtml('montee', maintenant, positions);
  $('tab-descente').innerHTML = tableHtml('descente', maintenant, positions);

  const passagesGare = gare ? passagesPourGare(grille, jour, gare, maintenant) : [];
  majTicker(
    messagesVisibles(messages, gare, passagesGare, heure.maintenantMs()),
    params?.vitesse_ticker_px_s,
  );
}

async function demarre(): Promise<void> {
  if (gareParam && gare === null) {
    // Paramètre présent mais inconnu (faute de frappe à l'installation)
    const liste = ORDRE_GARES.map((g) => `<code>${g}</code>`).join(' · ');
    afficheErreur(
      'Écran non configuré / Screen not configured',
      `Le paramètre <code>?gare=</code> est inconnu. / The <code>?gare=</code> parameter is unknown.<br><br>Gares valides / valid stations : ${liste}<br><br>Exemple / example : <code>grille.html?gare=saint-gervais</code>`,
    );
    window.setInterval(() => majHorloge(heure.maintenantS()), 1000);
    return;
  }

  enregistreServiceWorker();
  demarreAntiBurnIn();

  // C-02 — Aucune donnée réelle et aucune démonstration explicitement demandée :
  // on n'invente RIEN. Sans ce garde-fou, la page retombait silencieusement sur
  // le fournisseur de démonstration et affichait en gare des horaires fictifs.
  const mode = modeDonnees(configSupabasePresente(), estModeDemo(url));
  if (mode === 'aucune') {
    afficheNeutrePermanent();
    return;
  }
  if (mode === 'demo') document.body.classList.add('mode-demo');

  const terminusParam = url.get('terminus');
  const optionsDemo =
    terminusParam !== null && Number(terminusParam) > 0
      ? { terminusAPartirDuTrain: Number(terminusParam) }
      : {};
  const provider =
    mode === 'demo'
      ? creeProviderDemo(optionsDemo)
      : creeProviderReel(window.TMB_CONFIG!.supabaseUrl!, window.TMB_CONFIG!.supabaseKey!);

  const charge = async (): Promise<DonneesGrille> => {
    const dateJour = heure.dateISO();
    const [grilles, p, m, j] = await Promise.all([
      provider.getGrilles(),
      provider.getParams(),
      provider.getMessages(gare ?? 'le-fayet'),
      provider.getJour(dateJour),
    ]);
    return { grilles, params: p, messages: m, jour: j };
  };

  const applique = (d: DonneesGrille): void => {
    jour = d.jour;
    params = d.params;
    messages = d.messages;
    grille = d.grilles.find((g) => g.version === d.jour.grille_version) ?? d.grilles[0] ?? null;
    rendsEntetesEtPied();
  };

  sync = creeSynchronisation<DonneesGrille>({
    cleSnapshot: `tmb-grille-${gare ?? 'ligne'}`,
    charge,
    applique,
    // L'instantané relu ne passe pas par getParams() : même assainissement.
    valide: (d) => ({ ...d, params: paramsValides(d.params) }),
  });
  await sync.demarre();

  provider.onChange(() => sync?.resynchronise());
  window.setInterval(() => sync?.resynchronise(), 30_000);
  window.addEventListener('online', () => sync?.resynchronise());

  // Jamais de heartbeat en aperçu (?apercu=1) ni sans gare : un poste de
  // bureau consultant la ligne entière n'est pas un écran de gare.
  if (url.get('apercu') !== '1' && gare !== null) {
    const journaliseHeartbeat = creeJournalHeartbeat();
    const bat = (): void => {
      void provider
        .heartbeat({
          id: idEcran,
          gare,
          type: 'grille',
          version_app: import.meta.env.MODE,
          donnees_maj: sync?.derniereSyncISO() ?? null,
          date_affichee: jour?.date ?? null,
        })
        .catch(journaliseHeartbeat);
    };
    bat();
    window.setInterval(bat, INTERVALLE_HEARTBEAT_MS);
  }

  rendre();
  window.setInterval(() => {
    if (jour && jour.date !== heure.dateISO()) sync?.resynchronise(); // passage de minuit
    rendre();
  }, 1000);
}

void demarre();
