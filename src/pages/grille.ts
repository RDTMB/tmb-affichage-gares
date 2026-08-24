// Grille du jour (étape 3) — reproduit fidèlement maquettes/grille-horaire.html.
// Deux tableaux (montée, descente) : colonnes = trains effectivement en
// circulation, lignes = gares avec altitudes officielles. Paramètres d'URL :
// gare (cible des messages), ecran, simule=HH:MM, zoom, et en mode mock
// terminus=N (bascule « à partir du TRAIN N »).
import '@fontsource/amaranth/400.css';
import '@fontsource/amaranth/700.css';
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import '@fontsource/lato/900.css';
import '../styles/tokens.css';
import '../styles/grille.css';

import { formatHeure, passagesPourGare, positionsTrains, trainsDuJour } from '../core/horaires';
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
import { creeProvider } from '../data';
import { creeTicker, echapper, messagesVisibles, meteoHtml } from './affichage-commun';
import { creeSourceHeure } from './horloge-source';

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
// Identifiant physique : défaut « <gare>-1 » (docs/01 §1) — une gare équipée
// de plusieurs écrans les distingue via ?ecran=.
document.body.dataset.ecran = url.get('ecran') ?? `${gareParam ?? 'grille'}-1`;

($('logo') as HTMLImageElement).src = __LOGO_ROND__;

let grille: Grille | null = null;
let jour: Jour | null = null;
let params: Params | null = null;
let messages: Message[] = [];
const majTicker = creeTicker($('ticker'));

function machineDe(nomRame: string): Machine {
  return params?.machines.find((m) => m.nom === nomRame) ?? { ...RAME_INCONNUE, nom: nomRame };
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
    html += `<th class="${classesColonne(c, i === prochainIdx)}"><span class="num">TRAIN ${c.train.numero}</span>${formatHeure(c.departTheorique_s)}`;
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
// Légende, météo, erreur
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

// ---------------------------------------------------------------------------
// Boucle principale — re-rendu 1×/s maximum (contrainte CLAUDE.md)
// ---------------------------------------------------------------------------

function rendre(): void {
  const maintenant = heure.maintenantS();
  $('horloge').innerHTML =
    `${formatHeure(maintenant)}<span class="sec">${String(maintenant % 60).padStart(2, '0')}</span>`;
  $('date-jour').textContent = heure.dateLongue();

  if (!grille || !jour) return;

  const positions = new Map(
    positionsTrains(grille, jour, maintenant).map((p) => [p.numero, p.gare]),
  );
  $('tab-montee').innerHTML = tableHtml('montee', maintenant, positions);
  $('tab-descente').innerHTML = tableHtml('descente', maintenant, positions);

  const passagesGare = gare ? passagesPourGare(grille, jour, gare, maintenant) : [];
  majTicker(messagesVisibles(messages, gare, passagesGare, heure.maintenantMs()));
}

/** En-têtes et blocs statiques, réappliqués après CHAQUE rechargement (minuit, onChange). */
function rendsEntetesEtPied(): void {
  if (!grille || !params) return;
  // « Today's timetable · Grand service » — libellé du service depuis la grille
  const service = grille.libelle.split('—')[0]?.trim() ?? '';
  $('sous-titre').textContent = service ? `Today's timetable · ${service}` : "Today's timetable";
  rendsLegende();
  $('meteo').innerHTML = meteoHtml(params, grille);
}

async function demarre(): Promise<void> {
  if (gareParam && gare === null) {
    // Paramètre présent mais inconnu (faute de frappe à l'installation) :
    // même erreur explicite que l'écran de gare, plutôt qu'un ciblage des
    // messages silencieusement perdu.
    const liste = ORDRE_GARES.map((g) => `<code>${g}</code>`).join(' · ');
    afficheErreur(
      'Écran non configuré / Screen not configured',
      `Le paramètre <code>?gare=</code> est inconnu. / The <code>?gare=</code> parameter is unknown.<br><br>Gares valides / valid stations : ${liste}<br><br>Exemple / example : <code>grille.html?gare=saint-gervais</code>`,
    );
    demarreHorlogeSeule();
    return;
  }

  let provider: ReturnType<typeof creeProvider>;
  let rechargementEnCours = false;

  async function chargeDonnees(): Promise<void> {
    const dateJour = heure.dateISO();
    const [grilles, chargeParams, chargeMessages, chargeJour] = await Promise.all([
      provider.getGrilles(),
      provider.getParams(),
      provider.getMessages(gare ?? 'le-fayet'),
      provider.getJour(dateJour),
    ]);
    jour = chargeJour;
    params = chargeParams;
    messages = chargeMessages;
    grille = grilles.find((g) => g.version === chargeJour.grille_version) ?? grilles[0] ?? null;
    rendsEntetesEtPied();
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

  provider.onChange(() => {
    void chargeDonnees().catch(() => {}); // l'affichage garde le dernier état connu
  });

  rendre();
  window.setInterval(() => {
    verifieChangementDeDate();
    rendre();
  }, 1000);
}

void demarre();
