// Supervision (étapes 6-7-8) — fidèle à maquettes/supervision.html.
// Connexion obligatoire ; le rôle filtre les onglets (caisse : Messages
// uniquement ; supervision : tout sauf Paramètres ; admin : tout).
// Les modifications s'appliquent immédiatement ; « Publier » journalise un
// résumé horodaté (docs/01 §5.6).
import '@fontsource/amaranth/400.css';
import '@fontsource/amaranth/700.css';
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import '@fontsource/lato/900.css';
import '../styles/tokens.css';
import '../styles/supervision.css';

import { formatHeure, heureVersSecondes, serviceActif } from '../core/horaires';
import { ORDRE_GARES } from '../core/types';
import type {
  Circulation,
  GareId,
  Grille,
  Jour,
  Machine,
  Media,
  Message,
  Params,
  Role,
  TrainGrille,
  User,
} from '../core/types';
import { creeProvider } from '../data';
import { echapper } from './affichage-commun';
import {
  datetimeLocalVersIso,
  isoVersDatetimeLocal,
  messageDepuisFormulaire,
  traductionLocale,
  valeursFormulaireMessage,
  type FormulaireMessage,
} from './supervision-logique';

const provider = creeProvider();

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Élément #${id} introuvable`);
  return el;
}

const ONGLET_PAR_ROLE: Record<Role, string[]> = {
  admin: ['circulations', 'messages', 'medias', 'ecrans', 'parametres'],
  supervision: ['circulations', 'messages', 'medias', 'ecrans'],
  caisse: ['messages'],
};

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------

let role: Role | null = null;
let emailConnecte = '';
let grilles: Grille[] = [];
let jour: Jour | null = null;
let dateSel = dateISO(0);
let params: Params | null = null;
let messages: Message[] = [];
let medias: Media[] = [];
let utilisateurs: User[] = [];
let modifs = 0;
const journal: string[] = [];
let editionMessageId: string | null = null;
let traductionManuelle = false;

function dateISO(decalageJours: number): string {
  const d = new Date();
  d.setDate(d.getDate() + decalageJours);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);
}

function grilleDuJour(): Grille | null {
  return grilles.find((g) => g.version === jour?.grille_version) ?? grilles[0] ?? null;
}

function circulationDe(numero: number): Circulation | null {
  return jour?.circulations.find((c) => c.numero === numero) ?? null;
}

function machineDe(nom: string): Machine {
  return (
    params?.machines.find((m) => m.nom === nom) ?? { nom, couleur: '#708DA4', en_service: true }
  );
}

let toastId = 0;
function toast(texte: string): void {
  const t = $('toast');
  t.textContent = texte;
  t.classList.add('on');
  window.clearTimeout(toastId);
  toastId = window.setTimeout(() => t.classList.remove('on'), 3600);
}

function bump(detail: string): void {
  modifs += 1;
  journal.push(detail);
  $('etat-pub').innerHTML =
    `<b>${modifs} modification${modifs > 1 ? 's' : ''}</b> en attente de publication`;
}

function erreurVersToast(erreur: unknown): void {
  toast(`⚠ ${String(erreur instanceof Error ? erreur.message : erreur)}`);
}

// ---------------------------------------------------------------------------
// Chargement
// ---------------------------------------------------------------------------

async function chargeTout(): Promise<void> {
  const demande = dateSel;
  const [g, p, msg, med, j] = await Promise.all([
    provider.getGrilles(),
    provider.getParams(),
    provider.getMessages('le-fayet'),
    provider.listMedias(), // TOUS les médias : un média désactivé doit rester gérable
    provider.getJour(demande),
  ]);
  grilles = g;
  params = p;
  messages = msg;
  medias = med;
  // Garde de course : ne pas écraser l'affichage si l'agent a changé de date
  // pendant le chargement (l'en-tête et le tableau seraient désynchronisés).
  if (demande === dateSel) jour = j;
}

async function rechargeJour(): Promise<void> {
  const demande = dateSel;
  const j = await provider.getJour(demande);
  if (demande !== dateSel) return; // une navigation plus récente a pris le relais
  jour = j;
  rendreCirculations();
}

function rendreTout(): void {
  rendreEnTete();
  rendreCirculations();
  rendreCasesGares(); // noms de gares : les grilles sont chargées à ce stade
  rendreMessages();
  rendreMedias();
  void rendreEcrans();
  rendreParametres();
}

// ---------------------------------------------------------------------------
// En-tête, onglets, connexion
// ---------------------------------------------------------------------------

function rendreEnTete(): void {
  const grille = serviceActif(grilles, dateISO(0));
  $('pill-service').textContent = grille ? grille.libelle : 'Hors saison';
}

function appliqueRole(r: Role): void {
  const visibles = ONGLET_PAR_ROLE[r];
  document.querySelectorAll<HTMLButtonElement>('nav.tabs button').forEach((b) => {
    const nom = b.dataset.t ?? '';
    b.style.display = visibles.includes(nom) ? '' : 'none';
    b.classList.toggle('on', nom === visibles[0]);
  });
  document.querySelectorAll('.onglet').forEach((o) => {
    o.classList.toggle('on', o.id === `t-${visibles[0]}`);
  });
}

function initOnglets(): void {
  document.querySelectorAll<HTMLButtonElement>('nav.tabs button').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('nav.tabs button').forEach((x) => x.classList.remove('on'));
      document.querySelectorAll('.onglet').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      $(`t-${b.dataset.t}`).classList.add('on');
    });
  });
}

async function apresConnexion(): Promise<void> {
  $('connexion').style.display = 'none';
  $('tabs').style.display = '';
  $('contenu').style.display = '';
  $('barre-publier').style.display = '';
  $('bloc-user').style.display = '';
  $('user-nom').textContent = emailConnecte;
  $('avatar').textContent = emailConnecte.slice(0, 2).toUpperCase();
  const tag = $('user-role');
  tag.textContent = (role ?? '').toUpperCase();
  tag.className = `role-tag role-${role}`;
  appliqueRole(role ?? 'caisse');
  try {
    await chargeTout();
  } catch (erreur) {
    // Jamais d'écran vide et muet : l'agent doit savoir pourquoi
    erreurVersToast(erreur);
    $('sous-titre-jour').textContent = '— données indisponibles';
    toast('Chargement impossible — vérifiez la connexion, puis rechargez la page');
    return;
  }
  rendreTout();

  provider.onChange(() => {
    // Pas de re-rendu pendant une saisie (le rafraîchissement suivra)
    const actif = document.activeElement;
    if (actif && $('contenu').contains(actif) && actif.matches('input, select, textarea')) return;
    void chargeTout()
      .then(rendreTout)
      .catch(() => {}); // l'affichage garde le dernier état connu
  });
  window.setInterval(() => void rendreEcrans(), 10_000);
}

// ---------------------------------------------------------------------------
// Onglet Circulations
// ---------------------------------------------------------------------------

function heurePassee(depart: string): boolean {
  if (dateSel !== dateISO(0)) return false;
  const d = new Date();
  const maintenant = d.getHours() * 3600 + d.getMinutes() * 60;
  return maintenant > heureVersSecondes(depart) + 75 * 60;
}

function optionsMotifs(selection: string | null): string {
  const motifs = params?.motifs.map((m) => m.fr) ?? [];
  return ['—', ...motifs]
    .map((m) => `<option ${m === (selection ?? '—') ? 'selected' : ''}>${echapper(m)}</option>`)
    .join('');
}

