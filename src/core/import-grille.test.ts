// Import des horaires : l'Excel exploitation été 2026 (cellules extraites en
// JSON) doit reproduire EXACTEMENT les deux grilles officielles ; un fichier
// cassé doit être refusé avec un message qui nomme feuille, ligne et colonne.
import { describe, expect, it } from 'vitest';

import cellulesJson from './__fixtures__/2026-ete-exploit-v1.cellules.json';
import grandServiceJson from '../../public/grilles/2026-ete-grand-service.json';
import petitServiceJson from '../../public/grilles/2026-ete-petit-service.json';
import {
  ARRETS_HABITUELS_S,
  avertissementsGrillePrecedente,
  chevauchementsPeriodes,
  interpreteHeure,
  lettreColonne,
  libelleProposee,
  parseClasseur,
  parseFeuille,
  periodesDepuisTitre,
  versionDisponible,
  versionProposee,
  type Cellule,
  type FeuilleCellules,
} from './import-grille';
import type { Grille, TrainGrille } from './types';

const GRAND = grandServiceJson as unknown as Grille;
const PETIT = petitServiceJson as unknown as Grille;
const FEUILLES = cellulesJson.feuilles as FeuilleCellules[];

function feuille(nom: 'Petit service' | 'Grand service'): FeuilleCellules {
  const f = FEUILLES.find((x) => x.nom === nom);
  if (!f) throw new Error(`feuille ${nom} absente de la fixture`);
  return structuredClone(f);
}

/** Cellule (ligne et colonne Excel, 1 = première) → valeur. */
function pose(f: FeuilleCellules, ligne: number, colonne: string, valeur: Cellule): void {
  const c = colonne.charCodeAt(0) - 65;
  const l = f.lignes[ligne - 1];
  if (!l) throw new Error(`ligne ${ligne} absente`);
  l[c] = valeur;
}

/** Comparaison structurelle des trains (passages {gare, a?, d?}). */
function canon(trains: TrainGrille[]): unknown[] {
  return trains.map((t) => ({
    numero: t.numero,
    express: t.express,
    facultatif: t.facultatif,
    velos: t.velos,
    passages: t.passages.map((p) => ({ gare: p.gare, a: p.a ?? null, d: p.d ?? null })),
  }));
}

function erreurs(f: FeuilleCellules): string[] {
  return parseFeuille(f).erreurs.map((e) => e.message);
}

// ---------------------------------------------------------------------------

describe('parseClasseur sur le document d’exploitation été 2026 (oracle : les JSON officiels)', () => {
  const resultat = parseClasseur(FEUILLES);

  it('trouve les deux feuilles d’horaires, sans erreur ni avertissement', () => {
    expect(resultat.erreurs).toEqual([]);
    expect(resultat.feuilles.map((f) => f.nom)).toEqual(['Petit service', 'Grand service']);
    for (const f of resultat.feuilles) {
      expect(f.erreurs).toEqual([]);
      expect(f.avertissements).toEqual([]);
      expect(f.grille).not.toBeNull();
    }
  });

  it('Grand service : 13 montées et 13 descentes, heures et indicateurs IDENTIQUES au JSON officiel', () => {
    const g = resultat.feuilles[1]?.grille;
    if (!g) throw new Error('grille absente');
    expect(canon(g.montees)).toEqual(canon(GRAND.montees));
    expect(canon(g.descentes)).toEqual(canon(GRAND.descentes));
    expect(g.gares).toEqual(GRAND.gares);
    expect(g.arret_intermediaire_s).toBe(60);
  });

  it('Petit service : 8 montées et 8 descentes identiques au JSON officiel', () => {
    const g = resultat.feuilles[0]?.grille;
    if (!g) throw new Error('grille absente');
    expect(canon(g.montees)).toEqual(canon(PETIT.montees));
    expect(canon(g.descentes)).toEqual(canon(PETIT.descentes));
  });

  it('lit le titre, la date de mise à jour et propose les périodes du titre', () => {
    const [petit, grand] = resultat.feuilles;
    expect(petit?.titre).toMatch(/^HORAIRES PETIT SERVICE DU 13 JUIN AU 3 JUILLET 2026/);
    expect(petit?.miseAJour).toBe('05/06/2026');
    expect(petit?.periodesProposees).toEqual(PETIT.periodes);
    expect(grand?.periodesProposees).toEqual(GRAND.periodes);
    expect(grand?.grille?.source).toBe('Mise à jour du 05/06/2026');
  });

  it('propose identifiant et libellé depuis le nom de feuille et les périodes', () => {
    expect(versionProposee('Grand service', GRAND.periodes)).toBe('2026-ete-grand-service');
    expect(versionProposee('Petit service', PETIT.periodes)).toBe('2026-ete-petit-service');
    expect(libelleProposee('Grand service', GRAND.periodes)).toBe('Grand service — été 2026');
    const hiver = [{ du: '2026-12-19', au: '2027-04-11' }];
    expect(versionProposee('Hiver', hiver)).toBe('2026-2027-hiver');
    expect(libelleProposee('Hiver', hiver)).toBe('Hiver 2026-2027');
    expect(versionProposee('Grand service', [])).toBeNull();
    expect(libelleProposee('Grand service', [])).toBe('Grand service');
  });

  it('la halte de Mont Lachat est lue puis ignorée', () => {
    const g = resultat.feuilles[1]?.grille;
    const gares = new Set(g?.montees.flatMap((t) => t.passages.map((p) => p.gare)));
    expect([...gares]).not.toContain('mont-lachat');
    expect(gares.size).toBe(6);
  });
});

