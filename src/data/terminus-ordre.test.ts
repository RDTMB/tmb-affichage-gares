// M-21 — verrous de TEXTE sur ce que le mock ne peut pas éprouver.
//
// Le MockProvider est exécutable ici et couvre le comportement (mock.test.ts,
// « le matin de montagne »). Deux choses lui échappent : le SupabaseProvider,
// qui demande un réseau et une base, et l'ORDRE de publication, qui vit dans
// la supervision. Les deux portent le correctif ; ce fichier les verrouille.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(chemin: string): string {
  const url = new URL(`../../${chemin}`, import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf-8').replace(/\r\n/g, '\n');
}

const supabase = source('src/data/supabase.ts');
const bascule = supabase.slice(
  supabase.indexOf('async setTerminusBellevue'),
  supabase.indexOf('async saveMessage'),
);

describe('SupabaseProvider — la bascule travaille par DIFFÉRENCE', () => {
  it('lit la plage PRÉCÉDENTE avant de l’écraser', () => {
    // Sans elle, impossible de distinguer une montée limitée par l'ancienne
    // plage d'une montée limitée à la main : c'est toute la cause de M-21.
    expect(bascule).toContain("select('terminus_bellevue_a_partir_du_train')");
    // La DÉRIVATION, pas seulement le nom : un `const ancien = null` passerait
    // un contrôle qui se contenterait de la déclaration, et la bascule
    // recalculerait de nouveau la colonne entière sans que rien ne le dise.
    expect(bascule).toContain("const ancien = typeof brut === 'number' ? normalise(brut) : null;");
    expect(bascule).toContain('?.terminus_bellevue_a_partir_du_train;');
    const lecture = bascule.indexOf("select('terminus_bellevue_a_partir_du_train')");
    const ecriture = bascule.indexOf('terminus_bellevue_a_partir_du_train: seuil');
    expect(lecture).toBeGreaterThan(0);
    expect(ecriture).toBeGreaterThan(lecture);
  });

  it('borne les deux écritures : ce qui ENTRE et ce qui SORT', () => {
    // Une borne absente d'un côté suffit à recalculer la colonne entière.
    expect(bascule).toContain("entrent = entrent.lt('numero', ancien)");
    expect(bascule).toContain("sortent = sortent.gte('numero', ancien)");
    expect(bascule).toContain("sortent = sortent.lt('numero', seuil)");
    // Plus de borne infinie : c'était la forme qui interdisait de filtrer.
    expect(supabase).not.toContain('Number.POSITIVE_INFINITY');
  });

  it('DÉCOCHER reste sans borne : c’est une décision explicite', () => {
    // Laisser une montée limitée que la bascule n'indique plus serait pire
    // que d'effacer un réglage manuel.
    expect(bascule).toMatch(/const libere = v === false \|\|/);
    expect(bascule).toContain('if (v !== false) {');
  });

  it('RESTREINDRE passe avant LIBÉRER', () => {
    // Les deux ensembles sont disjoints, donc l'ordre ne change pas l'état
    // final — seulement l'intermédiaire si la seconde écriture échoue.
    // Restreindre d'abord limite TROP plutôt que TROP PEU : personne n'est
    // porté vers un tronçon fermé.
    const restreint = bascule.indexOf("update({ terminus: 'bellevue' })");
    const libere = bascule.indexOf("update({ terminus: 'nid-daigle' })");
    expect(restreint).toBeGreaterThan(0);
    expect(libere).toBeGreaterThan(restreint);
  });

  it('les deltas n’exigent AUCUNE ligne : zéro est normal', () => {
    // `exigeLignes` sur un delta vide ferait échouer une publication juste.
    expect(bascule).toContain('verifie((await entrent).error)');
    expect(bascule).toContain('verifie((await sortent).error)');
  });
});

describe('la publication applique la bascule AVANT les circulations', () => {
  const sup = source('src/pages/supervision.ts');
  const publie = sup.slice(sup.indexOf('async function publieLeBrouillon'));

  it('section, puis bascule, puis circulations', () => {
    // La bascule PRÉ-REMPLIT la colonne, et « la colonne reste prioritaire et
    // ajustable » (docs/01 §2.3). La publier en dernier écrasait le geste de
    // l'agent : la journée publiée ne ressemblait pas à celle qu'il venait de
    // relire dans l'aperçu.
    const section = publie.indexOf('brouillonSection.entries()');
    const terminus = publie.indexOf('brouillonTerminus.entries()');
    const circulations = publie.indexOf('brouillonCirc.entries()');
    for (const [nom, i] of [
      ['section', section],
      ['terminus', terminus],
      ['circulations', circulations],
    ] as const) {
      expect(i, `boucle ${nom} introuvable`).toBeGreaterThan(0);
    }
    expect(section).toBeLessThan(terminus);
    expect(terminus).toBeLessThan(circulations);
  });
});