function ligneCirculation(
  train: TrainGrille,
  sens: 'montee' | 'descente',
  lectureSeule = false,
): string {
  const c = circulationDe(train.numero);
  if (!c) return '';
  const verrou = lectureSeule ? ' disabled' : '';
  const montee = sens === 'montee';
  const circMontee = montee ? c : circulationDe(train.numero - 1);
  const rameEffective = circMontee?.rame ?? c.rame;
  const machine = machineDe(rameEffective);
  const inactif = c.facultatif && !c.facultatif_actif;
  const depart = train.passages[0]?.d ?? train.passages[0]?.a ?? '00:00:00';
  const heure = formatHeure(heureVersSecondes(depart));
  const n = c.numero;

  const rame = montee
    ? `<select data-action="rame" data-numero="${n}"${verrou}>${
        // Rame absente des machines (renommée ou retirée) : on la garde en
        // tête pour ne pas afficher silencieusement une autre rame.
        (params?.machines ?? []).some((m) => m.nom === rameEffective)
          ? ''
          : `<option selected>${echapper(rameEffective)}</option>`
      }${(params?.machines ?? [])
        .filter((m) => m.en_service || m.nom === rameEffective)
        .map(
          (m) => `<option ${m.nom === rameEffective ? 'selected' : ''}>${echapper(m.nom)}</option>`,
        )
        .join('')}</select>`
    : `<span class="rame-fixe"><span class="p" style="background:${machine.couleur};${
        machine.cercle ? `box-shadow:0 0 0 2px ${machine.cercle};` : ''
      }"></span>${echapper(rameEffective)}<small>(rotation)</small></span>`;

  // Rotation limitée = colonne Terminus de la MONTÉE sur Bellevue (pour une
  // montée, circMontee est la ligne elle-même). Un facultatif non activé ou
  // un train supprimé ne circule pas : plus rien à traiter (sinon toute
  // journée grand service afficherait le signalement par défaut).
  const aTraiter = circMontee?.terminus === 'bellevue' && c.statut !== 'supprime' && !inactif;
  const terminus = montee
    ? train.express
      ? aTraiter
        ? // Express dans une plage limitée : il n'est jamais tronqué (il ne
          // dessert pas Bellevue) — l'agent tranche explicitement.
          `<span class="term-bv" title="Un express ne dessert pas Bellevue : à supprimer, ou à maintenir jusqu'au Nid d'Aigle">À traiter ⚠</span>
           <span class="a-traiter">
             <button class="leger" data-action="express-supprimer" data-numero="${n}"${verrou}>Supprimer</button>
             <button class="leger" data-action="express-maintenir" data-numero="${n}"${verrou}>Maintenir</button>
           </span>`
        : c.terminus === 'bellevue'
          ? '<span class="term-fixe">Rotation limitée</span>'
          : '<span class="term-fixe" title="Un express ne peut pas être limité à Bellevue">Nid d\'Aigle</span>'
      : `<select data-action="terminus" data-numero="${n}"${verrou}>
          <option value="nid-daigle" ${c.terminus === 'nid-daigle' ? 'selected' : ''}>Nid d'Aigle</option>
          <option value="bellevue" ${c.terminus === 'bellevue' ? 'selected' : ''}>Bellevue ⚠</option>
        </select>`
    : circMontee?.terminus === 'bellevue'
      ? train.express
        ? // Descente EXPRESS d'une rotation limitée : elle ne dessert pas
          // Bellevue, elle partirait donc du Nid d'Aigle sur un tronçon fermé.
          !aTraiter
          ? '<span class="term-fixe">Rotation limitée</span>'
          : `<span class="term-bv" title="Un express ne part pas de Bellevue : à supprimer, ou à maintenir depuis le Nid d'Aigle">À traiter ⚠</span>
             <span class="a-traiter">
               <button class="leger" data-action="express-supprimer" data-numero="${n}"${verrou}>Supprimer</button>
               <button class="leger" data-action="express-maintenir-descente" data-numero="${n}"${verrou}>Maintenir</button>
             </span>`
        : '<span class="term-bv">Départ de Bellevue</span>'
      : '<span class="term-fixe">Le Fayet</span>';

  const facultatif = c.facultatif
    ? `<label class="switch"><input type="checkbox" data-action="actif" data-numero="${n}" ${
        c.facultatif_actif ? 'checked' : ''
      }${verrou} />${c.facultatif_actif ? 'Activé' : 'Non activé'}</label>`
    : '<span style="color:#B4C4D4">—</span>';

  const statut = inactif
    ? '<span style="color:#B4C4D4;font-weight:700">Ne circule pas — absent des écrans</span>'
    : `<span class="seg">
        <button class="${c.statut === 'ok' ? 'on-ok' : ''}" data-action="statut-ok" data-numero="${n}"${verrou}>À l'heure</button>
        <button class="${c.statut === 'retard' ? 'on-retard' : ''}" data-action="statut-retard" data-numero="${n}"${verrou}>Retard</button>
        <button class="${c.statut === 'supprime' ? 'on-supp' : ''}" data-action="statut-supprime" data-numero="${n}"${verrou}>Supprimé</button>
      </span>${
        c.statut === 'retard'
          ? `<span class="retard-ctrl"><button data-action="retard-moins" data-numero="${n}"${verrou}>−</button><span class="val">+${c.retard_min} min</span><button data-action="retard-plus" data-numero="${n}"${verrou}>+</button></span>`
          : ''
      }`;

  return `<tr class="${heurePassee(depart) ? 'passe' : ''} ${inactif ? 'inactif' : ''} ${
    montee ? '' : 'paire-fin'
  }">
    <td class="h-dep">${heure}<small>TRAIN ${n}</small></td>
    <td><span class="sens-tag ${montee ? 'up' : 'down'}">${montee ? '↗ Montée' : '↙ Descente'}</span>${
      train.express
        ? `<span class="exp-tag"><img src="${__MOTRICE_MARINE__}" alt="" /> EXPRESS</span>`
        : ''
    }${train.velos ? '<span class="velo-tag">🚲</span>' : ''}</td>
    <td>${rame}</td>
    <td>${terminus}</td>
    <td>${facultatif}</td>
    <td>${statut}</td>
    <td><select data-action="motif" data-numero="${n}" ${inactif || lectureSeule ? 'disabled' : ''}>${optionsMotifs(c.motif ?? null)}</select></td>
  </tr>`;
}

function rendreCirculations(): void {
  const grille = grilleDuJour();
  if (!grille || !jour) return;
  ($('date-picker') as HTMLInputElement).value = dateSel;
  const dateAffichee = new Date(`${dateSel}T12:00:00`).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  $('sous-titre-jour').textContent = `du ${dateAffichee}`;
  $('chip-auj').classList.toggle('on', dateSel === dateISO(0));
  $('chip-dem').classList.toggle('on', dateSel === dateISO(1));
  // Hors saison : aucun train, contrôles désactivés. Date passée jamais
  // exploitée : aperçu théorique en LECTURE SEULE (pas d'historique inventé).
  // Les dates à venir sont créées automatiquement à l'ouverture (provider).
  const horsSaison = jour.hors_saison === true;
  const lectureSeule = !horsSaison && jour.enregistre === false;
  const bandeau = $('bandeau-apercu');
  bandeau.style.display = lectureSeule ? '' : 'none';
  bandeau.textContent = '👁 Aperçu théorique — journée non exploitée (lecture seule).';
  ($('chk-terminus') as HTMLInputElement).disabled = horsSaison || lectureSeule;
  ($('sel-terminus-train') as HTMLSelectElement).disabled = horsSaison || lectureSeule;
  ($('btn-reinitialiser') as HTMLButtonElement).disabled = horsSaison || lectureSeule;

  const service = serviceActif(grilles, dateSel);
  $('service-tag').textContent = service
    ? `${service.libelle.split('—')[0]?.trim()} (${service.periodes
        .map((p) => `${p.du.slice(8)}/${p.du.slice(5, 7)} → ${p.au.slice(8)}/${p.au.slice(5, 7)}`)
        .join(' et ')})`
    : 'Hors saison / service hiver';

  // Bascule Terminus Bellevue « à partir du TRAIN N »
  const flag = jour.terminus_bellevue;
  ($('chk-terminus') as HTMLInputElement).checked = flag !== false;
  const sel = $('sel-terminus-train') as HTMLSelectElement;
  sel.innerHTML = grille.montees
    .map(
      (m) =>
        `<option value="${m.numero}" ${
          flag !== false && flag.a_partir_du_train === m.numero ? 'selected' : ''
        }>TRAIN ${m.numero}${m.numero === 1 ? ' (journée entière)' : ''}</option>`,
    )
    .join('');

  // Ordre APPARIÉ : chaque montée suivie de sa descente (même rotation)
  const tbody = document.querySelector('#tab-circ tbody');
  if (!tbody) return;
  if (horsSaison) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="padding:22px;color:var(--sec);font-weight:700">Aucun service ne circule à cette date.</td></tr>';
    return;
  }
  tbody.innerHTML = grille.montees
    .map((montee) => {
      const descente = grille.descentes.find((d) => d.numero === montee.numero + 1);
      return (
        ligneCirculation(montee, 'montee', lectureSeule) +
        (descente ? ligneCirculation(descente, 'descente', lectureSeule) : '')
      );
    })
    .join('');
}

