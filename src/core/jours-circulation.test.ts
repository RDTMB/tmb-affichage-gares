// Un train de grille qui ne circule que certains jours — le TRAIN 20 du
// samedi d'hiver (décision de l'exploitant du 16/10/2026). Il vit DANS la
// grille, se lit « Samedi » dans la ligne des lettres comme au document
// 2025-2026, part de Col de Voza sans montée appariée, et apparaît tout seul
// chaque samedi de la saison — jamais un autre jour.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ecarts } from './ecarts-grille';
import { cellulesGrille } from './export-grille';
import { grilleDepuisEnregistrement } from './grilles';
import {
  circuleLe,
  dateSuivante,
  generationJour,
  jourIso,
  libelleJours,
  passagesPourGare,
  trainsDuJour,
} from './horaires';
import { lisIndicateurs, parseFeuille, type Cellule, type FeuilleCellules } from './import-grille';
import { lireClasseur } from './lecture-xlsx';
import { tempsDeGrille } from './train-sup';
import type { Grille } from './types';

const FICHIER = fileURLToPath(
  new URL('./__fixtures__/2026-2027-hiver-service-unique.xlsx', import.meta.url),
);

/** La feuille « Hiver » du fichier de référence, en cellules (copie modifiable). */
function feuilleHiver(): FeuilleCellules {
  const f = lireClasseur(new Uint8Array(readFileSync(FICHIER))).find((x) => x.nom === 'Hiver');
  if (!f) throw new Error('feuille « Hiver » absente du fichier de référence');
  return structuredClone(f);
}

function grilleHiver(): Grille {
  const r = parseFeuille(feuilleHiver());
  if (!r.grille || r.erreurs.length > 0)
    throw new Error(r.erreurs.map((e) => e.message).join('\n'));
  return { ...r.grille, periodes: r.periodesProposees };
}

/** Ligne Excel (1 = première) dont la colonne A commence par `debut`, à partir de `apres`. */
function ligneDe(f: FeuilleCellules, debut: string, apres = 0): number {
  const i = f.lignes.findIndex(
    (l, k) => k >= apres && typeof l[0] === 'string' && l[0].startsWith(debut),
  );
  if (i < 0) throw new Error(`ligne « ${debut} » introuvable`);
  return i + 1;
}

function pose(f: FeuilleCellules, ligne: number, colonne: string, valeur: Cellule): void {
  const l = f.lignes[ligne - 1];
  if (!l) throw new Error(`ligne ${ligne} absente`);
  l[colonne.charCodeAt(0) - 65] = valeur;
}

const heure = (hh: number, mm: number): number => (hh * 60 + mm) / 1440;

// ---------------------------------------------------------------------------

describe('jourIso / circuleLe / libelleJours', () => {
  it('lit le jour de la semaine sur la DATE, sans fuseau', () => {
    expect(jourIso('2026-12-12')).toBe(6); // samedi
    expect(jourIso('2026-12-13')).toBe(7); // dimanche
    expect(jourIso('2026-12-14')).toBe(1); // lundi
    expect(jourIso('2027-03-27')).toBe(6);
    expect(jourIso('2027-03-29')).toBe(1);
  });

  it('sans jours : tous les jours ; avec : seulement ceux-là', () => {
    expect(circuleLe({}, '2026-12-14')).toBe(true);
    expect(circuleLe({ jours: [6] }, '2026-12-12')).toBe(true);
    expect(circuleLe({ jours: [6] }, '2026-12-13')).toBe(false);
  });

  it('écrit les jours comme une phrase', () => {
    expect(libelleJours([6])).toBe('samedi');
    expect(libelleJours([7, 6])).toBe('samedi et dimanche');
    expect(libelleJours([1, 2, 3])).toBe('lundi, mardi et mercredi');
  });
});

