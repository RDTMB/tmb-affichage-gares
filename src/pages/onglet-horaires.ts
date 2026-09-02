// Onglet Horaires de la supervision : liste des grilles (voir, activer,
// désactiver) et chargement d'un classeur Excel avec aperçu avant validation.
//
// Toute la logique métier vit dans src/core (import-grille, ecarts-grille,
// grilles) et dans src/pages/horaires-onglet.ts (pure, testée) ; ici,
// uniquement le DOM et les appels au fournisseur de données. Le lecteur .xlsx
// (fflate) est chargé À LA DEMANDE, au premier fichier choisi : les écrans de
// gare ne l'embarquent jamais.
//
// Vocabulaire pour l'agent : « grille », « dates de validité », « train » —
// jamais « version », « payload » ni jargon technique. L'identifiant interne
// n'apparaît qu'en petit, sous le nom « référence », pour le journal.
import { decritEcarts, libellePeriodes } from '../core/ecarts-grille';
import { datesDesPeriodes } from '../core/grilles-periodes';
import { formatHeure, heureVersSecondes, serviceActif } from '../core/horaires';
import { nomGare, parseClasseur, type Probleme } from '../core/import-grille';
import { ORDRE_GARES } from '../core/types';
import type { Grille, Role, Sens, TrainGrille } from '../core/types';
import type { DataProvider } from '../data/provider';
import { echapper } from './affichage-commun';
import {
  dateCourte,
  dateLongue,
  ecartsFeuille,
  nouvelleFeuilleImport,
  planValidation,
  raisonsBlocage,
  resumePlan,
  texteActivation,
  texteDesactivation,
  type FeuilleImport,
} from './horaires-onglet';
import { avertissementsGrillePrecedente } from '../core/import-grille';
import { grillePrecedentePour } from './horaires-onglet';

export interface DependancesHoraires {
  provider: DataProvider;
  $: (id: string) => HTMLElement;
  toast: (texte: string) => void;
  erreurVersToast: (erreur: unknown) => void;
  role: () => Role | null;
  /** Après un import ou une (dés)activation : la supervision relit grilles actives et journée. */
  apresChangement: () => Promise<void>;
}

export interface OngletHoraires {
  /** Relit la liste des grilles et la redessine (appelé à chaque rafraîchissement). */
  rendre: () => Promise<void>;
}

interface ImportEnCours {
  nomFichier: string;
  feuilles: FeuilleImport[];
}