/**
 * Enregistre une circulation. Retourne false si l'écriture a échoué : les
 * appelants NE DOIVENT PAS annoncer de succès dans ce cas (un toast de
 * succès effacerait le toast d'erreur — même famille de faux succès que le
 * bug du 25/08).
 */
async function sauveCirculation(c: Circulation, detail: string): Promise<boolean> {
  let ok = true;
  try {
    await provider.saveCirculation(c);
    bump(detail);
  } catch (erreur) {
    erreurVersToast(erreur);
    ok = false;
  }
  // Le rechargement lui-même ne doit jamais échouer en silence
  try {
    await rechargeJour();
  } catch (erreur) {
    erreurVersToast(erreur);
    ok = false;
  }
  return ok;
}

function initCirculations(): void {
  $('btn-jour-prec').addEventListener('click', () => void changeDate(-1));
  $('btn-jour-suiv').addEventListener('click', () => void changeDate(1));
  $('chip-auj').addEventListener('click', () => void allerDate(dateISO(0)));
  $('chip-dem').addEventListener('click', () => void allerDate(dateISO(1)));
  $('date-picker').addEventListener('change', (e) => {
    void allerDate((e.target as HTMLInputElement).value);
  });
  $('btn-reinitialiser').addEventListener('click', () => {
    if (
      !window.confirm(
        `Réinitialiser la journée du ${dateSel} depuis la grille en vigueur ?\n` +
          'TOUTES les modifications du jour seront perdues (retour à l’horaire théorique).',
      )
    )
      return;
    void provider
      .reinitialiseJour(dateSel)
      .then(() => rechargeJour())
      .then(() => {
        bump(`journée ${dateSel} réinitialisée`);
        toast('Journée réinitialisée depuis la grille en vigueur');
      })
      .catch(erreurVersToast);
  });
  $('btn-csv').addEventListener('click', exporteCsv);

  const terminusChange = (): void => {
    const coche = ($('chk-terminus') as HTMLInputElement).checked;
    const n = Number(($('sel-terminus-train') as HTMLSelectElement).value) || 1;
    void provider
      .setTerminusBellevue(dateSel, coche ? { a_partir_du_train: n } : false)
      .then(() => rechargeJour())
      .then(() => {
        bump(coche ? `terminus Bellevue à partir du TRAIN ${n}` : 'terminus Bellevue désactivé');
        toast(
          coche
            ? `Terminus Bellevue à partir du TRAIN ${n} : colonne Terminus pré-remplie, express signalés « à traiter », Nid d'Aigle en « tronçon fermé » quand plus aucun passage`
            : 'Retour au service normal jusqu’au Nid d’Aigle',
        );
      })
      .catch(erreurVersToast);
  };
  $('chk-terminus').addEventListener('change', terminusChange);
  $('sel-terminus-train').addEventListener('change', () => {
    if (($('chk-terminus') as HTMLInputElement).checked) terminusChange();
  });

  /**
   * Suppression d'une MONTÉE : propose la suppression de sa descente
   * appariée (par défaut Oui, dérogeable — rame de remplacement), docs/01 §5.1.
   */
  const proposeSuppressionDescente = (montee: Circulation): void => {
    const descente = circulationDe(montee.numero + 1);
    if (!descente || descente.statut === 'supprime') return;
    if (
      !window.confirm(
        `Supprimer aussi la descente appariée (TRAIN ${descente.numero}) ?\n` +
          'La rame ne redescendra pas : cliquez Annuler seulement si une rame de remplacement assure la descente.',
      )
    )
      return;
    descente.statut = 'supprime';
    descente.retard_min = 0;
    descente.motif = montee.motif;
    void sauveCirculation(descente, `statut TRAIN ${descente.numero} → supprime (rotation)`);
  };

  // Délégation d'événements sur le tableau
  const tbody = document.querySelector('#tab-circ tbody');
  if (!tbody) return;
  const surAction = (cible: HTMLElement): void => {
    // Garde-fou : hors saison ou journée passée non exploitée = lecture seule
    if (jour?.hors_saison || jour?.enregistre === false) return;
    const action = cible.dataset.action;
    const numero = Number(cible.dataset.numero);
    if (!action || !numero) return;
    const c = circulationDe(numero);
    if (!c) return;

    if (action === 'rame') {
      c.rame = (cible as HTMLSelectElement).value;
      void sauveCirculation(c, `rame TRAIN ${numero} → ${c.rame}`).then((ok) => {
        if (ok) toast('Rame changée : la descente de la même rotation suit automatiquement');
      });
    } else if (action === 'terminus') {
      c.terminus = (cible as HTMLSelectElement).value as Circulation['terminus'];
      void sauveCirculation(c, `terminus TRAIN ${numero} → ${c.terminus}`).then((ok) => {
        if (!ok) return;
        toast(
          c.terminus === 'bellevue'
            ? `TRAIN ${numero} limité à Bellevue : sa descente partira de Bellevue`
            : `TRAIN ${numero} rétabli jusqu'au Nid d'Aigle`,
        );
      });
    } else if (action === 'actif') {
      c.facultatif_actif = (cible as HTMLInputElement).checked;
      void sauveCirculation(
        c,
        `facultatif TRAIN ${numero} ${c.facultatif_actif ? 'activé' : 'désactivé'}`,
      ).then((ok) => {
        if (!ok) return;
        toast(
          c.facultatif_actif
            ? 'Train facultatif activé : il apparaîtra sur les écrans'
            : 'Train facultatif désactivé : retiré des écrans',
        );
      });
    } else if (action.startsWith('statut-')) {
      const statut = action.replace('statut-', '') as Circulation['statut'];
      if (statut === 'supprime') {
        const heure = formatHeure(
          heureVersSecondes(
            grilleDuJour()
              ?.montees.concat(grilleDuJour()?.descentes ?? [])
              .find((t) => t.numero === numero)?.passages[0]?.d ?? '00:00',
          ),
        );
        if (
          !window.confirm(
            `Confirmer la suppression du TRAIN ${numero} (${heure}) ? Il restera affiché barré jusqu'à son heure théorique.`,
          )
        ) {
          rendreCirculations();
          return;
        }
      }
      c.statut = statut;
      if (statut === 'retard' && c.retard_min < 5) c.retard_min = 5;
      if (statut !== 'retard') c.retard_min = 0;
      void sauveCirculation(c, `statut TRAIN ${numero} → ${statut}`).then((ok) => {
        if (ok && statut === 'supprime' && c.sens === 'montee') proposeSuppressionDescente(c);
      });
    } else if (action === 'express-supprimer') {
      if (
        !window.confirm(
          `Supprimer l'express TRAIN ${numero} ?\n` +
            'Il restera affiché barré jusqu’à son heure théorique.',
        )
      )
        return;
      c.statut = 'supprime';
      c.retard_min = 0;
      c.motif ??= params?.motifs[0]?.fr ?? null;
      void sauveCirculation(c, `express TRAIN ${numero} supprimé (plage Bellevue)`).then((ok) => {
        if (!ok) return;
        toast(`Express TRAIN ${numero} supprimé — signalement levé`);
        // Même règle que pour une montée normale (docs/01 §5.1)
        if (c.sens === 'montee') proposeSuppressionDescente(c);
      });
    } else if (action === 'express-maintenir-descente') {
      // Descente express maintenue : on lève la limitation de SA rotation
      // (la montée repasse au Nid d'Aigle), sinon le signalement reviendrait.
      const montee = circulationDe(numero - 1);
      if (!montee) return;
      montee.terminus = 'nid-daigle';
      void sauveCirculation(
        montee,
        `rotation TRAIN ${montee.numero}/${numero} maintenue jusqu'au Nid d'Aigle`,
      ).then((ok) => {
        if (ok) toast(`Rotation express maintenue jusqu'au Nid d'Aigle — signalement levé`);
      });
    } else if (action === 'express-maintenir') {
      // Lève le signalement : l'express circule jusqu'au Nid d'Aigle malgré
      // la plage limitée (aucun horaire n'est inventé). Sa descente appariée,
      // express elle aussi, redescend donc bien du Nid d'Aigle.
      c.terminus = 'nid-daigle';
      void sauveCirculation(c, `express TRAIN ${numero} maintenu jusqu'au Nid d'Aigle`).then(
        (ok) => {
          if (ok) toast(`Express TRAIN ${numero} maintenu jusqu'au Nid d'Aigle — signalement levé`);
        },
      );
    } else if (action === 'retard-plus' || action === 'retard-moins') {
      c.retard_min = Math.max(5, c.retard_min + (action === 'retard-plus' ? 5 : -5));
      void sauveCirculation(c, `retard TRAIN ${numero} → +${c.retard_min} min`);
    } else if (action === 'motif') {
      const v = (cible as HTMLSelectElement).value;
      c.motif = v === '—' ? null : v;
      void sauveCirculation(c, `motif TRAIN ${numero} → ${v}`);
    }
  };
  tbody.addEventListener('click', (e) => {
    const bouton = (e.target as HTMLElement).closest('button[data-action]');
    if (bouton) surAction(bouton as HTMLElement);
  });
  tbody.addEventListener('change', (e) => {
    const champ = (e.target as HTMLElement).closest('select[data-action], input[data-action]');
    if (champ) surAction(champ as HTMLElement);
  });
}