describe('ligne des lettres : les jours AVANT les lettres', () => {
  it('reconnaît les jours, casse, accents et séparateurs indifférents', () => {
    expect(lisIndicateurs('Samedi')).toEqual({ lettres: '', jours: [6], inconnus: '' });
    expect(lisIndicateurs('samedi').jours).toEqual([6]);
    expect(lisIndicateurs('SAMEDI').jours).toEqual([6]);
    expect(lisIndicateurs('Sámedi').jours).toEqual([6]);
    expect(lisIndicateurs('Samedi et dimanche').jours).toEqual([6, 7]);
    expect(lisIndicateurs('samedi, dimanche').jours).toEqual([6, 7]);
    expect(lisIndicateurs('R Samedi')).toEqual({ lettres: 'R', jours: [6], inconnus: '' });
  });

  it('« MERCREDI » en majuscules n’est PAS un train facultatif', () => {
    // Lu lettre à lettre d'abord, son R deviendrait « facultatif » — et ses
    // M, E, C, D, I une erreur incompréhensible pour l'agent.
    expect(lisIndicateurs('MERCREDI')).toEqual({ lettres: '', jours: [3], inconnus: '' });
    const f = feuilleHiver();
    pose(f, ligneDe(f, 'HORAIRES DES DESCENTES') + 2, 'C', 'MERCREDI');
    const r = parseFeuille(f);
    expect(r.erreurs).toEqual([]);
    const t20 = r.grille?.descentes.find((d) => d.numero === 20);
    expect(t20?.facultatif).toBe(false);
    expect(t20?.jours).toEqual([3]);
  });

  it('les lettres d’avant ne changent pas', () => {
    expect(lisIndicateurs('Rb')).toEqual({ lettres: 'Rb', jours: [], inconnus: '' });
    expect(lisIndicateurs('R b')).toEqual({ lettres: 'Rb', jours: [], inconnus: '' });
    expect(lisIndicateurs('Rÿ').lettres).toBe('Rÿ');
  });

  it('un mot inconnu reste une erreur bloquante, et le message cite les jours', () => {
    expect(lisIndicateurs('Sam').inconnus).not.toBe('');
    // « et » n'est un séparateur qu'entre des jours.
    expect(lisIndicateurs('R et b').inconnus).toBe('et');
    const f = feuilleHiver();
    const l = ligneDe(f, 'HORAIRES DES DESCENTES') + 2;
    pose(f, l, 'C', 'Samdi');
    expect(parseFeuille(f).erreurs.map((e) => e.message)).toEqual([
      `TRAIN 20 : indicateur « Samdi » inconnu (lettres acceptées : R facultatif, b vélos, ÿ express, ou des jours (Samedi…)) (feuille « Hiver », ligne ${l}, colonne C)`,
    ]);
  });
});

describe('le fichier de référence 2026-2027-hiver-service-unique.xlsx', () => {
  const r = parseFeuille(feuilleHiver());

  it('0 erreur ; les avertissements sont les durées d’arrêt et la descente sans montée', () => {
    expect(r.erreurs).toEqual([]);
    const autres = r.avertissements.filter((a) => !/ : arrêt de /.test(a.message));
    expect(autres.map((a) => a.message)).toEqual([
      'TRAIN 20 : descente sans montée appariée, au départ de Col de Voza (feuille « Hiver »)',
    ]);
    // 32 durées d'arrêt sur les huit rotations, deux sur le TRAIN 20
    // (5 min à Motivon et à Saint-Gervais).
    expect(r.avertissements.length - autres.length).toBe(34);
  });

  it('titre, période, 8 montées, 9 descentes, Bellevue pour sommet', () => {
    expect(r.titre).toBe('HORAIRES HIVER DU 12 DECEMBRE 2026 AU 29 MARS 2027');
    expect(r.periodesProposees).toEqual([{ du: '2026-12-12', au: '2027-03-29' }]);
    expect(r.grille?.montees.map((t) => t.numero)).toEqual([1, 3, 5, 7, 9, 11, 13, 15]);
    expect(r.grille?.descentes.map((t) => t.numero)).toEqual([20, 2, 4, 6, 8, 10, 12, 14, 16]);
    const gares = new Set(
      [...(r.grille?.montees ?? []), ...(r.grille?.descentes ?? [])].flatMap((t) =>
        t.passages.map((p) => p.gare),
      ),
    );
    expect(gares.has('nid-daigle')).toBe(false);
    expect(gares.has('bellevue')).toBe(true);
  });

  it('le TRAIN 20 : samedi, de Col de Voza 8:30 au Fayet 9:30', () => {
    expect(r.grille?.descentes.find((d) => d.numero === 20)).toEqual({
      numero: 20,
      express: false,
      facultatif: false,
      velos: false,
      jours: [6],
      passages: [
        { gare: 'col-de-voza', d: '08:30:00' },
        { gare: 'motivon', a: '08:50:00', d: '08:55:00' },
        { gare: 'saint-gervais', a: '09:15:00', d: '09:20:00' },
        { gare: 'le-fayet', a: '09:30:00' },
      ],
    });
  });

  it('aucun autre train ne porte de jours : ils circulent tous les jours', () => {
    const autres = [...(r.grille?.montees ?? []), ...(r.grille?.descentes ?? [])].filter(
      (t) => t.numero !== 20,
    );
    expect(autres.every((t) => !('jours' in t))).toBe(true);
  });
});