describe('classeur sans feuille d’horaires', () => {
  it('refuse un classeur dont aucune feuille ne porte les deux titres, en nommant les feuilles lues', () => {
    const f = feuille('Grand service');
    pose(f, 3, 'A', 'HORAIRES');
    const r = parseClasseur([f, { nom: 'Notes', lignes: [['bonjour']] }]);
    expect(r.feuilles).toEqual([]);
    expect(r.erreurs[0]?.message).toMatch(/Aucune feuille ne contient les titres/);
    expect(r.erreurs[0]?.message).toMatch(/« Grand service », « Notes »/);
  });

  it('une feuille renommée reste reconnue : seul le contenu compte, le nom devient le libellé', () => {
    const f = { ...feuille('Grand service'), nom: 'Copie de Feuil1' };
    const r = parseClasseur([f]);
    expect(r.feuilles).toHaveLength(1);
    expect(r.feuilles[0]?.grille?.libelle).toBe('Copie de Feuil1');
    expect(r.feuilles[0]?.erreurs).toEqual([]);
  });

  it('les feuilles sans titres (légende, brouillon) sont ignorées, pas refusées', () => {
    const r = parseClasseur([
      { nom: 'Légende', lignes: [['R', 'facultatif']] },
      feuille('Petit service'),
    ]);
    expect(r.feuilles.map((f) => f.nom)).toEqual(['Petit service']);
  });
});

