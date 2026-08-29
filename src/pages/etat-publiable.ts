// Écarts réels avec l'état de référence, PUR et testable sans DOM.
//
// Pourquoi : le compteur de la barre de publication comptait les CLICS
// (`modifs += 1` à chaque action). Ramener une température de 12 à 8
// annonçait donc « 2 modifications » alors que plus rien ne différait de
// l'état publié. On compare désormais un INSTANTANÉ de l'état publiable à
// une référence prise au chargement de la page et après chaque publication.
//
// Une valeur posée puis retirée ne laisse ici aucune trace — c'est voulu —
// mais les écrans l'ont bel et bien affichée : la trace permanente de chaque
// écriture vit dans le journal d'exploitation (table `journal_exploitation`,
// alimentée par déclencheurs Postgres), pas dans ce compteur.
import type {
  Circulation,
  EcranInfo,
  Jour,
  Machine,
  Media,
  Message,
  ModeleMessage,
  Motif,
  Params,
} from '../core/types';

/** État publiable aplati : une clé stable par CHAMP, valeur normalisée. */
export type Instantane = Record<string, string>;

export interface Ecart {
  /** Clé technique, stable entre deux instantanés. */
  cle: string;
  /** Formulation lisible pour le résumé de publication (« TRAIN 5 statut »). */
  libelle: string;
  avant: string;
  apres: string;
}

/**
 * Normalisation : aucune différence purement cosmétique ne doit compter.
 * Les nombres sont comparés en VALEUR (8, « 8 », « 8.0 » identiques), les
 * textes après trim, les booléens en oui/non, l'absence en chaîne vide.
 */
export function normalise(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return '';
  if (typeof valeur === 'boolean') return valeur ? 'oui' : 'non';
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? String(valeur) : '';
  const texte = String(valeur).trim();
  if (texte === '') return '';
  // « 8 », « 8.0 » et 8 doivent se valoir ; « 21:00 » ou « 2026-08-29 » non.
  const nombre = Number(texte);
  return Number.isFinite(nombre) && /^[+-]?\d+(\.\d+)?$/.test(texte) ? String(nombre) : texte;
}

/**
 * Une journée à comparer. Il y en a plusieurs : celle qui est affichée, et
 * toutes celles qui portent des modifications en attente — « Publier »
 * publie TOUTES les dates du brouillon, le compteur doit donc les voir
 * toutes, sans quoi une modification posée sur une date puis quittée
 * griserait le bouton et deviendrait impubliable.
 */
export interface JourPubliable {
  date: string;
  jour: Jour | null;
}

/** Tout ce qui compose l'état publiable, tel que la supervision le connaît. */
export interface EntreesPubliables {
  /** Journée affichée + toutes celles qui ont des modifications en attente. */
  jours: JourPubliable[];
  messages: Message[];
  medias: Media[];
  params: Params | null;
  ecrans: EcranInfo[];
  machines: Machine[];
  motifs: Motif[];
  modeles: ModeleMessage[];
}

/** Champs d'une circulation qui font une différence pour les voyageurs. */
const CHAMPS_CIRCULATION = [
  'statut',
  'retard_min',
  'motif',
  'rame',
  'terminus',
  'facultatif_actif',
  'sans_voyageurs',
] as const satisfies readonly (keyof Circulation)[];

const CHAMPS_MESSAGE = [
  'texte_fr',
  'texte_en',
  'cible_type',
  'train_numero',
  'priorite',
  'actif',
  'expire_at',
] as const satisfies readonly (keyof Message)[];

/**
 * Partie DATÉE de l'instantané (circulations et bascule Terminus). Elle est
 * recalculée à chaque comparaison plutôt que figée dans la référence : les
 * clés portent la date, une référence figée sur la date précédente ferait
 * compter toute une journée comme supprimée et toute la nouvelle comme
 * ajoutée (252 « modifications » observées le 29/08/2026).
 */
export function instantaneJours(jours: JourPubliable[]): Instantane {
  const instantane: Instantane = {};
  for (const { date, jour } of jours) {
    for (const c of jour?.circulations ?? []) {
      for (const champ of CHAMPS_CIRCULATION) {
        instantane[`circulation|${date}|${c.numero}|${champ}`] = normalise(c[champ]);
      }
    }
    const flag = jour?.terminus_bellevue;
    instantane[`jour|${date}|terminus_bellevue`] = normalise(
      flag === false || !flag ? '' : flag.a_partir_du_train,
    );
  }
  return instantane;
}