interface OptionsTableau {
  /** Cases à cocher facultatif / vélos modifiables (aperçu d'import). */
  editable: boolean;
  /** Clés « sens|numéro|gare|a/d » des heures qui changent par rapport à la grille en service. */
  modifiees?: Set<string>;
  /** Clés « sens|numéro » des trains absents de la grille en service. */
  ajoutes?: Set<string>;
  feuille?: number;
}

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Au-delà, la liste des écarts est tronquée (les heures d'une grille entière peuvent toutes bouger). */
const MAX_ECARTS_AFFICHES = 150;

export function initOngletHoraires(deps: DependancesHoraires): OngletHoraires {
  const { provider, $, toast, erreurVersToast } = deps;
  let grilles: Grille[] = [];
  let importEnCours: ImportEnCours | null = null;

  const peutEcrire = (): boolean => deps.role() === 'admin' || deps.role() === 'supervision';
  const actives = (): Grille[] => grilles.filter((g) => g.actif !== false);
  const aujourdhui = (): string =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());

  // ------------------------------------------------------------------ liste

  function rendreListe(): void {
    const tbody = document.querySelector('#tab-grilles tbody');
    if (!tbody) return;
    $('btn-grille-importer').style.display = peutEcrire() ? '' : 'none';
    const enService = serviceActif(actives(), aujourdhui());
    // Les grilles les plus récentes en haut (celles qu'on vient de charger).
    const triees = [...grilles].sort((a, b) => (b.cree_le ?? '').localeCompare(a.cree_le ?? ''));
    tbody.innerHTML =
      triees.map((g) => ligneGrilleHtml(g, enService)).join('') ||
      '<tr><td colspan="6" style="padding:22px;color:var(--sec);font-weight:700">Aucune grille horaire enregistrée.</td></tr>';
  }

  function ligneGrilleHtml(g: Grille, enService: Grille | null): string {
    const etat =
      g.actif === false
        ? '<span class="etat-grille inactive">Désactivée</span>'
        : enService?.version === g.version
          ? '<span class="etat-grille en-service">En service aujourd’hui</span>'
          : '<span class="etat-grille active">Active</span>';
    const v = echapper(g.version);
    const actions = [`<button class="leger" data-action="voir" data-version="${v}">Voir</button>`];
    if (peutEcrire()) {
      actions.push(
        g.actif === false
          ? `<button class="leger" data-action="activer" data-version="${v}">Réactiver</button>`
          : `<button class="leger danger" data-action="desactiver" data-version="${v}">Désactiver</button>`,
      );
    }
    const chargee = g.cree_le ? dateCourte(g.cree_le.slice(0, 10)) : '—';
    return `<tr class="${g.actif === false ? 'inactif' : ''}">
      <td title="référence ${v}"><b>${echapper(g.libelle)}</b>${g.commentaire ? `<br><small>${echapper(g.commentaire)}</small>` : ''}</td>
      <td>${echapper(libellePeriodes(g.periodes))}</td>
      <td>${g.montees.length} montées · ${g.descentes.length} descentes</td>
      <td>${etat}</td>
      <td>${chargee}<br><small>${echapper(g.cree_par ?? '')}</small></td>
      <td class="actions-grille">${actions.join(' ')}</td>
    </tr>`;
  }

  // ------------------------------------------------------------------- voir

  function rendreVoir(version: string): void {
    const g = grilles.find((x) => x.version === version);
    if (!g) return;
    const carte = $('carte-voir');
    carte.style.display = '';
    carte.innerHTML = `<h2>${echapper(g.libelle)}
        <span class="sous">${echapper(libellePeriodes(g.periodes))} · référence ${echapper(g.version)}</span>
        <div class="actions"><button class="leger" id="btn-voir-fermer">Fermer</button></div>
      </h2>
      <div class="corps-voir">${tableauxGrilleHtml(g, { editable: false })}</div>
      <div class="note">${g.source ? `Provenance : ${echapper(g.source)}. ` : ''}${
        g.cree_par ? `Chargée par ${echapper(g.cree_par)}. ` : ''
      }Les heures sont affichées à la minute ; les secondes du document (au survol) sont conservées pour les calculs.</div>`;
    $('btn-voir-fermer').addEventListener('click', () => {
      carte.style.display = 'none';
      carte.innerHTML = '';
    });
    carte.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ------------------------------------------------------ tableau d'aperçu

  function tableauxGrilleHtml(g: Grille, o: OptionsTableau): string {
    return `<div class="grille-apercu">${tableauSensHtml('montee', g.montees, o)}${tableauSensHtml(
      'descente',
      g.descentes,
      o,
    )}</div>`;
  }

  function tableauSensHtml(sens: Sens, trains: TrainGrille[], o: OptionsTableau): string {
    const titre = sens === 'montee' ? 'Montées' : 'Descentes';
    if (trains.length === 0) return `<h4>${titre}</h4><p class="vide">Aucun train.</p>`;
    const gares = sens === 'montee' ? [...ORDRE_GARES] : [...ORDRE_GARES].reverse();
    const feuille = o.feuille ?? 0;

    const entete = trains
      .map(
        (t) =>
          `<th class="${o.ajoutes?.has(`${sens}|${t.numero}`) ? 'ajoute' : ''}" title="${
            o.ajoutes?.has(`${sens}|${t.numero}`) ? 'Train absent de la grille en service' : ''
          }">TRAIN ${t.numero}${t.express ? '<small>EXPRESS</small>' : ''}</th>`,
      )
      .join('');
    const ligneIndicateur = (champ: 'facultatif' | 'velos', libelle: string): string =>
      `<tr class="indic"><th>${libelle}</th><td></td>${trains
        .map((t) =>
          o.editable
            ? `<td><input type="checkbox" data-champ="${champ}" data-sens="${sens}" data-train="${t.numero}" data-feuille="${feuille}" ${
                t[champ] ? 'checked' : ''
              } title="${libelle} — TRAIN ${t.numero}"></td>`
            : `<td>${t[champ] ? 'oui' : '—'}</td>`,
        )
        .join('')}</tr>`;

    let corps = '';
    for (const gare of gares) {
      if (!trains.some((t) => t.passages.some((p) => p.gare === gare))) continue; // gare hors service (hiver)
      const champs = (['a', 'd'] as const).filter((champ) =>
        trains.some((t) => t.passages.find((p) => p.gare === gare)?.[champ] !== undefined),
      );
      champs.forEach((champ, i) => {
        corps += `<tr>${i === 0 ? `<th rowspan="${champs.length}">${echapper(nomGare(gare))}</th>` : ''}<td class="ad">${
          champ === 'a' ? 'A' : 'D'
        }</td>`;
        for (const t of trains) {
          const p = t.passages.find((x) => x.gare === gare);
          const h = p?.[champ];
          const classes = [
            o.modifiees?.has(`${sens}|${t.numero}|${gare}|${champ}`) ? 'modif' : '',
            p ? '' : 'saute',
          ]
            .filter(Boolean)
            .join(' ');
          const texte = !p ? (t.express ? '|' : '—') : h ? formatHeure(heureVersSecondes(h)) : '';
          corps += `<td class="${classes}"${h ? ` title="${h}"` : ''}>${texte}</td>`;
        }
        corps += '</tr>';
      });
    }
    return `<h4>${titre} <small>${trains.length} trains</small></h4>
      <div class="tabwrap-apercu"><table class="table-apercu">
        <thead><tr><th>Gare</th><th></th>${entete}</tr>${ligneIndicateur('facultatif', 'Facultatif')}${ligneIndicateur('velos', 'Vélos')}</thead>
        <tbody>${corps}</tbody>
      </table></div>`;
  }

  // ----------------------------------------------------------------- import

  async function ouvreFichier(fichier: File): Promise<void> {
    toast('Lecture du fichier…');
    let feuilles: FeuilleImport[];
    try {
      const octets = new Uint8Array(await fichier.arrayBuffer());
      // Import dynamique : fflate et le lecteur ne sont téléchargés qu'ici.
      const { lireClasseur } = await import('../core/lecture-xlsx');
      const resultat = parseClasseur(lireClasseur(octets));
      if (resultat.erreurs.length > 0) {
        afficheRefus(fichier.name, resultat.erreurs);
        return;
      }
      feuilles = resultat.feuilles.map((f) => nouvelleFeuilleImport(f, actives()));
    } catch (erreur) {
      afficheRefus(fichier.name, [
        {
          niveau: 'erreur',
          message: erreur instanceof Error ? erreur.message : String(erreur),
        },
      ]);
      return;
    }
    importEnCours = { nomFichier: fichier.name, feuilles };
    await Promise.all(feuilles.map(chargeJoursExistants));
    rendreImport();
    $('carte-import').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function afficheRefus(nomFichier: string, problemes: Probleme[]): void {
    importEnCours = null;
    const carte = $('carte-import');
    carte.style.display = '';
    carte.innerHTML = `<h2>Fichier refusé : « ${echapper(nomFichier)} »
        <div class="actions"><button class="leger" id="import-annuler">Fermer</button></div></h2>
      <div class="refus-import">Rien n'a été enregistré. ${
        problemes.length > 1 ? 'Raisons :' : 'Raison :'
      }<ul>${problemes.map((p) => `<li>${echapper(p.message)}</li>`).join('')}</ul>
      Le format attendu est décrit dans docs/format-excel-horaires.md (« Charger la grille » dans le guide).</div>`;
  }

  async function chargeJoursExistants(f: FeuilleImport): Promise<void> {
    const valides = f.periodes.filter(
      (p) => DATE_ISO.test(p.du) && DATE_ISO.test(p.au) && p.du <= p.au,
    );
    if (valides.length === 0) {
      f.joursExistants = [];
      f.joursAReinitialiser.clear();
      return;
    }
    const du = valides.map((p) => p.du).sort()[0] ?? '';
    const au =
      valides
        .map((p) => p.au)
        .sort()
        .reverse()[0] ?? '';
    const dans = new Set(datesDesPeriodes(valides));
    try {
      f.joursExistants = (await provider.listJoursGeneres(du, au)).filter((d) => dans.has(d));
    } catch (erreur) {
      erreurVersToast(erreur);
      f.joursExistants = [];
    }
    for (const d of [...f.joursAReinitialiser]) {
      if (!f.joursExistants.includes(d)) f.joursAReinitialiser.delete(d);
    }
  }

  /** Avertissements recalculés après un changement d'indicateur ou de période. */
  function recalculeAvertissements(f: FeuilleImport): void {
    const precedente = f.grille ? grillePrecedentePour(actives(), f.periodes) : null;
    const nouveaux = [
      ...f.resultat.avertissements,
      ...(f.grille && precedente ? avertissementsGrillePrecedente(f.grille, precedente) : []),
    ];
    const memes =
      nouveaux.length === f.avertissements.length &&
      nouveaux.every((p, i) => p.message === f.avertissements[i]?.message);
    if (!memes) f.avertissementsAcquittes = false; // du nouveau à lire
    f.avertissements = nouveaux;
  }

  function rendreImport(): void {
    const carte = $('carte-import');
    if (!importEnCours) {
      carte.style.display = 'none';
      carte.innerHTML = '';
      return;
    }
    carte.style.display = '';
    carte.innerHTML = `<h2>Charger les horaires du fichier « ${echapper(importEnCours.nomFichier)} »
        <span class="sous">vérifiez chaque feuille, complétez les dates, puis validez — rien ne change sur les écrans avant la première date de validité</span>
        <div class="actions"><button class="leger" id="import-annuler">Annuler</button></div>
      </h2>
      ${importEnCours.feuilles.map((f, i) => feuilleHtml(f, i)).join('')}
      <div class="validation-import">
        <ul id="import-raisons"></ul>
        <button class="primaire" id="import-valider" disabled>Enregistrer et mettre en service</button>
      </div>`;
    rendreValidation();
  }

  function feuilleHtml(f: FeuilleImport, i: number): string {
    const r = f.resultat;
    const compte = r.grille
      ? `${r.grille.montees.length} montées · ${r.grille.descentes.length} descentes`
      : 'feuille illisible';
    const entete = `<h3><label class="inclure"><input type="checkbox" data-role="inclure" data-feuille="${i}" ${
      f.inclure ? 'checked' : ''
    }> Charger la feuille « ${echapper(r.nom)} »</label><span class="compte">${compte}</span></h3>`;
    if (!f.inclure)
      return `<section class="feuille-import exclue" data-feuille="${i}">${entete}</section>`;

    const e = ecartsFeuille(f, actives());
    const modifiees = new Set(
      e?.ecarts.heures.map((h) => `${h.sens}|${h.numero}|${h.gare}|${h.champ}`) ?? [],
    );
    const ajoutes = new Set(e?.ecarts.trainsAjoutes.map((t) => `${t.sens}|${t.numero}`) ?? []);
    const lignesEcarts = e ? decritEcarts(e.ecarts) : [];

    const periodes = f.periodes
      .map(
        (p, k) => `<span class="periode">
          <input type="date" data-role="du" data-feuille="${i}" data-periode="${k}" value="${p.du}"> →
          <input type="date" data-role="au" data-feuille="${i}" data-periode="${k}" value="${p.au}">
          <button class="leger" data-role="suppr-periode" data-feuille="${i}" data-periode="${k}" title="Retirer cette période">✕</button>
        </span>`,
      )
      .join('');
    const champs = `<div class="champs-import">
        <label>Nom de la grille
          <input type="text" data-role="libelle" data-feuille="${i}" value="${echapper(f.libelle)}" maxlength="80"></label>
        <div class="periodes-import"><span class="intitule">Dates de validité (du → au, plusieurs périodes possibles)</span>
          ${periodes}
          <span><button class="leger" data-role="ajout-periode" data-feuille="${i}">+ Ajouter une période</button></span>
          <small>${
            r.titre
              ? `Lues dans le titre du fichier : « ${echapper(r.titre)} » — à confirmer.`
              : 'Le titre du fichier ne donne pas de dates lisibles : saisissez-les.'
          }</small>
        </div>
        <label>Commentaire
          <input type="text" data-role="commentaire" data-feuille="${i}" value="${echapper(
            f.commentaire,
          )}" maxlength="200" placeholder="pourquoi cette grille, qui l’a demandée (facultatif)"></label>
      </div>`;

    const erreurs =
      r.erreurs.length > 0
        ? `<div class="problemes erreurs"><b>✖ ${r.erreurs.length} erreur(s) — corrigez le fichier Excel puis rechargez-le :</b>
          <ul>${r.erreurs.map((p) => `<li>${echapper(p.message)}</li>`).join('')}</ul></div>`
        : '';
    const avertissements =
      f.avertissements.length > 0
        ? `<div class="problemes avertissements"><b>⚠ ${f.avertissements.length} avertissement(s) — à lire avant de valider :</b>
          <ul>${f.avertissements.map((p) => `<li>${echapper(p.message)}</li>`).join('')}</ul>
          <label><input type="checkbox" data-role="acquitter" data-feuille="${i}" ${
            f.avertissementsAcquittes ? 'checked' : ''
          }> J’ai lu ces avertissements</label></div>`
        : '';

    let ecartsHtml: string;
    if (!e) {
      ecartsHtml =
        '<b>Aucune grille n’est en service sur ces dates aujourd’hui</b> : rien à comparer, la grille s’appliquera telle quelle.';
    } else if (e.ecarts.aucun && e.ecarts.periodes.identiques) {
      ecartsHtml = `<b>Aucun écart</b> avec la grille « ${echapper(e.precedente.libelle)} », en service sur ces dates.`;
    } else {
      ecartsHtml = `<b>${lignesEcarts.length} écart(s)</b> avec la grille « ${echapper(
        e.precedente.libelle,
      )} », en service sur ces dates (heures modifiées surlignées dans le tableau) :
        <ul>${lignesEcarts
          .slice(0, MAX_ECARTS_AFFICHES)
          .map((l) => `<li>${echapper(l)}</li>`)
          .join('')}${
          lignesEcarts.length > MAX_ECARTS_AFFICHES
            ? `<li>… et ${lignesEcarts.length - MAX_ECARTS_AFFICHES} autres</li>`
            : ''
        }</ul>`;
    }

    const jours =
      f.joursExistants.length === 0
        ? 'Aucune journée n’a encore été préparée sur ces dates.'
        : `<b>${f.joursExistants.length} journée(s) déjà préparée(s)</b> sur ces dates, peut-être retouchée(s) à la main. Cochez celles à <b>réinitialiser depuis la nouvelle grille</b> ; les autres sont conservées telles quelles.
          <div class="jours">${f.joursExistants
            .map(
              (d) =>
                `<label><input type="checkbox" data-role="jour" data-feuille="${i}" data-date="${d}" ${
                  f.joursAReinitialiser.has(d) ? 'checked' : ''
                }> ${dateLongue(d)}</label>`,
            )
            .join('')}</div>`;

    return `<section class="feuille-import" data-feuille="${i}">
      ${entete}
      ${champs}
      ${erreurs}
      ${avertissements}
      <div class="ecarts">${ecartsHtml}</div>
      <div class="jours-existants">${jours}</div>
      ${f.grille ? tableauxGrilleHtml(f.grille, { editable: true, modifiees, ajoutes, feuille: i }) : ''}
    </section>`;
  }

  function rendreValidation(): void {
    if (!importEnCours) return;
    const raisons = raisonsBlocage(importEnCours.feuilles);
    $('import-raisons').innerHTML =
      raisons.length > 0
        ? raisons.map((r) => `<li>${echapper(r)}</li>`).join('')
        : '<li class="ok">✓ Tout est prêt : la grille peut être enregistrée.</li>';
    ($('import-valider') as HTMLButtonElement).disabled = raisons.length > 0;
  }

  function feuilleDe(element: HTMLElement): FeuilleImport | null {
    const index = Number(element.dataset.feuille);
    return importEnCours?.feuilles[index] ?? null;
  }

  async function valider(): Promise<void> {
    if (!importEnCours) return;
    const plans = planValidation(
      importEnCours.feuilles,
      importEnCours.nomFichier,
      actives(),
      grilles.map((g) => g.version),
    );
    const question = [
      'Enregistrer et mettre en service :',
      '',
      ...plans.map((p) => `• ${resumePlan(p)}`),
      '',
      'Rien ne change sur les écrans avant la première date de validité de chaque grille.',
    ].join('\n');
    if (!window.confirm(question)) return;

    ($('import-valider') as HTMLButtonElement).disabled = true;
    const faits: string[] = [];
    try {
      for (const plan of plans) {
        await provider.saveGrille(plan.grille, { actif: true, commentaire: plan.commentaire });
        for (const g of plan.aDesactiver) await provider.setGrilleActive(g.version, false);
        for (const date of plan.joursAReinitialiser) await provider.reinitialiseJour(date);
        const resume = resumePlan(plan);
        faits.push(resume);
        await provider.logPublication(resume).catch(erreurVersToast);
      }
    } catch (erreur) {
      erreurVersToast(erreur);
    }
    importEnCours = null;
    rendreImport();
    const recap = $('horaires-recap');
    if (faits.length > 0) {
      recap.style.display = '';
      recap.innerHTML = `✓ ${faits.length} grille(s) enregistrée(s) :<ul>${faits
        .map((f) => `<li>${echapper(f)}</li>`)
        .join('')}</ul>`;
      toast(`✓ ${faits.length} grille(s) enregistrée(s) · consigné dans l’historique`);
    } else {
      toast('⚠ Aucune grille enregistrée');
    }
    await deps.apresChangement().catch(erreurVersToast);
  }

  async function bascule(version: string, actif: boolean): Promise<void> {
    const g = grilles.find((x) => x.version === version);
    if (!g) return;
    const texte = actif ? texteActivation(grilles, version) : texteDesactivation(grilles, version);
    if (!window.confirm(texte)) return;
    try {
      await provider.setGrilleActive(version, actif);
      await provider
        .logPublication(
          `Grille « ${g.libelle} » ${actif ? 'réactivée' : 'désactivée'} (référence ${version}) : ${libellePeriodes(g.periodes)}`,
        )
        .catch(erreurVersToast);
      toast(actif ? `✓ Grille « ${g.libelle} » réactivée` : `✓ Grille « ${g.libelle} » désactivée`);
      await deps.apresChangement();
    } catch (erreur) {
      erreurVersToast(erreur);
    }
  }

  // ---------------------------------------------------------- événements

  $('btn-grille-importer').addEventListener('click', () => $('grille-fichier').click());
  $('grille-fichier').addEventListener('change', () => {
    const entree = $('grille-fichier') as HTMLInputElement;
    const fichier = entree.files?.[0];
    entree.value = '';
    if (!fichier) return;
    if (!peutEcrire()) {
      toast('Le chargement d’une grille est réservé à la supervision et à l’administrateur');
      return;
    }
    void ouvreFichier(fichier).catch(erreurVersToast);
  });

  $('tab-grilles').addEventListener('click', (e) => {
    const bouton = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!bouton) return;
    const version = bouton.dataset.version ?? '';
    if (bouton.dataset.action === 'voir') rendreVoir(version);
    if (bouton.dataset.action === 'activer') void bascule(version, true);
    if (bouton.dataset.action === 'desactiver') void bascule(version, false);
  });

  $('horaires-recap').addEventListener('click', () => {
    $('horaires-recap').style.display = 'none';
  });

  const carteImport = $('carte-import');
  carteImport.addEventListener('click', (e) => {
    const cible = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!cible) return;
    if (cible.id === 'import-annuler') {
      importEnCours = null;
      rendreImport();
      return;
    }
    if (cible.id === 'import-valider') {
      void valider();
      return;
    }
    const f = feuilleDe(cible);
    if (!f) return;
    if (cible.dataset.role === 'ajout-periode') {
      f.periodes.push({ du: '', au: '' });
      rendreImport();
    }
    if (cible.dataset.role === 'suppr-periode') {
      f.periodes.splice(Number(cible.dataset.periode), 1);
      void chargeJoursExistants(f).then(() => {
        recalculeAvertissements(f);
        rendreImport();
      });
    }
  });
  carteImport.addEventListener('input', (e) => {
    const champ = e.target as HTMLInputElement;
    const f = feuilleDe(champ);
    if (!f) return;
    if (champ.dataset.role === 'libelle') f.libelle = champ.value;
    if (champ.dataset.role === 'commentaire') f.commentaire = champ.value;
    if (champ.dataset.role === 'libelle' || champ.dataset.role === 'commentaire')
      rendreValidation();
  });
  carteImport.addEventListener('change', (e) => {
    const champ = e.target as HTMLInputElement;
    const f = feuilleDe(champ);
    if (!f) return;
    const role = champ.dataset.role;
    if (role === 'inclure') {
      f.inclure = champ.checked;
      rendreImport();
    } else if (role === 'acquitter') {
      f.avertissementsAcquittes = champ.checked;
      rendreValidation();
    } else if (role === 'jour') {
      if (champ.checked) f.joursAReinitialiser.add(champ.dataset.date ?? '');
      else f.joursAReinitialiser.delete(champ.dataset.date ?? '');
    } else if (role === 'du' || role === 'au') {
      const periode = f.periodes[Number(champ.dataset.periode)];
      if (periode) periode[role] = champ.value;
      // Les dates changent la grille de comparaison et les journées concernées.
      void chargeJoursExistants(f).then(() => {
        recalculeAvertissements(f);
        rendreImport();
      });
    } else if (champ.dataset.champ === 'facultatif' || champ.dataset.champ === 'velos') {
      const liste = champ.dataset.sens === 'montee' ? f.grille?.montees : f.grille?.descentes;
      const train = liste?.find((t) => t.numero === Number(champ.dataset.train));
      if (train) {
        train[champ.dataset.champ] = champ.checked;
        recalculeAvertissements(f);
        rendreImport(); // écarts et avertissements suivent
      }
    }
  });

  return {
    async rendre() {
      grilles = await provider.listGrilles();
      rendreListe();
    },
  };
}
