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

// Depuis le 20/10/2026 (terminus par gare), la règle M-21 ne s'écrit plus en
// filtres PostgREST : le fournisseur lit la colonne des montées, la passe à
// `deltaBascule()` — la règle PURE, testée dans src/core — et écrit ce qui a
// changé. Ces verrous gardent les quatre propriétés qui comptaient.
describe('SupabaseProvider — la bascule travaille par DIFFÉRENCE', () => {
  it('lit la bascule PRÉCÉDENTE avant de l’écraser', () => {
    // Sans elle, impossible de distinguer une montée limitée par l'ancienne
    // plage d'une montée limitée à la main : c'est toute la cause de M-21.
    // La DÉRIVATION, pas seulement le nom : un `const ancienne = null`
    // passerait un contrôle qui se contenterait de la déclaration.
    expect(bascule).toContain('const ancienne = basculeDuFlag(ligne ? versFlag(ligne) : false);');
    const lecture = bascule.indexOf(".from('jours').select('*')");
    const ecriture = bascule.indexOf('terminus_bellevue_a_partir_du_train: nouvelle?.seuil');
    expect(lecture).toBeGreaterThan(0);
    expect(ecriture).toBeGreaterThan(lecture);
  });

  it('la colonne suit la règle PURE, appliquée à la colonne réelle', () => {
    // Une seule description de la règle — aperçu, mock et base disent pareil.
    expect(bascule).toContain('deltaBascule(actuelles, ancienne, nouvelle)');
    // Seules les montées qui CHANGENT sont écrites : recalculer la colonne
    // entière effacerait les réglages manuels (M-21).
    expect(bascule).toContain('if (c.terminus === actuelles[i]?.terminus) return;');
    expect(bascule).toContain(".in('numero', numeros)");
    expect(supabase).not.toContain('Number.POSITIVE_INFINITY');
  });

  it('une base pas encore migrée se lit encore : jamais la colonne nommée en lecture', () => {
    // Nommer `terminus_bascule_gare` dans un select ferait échouer la lecture
    // sur une base d'avant la migration — leçon du 11/09.
    expect(supabase).not.toMatch(/select\([^)]*terminus_bascule_gare/);
  });

  it('RESTREINDRE passe avant LIBÉRER : Col de Voza, puis Bellevue, puis non limité', () => {
    // Les ensembles sont disjoints, donc l'ordre ne change pas l'état final —
    // seulement l'intermédiaire si une écriture échoue. Restreindre d'abord
    // limite TROP plutôt que TROP PEU : personne n'est porté vers un tronçon
    // fermé.
    expect(bascule).toContain(
      "const ordre: Circulation['terminus'][] = ['col-de-voza', 'bellevue', 'nid-daigle'];",
    );
  });

  it('les deltas n’exigent AUCUNE ligne : zéro est normal', () => {
    // `exigeLignes` sur un delta vide ferait échouer une publication juste.
    expect(bascule).toContain('verifie(ecriture.error)');
    expect(bascule).not.toContain('exigeLignes(ecriture');
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