async function changeDate(decalage: number): Promise<void> {
  // Arithmétique en UTC pur (midi) : insensible au fuseau et aux
  // changements d'heure d'été, contrairement à new Date('...T12:00:00').
  const [a = 0, m = 1, j = 1] = dateSel.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j + decalage));
  await allerDate(d.toISOString().slice(0, 10));
}

/**
 * Change de date SANS échec muet : la date affichée ne bouge que si le
 * chargement a réussi — sinon les actions (suppression, terminus…)
 * s'appliqueraient à une date différente de celle qui est à l'écran.
 */
async function allerDate(date: string): Promise<void> {
  if (!date) {
    // Champ vidé : on ne bouge pas, mais on le dit et on remet la date réelle
    ($('date-picker') as HTMLInputElement).value = dateSel;
    toast('Date invalide — la journée affichée est inchangée');
    return;
  }
  const precedente = dateSel;
  try {
    dateSel = date; // les chargements concurrents comparent à cette valeur
    const nouveau = await provider.getJour(date);
    if (dateSel !== date) return; // une navigation plus récente a pris le relais
    jour = nouveau;
    rendreCirculations();
  } catch (erreur) {
    if (dateSel === date) {
      dateSel = precedente;
      ($('date-picker') as HTMLInputElement).value = precedente;
      rendreCirculations(); // remet en-tête, service et bascule sur la date réelle
    }
    erreurVersToast(erreur);
  }
}