export function instantanePubliable(e: EntreesPubliables): Instantane {
  const instantane: Instantane = { ...instantaneJours(e.jours) };
  const pose = (cle: string, valeur: unknown): void => {
    instantane[cle] = normalise(valeur);
  };

  // --- Messages voyageurs ---
  for (const m of e.messages) {
    for (const champ of CHAMPS_MESSAGE) pose(`message|${m.id}|${champ}`, m[champ]);
    pose(`message|${m.id}|gares`, [...(m.gares ?? [])].sort().join(','));
  }

  // --- Médias ---
  for (const m of e.medias) {
    pose(`media|${m.id}|actif`, m.actif);
    pose(`media|${m.id}|duree_s`, m.duree_s);
    pose(`media|${m.id}|ordre`, m.ordre);
    pose(`media|${m.id}|gares`, [...(m.gares ?? [])].sort().join(','));
    pose(`media|${m.id}|expire_at`, m.expire_at);
  }

  // --- Paramètres d'affichage ---
  if (e.params) {
    pose('params|meteo|t', e.params.meteo_sommet.t);
    pose('params|meteo|ciel_fr', e.params.meteo_sommet.ciel_fr);
    pose('params|meteo|ciel_en', e.params.meteo_sommet.ciel_en);
    // heure_releve est VOLONTAIREMENT absente : c'est une métadonnée qui
    // accompagne la température, pas une décision d'exploitation. La compter
    // ferait annoncer « 2 modifications » pour un simple changement de
    // température, et « 1 » après un retour à la valeur d'origine.
    pose('params|vitesse_ticker_px_s', e.params.vitesse_ticker_px_s);
    pose('params|duree_horaires_s', e.params.duree_horaires_s);
    pose('params|mode_medias', e.params.mode_medias);
    pose('params|veille|debut', e.params.veille_nuit.debut);
    pose('params|veille|fin', e.params.veille_nuit.fin);
  }

  // --- Veille propre à chaque écran ---
  for (const ecran of e.ecrans) {
    pose(`ecran|${ecran.id}|veille_debut`, ecran.veille_debut?.slice(0, 5));
    pose(`ecran|${ecran.id}|veille_fin`, ecran.veille_fin?.slice(0, 5));
  }

  // --- Machines, motifs, bibliothèque de modèles ---
  for (const m of e.machines) {
    pose(`machine|${m.nom}|couleur`, m.couleur);
    pose(`machine|${m.nom}|cercle`, m.cercle);
    pose(`machine|${m.nom}|en_service`, m.en_service);
  }
  for (const m of e.motifs) pose(`motif|${m.fr}|en`, m.en);
  for (const m of e.modeles) {
    pose(`modele|${m.id}|titre`, m.titre);
    pose(`modele|${m.id}|texte_fr`, m.texte_fr);
    pose(`modele|${m.id}|texte_en`, m.texte_en);
    pose(`modele|${m.id}|actif`, m.actif);
    pose(`modele|${m.id}|ordre`, m.ordre);
  }

  return instantane;
}

/** Formulation lisible d'une clé, pour le résumé consigné à la publication. */
export function libelleDeCle(cle: string): string {
  const [type = '', a = '', b = '', c = ''] = cle.split('|');
  switch (type) {
    case 'circulation':
      return `TRAIN ${b} ${c}`;
    case 'jour':
      return 'terminus Bellevue';
    case 'message':
      return `message ${b}`;
    case 'media':
      return `média ${b}`;
    case 'params':
      return a === 'meteo' ? `météo ${b}` : a === 'veille' ? `veille ${b}` : a.replace(/_/g, ' ');
    case 'ecran':
      return `veille ${a} ${b.replace('veille_', '')}`;
    case 'machine':
      return `rame ${a} ${b}`;
    case 'motif':
      return `motif ${a}`;
    case 'modele':
      return `modèle ${b}`;
    default:
      return cle;
  }
}

