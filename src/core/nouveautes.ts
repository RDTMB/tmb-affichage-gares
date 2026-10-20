// Nouveautés de la Supervision : un fichier par PR dans `nouveautes/`
// (docs/nouveautes.md). Ce module est PUR : il reçoit le nom et le texte d'un
// fichier, il rend une entrée — ou il LÈVE une erreur qui nomme le fichier.
//
// Il est appelé AU BUILD par vite.config.ts (module virtuel
// `virtual:nouveautes`) : un fichier mal formé fait donc échouer le build. Un
// parseur indulgent écarterait l'entrée en silence, et l'onglet Version se
// viderait sans que personne ne sache pourquoi.

export type PublicNouveaute = 'tous' | 'admin';

export interface Nouveaute {
  /** Nom du fichier, sans dossier (`2026-10-20-version.md`). */
  fichier: string;
  /** Date de fusion sur `main`, `AAAA-MM-JJ`. */
  date: string;
  /** `admin` : changement invisible à l'usage (refactorisation, CI, doc). */
  pour: PublicNouveaute;
  /** Une à trois puces, texte brut. */
  puces: string[];
}

const NOM_FICHIER = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/;
const MAX_PUCES = 3;

function dateValide(texte: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texte)) return false;
  const [a, m, j] = texte.split('-').map(Number) as [number, number, number];
  const d = new Date(Date.UTC(a, m - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j;
}

/** Lit UN fichier. Lève une erreur qui nomme le fichier au moindre écart. */
export function lireNouveaute(fichier: string, texte: string): Nouveaute {
  const echec = (motif: string): never => {
    throw new Error(`nouveautes/${fichier} : ${motif} (format : docs/nouveautes.md)`);
  };
  if (!NOM_FICHIER.test(fichier)) {
    echec('nom de fichier attendu « AAAA-MM-JJ-sujet-court.md », en minuscules');
  }
  const sansBom = texte.charCodeAt(0) === 0xfeff ? texte.slice(1) : texte;
  const lignes = sansBom.split(/\r?\n/);
  if (lignes[0]?.trim() !== '---') echec('en-tête manquant (première ligne « --- »)');
  const fin = lignes.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (fin < 0) echec('en-tête non refermé (ligne « --- » attendue)');

  const champs = new Map<string, string>();
  for (const ligne of lignes.slice(1, fin)) {
    const sansCommentaire = ligne.replace(/\s+#.*$/, '').trim();
    if (sansCommentaire === '') continue;
    const m = /^([a-z]+):\s*(.*)$/.exec(sansCommentaire);
    if (!m) echec(`ligne d'en-tête illisible : « ${ligne.trim()} »`);
    const [, cle, valeur] = m as RegExpExecArray;
    if (cle !== 'date' && cle !== 'pour') echec(`champ d'en-tête inconnu : « ${cle} »`);
    champs.set(cle as string, (valeur as string).trim());
  }

  const date = champs.get('date');
  if (date === undefined) echec('champ « date » manquant');
  if (!dateValide(date as string)) echec(`date invalide : « ${date} » (attendu AAAA-MM-JJ)`);
  if (!fichier.startsWith(date as string)) {
    echec(`la date de l'en-tête (${date}) diffère de celle du nom de fichier`);
  }
  const pour = champs.get('pour');
  if (pour === undefined) echec('champ « pour » manquant (tous | admin)');
  if (pour !== 'tous' && pour !== 'admin') echec(`« pour » inconnu : « ${pour} » (tous | admin)`);

  const puces: string[] = [];
  for (const ligne of lignes.slice(fin + 1)) {
    const t = ligne.trim();
    if (t === '') continue;
    const m = /^[-*]\s+(.+)$/.exec(t);
    if (m) puces.push((m[1] as string).trim());
    // Une ligne qui n'est pas une puce continue la précédente (retour à la
    // ligne de Prettier dans une puce longue).
    else if (puces.length > 0) puces[puces.length - 1] += ` ${t}`;
    else echec(`texte hors puce : « ${t} »`);
  }
  if (puces.length === 0) echec('aucune puce « - … » sous l’en-tête');
  if (puces.length > MAX_PUCES) echec(`${puces.length} puces : ${MAX_PUCES} au plus`);

  return { fichier, date: date as string, pour: pour as PublicNouveaute, puces };
}

/**
 * Lit tous les fichiers (chemin → texte), de la plus récente à la plus
 * ancienne ; à date égale, l'ordre inverse des noms, stable d'un build à
 * l'autre.
 */
export function lireNouveautes(fichiers: Readonly<Record<string, string>>): Nouveaute[] {
  return Object.entries(fichiers)
    .map(([chemin, texte]) => lireNouveaute(chemin.split(/[\\/]/).pop() ?? chemin, texte))
    .sort((a, b) =>
      a.date === b.date ? b.fichier.localeCompare(a.fichier) : b.date < a.date ? -1 : 1,
    );
}

/** Regroupe par date, dans l'ordre reçu (déjà trié par `lireNouveautes`). */
export function grouperParDate(
  nouveautes: readonly Nouveaute[],
): { date: string; entrees: Nouveaute[] }[] {
  const groupes: { date: string; entrees: Nouveaute[] }[] = [];
  for (const n of nouveautes) {
    const dernier = groupes[groupes.length - 1];
    if (dernier && dernier.date === n.date) dernier.entrees.push(n);
    else groupes.push({ date: n.date, entrees: [n] });
  }
  return groupes;
}

/** `2026-10-20` → `20/10/2026`. */
export function dateNouveaute(date: string): string {
  const [a, m, j] = date.split('-');
  return `${j}/${m}/${a}`;
}