describe('fichiers cassés : refus avec message précis', () => {
  it('heure vide → « Heure manquante » avec train, gare, feuille, ligne et colonne', () => {
    const f = feuille('Grand service');
    pose(f, 9, 'G', null); // Motivon, arrivée, TRAIN 9
    expect(erreurs(f)).toEqual([
      'Heure manquante : TRAIN 9, Motivon, arrivée (feuille « Grand service », ligne 9, colonne G)',
    ]);
  });

  it('train en double dans la ligne des trains', () => {
    const f = feuille('Grand service');
    pose(f, 4, 'D', 'Train 1');
    const messages = erreurs(f);
    expect(messages.some((m) => /TRAIN 1 apparaît deux fois \(colonnes C et D\)/.test(m))).toBe(
      true,
    );
  });

  it('colonne décalée : les heures ne sont plus sous leur train → heures manquantes signalées', () => {
    const f = feuille('Grand service');
    const entete = f.lignes[3];
    if (!entete) throw new Error('ligne 4 absente');
    entete.splice(2, 0, null); // tout l'en-tête glisse d'une colonne vers la droite
    entete.pop();
    const messages = erreurs(f);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => /Heure manquante : TRAIN 25/.test(m))).toBe(true);
  });

  it('montée paire / descente impaire', () => {
    const f = feuille('Petit service');
    pose(f, 4, 'C', 'Train 2');
    expect(erreurs(f).some((m) => /TRAIN 2 : une montée porte un numéro impair/.test(m))).toBe(
      true,
    );
    const d = feuille('Petit service');
    pose(d, 19, 'C', 'Train 3');
    expect(erreurs(d).some((m) => /TRAIN 3 : une descente porte un numéro pair/.test(m))).toBe(
      true,
    );
  });

  it('« Train n°1 » n’est pas reconnu et le dit', () => {
    const f = feuille('Petit service');
    pose(f, 4, 'C', 'Train n°1');
    expect(
      erreurs(f).some((m) => /« Train n°1 » n'est pas un numéro de train reconnu/.test(m)),
    ).toBe(true);
  });

  it('tirets à Col de Voza et Bellevue sans le symbole express → refus', () => {
    const f = feuille('Grand service');
    pose(f, 5, 'G', 'R'); // TRAIN 9 perd son ÿ
    expect(erreurs(f)).toEqual([
      'TRAIN 9 : passages absents à Col de Voza et Bellevue sans le symbole express (ÿ) (feuille « Grand service »)',
    ]);
  });

  it('symbole express sur un train qui s’arrête à Col de Voza et Bellevue → refus', () => {
    const f = feuille('Grand service');
    pose(f, 5, 'D', 'Rbÿ'); // TRAIN 3
    expect(erreurs(f)).toEqual([
      "TRAIN 3 : symbole express (ÿ) mais des heures à Col de Voza et Bellevue — un express ne s'y arrête pas (feuille « Grand service »)",
    ]);
  });

  it('tiret sur la ligne A mais heure sur la ligne D', () => {
    const f = feuille('Grand service');
    pose(f, 11, 'C', '-'); // TRAIN 1, Col de Voza, arrivée
    expect(erreurs(f)[0]).toMatch(
      /TRAIN 1, Col de Voza : tiret sur la ligne A mais une heure sur l'autre.*ligne 11, colonne C/,
    );
  });

  it('un seul passage manquant (tirets à Motivon) → refus, tous les trains desservent Motivon', () => {
    const f = feuille('Petit service');
    pose(f, 9, 'C', '-');
    pose(f, 10, 'C', '-');
    expect(erreurs(f)).toEqual([
      'TRAIN 1 : passage absent à Motivon — tous les trains desservent cette gare (feuille « Petit service »)',
    ]);
  });

  it('texte qui n’est pas une heure → refus avec les formats acceptés', () => {
    const f = feuille('Petit service');
    pose(f, 6, 'C', 'sept heures');
    expect(erreurs(f)).toEqual([
      "« sept heures » n'est pas une heure (TRAIN 1, Le Fayet, départ) — formats acceptés : 7:26, 07:26:30, 7h26 (feuille « Petit service », ligne 6, colonne C)",
    ]);
  });

  it('gare inconnue en colonne A', () => {
    const f = feuille('Petit service');
    pose(f, 9, 'A', 'Chamonix');
    const messages = erreurs(f);
    expect(messages[0]).toMatch(/Gare inconnue « Chamonix ».*ligne 9, colonne A/);
  });

  it('heures qui ne se suivent pas le long de la ligne', () => {
    const f = feuille('Petit service');
    pose(f, 9, 'C', 0.5); // TRAIN 1 arrive à Motivon à 12:00, après Col de Voza
    pose(f, 10, 'C', 0.51);
    const messages = erreurs(f);
    expect(
      messages.some((m) =>
        /TRAIN 1 : Col de Voza \(07:40\) n'est pas après Motivon \(12:14\)/.test(m),
      ),
    ).toBe(true);
  });

  it('arrivée après le départ dans une même gare', () => {
    const f = feuille('Petit service');
    pose(f, 7, 'C', 0.32); // Saint-Gervais A 07:40:48 > D 07:15
    expect(
      erreurs(f).some((m) =>
        /TRAIN 1, Saint-Gervais : arrivée 07:40 après le départ 07:15/.test(m),
      ),
    ).toBe(true);
  });

  it('titre des descentes absent → refus, grille non construite', () => {
    const f = feuille('Petit service');
    pose(f, 18, 'A', 'RETOURS');
    const r = parseFeuille(f);
    expect(r.grille).toBeNull();
    expect(r.erreurs.map((e) => e.message)).toEqual([
      'Titre « HORAIRES DES DESCENTES » absent de la colonne A (feuille « Petit service »)',
    ]);
  });

  it('descente sans montée appariée', () => {
    const f = feuille('Petit service');
    pose(f, 19, 'D', 'Train 4'); // la descente 6 devient 4 : plus de TRAIN 3 en face
    expect(erreurs(f)).toEqual([
      'TRAIN 4 : descente sans montée appariée (TRAIN 3 absent) (feuille « Petit service »)',
    ]);
  });
});