/**
 * Champs dont la valeur diffère de la référence. Une clé absente d'un côté
 * compte aussi : un message supprimé ou un écran nouvellement déclaré est un
 * écart réel, pas un non-événement.
 */
export function ecarts(reference: Instantane, courant: Instantane): Ecart[] {
  const cles = new Set([...Object.keys(reference), ...Object.keys(courant)]);
  const liste: Ecart[] = [];
  for (const cle of [...cles].sort()) {
    const avant = reference[cle] ?? '';
    const apres = courant[cle] ?? '';
    if (avant === apres) continue;
    liste.push({ cle, libelle: libelleDeCle(cle), avant, apres });
  }
  return liste;
}

/** Une clé porte-t-elle une date (circulation, bascule du jour) ? */
export function estCleDatee(cle: string): boolean {
  return cle.startsWith('circulation|') || cle.startsWith('jour|');
}

/**
 * Écarts entre l'état PUBLIÉ et l'état effectif.
 *
 * La partie DATÉE est reconstruite des deux côtés à chaque appel, depuis les
 * journées telles qu'elles sont en base : seule la partie non datée vient de
 * la référence figée. C'est ce qui permet de changer de date sans que
 * l'ancienne journée compte comme supprimée et la nouvelle comme ajoutée.
 */
export function ecartsPublies(
  referenceFigee: Instantane,
  joursDeReference: JourPubliable[],
  courant: EntreesPubliables,
): Ecart[] {
  const reference: Instantane = instantaneJours(joursDeReference);
  for (const [cle, valeur] of Object.entries(referenceFigee)) {
    if (!estCleDatee(cle)) reference[cle] = valeur;
  }
  return ecarts(reference, instantanePubliable(courant));
}

/**
 * Résumé consigné à la publication, construit sur les ÉCARTS RÉELS : une
 * température revenue à sa valeur d'origine n'y figure pas.
 */
export function resumeEcarts(liste: Ecart[], max = 10): string {
  if (liste.length === 0) return 'publication sans modification';
  const details = liste
    .slice(0, max)
    .map((e) => `${e.libelle} ${e.avant || '—'} → ${e.apres || '—'}`)
    .join(' · ');
  const reste = liste.length > max ? ` · +${liste.length - max} autre(s)` : '';
  return `${liste.length} modification(s) : ${details}${reste}`;
}

// ---------------------------------------------------------------------------
// Journal d'exploitation — mise en forme (pure, testable sans DOM)
// ---------------------------------------------------------------------------

/** Noms de tables → libellés d'exploitation. */
export const OBJETS_JOURNAL: Record<string, string> = {
  circulations: 'Circulation',
  jours: 'Journée',
  messages: 'Message',
  medias: 'Média',
  params: 'Paramètre',
  machines: 'Rame',
  motifs: 'Motif',
  modeles_messages: 'Modèle',
  ecrans: 'Écran',
};

export function libelleObjet(table: string): string {
  return OBJETS_JOURNAL[table] ?? table;
}

/** « 2026-08-29T07:19:42Z » → « 29/08 09:19:42 » (heure de Paris). */
export function horodatageJournal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(d);
}

/**
 * Export CSV du journal. Séparateur point-virgule et BOM : Excel francophone
 * ouvre le fichier sans passer par l'assistant d'importation.
 */
export function journalVersCsv(entrees: EntreeJournalCsv[]): string {
  const echappe = (v: string | null): string => `"${(v ?? '').replace(/"/g, '""')}"`;
  const lignes = [
    ['quand', 'qui', 'objet', 'cle', 'champ', 'avant', 'apres', 'date_service'].join(';'),
    ...entrees.map((e) =>
      [
        e.quand,
        echappe(e.qui),
        libelleObjet(e.table_cible),
        echappe(e.cle),
        echappe(e.champ),
        echappe(e.avant),
        echappe(e.apres),
        e.date_service ?? '',
      ].join(';'),
    ),
  ];
  return `﻿${lignes.join('\r\n')}`;
}

export interface EntreeJournalCsv {
  quand: string;
  qui: string | null;
  table_cible: string;
  cle: string;
  champ: string;
  avant: string | null;
  apres: string | null;
  date_service: string | null;
}