function exporteCsv(): void {
  const grille = grilleDuJour();
  if (!grille || !jour) return;
  const lignes = [
    [
      'date',
      'train',
      'sens',
      'heure',
      'express',
      'facultatif',
      'actif',
      'rame',
      'terminus',
      'statut',
      'retard_min',
      'motif',
    ].join(';'),
  ];
  for (const montee of grille.montees) {
    for (const t of [montee, grille.descentes.find((d) => d.numero === montee.numero + 1)]) {
      if (!t) continue;
      const c = circulationDe(t.numero);
      if (!c) continue;
      const circMontee = c.sens === 'montee' ? c : circulationDe(t.numero - 1);
      lignes.push(
        [
          dateSel,
          `TRAIN ${c.numero}`,
          c.sens,
          formatHeure(heureVersSecondes(t.passages[0]?.d ?? t.passages[0]?.a ?? '00:00')),
          t.express ? 'oui' : '',
          c.facultatif ? 'oui' : '',
          c.facultatif ? (c.facultatif_actif ? 'oui' : 'non') : '',
          circMontee?.rame ?? c.rame,
          c.terminus,
          c.statut,
          String(c.retard_min),
          c.motif ?? '',
        ].join(';'),
      );
    }
  }
  const blob = new Blob([`﻿${lignes.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `circulations-${dateSel}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------------------
// Onglet Messages (traduction EN automatique : Edge Function + repli local)
// ---------------------------------------------------------------------------

/** Avertit l'agent que l'anglais n'a pas pu être produit automatiquement. */
function afficheAvertissementTraduction(visible: boolean): void {
  $('msg-trad-avert').style.display = visible ? '' : 'none';
}

let traductionId = 0;
function lanceTraduction(): void {
  const fr = ($('msg-fr') as HTMLInputElement).value.trim();
  if (traductionManuelle) return; // le texte EN a été retouché à la main
  if (!fr) {
    ($('msg-en') as HTMLInputElement).value = '';
    afficheAvertissementTraduction(false);
    return;
  }
  window.clearTimeout(traductionId);
  traductionId = window.setTimeout(() => {
    void provider.traduire(fr).then((en) => {
      if (traductionManuelle) return;
      // Service indisponible (null) : repli dictionnaire ; s'il ne connaît
      // pas la phrase, on laisse VIDE — jamais de faux anglais.
      const traduit = en ?? traductionLocale(fr);
      ($('msg-en') as HTMLInputElement).value = traduit;
      afficheAvertissementTraduction(traduit === '');
    });
  }, 500);
}

function libelleCible(m: Message): string {
  if (m.cible_type === 'gares') {
    return (m.gares ?? []).map((g) => nomDeGare(g)).join(', ') || 'Gares…';
  }
  if (m.cible_type === 'train') return `TRAIN ${m.train_numero}`;
  return 'Toutes les gares';
}

function nomDeGare(id: string): string {
  return grilles[0]?.gares.find((g) => g.id === id)?.nom ?? id;
}

function rendreMessages(): void {
  $('badge-msgs').textContent = String(messages.filter((m) => m.actif).length);
  $('liste-msgs').innerHTML = messages
    .map(
      (m) => `
    <div class="msg${editionMessageId === m.id ? ' en-edition' : ''}">
      <div class="prio ${m.priorite === 'importante' ? 'imp' : 'norm'}"></div>
      <div class="corps">
        <div class="fr">${echapper(m.texte_fr)}</div>
        <div class="en">${echapper(m.texte_en)}</div>
        <div class="cibles">
          <span class="chip-gare ${m.cible_type === 'toutes' ? 'toutes' : m.cible_type === 'train' ? 'train' : ''}">${echapper(libelleCible(m))}</span>
          ${m.priorite === 'importante' ? '<span class="chip-gare fixe">Bandeau fixe</span>' : ''}
          ${m.expire_at ? `<span class="chip-gare">expire ${new Date(m.expire_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>` : ''}
        </div>
      </div>
      <button class="leger" data-modifier="${m.id}">Modifier</button>
      <button class="leger" data-retirer="${m.id}">Retirer</button>
    </div>`,
    )
    .join('');
}

/** Les raccourcis d'expiration remplissent le champ date : ce qui est affiché est ce qui sera enregistré. */
function appliqueRaccourciExpiration(): void {
  const choix = ($('msg-expire') as HTMLSelectElement).value;
  const champ = $('msg-expire-date') as HTMLInputElement;
  champ.style.display = choix === '' ? 'none' : '';
  if (choix === '' || choix === 'date') {
    if (choix === '') champ.value = '';
    return;
  }
  const quand = new Date();
  if (choix === 'soir') {
    quand.setHours(21, 0, 0, 0);
    // Après 21:00, « ce soir » viserait une heure passée : le message
    // n'apparaîtrait sur aucun écran. On bascule au soir suivant.
    if (quand.getTime() <= Date.now()) quand.setDate(quand.getDate() + 1);
  }
  if (choix === '1h') quand.setTime(quand.getTime() + 3_600_000);
  if (choix === '3h') quand.setTime(quand.getTime() + 3 * 3_600_000);
  champ.value = isoVersDatetimeLocal(quand.toISOString());
  ($('msg-expire') as HTMLSelectElement).value = 'date'; // la date fait foi
}

/** Lit l'état complet du formulaire (source de vérité unique à l'enregistrement). */
function formulaireMessage(): FormulaireMessage {
  return {
    texte_fr: ($('msg-fr') as HTMLInputElement).value,
    texte_en: ($('msg-en') as HTMLInputElement).value,
    cible_type: ($('msg-cible') as HTMLSelectElement).value as Message['cible_type'],
    gares: Array.from(document.querySelectorAll<HTMLInputElement>('#msg-gares input:checked')).map(
      (i) => i.value as GareId,
    ),
    train_numero: Number(($('msg-train') as HTMLSelectElement).value) || null,
    priorite: ($('msg-prio') as HTMLSelectElement).value as Message['priorite'],
    expire_local: ($('msg-expire-date') as HTMLInputElement).value,
  };
}

/** Remplit le formulaire depuis un message (édition) ou le vide (nouveau). */
function remplitFormulaireMessage(f: FormulaireMessage | null): void {
  const vide: FormulaireMessage = {
    texte_fr: '',
    texte_en: '',
    cible_type: 'toutes',
    gares: [],
    train_numero: null,
    priorite: 'normale',
    expire_local: '',
  };
  const v = f ?? vide;
  ($('msg-fr') as HTMLInputElement).value = v.texte_fr;
  ($('msg-en') as HTMLInputElement).value = v.texte_en;
  ($('msg-cible') as HTMLSelectElement).value = v.cible_type;
  ($('msg-prio') as HTMLSelectElement).value = v.priorite;
  ($('msg-expire-date') as HTMLInputElement).value = v.expire_local;
  ($('msg-expire') as HTMLSelectElement).value = v.expire_local ? 'date' : '';
  $('msg-expire-date').style.display = v.expire_local ? '' : 'none';
  majChampsCible(v.cible_type, v.train_numero);
  for (const case_ of document.querySelectorAll<HTMLInputElement>('#msg-gares input')) {
    case_.checked = v.gares.includes(case_.value as GareId);
  }
}

/** Affiche les champs de la cible choisie et (re)construit la liste des trains. */
function majChampsCible(cible: Message['cible_type'], trainSelectionne: number | null): void {
  $('msg-gares').style.display = cible === 'gares' ? '' : 'none';
  $('msg-train').style.display = cible === 'train' ? '' : 'none';
  if (cible !== 'train') return;
  // Trains de la grille du JOUR AFFICHÉ (et non toujours la première grille)
  const g = grilleDuJour() ?? grilles[0] ?? null;
  const trains = [...(g?.montees ?? []), ...(g?.descentes ?? [])].sort(
    (a, b) => a.numero - b.numero,
  );
  const options = trains.map((t) => {
    const heure = formatHeure(heureVersSecondes(t.passages[0]?.d ?? t.passages[0]?.a ?? '00:00'));
    return `<option value="${t.numero}" ${t.numero === trainSelectionne ? 'selected' : ''}>TRAIN ${t.numero} — ${heure} ${t.numero % 2 === 1 ? '↗' : '↙'}${t.express ? ' (Express)' : ''}</option>`;
  });
  // Train du message absent de cette grille (autre service à cette date) :
  // on le garde en tête, sinon le select retomberait sur le premier train et
  // l'enregistrement recyclerait silencieusement la cible vers celui-ci.
  if (trainSelectionne !== null && !trains.some((t) => t.numero === trainSelectionne)) {
    options.unshift(
      `<option value="${trainSelectionne}" selected>TRAIN ${trainSelectionne} — hors grille de cette date</option>`,
    );
  }
  ($('msg-train') as HTMLSelectElement).innerHTML = options.join('');
}

function annuleEditionMessage(): void {
  editionMessageId = null;
  traductionManuelle = false;
  afficheAvertissementTraduction(false);
  remplitFormulaireMessage(null);
  $('btn-msg').textContent = 'Ajouter';
  $('btn-msg-annuler').style.display = 'none';
  rendreMessages();
}

/** Cases à cocher des gares cibles, avec les noms de la charte (grilles chargées). */
function rendreCasesGares(): void {
  const cochees = new Set(
    Array.from(document.querySelectorAll<HTMLInputElement>('#msg-gares input:checked')).map(
      (i) => i.value,
    ),
  );
  $('msg-gares').innerHTML = ORDRE_GARES.map(
    (g) =>
      `<label><input type="checkbox" value="${g}" ${cochees.has(g) ? 'checked' : ''} /> ${echapper(nomDeGare(g))}</label>`,
  ).join('');
}

function initMessages(): void {
  rendreCasesGares(); // reconstruites après chargement des grilles (rendreTout)

  $('msg-cible').addEventListener('change', () => {
    majChampsCible(($('msg-cible') as HTMLSelectElement).value as Message['cible_type'], null);
  });
  $('msg-expire').addEventListener('change', appliqueRaccourciExpiration);
  $('msg-fr').addEventListener('input', lanceTraduction);
  $('msg-en').addEventListener('input', () => {
    const saisi = ($('msg-en') as HTMLInputElement).value.trim() !== '';
    traductionManuelle = saisi;
    if (saisi) afficheAvertissementTraduction(false); // l'agent a fourni l'anglais
  });
  $('btn-msg-annuler').addEventListener('click', annuleEditionMessage);

  $('btn-msg').addEventListener('click', () => {
    const f = formulaireMessage();
    if (!f.texte_fr.trim()) {
      toast('Saisissez d’abord le message en français');
      return;
    }
    if (f.cible_type === 'gares' && f.gares.length === 0) {
      toast('Cochez au moins une gare, sinon le message ne s’affichera nulle part');
      return;
    }
    // Anglais absent : repli dictionnaire, sinon VIDE (l'écran n'affichera
    // que le français — jamais de faux anglais). L'agent a été averti.
    if (!f.texte_en.trim()) f.texte_en = traductionLocale(f.texte_fr);
    // Le formulaire est la source de vérité : cible et expiration affichées
    // sont exactement celles enregistrées (elles ont été restituées à
    // l'ouverture de l'édition).
    const message = messageDepuisFormulaire(f, editionMessageId ?? '');
    void provider
      .saveMessage(message)
      .then(() => provider.getMessages('le-fayet'))
      .then((liste) => {
        messages = liste;
        bump(editionMessageId ? 'message modifié' : 'message ajouté');
        toast(editionMessageId ? 'Message modifié' : 'Message publié sur les écrans ciblés');
        annuleEditionMessage();
      })
      .catch(erreurVersToast);
  });

  $('liste-msgs').addEventListener('click', (e) => {
    const cible = e.target as HTMLElement;
    const idModif = cible.dataset.modifier;
    const idRetrait = cible.dataset.retirer;
    if (idModif) {
      const m = messages.find((x) => x.id === idModif);
      if (!m) return;
      editionMessageId = m.id;
      traductionManuelle = true; // ne pas écraser l'anglais existant
      // Restitution COMPLÈTE : textes, cible (gares/train) et expiration
      remplitFormulaireMessage(valeursFormulaireMessage(m));
      $('btn-msg').textContent = 'Enregistrer';
      $('btn-msg-annuler').style.display = '';
      rendreMessages();
      ($('msg-fr') as HTMLInputElement).focus();
    } else if (idRetrait) {
      void provider
        .deleteMessage(idRetrait)
        .then(() => provider.getMessages('le-fayet'))
        .then((liste) => {
          messages = liste;
          if (editionMessageId === idRetrait) annuleEditionMessage();
          bump('message retiré');
          rendreMessages();
        })
        .catch(erreurVersToast);
    }
  });
}

// ---------------------------------------------------------------------------
// Onglet Médias
// ---------------------------------------------------------------------------

function rendreMedias(): void {
  ($('duree-horaires') as HTMLInputElement).value = String(params?.duree_horaires_s ?? 20);
  $('medias').innerHTML = medias
    .map(
      (m) => `
    <div class="media">
      <div class="apercu">${
        m.type === 'video'
          ? `<video src="${echapper(m.url)}" muted playsinline></video>`
          : `<img src="${echapper(m.url)}" alt="" />`
      }</div>
      <div class="infos">
        <div class="nom">${echapper(m.nom)}</div>
        <div class="det">${m.type === 'video' ? 'Vidéo (muette)' : 'Image'}</div>
        <div class="ligne">
          Durée : <input type="number" min="3" max="120" value="${m.duree_s}" data-duree="${m.id}" /> s
          <label class="switch" style="margin-left:auto"><input type="checkbox" ${m.actif ? 'checked' : ''} data-actif="${m.id}" />Actif</label>
          <button class="leger" data-suppr="${m.id}">Retirer</button>
        </div>
        <div class="ligne" style="margin-top:6px">
          Expire :
          <input type="datetime-local" value="${isoVersDatetimeLocal(m.expire_at)}" data-expire="${m.id}" />
          <button class="leger" data-expire-jamais="${m.id}">Jamais</button>
        </div>
        <div class="ligne media-gares" style="margin-top:6px">
          Gares :
          <label><input type="checkbox" data-gare-toutes="${m.id}" ${m.gares?.length ? '' : 'checked'} /> toutes</label>
          ${ORDRE_GARES.map(
            (g) =>
              `<label><input type="checkbox" data-gare="${m.id}" value="${g}" ${
                m.gares?.includes(g) ? 'checked' : ''
              } /> ${echapper(nomDeGare(g))}</label>`,
          ).join('')}
        </div>
      </div>
    </div>`,
    )
    .join('');
}

async function rechargeMedias(): Promise<void> {
  medias = await provider.listMedias();
  rendreMedias();
}

function initMedias(): void {
  /**
   * Enregistre une modification SANS muter l'état local avant l'écriture
   * (une écriture refusée ne doit rien laisser en mémoire, sinon elle
   * pourrait être publiée plus tard silencieusement) et ne re-dessine que
   * lorsque c'est nécessaire.
   */
  const majMedia = (id: string, patch: Partial<Media>, reRendre: boolean): void => {
    const media = medias.find((m) => m.id === id);
    if (!media) return;
    void provider
      .saveMedia({ ...media, ...patch })
      .then(() => {
        Object.assign(media, patch); // aligné SEULEMENT après succès
        bump(`média ${media.nom} mis à jour`);
        if (reRendre) rendreMedias();
      })
      .catch((erreur: unknown) => {
        erreurVersToast(erreur);
        rendreMedias(); // rétablit les valeurs réellement enregistrées
      });
  };

  $('btn-media-ajout').addEventListener('click', () => $('media-fichier').click());
  $('media-fichier').addEventListener('change', () => {
    const fichier = ($('media-fichier') as HTMLInputElement).files?.[0];
    if (!fichier) return;
    if (fichier.size > 20_971_520) {
      toast('Fichier trop lourd : 20 Mo maximum');
      return;
    }
    const type = fichier.type.startsWith('video/') ? 'video' : 'image';
    void provider
      .uploadMedia(fichier, { nom: fichier.name, type, duree_s: 8, gares: null })
      .then(() => rechargeMedias())
      .then(() => {
        bump(`média ajouté : ${fichier.name}`);
        toast('Média ajouté : il entre dans le cycle des écrans');
      })
      .catch(erreurVersToast);
    ($('media-fichier') as HTMLInputElement).value = '';
  });
  $('duree-horaires').addEventListener('change', () => {
    const v = Number(($('duree-horaires') as HTMLInputElement).value) || 20;
    void provider
      .saveParams({ duree_horaires_s: v })
      .then(() => {
        bump(`durée horaires → ${v} s`);
        if (params) params.duree_horaires_s = v;
      })
      .catch(erreurVersToast);
  });
  $('medias').addEventListener('change', (e) => {
    const cible = e.target as HTMLInputElement;
    if (cible.dataset.duree) {
      majMedia(
        cible.dataset.duree,
        { duree_s: Math.min(120, Math.max(3, Number(cible.value) || 8)) },
        false,
      );
    } else if (cible.dataset.actif) {
      majMedia(cible.dataset.actif, { actif: cible.checked }, true);
    } else if (cible.dataset.expire) {
      // Pas de re-render : re-dessiner la carte pendant la saisie d'une date
      // détruirait le champ à la première frappe.
      majMedia(cible.dataset.expire, { expire_at: datetimeLocalVersIso(cible.value) }, false);
    } else if (cible.dataset.gare || cible.dataset.gareToutes) {
      const id = cible.dataset.gare ?? cible.dataset.gareToutes ?? '';
      // « toutes » cochée = aucune gare précise ; sinon les gares cochées
      // (aucune cochée revenant à « toutes », comme à la création).
      const toutes = cible.dataset.gareToutes ? cible.checked : false;
      const cochees = Array.from(
        document.querySelectorAll<HTMLInputElement>(`#medias input[data-gare="${id}"]:checked`),
      ).map((i) => i.value as GareId);
      majMedia(id, { gares: toutes || cochees.length === 0 ? null : cochees }, true);
    }
  });
  $('medias').addEventListener('click', (e) => {
    const cible = e.target as HTMLElement;
    const idJamais = cible.dataset.expireJamais;
    if (idJamais) {
      majMedia(idJamais, { expire_at: null }, true);
      return;
    }
    const id = cible.dataset.suppr;
    if (!id) return;
    const media = medias.find((m) => m.id === id);
    if (!media || !window.confirm(`Retirer le média « ${media.nom} » ?`)) return;
    void provider
      .deleteMedia(id)
      .then(() => rechargeMedias())
      .then(() => bump(`média retiré : ${media.nom}`))
      .catch(erreurVersToast);
  });
}

// ---------------------------------------------------------------------------
// Onglet Écrans
// ---------------------------------------------------------------------------

async function rendreEcrans(): Promise<void> {
  let liste;
  try {
    liste = await provider.listEcrans();
  } catch {
    return;
  }
  const maintenant = Date.now();
  const enLigne = (vu?: string | null): boolean =>
    !!vu && maintenant - new Date(vu).getTime() < 90_000;
  const actifs = liste.filter((e) => enLigne(e.derniere_vue)).length;
  $('pill-ecrans').innerHTML =
    `<span class="dot ${actifs === liste.length ? '' : 'rouge'}"></span> ${actifs}/${liste.length || '—'} écrans en ligne`;
  $('ecrans').innerHTML = liste.length
    ? liste
        .map((e) => {
          const ok = enLigne(e.derniere_vue);
          const vu = e.derniere_vue
            ? `${Math.max(0, Math.round((maintenant - new Date(e.derniere_vue).getTime()) / 1000))} s`
            : '—';
          return `
      <div class="ecran">
        <div class="haut"><span class="dot ${ok ? '' : 'rouge'}"></span>${echapper(nomDeGare(e.gare))} · ${echapper(e.id)}
          <span class="net">${echapper(e.reseau ?? (e.gare === 'nid-daigle' ? '5G · solaire' : 'Fibre'))}</span></div>
        <div class="sub">${echapper(e.type ?? 'écran')} · vu il y a ${vu} · ${echapper(e.version_app ?? '—')}</div>
        <div class="actions">
          <button class="leger" data-recharger="${echapper(e.id)}">⟳ Recharger</button>
          <button class="leger" data-voir="${echapper(e.gare)}" data-type="${echapper(e.type ?? 'ecran')}">Voir</button>
          ${ok ? '' : `<button class="leger" data-oublier="${echapper(e.id)}">Oublier</button>`}
        </div>
      </div>`;
        })
        .join('')
    : '<div class="note">Aucun écran ne s’est encore signalé (heartbeat 30 s).</div>';
}

function initEcrans(): void {
  $('ecrans').addEventListener('click', (e) => {
    const cible = e.target as HTMLElement;
    if (cible.dataset.recharger) {
      void provider
        .demanderRechargement(cible.dataset.recharger)
        .then(() =>
          toast(`L'écran ${cible.dataset.recharger} rechargera sa page au prochain signal de vie`),
        )
        .catch(erreurVersToast);
    } else if (cible.dataset.voir) {
      // La bonne page selon le type, et ?apercu=1 pour ne PAS battre sous
      // l'identifiant du poste réel (sinon sa dernière vue serait faussée et
      // son ordre de rechargement consommé par cet onglet d'aperçu).
      const page = cible.dataset.type === 'grille' ? 'grille.html' : 'ecran.html';
      window.open(`${page}?gare=${cible.dataset.voir}&apercu=1`, '_blank');
    } else if (cible.dataset.oublier) {
      const id = cible.dataset.oublier;
      if (!window.confirm(`Oublier l'écran « ${id} » ? Il réapparaîtra s'il redonne signe de vie.`))
        return;
      void provider
        .oublierEcran(id)
        .then(() => rendreEcrans())
        .then(() => {
          bump(`écran oublié : ${id}`);
          toast(`Écran ${id} retiré de la liste`);
        })
        .catch(erreurVersToast);
    }
  });
}

// ---------------------------------------------------------------------------
// Onglet Paramètres (admin)
// ---------------------------------------------------------------------------

function rendreParametres(): void {
  if (!params) return;
  // Machines
  $('machines').innerHTML = params.machines
    .map(
      (m) => `
    <div class="machine-row" data-nom="${echapper(m.nom)}">
      <input type="color" value="${m.couleur}" data-champ="couleur" title="Couleur de pastille" />
      <input type="color" value="${m.cercle ?? '#ffffff'}" data-champ="cercle" title="Couleur d'anneau (blanc = aucun)" />
      <input type="text" value="${echapper(m.nom)}" data-champ="nom" />
      <label class="switch" style="margin-left:auto"><input type="checkbox" ${m.en_service ? 'checked' : ''} data-champ="en_service" />En service</label>
      <button class="leger" data-champ="retirer">Retirer</button>
    </div>`,
    )
    .join('');
  // Motifs
  $('motifs').innerHTML = params.motifs
    .map(
      (m) =>
        `<span class="motif-chip">${echapper(m.fr)} <small>/ ${echapper(m.en)}</small><button data-motif="${echapper(m.fr)}">×</button></span>`,
    )
    .join('');
  // Utilisateurs
  $('users').innerHTML = utilisateurs
    .map(
      (u) => `
    <div class="user-row" data-user="${echapper(u.user_id)}">
      <b style="width:140px">${echapper(u.nom)}</b>
      <span style="color:var(--sec);font-size:13px;flex:1">${echapper(u.email)}</span>
      <span class="role-tag role-${u.role}">${u.role.toUpperCase()}</span>
      <select data-champ="role">
        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrateur</option>
        <option value="supervision" ${u.role === 'supervision' ? 'selected' : ''}>Supervision</option>
        <option value="caisse" ${u.role === 'caisse' ? 'selected' : ''}>Caisse</option>
      </select>
      <label class="switch"><input type="checkbox" ${u.actif ? 'checked' : ''} data-champ="actif" />Actif</label>
      <button class="leger" data-champ="reset">Réinit. mdp</button>
    </div>`,
    )
    .join('');
  // Saisons
  const aujourdhui = dateISO(0);
  $('saisons').innerHTML =
    grilles
      .map((g) => {
        const enCours = g.periodes.some((p) => aujourdhui >= p.du && aujourdhui <= p.au);
        const periodes = g.periodes
          .map((p) => `${p.du.slice(8)}/${p.du.slice(5, 7)} → ${p.au.slice(8)}/${p.au.slice(5, 7)}`)
          .join(' et ');
        return `<div class="saison"><b>${echapper(g.libelle)}</b><span class="per">${periodes} · ${g.montees.length} montées + ${g.descentes.length} descentes</span><span class="etat" style="${
          enCours ? 'background:var(--ok-bg);color:var(--ok)' : 'background:#EEF2F6;color:#4A6078'
        }">${enCours ? 'EN COURS' : 'PROGRAMMÉ'}</span></div>`;
      })
      .join('') +
    '<div class="saison"><b>Service hiver</b><span class="per">terminus Bellevue permanent (à partir du TRAIN 1) — grille à charger</span><span class="etat" style="background:#FBEEC2;color:#7A6017">À CRÉER</span></div>';
  // Veille + météo
  ($('veille-debut') as HTMLInputElement).value = params.veille_nuit.debut;
  ($('veille-fin') as HTMLInputElement).value = params.veille_nuit.fin;
  ($('meteo-t') as HTMLInputElement).value = String(params.meteo_sommet.t);
  ($('meteo-fr') as HTMLInputElement).value = params.meteo_sommet.ciel_fr;
  ($('meteo-en') as HTMLInputElement).value = params.meteo_sommet.ciel_en;
}

async function rechargeParams(): Promise<void> {
  params = await provider.getParams();
  rendreParametres();
}

function initParametres(): void {
  $('machines').addEventListener('change', (e) => {
    const champ = e.target as HTMLInputElement;
    const rangee = champ.closest('.machine-row') as HTMLElement | null;
    const nomOriginal = rangee?.dataset.nom;
    const machine = params?.machines.find((m) => m.nom === nomOriginal);
    if (!machine || !rangee) return;
    const maj: Machine = { ...machine };
    if (champ.dataset.champ === 'couleur') maj.couleur = champ.value;
    if (champ.dataset.champ === 'cercle')
      maj.cercle =
        champ.value.toLowerCase() === '#ffffff' && machine.cercle == null ? null : champ.value;
    if (champ.dataset.champ === 'en_service') maj.en_service = champ.checked;
    if (champ.dataset.champ === 'nom') maj.nom = champ.value.trim() || machine.nom;
    const promesse =
      maj.nom !== machine.nom
        ? provider.deleteMachine(machine.nom).then(() => provider.saveMachine(maj))
        : provider.saveMachine(maj);
    void promesse
      .then(() => rechargeParams())
      .then(() => bump(`machine ${maj.nom} mise à jour`))
      .catch(erreurVersToast);
  });
  $('machines').addEventListener('click', (e) => {
    const bouton = e.target as HTMLElement;
    if (bouton.dataset.champ !== 'retirer') return;
    const nom = (bouton.closest('.machine-row') as HTMLElement | null)?.dataset.nom;
    if (!nom || !window.confirm(`Retirer la machine « ${nom} » ?`)) return;
    void provider
      .deleteMachine(nom)
      .then(() => rechargeParams())
      .then(() => bump(`machine retirée : ${nom}`))
      .catch(erreurVersToast);
  });
  $('btn-machine-ajout').addEventListener('click', () => {
    const nom = window.prompt('Nom de la nouvelle machine ?');
    if (!nom?.trim()) return;
    void provider
      .saveMachine({ nom: nom.trim(), couleur: '#708DA4', en_service: true })
      .then(() => rechargeParams())
      .then(() => bump(`machine ajoutée : ${nom.trim()}`))
      .catch(erreurVersToast);
  });

  $('btn-motif-ajout').addEventListener('click', () => {
    const fr = ($('nouveau-motif') as HTMLInputElement).value.trim();
    if (!fr) return;
    const en = ($('nouveau-motif-en') as HTMLInputElement).value.trim();
    const enregistre = (texteEn: string): void => {
      void provider
        .saveMotif({ fr, en: texteEn })
        .then(() => rechargeParams())
        .then(() => {
          bump(`motif ajouté : ${fr}`);
          ($('nouveau-motif') as HTMLInputElement).value = '';
          ($('nouveau-motif-en') as HTMLInputElement).value = '';
        })
        .catch(erreurVersToast);
    };
    if (en) enregistre(en);
    else void provider.traduire(fr).then((t) => enregistre(t ?? traductionLocale(fr)));
  });
  $('motifs').addEventListener('click', (e) => {
    const fr = (e.target as HTMLElement).dataset.motif;
    if (!fr) return;
    void provider
      .deleteMotif(fr)
      .then(() => rechargeParams())
      .then(() => bump(`motif retiré : ${fr}`))
      .catch(erreurVersToast);
  });

  $('btn-user-ajout').addEventListener('click', () => {
    const f = $('form-user');
    f.style.display = f.style.display === 'none' ? '' : 'none';
  });
  $('btn-user-inviter').addEventListener('click', () => {
    const nom = ($('user-nouveau-nom') as HTMLInputElement).value.trim();
    const email = ($('user-nouveau-email') as HTMLInputElement).value.trim();
    const r = ($('user-nouveau-role') as HTMLSelectElement).value as Role;
    if (!nom || !email) {
      toast('Nom et email requis');
      return;
    }
    void provider
      .inviteUser(email, nom, r)
      .then(() => provider.listUsers())
      .then((liste) => {
        utilisateurs = liste;
        bump(`utilisateur invité : ${email}`);
        toast(`Invitation envoyée à ${email}`);
        rendreParametres();
      })
      .catch(erreurVersToast);
  });
  $('users').addEventListener('change', (e) => {
    const champ = e.target as HTMLInputElement;
    const id = (champ.closest('.user-row') as HTMLElement | null)?.dataset.user;
    const u = utilisateurs.find((x) => x.user_id === id);
    if (!u) return;
    if (champ.dataset.champ === 'role') u.role = champ.value as Role;
    if (champ.dataset.champ === 'actif') u.actif = champ.checked;
    void provider
      .saveUser(u)
      .then(() => bump(`profil ${u.email} mis à jour`))
      .then(() => rendreParametres())
      .catch(erreurVersToast);
  });
  $('users').addEventListener('click', (e) => {
    const bouton = e.target as HTMLElement;
    if (bouton.dataset.champ !== 'reset') return;
    const id = (bouton.closest('.user-row') as HTMLElement | null)?.dataset.user;
    const u = utilisateurs.find((x) => x.user_id === id);
    if (!u) return;
    void provider
      .resetMotDePasse(u.email)
      .then(() => toast(`Réinitialisation du mot de passe envoyée à ${u.email}`))
      .catch(erreurVersToast);
  });

  const sauveVeille = (): void => {
    void provider
      .saveParams({
        veille_nuit: {
          debut: ($('veille-debut') as HTMLInputElement).value || '21:00',
          fin: ($('veille-fin') as HTMLInputElement).value || '06:00',
        },
      })
      .then(() => bump('veille nuit modifiée'))
      .catch(erreurVersToast);
  };
  $('veille-debut').addEventListener('change', sauveVeille);
  $('veille-fin').addEventListener('change', sauveVeille);
  $('btn-meteo').addEventListener('click', () => {
    void provider
      .saveParams({
        meteo_sommet: {
          t: Number(($('meteo-t') as HTMLInputElement).value) || 0,
          ciel_fr: ($('meteo-fr') as HTMLInputElement).value.trim() || '—',
          ciel_en: ($('meteo-en') as HTMLInputElement).value.trim() || '—',
        },
      })
      .then(() => {
        bump('météo sommet mise à jour');
        toast('Météo sommet mise à jour sur tous les écrans');
      })
      .catch(erreurVersToast);
  });
}

// ---------------------------------------------------------------------------
// Publication
// ---------------------------------------------------------------------------

function initPublication(): void {
  $('btn-apercu').addEventListener('click', () =>
    window.open('ecran.html?gare=saint-gervais', '_blank'),
  );
  $('btn-publier').addEventListener('click', () => {
    const resume =
      modifs > 0
        ? `${modifs} modification(s) : ${journal.slice(-10).join(' · ')}`
        : 'publication sans modification';
    void provider
      .logPublication(resume)
      .then(() => {
        modifs = 0;
        journal.length = 0;
        $('etat-pub').textContent = 'Tout est publié ✓';
        toast('✓ Publié — les 6 gares sont synchronisées · consigné dans l’historique');
      })
      .catch(erreurVersToast);
  });
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

async function demarre(): Promise<void> {
  ($('logo') as HTMLImageElement).src = __LOGO_ROND_BLANC__;
  initOnglets();
  initCirculations();
  initMessages();
  initMedias();
  initEcrans();
  initParametres();
  initPublication();

  $('btn-deconnexion').addEventListener('click', () => {
    sessionStorage.clear();
    window.location.reload();
  });

  // Session déjà ouverte (Supabase persiste, mock via sessionStorage)
  try {
    role = await provider.getRole();
    emailConnecte = sessionStorage.getItem('tmb-email') ?? 'agent connecté';
    if (role === 'admin' || role === 'supervision' || role === 'caisse') {
      utilisateurs = await provider.listUsers().catch(() => []);
      await apresConnexion();
      return;
    }
  } catch {
    // pas de session : formulaire de connexion
  }

  $('form-connexion').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = ($('login-email') as HTMLInputElement).value.trim();
    const mdp = ($('login-mdp') as HTMLInputElement).value;
    $('login-erreur').textContent = '';
    void provider
      .signIn(email, mdp)
      .then(async (session) => {
        emailConnecte = session.email;
        sessionStorage.setItem('tmb-email', session.email);
        role = await provider.getRole();
        utilisateurs = await provider.listUsers().catch(() => []);
        await apresConnexion();
      })
      .catch((erreur: unknown) => {
        $('login-erreur').textContent = String(
          erreur instanceof Error ? erreur.message : 'Connexion refusée',
        );
      });
  });
}

void demarre();