describe('avertissements (acquittables)', () => {
  it('durée d’arrêt inhabituelle', () => {
    const f = feuille('Petit service');
    pose(f, 8, 'C', 0.30277777777777776); // TRAIN 1 repart de Saint-Gervais à 07:16 (6 min)
    const r = parseFeuille(f);
    expect(r.erreurs).toEqual([]);
    expect(r.avertissements.map((a) => a.message)).toEqual([
      'TRAIN 1 : arrêt de 6 min à Saint-Gervais (habituellement 5 min) (feuille « Petit service »)',
    ]);
    // Les valeurs habituelles diffèrent selon le sens : 2 min à Saint-Gervais en descente
    expect(ARRETS_HABITUELS_S.descente['saint-gervais']).toBe(120);
  });

  it('descente qui part avant l’arrivée de sa montée (rotation impossible)', () => {
    const f = feuille('Petit service');
    pose(f, 21, 'C', 0.3333333333333333); // TRAIN 2 part du Nid d'Aigle à 08:00 (TRAIN 1 arrive à 08:05:30)
    const r = parseFeuille(f);
    expect(r.avertissements.map((a) => a.message)).toEqual([
      "Rotation TRAIN 1 / TRAIN 2 : la descente part à 08:00 avant l'arrivée de la montée à 08:05 (feuille « Petit service »)",
    ]);
  });

  it('montée sans descente appariée', () => {
    const f = feuille('Petit service');
    pose(f, 19, 'C', 'Train 32'); // la descente 2 devient 32 : TRAIN 1 reste sans retour, et 32 sans montée
    const r = parseFeuille(f);
    expect(r.erreurs.map((e) => e.message)).toEqual([
      'TRAIN 32 : descente sans montée appariée (TRAIN 31 absent) (feuille « Petit service »)',
    ]);
    expect(r.avertissements.map((a) => a.message)).toEqual([
      'TRAIN 1 : montée sans descente appariée (TRAIN 2 absent) (feuille « Petit service »)',
    ]);
  });

  it('heure d’arrivée au point de départ ignorée avec avertissement', () => {
    const f = feuille('Petit service');
    const lignes = f.lignes;
    // On insère une ligne « A » pour Le Fayet avant sa ligne « D »
    const ligneA: Cellule[] =
      lignes[5]?.map((v, i) => (i === 1 ? 'A' : typeof v === 'number' ? v - 0.002 : v)) ?? [];
    ligneA[0] = null;
    lignes.splice(5, 0, ['Le Fayet', 'A', ...ligneA.slice(2)]);
    lignes[6]![0] = null; // la ligne D suivante prend la gare courante
    const r = parseFeuille(f);
    expect(r.erreurs).toEqual([]);
    expect(
      r.avertissements.some((a) =>
        /TRAIN 1 : heure d'arrivée au point de départ \(Le Fayet\) ignorée/.test(a.message),
      ),
    ).toBe(true);
    expect(r.grille?.montees[0]?.passages[0]).toEqual({ gare: 'le-fayet', d: '07:00:00' });
  });

  it('comparaison avec la grille précédente : trains disparus et indicateurs différents, le fichier fait foi', () => {
    const nouvelle: Grille = {
      ...GRAND,
      montees: GRAND.montees
        .filter((m) => m.numero !== 25)
        .map((m) => (m.numero === 3 ? { ...m, velos: false } : m)),
    };
    const messages = avertissementsGrillePrecedente(nouvelle, GRAND).map((a) => a.message);
    expect(messages).toContain(
      'TRAIN 25 (montée) présent dans la grille précédente « Grand service — été 2026 », absent de la nouvelle',
    );
    expect(messages).toContain('TRAIN 3 : velos oui → non dans le fichier (le fichier fait foi)');
  });
});

