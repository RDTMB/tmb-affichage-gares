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
import type { EcartsGrilles, Indicateur } from '../core/ecarts-grille';
import {
  ajouteRotation,
  numeroMonteeSuivant,
  poseHeure,
  poseIndicateur,
  retireNidDaigle,
  seTermineABellevue,
  supprimeRotation,
  validationEdition,
} from '../core/edition-grille';
import {
  datesDesPeriodes,
  effetChangementPeriodes,
  type EffetPeriodes,
} from '../core/grilles-periodes';
import { formatHeure, heureVersSecondes, serviceActif } from '../core/horaires';
import { nomGare, parseClasseur, type Probleme } from '../core/import-grille';
import { ORDRE_GARES } from '../core/types';
import type { GareId, Grille, Role, Sens, TrainGrille } from '../core/types';
import { aLeDroit } from '../core/roles';
import type { DataProvider } from '../data/provider';
import { echapper } from './affichage-commun';
import {
  dateCourte,
  dateLongue,
  datesGagnees,
  ecartsFeuille,
  lignesEffetPeriodes,
  nouvelleEdition,
  nouvelleFeuilleImport,
  periodesValides,
  planValidation,
  raisonsBlocage,
  raisonsBlocageEdition,
  resumeEdition,
  resumePlan,
  texteActivation,
  texteDesactivation,
  type EditionGrille,
  type FeuilleImport,
} from './horaires-onglet';
import { avertissementsGrillePrecedente } from '../core/import-grille';
import { grillePrecedentePour } from './horaires-onglet';
import {
  cleCellule,
  ecartsCorrection,
  effetNouvelleGrille,
  grilleAEnregistrerCorrection,
  nouvelleCorrection,
  nouvelleDuplication,
  periodesRetenues,
  raisonsBlocageCorrection,
  resumeCorrection,
  type CorrectionEnCours,
  type ModeCorrection,
  type SaisieRefusee,
} from './correction-grille';