describe('la journée générée', () => {
  const g = grilleHiver();
  const cas: Array<[string, number, number]> = [
    ['2026-12-12', 17, 9], // samedi, premier jour de la saison
    ['2026-12-13', 16, 8], // dimanche
    ['2027-03-27', 17, 9], // dernier samedi
    ['2027-03-29', 16, 8], // lundi, dernier jour
  ];
  for (const [date, trains, descentes] of cas) {
    it(`${date} : ${trains} trains dont ${descentes} descentes`, () => {
      const jour = generationJour(g, date);
      expect(jour.circulations).toHaveLength(trains);
      expect(jour.circulations.filter((c) => c.sens === 'descente')).toHaveLength(descentes);
      expect(trainsDuJour(g, jour)).toHaveLength(trains);
    });
  }

  it('JAMAIS en semaine : chaque date de la saison, le TRAIN 20 ssi samedi', () => {
    let samedis = 0;
    for (let date = '2026-12-12'; date <= '2027-03-29'; date = dateSuivante(date)) {
      const samedi = jourIso(date) === 6;
      if (samedi) samedis++;
      const jour = generationJour(g, date);
      expect(
        jour.circulations.some((c) => c.numero === 20),
        date,
      ).toBe(samedi);
      expect(
        trainsDuJour(g, jour).some((t) => t.numero === 20),
        date,
      ).toBe(samedi);
    }
    expect(samedis).toBe(16);
  });

  it('la jointure grille × journée filtre AUSSI : une journée sans sa ligne ne le fait pas revenir', () => {
    // `trainsDuJour()` part de la GRILLE : sans son propre filtre, le TRAIN 20
    // reviendrait un lundi avec le statut « ok » par défaut, sans circulation.
    const lundi = generationJour(g, '2026-12-14');
    expect(lundi.circulations.some((c) => c.numero === 20)).toBe(false);
    expect(trainsDuJour(g, lundi).map((t) => t.numero)).not.toContain(20);
  });

  it('ne reçoit PAS de rame d’office ; les autres rames ne bougent pas', () => {
    const samedi = generationJour(g, '2026-12-12');
    const dimanche = generationJour(g, '2026-12-13');
    expect(samedi.circulations.find((c) => c.numero === 20)?.rame).toBe('');
    const rames = (j: typeof samedi): string[] =>
      j.circulations.filter((c) => c.numero !== 20).map((c) => `${c.numero}:${c.rame}`);
    expect(rames(samedi)).toEqual(rames(dimanche));
    // Une rame attribuée en supervision lui reste (aucune montée dont hériter).
    const avecRame = {
      ...samedi,
      circulations: samedi.circulations.map((c) => (c.numero === 20 ? { ...c, rame: 'Anne' } : c)),
    };
    expect(trainsDuJour(g, avecRame).find((t) => t.numero === 20)?.rame).toBe('Anne');
  });

  it('écran de Col de Voza, samedi : TRAIN 20, départ 8:30 pour Le Fayet', () => {
    const passages = passagesPourGare(g, generationJour(g, '2026-12-12'), 'col-de-voza');
    const t20 = passages.find((p) => p.numero === 20);
    expect(t20?.destination).toBe('le-fayet');
    expect(t20?.origine).toBe('col-de-voza');
    expect(t20?.depart_s).toBe(8 * 3600 + 30 * 60);
    // Le premier départ de la journée à Col de Voza.
    const premier = [...passages]
      .filter((p) => p.depart_s !== null)
      .sort((a, b) => (a.depart_s ?? 0) - (b.depart_s ?? 0))[0];
    expect(premier?.numero).toBe(20);
  });

  it('lundi à Col de Voza : pas de TRAIN 20 ; samedi à Bellevue : pas de TRAIN 20', () => {
    const lundi = passagesPourGare(g, generationJour(g, '2026-12-14'), 'col-de-voza');
    expect(lundi.map((p) => p.numero)).not.toContain(20);
    const bellevue = passagesPourGare(g, generationJour(g, '2026-12-12'), 'bellevue');
    expect(bellevue.map((p) => p.numero)).not.toContain(20);
  });

  it('un renfort descendant garde le tronçon Bellevue → Col de Voza (train de référence complet)', () => {
    // Le TRAIN 20 est en première colonne des descentes : « le premier non
    // express » aurait été lui, et Bellevue manquerait.
    expect(tempsDeGrille(g, 'descente').ordre[0]).toBe('bellevue');
  });
});