describe('heures, périodes du titre, identifiants', () => {
  it('interprète les nombres Excel avec leurs secondes et les textes usuels', () => {
    expect(interpreteHeure(0.31006944444444445)).toEqual({
      type: 'heure',
      texte: '07:26:30',
      s: 26790,
    });
    expect(interpreteHeure('7:26')).toMatchObject({ type: 'heure', texte: '07:26:00' });
    expect(interpreteHeure('07:26:30')).toMatchObject({ type: 'heure', texte: '07:26:30' });
    expect(interpreteHeure('7h26')).toMatchObject({ type: 'heure', texte: '07:26:00' });
    expect(interpreteHeure(' - ')).toEqual({ type: 'sansArret' });
    expect(interpreteHeure(null)).toEqual({ type: 'vide' });
    expect(interpreteHeure('')).toEqual({ type: 'vide' });
    expect(interpreteHeure('25:00')).toEqual({ type: 'invalide', brut: '25:00' });
    expect(interpreteHeure(1.5)).toEqual({ type: 'invalide', brut: '1.5' });
    expect(interpreteHeure('2380m')).toEqual({ type: 'invalide', brut: '2380m' });
  });

  it('lit les périodes du titre, année reprise de la seconde borne', () => {
    expect(
      periodesDepuisTitre(
        'HORAIRES PETIT SERVICE DU 13 JUIN AU 3 JUILLET 2026 \r\nET DU 31 AOUT AU 27 SEPTEMBRE 2026',
      ),
    ).toEqual([
      { du: '2026-06-13', au: '2026-07-03' },
      { du: '2026-08-31', au: '2026-09-27' },
    ]);
    expect(periodesDepuisTitre('HORAIRES GRAND SERVICE DU 4 JUILLET AU 30 AOUT 2026')).toEqual([
      { du: '2026-07-04', au: '2026-08-30' },
    ]);
  });

  it('période qui franchit le Nouvel An, avec ou sans année sur la première borne', () => {
    expect(periodesDepuisTitre('Horaires hiver du 19 décembre 2026 au 11 avril 2027')).toEqual([
      { du: '2026-12-19', au: '2027-04-11' },
    ]);
    expect(periodesDepuisTitre('HORAIRES HIVER DU 19 DECEMBRE AU 11 AVRIL 2027')).toEqual([
      { du: '2026-12-19', au: '2027-04-11' },
    ]);
    expect(periodesDepuisTitre('DU 1ER JUILLET 2026 AU 31 AOUT')).toEqual([
      { du: '2026-07-01', au: '2026-08-31' },
    ]);
  });

  it('sans aucune année, ou avec une date impossible : rien n’est proposé', () => {
    expect(periodesDepuisTitre('HORAIRES DU 13 JUIN AU 3 JUILLET')).toEqual([]);
    expect(periodesDepuisTitre('DU 31 FEVRIER 2026 AU 3 MARS 2026')).toEqual([]);
    expect(periodesDepuisTitre('HORAIRES DES MONTEES')).toEqual([]);
  });

  it('versionDisponible ne réutilise jamais une version : -v2, -v3…', () => {
    expect(versionDisponible('2026-ete-grand-service', [])).toBe('2026-ete-grand-service');
    expect(versionDisponible('2026-ete-grand-service', ['2026-ete-grand-service'])).toBe(
      '2026-ete-grand-service-v2',
    );
    expect(
      versionDisponible('2026-ete-grand-service', [
        '2026-ete-grand-service',
        '2026-ete-grand-service-v2',
      ]),
    ).toBe('2026-ete-grand-service-v3');
  });

  it('deux feuilles du même classeur ne peuvent pas se chevaucher', () => {
    const problemes = chevauchementsPeriodes([
      { nom: 'Petit service', periodes: PETIT.periodes },
      { nom: 'Grand service', periodes: GRAND.periodes },
    ]);
    expect(problemes).toEqual([]);
    const conflit = chevauchementsPeriodes([
      { nom: 'Petit service', periodes: [{ du: '2026-06-13', au: '2026-07-10' }] },
      { nom: 'Grand service', periodes: GRAND.periodes },
    ]);
    expect(conflit.map((p) => p.message)).toEqual([
      'Les dates de « Petit service » (2026-06-13 → 2026-07-10) et de « Grand service » (2026-07-04 → 2026-08-30) se chevauchent : une seule grille par jour',
    ]);
  });

  it('lettres de colonnes Excel', () => {
    expect(lettreColonne(0)).toBe('A');
    expect(lettreColonne(6)).toBe('G');
    expect(lettreColonne(25)).toBe('Z');
    expect(lettreColonne(26)).toBe('AA');
  });
});