export interface DependancesHoraires {
  provider: DataProvider;
  $: (id: string) => HTMLElement;
  toast: (texte: string) => void;
  erreurVersToast: (erreur: unknown) => void;
  /** Rôles CUMULABLES de l'agent connecté (src/core/roles.ts). */
  roles: () => Role[];
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
  /**
   * CORRECTION : les heures deviennent saisissables dans le tableau lui-même,
   * l'express s'y coche, et chaque rotation porte son bouton de suppression.
   * Le tableau reste celui du document d'exploitation — c'est le point : un
   * agent corrige la case qu'il lit, à l'endroit où il la lit.
   */
  correction?: boolean;
  /** Clés « sens|numéro|gare|a/d » des heures qui changent par rapport à la grille en service. */
  modifiees?: Set<string>;
  /** Clés « sens|numéro » des trains absents de la grille en service. */
  ajoutes?: Set<string>;
  feuille?: number;
  /** Messages du validateur rattachés à une cellule, par « numéro|gare ». */
  erreursGare?: Map<string, string[]>;
  /** Messages du validateur rattachés à un train entier, par numéro. */
  erreursTrain?: Map<number, string[]>;
  /** Saisies REFUSÉES (texte qui n'est pas une heure), par « sens|numéro|gare|a/d ». */
  refus?: Map<string, SaisieRefusee>;
}

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Au-delà, la liste des écarts est tronquée (les heures d'une grille entière peuvent toutes bouger). */
const MAX_ECARTS_AFFICHES = 150;

export function initOngletHoraires(deps: DependancesHoraires): OngletHoraires {
  const { provider, $, toast, erreurVersToast } = deps;
  let grilles: Grille[] = [];
  let importEnCours: ImportEnCours | null = null;
  /** Fiche « Modifier » ouverte : la grille telle qu'enregistrée, et la saisie. */
  let editionEnCours: { grille: Grille; edition: EditionGrille } | null = null;
  /** Carte « Corriger » ou « Dupliquer » ouverte : le contenu en cours de saisie. */
  let correctionEnCours: CorrectionEnCours | null = null;

  // Les grilles sont PARTAGÉES : le prestataire informatique les charge, mais
  // l'exploitation aussi — un horaire corrigé un matin de service ne doit pas
  // attendre. Seule la caisse en reste à la lecture.
  const peutEcrire = (): boolean => aLeDroit(deps.roles(), 'grilles');
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
        `<button class="leger" data-action="modifier" data-version="${v}" title="Nom, dates de validité, commentaire">Modifier</button>`,
      );
      actions.push(
        `<button class="leger" data-action="corriger" data-version="${v}" title="Corriger les heures, les trains, les indicateurs — crée une nouvelle version">Corriger</button>`,
      );
      actions.push(
        `<button class="leger" data-action="dupliquer" data-version="${v}" title="Créer une nouvelle grille à partir de celle-ci">Dupliquer</button>`,
      );
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
        <div class="actions">${
          peutEcrire()
            ? `<button class="principal leger" id="btn-voir-corriger" data-version="${echapper(g.version)}">Corriger cette grille</button>`
            : ''
        }<button class="leger" id="btn-voir-fermer">Fermer</button></div>
      </h2>
      <div class="corps-voir">${tableauxGrilleHtml(g, { editable: false })}</div>
      <div class="note">${g.source ? `Provenance : ${echapper(g.source)}. ` : ''}${
        g.cree_par ? `Chargée par ${echapper(g.cree_par)}. ` : ''
      }Les heures sont affichées à la minute ; les secondes du document (au survol) sont conservées pour les calculs.</div>`;
    $('btn-voir-fermer').addEventListener('click', () => {
      carte.style.display = 'none';
      carte.innerHTML = '';
    });
    if (peutEcrire()) {
      $('btn-voir-corriger').addEventListener('click', () => {
        carte.style.display = 'none';
        carte.innerHTML = '';
        void ouvreCorrection(version, 'correction').catch(erreurVersToast);
      });
    }
    carte.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // --------------------------------------------------------------- modifier

  async function ouvreEdition(version: string): Promise<void> {
    const g = grilles.find((x) => x.version === version);
    if (!g || !peutEcrire()) return;
    editionEnCours = { grille: g, edition: nouvelleEdition(g) };
    await chargeJoursEdition();
    rendreEdition();
    $('carte-editer').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Effet des dates saisies (seules les périodes complètes comptent). */
  function effetEdition(): EffetPeriodes | null {
    if (!editionEnCours) return null;
    return effetChangementPeriodes(
      grilles,
      editionEnCours.grille.version,
      periodesValides(editionEnCours.edition.periodes),
    );
  }

  /** Journées déjà préparées dans les dates GAGNÉES : les seules que la modification peut concerner. */
  async function chargeJoursEdition(): Promise<void> {
    if (!editionEnCours) return;
    const e = editionEnCours.edition;
    const effet = effetEdition();
    const gagnees = effet ? datesGagnees(effet) : [];
    if (gagnees.length === 0) {
      e.joursExistants = [];
      e.joursAReinitialiser.clear();
      return;
    }
    const dans = new Set(gagnees);
    try {
      e.joursExistants = (
        await provider.listJoursGeneres(gagnees[0] ?? '', gagnees[gagnees.length - 1] ?? '')
      ).filter((d) => dans.has(d));
    } catch (erreur) {
      erreurVersToast(erreur);
      e.joursExistants = [];
    }
    for (const d of [...e.joursAReinitialiser]) {
      if (!e.joursExistants.includes(d)) e.joursAReinitialiser.delete(d);
    }
  }

  function rendreEdition(): void {
    const carte = $('carte-editer');
    if (!editionEnCours) {
      carte.style.display = 'none';
      carte.innerHTML = '';
      return;
    }
    const { grille: g, edition: e } = editionEnCours;
    carte.style.display = '';
    const periodes = e.periodes
      .map(
        (p, k) => `<span class="periode">
          <input type="date" data-role="du" data-periode="${k}" value="${echapper(p.du)}"> →
          <input type="date" data-role="au" data-periode="${k}" value="${echapper(p.au)}">
          <button class="leger" data-role="suppr-periode" data-periode="${k}" title="Retirer cette période">✕</button>
        </span>`,
      )
      .join('');
    const effet = effetEdition();
    const lignes = effet ? lignesEffetPeriodes(g, effet) : [];
    const jours =
      e.joursExistants.length === 0
        ? ''
        : `<div class="jours-existants"><b>${e.joursExistants.length} journée(s) déjà préparée(s)</b> sur les dates ajoutées, peut-être retouchée(s) à la main. Cochez celles à <b>réinitialiser depuis cette grille</b> ; les autres sont conservées telles quelles.
          <div class="jours">${e.joursExistants
            .map(
              (d) =>
                `<label><input type="checkbox" data-role="jour" data-date="${d}" ${
                  e.joursAReinitialiser.has(d) ? 'checked' : ''
                }> ${dateLongue(d)}</label>`,
            )
            .join('')}</div></div>`;
    carte.innerHTML = `<h2>Modifier la grille « ${echapper(g.libelle)} »
        <span class="sous">nom, dates de validité et commentaire — les heures et les trains ne se modifient pas ici</span>
        <div class="actions"><button class="leger" id="edition-fermer">Fermer</button></div>
      </h2>
      <div class="corps-edition">
        <div class="champs-import">
          <label>Nom de la grille
            <input type="text" data-role="libelle" value="${echapper(e.libelle)}" maxlength="80"></label>
          <div class="periodes-import"><span class="intitule">Dates de validité (du → au, plusieurs périodes possibles)</span>
            ${periodes}
            <span><button class="leger" data-role="ajout-periode">+ Ajouter une période</button></span>
          </div>
          <label>Commentaire
            <input type="text" data-role="commentaire" value="${echapper(e.commentaire)}" maxlength="200" placeholder="pourquoi cette modification (facultatif)"></label>
        </div>
        <div class="effet-periodes"><b>Effet des dates saisies :</b>
          <ul>${lignes.map((l) => `<li class="${l.niveau}">${echapper(l.texte)}</li>`).join('')}</ul>
        </div>
        ${jours}
        <div class="note">Une grille décrit le service théorique : la modifier ne change aucune journée déjà préparée, sauf celles cochées ci-dessus. <b>Pour modifier les trains d’aujourd’hui, utilisez l’onglet Circulations.</b></div>
        <div class="validation-import">
          <ul id="edition-raisons"></ul>
          <button class="principal" id="edition-enregistrer" disabled>Enregistrer les modifications</button>
        </div>
      </div>`;
    rendreValidationEdition();
  }

  function rendreValidationEdition(): void {
    if (!editionEnCours) return;
    const raisons = raisonsBlocageEdition(editionEnCours.grille, editionEnCours.edition);
    $('edition-raisons').innerHTML =
      raisons.length > 0
        ? raisons.map((r) => `<li>${echapper(r)}</li>`).join('')
        : '<li class="ok">✓ Prêt à enregistrer.</li>';
    ($('edition-enregistrer') as HTMLButtonElement).disabled = raisons.length > 0;
  }

  async function enregistreEdition(): Promise<void> {
    if (!editionEnCours) return;
    const { grille: g, edition: e } = editionEnCours;
    const effet = effetEdition();
    const resume = resumeEdition(g, e);
    const question = [
      'Enregistrer les modifications ?',
      '',
      `• ${resume}`,
      '',
      ...(effet ? lignesEffetPeriodes(g, effet).map((l) => `• ${l.texte}`) : []),
      '',
      'Les écrans suivent en quelques secondes.',
    ].join('\n');
    if (!window.confirm(question)) return;
    ($('edition-enregistrer') as HTMLButtonElement).disabled = true;
    try {
      await provider.updateGrilleMetadonnees(g.version, {
        libelle: e.libelle.trim(),
        periodes: periodesValides(e.periodes),
        commentaire: e.commentaire.trim() || null,
      });
      for (const date of [...e.joursAReinitialiser].sort()) await provider.reinitialiseJour(date);
      await provider.logPublication(resume).catch(erreurVersToast);
      editionEnCours = null;
      rendreEdition();
      const recap = $('horaires-recap');
      recap.style.display = '';
      recap.innerHTML = `✓ ${echapper(resume)}`;
      toast('✓ Grille modifiée · consigné dans l’historique');
      await deps.apresChangement();
    } catch (erreur) {
      erreurVersToast(erreur);
      rendreValidationEdition();
    }
  }

  // -------------------------------------------------------------- corriger

  /**
   * FORME RETENUE : le tableau du document, éditable en place, dans une carte
   * pleine largeur de l'onglet — ni fenêtre modale, ni panneau latéral.
   * L'agent qui corrige une heure fausse un matin de perturbation a le
   * document sous les yeux ; il clique la case qu'il lit et tape l'heure.
   * Une fenêtre modale l'aurait coupé du reste de la supervision (la journée
   * en cours, les circulations) alors que c'est précisément ce qu'il consulte
   * en même temps, et un panneau latéral aurait rétréci un tableau qui fait
   * déjà dix colonnes.
   */
  async function ouvreCorrection(version: string, mode: ModeCorrection): Promise<void> {
    const g = grilles.find((x) => x.version === version);
    if (!g || !peutEcrire()) return;
    correctionEnCours = mode === 'correction' ? nouvelleCorrection(g) : nouvelleDuplication(g);
    await chargeJoursCorrection();
    rendreCorrection();
    $('carte-corriger').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Journées déjà préparées sur les dates concernées. Une correction porte
   * sur les dates de la grille d'origine ; une duplication sur celles qu'on
   * vient de saisir. Dans les deux cas elles sont DÉCOCHÉES : une grille
   * décrit le service théorique, et modifier le théorique ne réécrit pas ce
   * qu'un agent a retouché à la main pour un jour précis.
   */
  async function chargeJoursCorrection(): Promise<void> {
    const c = correctionEnCours;
    if (!c) return;
    const dates = datesDesPeriodes(periodesRetenues(c));
    if (dates.length === 0) {
      c.joursExistants = [];
      c.joursAReinitialiser.clear();
      return;
    }
    const dans = new Set(dates);
    try {
      c.joursExistants = (
        await provider.listJoursGeneres(dates[0] ?? '', dates[dates.length - 1] ?? '')
      ).filter((d) => dans.has(d));
    } catch (erreur) {
      erreurVersToast(erreur);
      c.joursExistants = [];
    }
    for (const d of [...c.joursAReinitialiser]) {
      if (!c.joursExistants.includes(d)) c.joursAReinitialiser.delete(d);
    }
  }

  /** Erreurs du validateur rangées par train et par cellule, pour les poser sous elles. */
  function erreursParCible(problemes: Probleme[]): {
    parGare: Map<string, string[]>;
    parTrain: Map<number, string[]>;
    generales: string[];
  } {
    const parGare = new Map<string, string[]>();
    const parTrain = new Map<number, string[]>();
    const generales: string[] = [];
    for (const p of problemes) {
      if (p.train !== undefined && p.gare !== undefined) {
        const cle = `${p.train}|${p.gare}`;
        parGare.set(cle, [...(parGare.get(cle) ?? []), p.message]);
      } else if (p.train !== undefined) {
        parTrain.set(p.train, [...(parTrain.get(p.train) ?? []), p.message]);
      } else {
        generales.push(p.message);
      }
    }
    return { parGare, parTrain, generales };
  }

  function rendreCorrection(): void {
    const carte = $('carte-corriger');
    const c = correctionEnCours;
    if (!c) {
      carte.style.display = 'none';
      carte.innerHTML = '';
      return;
    }
    carte.style.display = '';
    const duplication = c.mode === 'duplication';
    const v = validationEdition(c.grille);
    const { parGare, parTrain, generales } = erreursParCible(v.erreurs);
    const e = ecartsCorrection(c);
    const modifiees = new Set(e.heures.map((h) => `${h.sens}|${h.numero}|${h.gare}|${h.champ}`));
    const ajoutes = new Set(e.trainsAjoutes.map((t) => `${t.sens}|${t.numero}`));
    const options: OptionsTableau = {
      editable: false,
      correction: true,
      modifiees,
      ajoutes,
      erreursGare: parGare,
      erreursTrain: parTrain,
      refus: c.erreursCellules,
    };

    const identite = duplication
      ? `<div class="champs-import">
          <label>Nom de la nouvelle grille
            <input type="text" data-role="libelle" value="${echapper(c.libelle)}" maxlength="80" placeholder="Hiver 2026-2027"></label>
          <div class="periodes-import"><span class="intitule">Dates de validité (du → au, plusieurs périodes possibles)</span>
            ${c.periodes
              .map(
                (p, k) => `<span class="periode">
                  <input type="date" data-role="du" data-periode="${k}" value="${echapper(p.du)}"> →
                  <input type="date" data-role="au" data-periode="${k}" value="${echapper(p.au)}">
                  <button class="leger" data-role="suppr-periode" data-periode="${k}" title="Retirer cette période">✕</button>
                </span>`,
              )
              .join('')}
            <span><button class="leger" data-role="ajout-periode">+ Ajouter une période</button></span>
          </div>
          <label>Commentaire
            <input type="text" data-role="commentaire" value="${echapper(c.commentaire)}" maxlength="200" placeholder="pourquoi cette grille (facultatif)"></label>
        </div>`
      : `<div class="champs-import">
          <label>Commentaire
            <input type="text" data-role="commentaire" value="${echapper(c.commentaire)}" maxlength="200" placeholder="pourquoi cette correction (facultatif)"></label>
        </div>`;

    const avertissements =
      v.avertissements.length > 0
        ? `<div class="problemes avertissements"><b>⚠ ${v.avertissements.length} avertissement(s) — à lire avant d’enregistrer :</b>
          <ul>${v.avertissements.map((p) => `<li>${echapper(p.message)}</li>`).join('')}</ul>
          <label><input type="checkbox" data-role="acquitter" ${
            c.avertissementsAcquittes ? 'checked' : ''
          }> J’ai lu ces avertissements</label></div>`
        : '';
    const erreursGenerales =
      generales.length > 0
        ? `<div class="problemes erreurs"><b>✖ ${generales.length} erreur(s) à corriger :</b>
          <ul>${generales.map((m) => `<li>${echapper(m)}</li>`).join('')}</ul></div>`
        : '';

    const jours =
      c.joursExistants.length === 0
        ? 'Aucune journée n’a encore été préparée sur ces dates.'
        : `<b>${c.joursExistants.length} journée(s) déjà préparée(s)</b> sur ces dates, peut-être retouchée(s) à la main. Cochez celles à <b>réinitialiser depuis la grille corrigée</b> ; les autres sont conservées telles quelles.
          <div class="jours">${c.joursExistants
            .map(
              (d) =>
                `<label><input type="checkbox" data-role="jour" data-date="${d}" ${
                  c.joursAReinitialiser.has(d) ? 'checked' : ''
                }> ${dateLongue(d)}</label>`,
            )
            .join('')}</div>`;

    const outils = `<div class="outils-correction">
        <button class="leger" data-role="ajout-rotation">+ Ajouter une rotation</button>
        ${
          seTermineABellevue(c.grille)
            ? '<span class="note-outil">Cette grille s’arrête à Bellevue : aucun train ne monte au Nid d’Aigle.</span>'
            : '<button class="leger" data-role="retirer-nid">Retirer le Nid d’Aigle (grille d’hiver)</button>'
        }
      </div>`;

    carte.innerHTML = `<h2>${
      duplication
        ? `Nouvelle grille à partir de « ${echapper(c.origine.libelle)} »`
        : `Corriger la grille « ${echapper(c.origine.libelle)} »`
    }
        <span class="sous">${
          duplication
            ? 'le contenu est copié ; donnez un nom et des dates, puis ajustez les trains'
            : `${echapper(libellePeriodes(c.origine.periodes))} · enregistrer crée une nouvelle version qui remplace celle-ci, réactivable à tout moment`
        }</span>
        <div class="actions"><button class="leger" id="correction-fermer">Fermer sans enregistrer</button></div>
      </h2>
      <div class="corps-correction">
        ${identite}
        ${outils}
        ${erreursGenerales}
        ${avertissements}
        <div class="ecarts">${blocEcartsHtml(c.origine.libelle, e, duplication)}</div>
        <div class="jours-existants">${jours}</div>
        ${tableauxGrilleHtml(c.grille, options)}
        <div class="note">Une grille décrit le service théorique : la corriger ne change aucune journée déjà préparée, sauf celles cochées ci-dessus. <b>Pour modifier les trains d’aujourd’hui, utilisez l’onglet Circulations.</b></div>
        <div class="validation-import">
          <ul id="correction-raisons"></ul>
          <button class="principal" id="correction-enregistrer" disabled>${
            duplication ? 'Enregistrer la nouvelle grille' : 'Enregistrer la correction'
          }</button>
        </div>
      </div>`;
    rendreValidationCorrection();
  }

  function rendreValidationCorrection(): void {
    if (!correctionEnCours) return;
    const raisons = raisonsBlocageCorrection(correctionEnCours);
    $('correction-raisons').innerHTML =
      raisons.length > 0
        ? raisons.map((r) => `<li>${echapper(r)}</li>`).join('')
        : '<li class="ok">✓ Prêt à enregistrer.</li>';
    ($('correction-enregistrer') as HTMLButtonElement).disabled = raisons.length > 0;
  }

  /** Un geste sur le contenu : on remplace la grille saisie et on redessine tout. */
  function appliqueGeste(nouvelle: Grille): void {
    if (!correctionEnCours) return;
    correctionEnCours.grille = nouvelle;
    rendreCorrection();
  }

  async function enregistreCorrection(): Promise<void> {
    const c = correctionEnCours;
    if (!c) return;
    const duplication = c.mode === 'duplication';
    let aEnregistrer: Grille;
    try {
      aEnregistrer = grilleAEnregistrerCorrection(
        c,
        grilles.map((g) => g.version),
      );
    } catch (erreur) {
      erreurVersToast(erreur);
      return;
    }
    const resume = resumeCorrection(c, aEnregistrer);
    const effet = duplication
      ? lignesEffetPeriodes(
          aEnregistrer,
          effetNouvelleGrille(grilles, aEnregistrer, new Date().toISOString()),
        ).map((l) => `• ${l.texte}`)
      : [
          `• Les écrans appliqueront la version corrigée sur ${libellePeriodes(aEnregistrer.periodes)}.`,
          `• La version précédente est désactivée : la réactiver suffit à revenir en arrière.`,
        ];
    const question = [
      duplication ? 'Enregistrer la nouvelle grille ?' : 'Enregistrer la correction ?',
      '',
      `• ${resume}`,
      '',
      ...effet,
      '',
      'Les écrans suivent en quelques secondes.',
    ].join('\n');
    if (!window.confirm(question)) return;

    ($('correction-enregistrer') as HTMLButtonElement).disabled = true;
    try {
      await provider.saveGrille(aEnregistrer, {
        actif: true,
        commentaire: c.commentaire.trim() || null,
      });
      // La version d'origine n'est jamais réécrite : elle est désactivée, donc
      // réactivable — c'est tout le retour arrière.
      if (!duplication) await provider.setGrilleActive(c.origine.version, false);
      for (const date of [...c.joursAReinitialiser].sort()) await provider.reinitialiseJour(date);
      await provider.logPublication(resume).catch(erreurVersToast);
      correctionEnCours = null;
      rendreCorrection();
      const recap = $('horaires-recap');
      recap.style.display = '';
      recap.innerHTML = `✓ ${echapper(resume)}`;
      toast(
        duplication
          ? '✓ Nouvelle grille enregistrée · consigné dans l’historique'
          : '✓ Grille corrigée · consigné dans l’historique',
      );
      await deps.apresChangement();
    } catch (erreur) {
      erreurVersToast(erreur);
      rendreValidationCorrection();
    }
  }

  // ------------------------------------------------------ tableau d'aperçu

  /**
   * Aperçu des écarts — LE MÊME composant pour l'import et pour la
   * correction : deux façons de dire « qu'est-ce qui change ? » auraient fini
   * par ne plus dire la même chose.
   */
  function blocEcartsHtml(nomReference: string, e: EcartsGrilles, duplication: boolean): string {
    const depuis = duplication
      ? `la grille copiée « ${echapper(nomReference)} »`
      : `la version enregistrée de « ${echapper(nomReference)} »`;
    if (e.aucun) return `<b>Aucun écart</b> avec ${depuis}.`;
    const lignes = decritEcarts({ ...e, periodes: { ...e.periodes, identiques: true } });
    return `<b>${lignes.length} écart(s)</b> avec ${depuis} (heures modifiées surlignées dans le tableau) :
      <ul>${lignes
        .slice(0, MAX_ECARTS_AFFICHES)
        .map((l) => `<li>${echapper(l)}</li>`)
        .join('')}${
        lignes.length > MAX_ECARTS_AFFICHES
          ? `<li>… et ${lignes.length - MAX_ECARTS_AFFICHES} autres</li>`
          : ''
      }</ul>`;
  }

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
      .map((t) => {
        const messages = o.erreursTrain?.get(t.numero) ?? [];
        const retirer =
          o.correction && sens === 'montee'
            ? `<button class="leger danger" data-role="suppr-rotation" data-train="${t.numero}" title="Retirer la rotation TRAIN ${t.numero} / TRAIN ${t.numero + 1}">✕</button>`
            : '';
        return `<th class="${[o.ajoutes?.has(`${sens}|${t.numero}`) ? 'ajoute' : '', messages.length > 0 ? 'en-erreur' : ''].filter(Boolean).join(' ')}" title="${
          o.ajoutes?.has(`${sens}|${t.numero}`) ? 'Train absent de la grille en service' : ''
        }">TRAIN ${t.numero}${t.express ? '<small>EXPRESS</small>' : ''}${retirer}${
          messages.length > 0
            ? `<small class="erreur-cellule">${messages.map(echapper).join(' ')}</small>`
            : ''
        }</th>`;
      })
      .join('');
    const ligneIndicateur = (champ: Indicateur, libelle: string): string =>
      `<tr class="indic"><th>${libelle}</th><td></td>${trains
        .map((t) =>
          o.editable || o.correction
            ? `<td><input type="checkbox" data-champ="${champ}" data-sens="${sens}" data-train="${t.numero}" data-feuille="${feuille}" ${
                t[champ] ? 'checked' : ''
              } title="${libelle} — TRAIN ${t.numero}"></td>`
            : `<td>${t[champ] ? 'oui' : '—'}</td>`,
        )
        .join('')}</tr>`;

    // En CORRECTION, chaque gare desservie montre ses deux lignes A et D, même
    // vides : la case à remplir doit exister avant d'être remplie. Seules les
    // extrémités du parcours n'en ont qu'une (pas d'arrivée à l'origine, pas
    // de départ au terminus) — la ligne l'impose, ce n'est pas une saisie.
    const desservies = gares.filter((g) =>
      trains.some((t) => t.passages.some((p) => p.gare === g)),
    );
    const origine = desservies[0];
    const terminus = desservies[desservies.length - 1];

    let corps = '';
    for (const gare of desservies) {
      const champs = (['a', 'd'] as const).filter((champ) =>
        o.correction
          ? !(champ === 'a' && gare === origine) && !(champ === 'd' && gare === terminus)
          : trains.some((t) => t.passages.find((p) => p.gare === gare)?.[champ] !== undefined),
      );
      const messagesGare = new Set<string>();
      champs.forEach((champ, i) => {
        corps += `<tr>${i === 0 ? `<th rowspan="${champs.length}">${echapper(nomGare(gare))}</th>` : ''}<td class="ad">${
          champ === 'a' ? 'A' : 'D'
        }</td>`;
        for (const t of trains) {
          const p = t.passages.find((x) => x.gare === gare);
          const h = p?.[champ];
          const cle = `${sens}|${t.numero}|${gare}|${champ}`;
          if (o.correction) {
            const refus = o.refus?.get(cle);
            const messages = o.erreursGare?.get(`${t.numero}|${gare}`) ?? [];
            for (const m of messages) messagesGare.add(m);
            const classes = [
              o.modifiees?.has(cle) ? 'modif' : '',
              refus !== undefined || messages.length > 0 ? 'en-erreur' : '',
            ]
              .filter(Boolean)
              .join(' ');
            corps += `<td class="${classes}"><input type="text" class="cellule-heure" maxlength="8"
              data-role="heure" data-sens="${sens}" data-train="${t.numero}" data-gare="${gare}" data-champ="${champ}"
              value="${echapper(refus?.saisie ?? (h ? formatHeure(heureVersSecondes(h)) : ''))}"
              placeholder="${t.express && !p ? '—' : ''}" title="TRAIN ${t.numero} — ${echapper(nomGare(gare))} ${
                champ === 'a' ? 'arrivée' : 'départ'
              }${h ? ` (${h})` : ''}">${
                refus ? `<small class="erreur-cellule">${echapper(refus.message)}</small>` : ''
              }</td>`;
          } else {
            const classes = [o.modifiees?.has(cle) ? 'modif' : '', p ? '' : 'saute']
              .filter(Boolean)
              .join(' ');
            const texte = !p ? (t.express ? '|' : '—') : h ? formatHeure(heureVersSecondes(h)) : '';
            corps += `<td class="${classes}"${h ? ` title="${h}"` : ''}>${texte}</td>`;
          }
        }
        corps += '</tr>';
      });
      if (messagesGare.size > 0) {
        corps += `<tr class="ligne-erreur"><td colspan="${trains.length + 2}">${[...messagesGare]
          .map((m) => `<span>${echapper(m)}</span>`)
          .join('')}</td></tr>`;
      }
    }
    return `<h4>${titre} <small>${trains.length} trains</small></h4>
      <div class="tabwrap-apercu"><table class="table-apercu">
        <thead><tr><th>Gare</th><th></th>${entete}</tr>${
          o.correction ? ligneIndicateur('express', 'Express') : ''
        }${ligneIndicateur('facultatif', 'Facultatif')}${ligneIndicateur('velos', 'Vélos')}</thead>
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
        <button class="principal" id="import-valider" disabled>Enregistrer et mettre en service</button>
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
    if (bouton.dataset.action === 'modifier') void ouvreEdition(version).catch(erreurVersToast);
    if (bouton.dataset.action === 'corriger') {
      void ouvreCorrection(version, 'correction').catch(erreurVersToast);
    }
    if (bouton.dataset.action === 'dupliquer') {
      void ouvreCorrection(version, 'duplication').catch(erreurVersToast);
    }
    if (bouton.dataset.action === 'activer') void bascule(version, true);
    if (bouton.dataset.action === 'desactiver') void bascule(version, false);
  });

  const carteEditer = $('carte-editer');
  carteEditer.addEventListener('click', (e) => {
    const cible = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!cible || !editionEnCours) return;
    if (cible.id === 'edition-fermer') {
      editionEnCours = null;
      rendreEdition();
      return;
    }
    if (cible.id === 'edition-enregistrer') {
      void enregistreEdition();
      return;
    }
    const ed = editionEnCours.edition;
    if (cible.dataset.role === 'ajout-periode') {
      ed.periodes.push({ du: '', au: '' });
      rendreEdition();
    }
    if (cible.dataset.role === 'suppr-periode') {
      ed.periodes.splice(Number(cible.dataset.periode), 1);
      void chargeJoursEdition().then(rendreEdition);
    }
  });
  carteEditer.addEventListener('input', (e) => {
    const champ = e.target as HTMLInputElement;
    if (!editionEnCours) return;
    if (champ.dataset.role === 'libelle') editionEnCours.edition.libelle = champ.value;
    if (champ.dataset.role === 'commentaire') editionEnCours.edition.commentaire = champ.value;
    if (champ.dataset.role === 'libelle' || champ.dataset.role === 'commentaire') {
      rendreValidationEdition();
    }
  });
  carteEditer.addEventListener('change', (e) => {
    const champ = e.target as HTMLInputElement;
    if (!editionEnCours) return;
    const ed = editionEnCours.edition;
    const role = champ.dataset.role;
    if (role === 'jour') {
      if (champ.checked) ed.joursAReinitialiser.add(champ.dataset.date ?? '');
      else ed.joursAReinitialiser.delete(champ.dataset.date ?? '');
    } else if (role === 'du' || role === 'au') {
      const periode = ed.periodes[Number(champ.dataset.periode)];
      if (periode) periode[role] = champ.value;
      // Les dates changent l'effet annoncé et les journées concernées.
      void chargeJoursEdition().then(rendreEdition);
    }
  });

  // --- carte « Corriger » / « Dupliquer » ---
  // Chaque geste passe par src/core/edition-grille.ts : ici, uniquement lire
  // le DOM, appeler la fonction, redessiner.
  const carteCorriger = $('carte-corriger');
  carteCorriger.addEventListener('click', (e) => {
    const cible = (e.target as HTMLElement).closest<HTMLElement>('button');
    const c = correctionEnCours;
    if (!cible || !c) return;
    if (cible.id === 'correction-fermer') {
      correctionEnCours = null;
      rendreCorrection();
      return;
    }
    if (cible.id === 'correction-enregistrer') {
      void enregistreCorrection();
      return;
    }
    switch (cible.dataset.role) {
      case 'ajout-periode':
        c.periodes.push({ du: '', au: '' });
        rendreCorrection();
        break;
      case 'suppr-periode':
        c.periodes.splice(Number(cible.dataset.periode), 1);
        void chargeJoursCorrection().then(rendreCorrection);
        break;
      case 'suppr-rotation': {
        const numero = Number(cible.dataset.train);
        if (!window.confirm(`Retirer la rotation TRAIN ${numero} / TRAIN ${numero + 1} ?`)) return;
        appliqueGeste(supprimeRotation(c.grille, numero));
        break;
      }
      case 'ajout-rotation': {
        const numero = numeroMonteeSuivant(c.grille);
        const r = ajouteRotation(c.grille, numero);
        if (!r.ok) toast(`⚠ ${r.erreur}`);
        else appliqueGeste(r.grille);
        break;
      }
      case 'retirer-nid':
        if (
          !window.confirm(
            'Retirer tout passage au Nid d’Aigle ? Bellevue devient le terminus (grille d’hiver). Les trains express, qui n’existent qu’avec le Nid d’Aigle, seront signalés : à retirer ou à requalifier.',
          )
        ) {
          return;
        }
        appliqueGeste(retireNidDaigle(c.grille));
        break;
    }
  });
  carteCorriger.addEventListener('input', (e) => {
    const champ = e.target as HTMLInputElement;
    const c = correctionEnCours;
    if (!c) return;
    if (champ.dataset.role === 'libelle') c.libelle = champ.value;
    if (champ.dataset.role === 'commentaire') c.commentaire = champ.value;
    if (champ.dataset.role === 'libelle' || champ.dataset.role === 'commentaire') {
      rendreValidationCorrection();
    }
  });
  carteCorriger.addEventListener('change', (e) => {
    const champ = e.target as HTMLInputElement;
    const c = correctionEnCours;
    if (!c) return;
    const role = champ.dataset.role;
    if (role === 'heure') {
      const cle = cleCellule(
        champ.dataset.sens ?? '',
        Number(champ.dataset.train),
        champ.dataset.gare ?? '',
        champ.dataset.champ ?? '',
      );
      const r = poseHeure(
        c.grille,
        {
          sens: champ.dataset.sens === 'descente' ? 'descente' : 'montee',
          numero: Number(champ.dataset.train),
          gare: (champ.dataset.gare ?? 'le-fayet') as GareId,
          champ: champ.dataset.champ === 'a' ? 'a' : 'd',
        },
        champ.value,
      );
      if (r.ok) {
        c.erreursCellules.delete(cle);
        appliqueGeste(r.grille);
      } else {
        // La saisie fautive RESTE dans la cellule : l'agent voit ce qu'il a tapé.
        const refus: SaisieRefusee = { saisie: champ.value, message: r.erreur };
        c.erreursCellules.set(cle, refus);
        rendreCorrection();
      }
      return;
    }
    if (role === 'acquitter') {
      c.avertissementsAcquittes = champ.checked;
      rendreValidationCorrection();
      return;
    }
    if (role === 'jour') {
      if (champ.checked) c.joursAReinitialiser.add(champ.dataset.date ?? '');
      else c.joursAReinitialiser.delete(champ.dataset.date ?? '');
      return;
    }
    if (role === 'du' || role === 'au') {
      const periode = c.periodes[Number(champ.dataset.periode)];
      if (periode) periode[role] = champ.value;
      void chargeJoursCorrection().then(rendreCorrection);
      return;
    }
    const indicateur = champ.dataset.champ;
    if (indicateur === 'express' || indicateur === 'facultatif' || indicateur === 'velos') {
      appliqueGeste(
        poseIndicateur(
          c.grille,
          champ.dataset.sens === 'descente' ? 'descente' : 'montee',
          Number(champ.dataset.train),
          indicateur,
          champ.checked,
        ),
      );
    }
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
      // La fiche ouverte suit la grille telle qu'enregistrée (sans redessiner
      // la saisie en cours) ; si la grille a disparu, la fiche se ferme.
      if (correctionEnCours) {
        const g = grilles.find((x) => x.version === correctionEnCours?.origine.version);
        if (g) correctionEnCours.origine = g;
        else {
          // La grille de départ a disparu : la carte n'a plus de référence.
          correctionEnCours = null;
          rendreCorrection();
        }
      }
      if (editionEnCours) {
        const g = grilles.find((x) => x.version === editionEnCours?.grille.version);
        if (g) editionEnCours.grille = g;
        else {
          editionEnCours = null;
          rendreEdition();
        }
      }
    },
  };
}