describe('descente sans montée : seulement depuis une gare intermédiaire', () => {
  it('au départ du SOMMET (Bellevue en hiver) : erreur bloquante, comme avant', () => {
    const f = feuilleHiver();
    const bv = ligneDe(f, 'Bellevue', ligneDe(f, 'HORAIRES DES DESCENTES'));
    pose(f, bv, 'C', heure(8, 20)); // le TRAIN 20 partirait de Bellevue
    pose(f, bv + 1, 'C', heure(8, 26)); // Col de Voza A
    const r = parseFeuille(f);
    expect(r.erreurs.map((e) => e.message)).toEqual([
      'TRAIN 20 : descente sans montée appariée (TRAIN 19 absent) (feuille « Hiver »)',
    ]);
  });

  it('un tiret sur la ligne A d’une gare qui n’est PAS l’origine reste une erreur', () => {
    const f = feuilleHiver();
    const mo = ligneDe(f, 'Motivon', ligneDe(f, 'HORAIRES DES DESCENTES'));
    pose(f, mo, 'C', '-');
    expect(parseFeuille(f).erreurs.map((e) => e.message)).toEqual([
      "TRAIN 20, Motivon : tiret sur la ligne A mais une heure sur l'autre — un train qui ne s'arrête pas porte un tiret sur les deux lignes (feuille « Hiver », ligne " +
        mo +
        ', colonne C)',
    ]);
  });
});

describe('montée sans descente : même règle, dans l’autre sens', () => {
  /** Ajoute une montée TRAIN 17 en colonne K, qui s'arrête à `terminus`. */
  function avecMontee17(terminus: 'col-de-voza' | 'bellevue', tiretDVoza = true): FeuilleCellules {
    const f = feuilleHiver();
    const debut = ligneDe(f, 'HORAIRES DES MONTEES');
    pose(f, debut + 1, 'K', 'Train 17');
    const lf = ligneDe(f, 'Le Fayet', debut);
    const valeurs: Cellule[] = [
      heure(17, 0), // Le Fayet D
      heure(17, 10), // St Gervais A
      heure(17, 15), // D
      heure(17, 26), // Motivon A
      heure(17, 27), // D
      heure(17, 40), // Col de Voza A
      terminus === 'bellevue' ? heure(17, 42) : tiretDVoza ? '-' : heure(17, 42), // D
      terminus === 'bellevue' ? heure(17, 47) : '-', // Bellevue A
    ];
    valeurs.forEach((v, i) => pose(f, lf + i, 'K', v));
    return f;
  }

  it('qui s’arrête à Col de Voza (heure en A, tiret en D) : avertissement nommant la gare', () => {
    const r = parseFeuille(avecMontee17('col-de-voza'));
    expect(r.erreurs).toEqual([]);
    expect(r.grille?.montees.find((m) => m.numero === 17)?.passages.slice(-1)[0]).toEqual({
      gare: 'col-de-voza',
      a: '17:40:00',
    });
    expect(r.avertissements.map((a) => a.message)).toContain(
      "TRAIN 17 : montée sans descente appariée, jusqu'à Col de Voza (feuille « Hiver »)",
    );
  });

  it('qui monte jusqu’au sommet : l’avertissement d’avant, inchangé', () => {
    const r = parseFeuille(avecMontee17('bellevue'));
    expect(r.erreurs).toEqual([]);
    expect(r.avertissements.map((a) => a.message)).toContain(
      'TRAIN 17 : montée sans descente appariée (TRAIN 18 absent) (feuille « Hiver »)',
    );
  });

  it('un tiret en D ailleurs qu’au terminus reste une erreur', () => {
    const f = feuilleHiver();
    const debut = ligneDe(f, 'HORAIRES DES MONTEES');
    const mo = ligneDe(f, 'Motivon', debut);
    pose(f, mo + 1, 'C', '-'); // TRAIN 1, Motivon D
    expect(parseFeuille(f).erreurs.map((e) => e.message)).toEqual([
      "TRAIN 1, Motivon : tiret sur la ligne D mais une heure sur l'autre — un train qui ne s'arrête pas porte un tiret sur les deux lignes (feuille « Hiver », ligne " +
        (mo + 1) +
        ', colonne C)',
    ]);
  });
});

describe('le document d’exploitation se refait, « Samedi » compris', () => {
  const g = grilleHiver();

  it('export → import : 0 écart, jours compris', () => {
    const f = cellulesGrille(g);
    const relu = parseFeuille(f);
    expect(relu.erreurs).toEqual([]);
    const e = ecarts(g, relu.grille as Grille);
    expect(e.jours).toEqual([]);
    expect(e.aucun).toBe(true);
    // « Samedi » dans la ligne des lettres, au-dessus de « Train 20 ».
    const iNumeros = f.lignes.findIndex((l) => l.includes('Train 20'));
    const colonne = f.lignes[iNumeros]?.indexOf('Train 20') ?? -1;
    expect(f.lignes[iNumeros + 1]?.[colonne]).toBe('Samedi');
    // Et Col de Voza, son origine, porte un tiret sur sa ligne A.
    const voza = f.lignes.findIndex((l, i) => i > iNumeros && l[0] === 'Col de Voza');
    expect(f.lignes[voza]?.[1]).toBe('A');
    expect(f.lignes[voza]?.[colonne]).toBe('-');
  });

  it('un jour retiré ou changé est un ÉCART (l’aperçu le dit)', () => {
    const sansJours = structuredClone(g);
    const t20 = sansJours.descentes.find((d) => d.numero === 20);
    if (t20) delete t20.jours;
    expect(ecarts(g, sansJours).jours).toEqual([
      { numero: 20, sens: 'descente', avant: [6], apres: null },
    ]);
    expect(ecarts(g, sansJours).aucun).toBe(false);
  });
});

describe('lecture en base (contenu jsonb)', () => {
  const g = grilleHiver();
  const ligne = (contenu: unknown) => ({
    version: '2026-2027-hiver',
    libelle: 'Hiver 2026-2027',
    source: null,
    periodes: g.periodes,
    actif: true,
    cree_le: '2026-10-16T10:00:00+00:00',
    cree_par: null,
    commentaire: null,
    contenu,
  });

  it('les jours survivent à la relecture ; un train sans jours n’en gagne pas', () => {
    const lue = grilleDepuisEnregistrement(ligne(structuredClone(g)));
    expect(lue.descentes.find((d) => d.numero === 20)?.jours).toEqual([6]);
    expect('jours' in (lue.descentes.find((d) => d.numero === 2) ?? {})).toBe(false);
  });

  it('des jours illisibles rendent la grille illisible (jamais « tous les jours » par défaut)', () => {
    for (const jours of [[], [0], [8], [6, 6], ['samedi'], 6]) {
      const c = structuredClone(g) as unknown as { descentes: Array<{ jours?: unknown }> };
      const t20 = c.descentes[0];
      if (t20) t20.jours = jours;
      expect(() => grilleDepuisEnregistrement(ligne(c)), JSON.stringify(jours)).toThrow(
        /contenu illisible/,
      );
    }
  });
});
