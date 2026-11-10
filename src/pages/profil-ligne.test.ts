// Profil de la ligne — géométrie et dessin (src/pages/profil-ligne.ts).
//
// Ce que ces tests protègent : le profil est un DESSIN QUI RENSEIGNE. Une
// gare posée à la mauvaise hauteur, une machine dessinée là où elle n'est
// pas ou tournée dans le mauvais sens, un tronçon fermé qui reste à l'écran,
// ou une couleur de rame injectée telle quelle dans un attribut seraient des
// fautes d'information, pas des défauts d'ornement.
import { describe, expect, it } from 'vitest';
import type { AvancementTrain, GareGrille, Machine, PositionTrain } from '../core/types';
import {
  BOITE_PROFIL,
  capSurVoie,
  pointSurVoie,
  pointsProfil,
  profilSvg,
  sigleGare,
  SIGLES_GARES,
  trainsSurProfil,
} from './profil-ligne';

const GARES: GareGrille[] = [
  { id: 'le-fayet', nom: 'Le Fayet', altitude_m: 580 },
  { id: 'saint-gervais', nom: 'Saint-Gervais', altitude_m: 786 },
  { id: 'motivon', nom: 'Motivon', altitude_m: 1375 },
  { id: 'col-de-voza', nom: 'Col de Voza', altitude_m: 1653 },
  { id: 'bellevue', nom: 'Bellevue', altitude_m: 1794 },
  { id: 'nid-daigle', nom: "Nid d'Aigle", altitude_m: 2412 },
];

const MACHINES: Machine[] = [
  { nom: 'Marie', couleur: '#2E74B5', en_service: true },
  { nom: 'Marguerite', couleur: '#FFFFFF', cercle: '#E52A23', en_service: true },
];

describe('pointsProfil — les gares sur la pente', () => {
  const points = pointsProfil(GARES);

  it('une gare par gare de la grille, dans l’ordre de la ligne', () => {
    expect(points.map((p) => p.id)).toEqual(GARES.map((g) => g.id));
  });

  it('les abscisses avancent régulièrement, de marge à marge', () => {
    const pas = points.slice(1).map((p, i) => p.x - (points[i]?.x ?? 0));
    for (const d of pas) expect(d).toBeCloseTo(pas[0] ?? 0, 0);
    expect(points[0]?.x).toBe(BOITE_PROFIL.margeX);
    expect(points[points.length - 1]?.x).toBe(BOITE_PROFIL.largeur - BOITE_PROFIL.margeX);
  });

  it('plus la gare est haute, plus son point est HAUT (ordonnée plus petite)', () => {
    for (let i = 1; i < points.length; i++) {
      expect(points[i]?.y).toBeLessThan(points[i - 1]?.y ?? 0);
    }
  });

  it('les ordonnées sont proportionnelles aux altitudes RÉELLES', () => {
    // Motivon (1 375 m) est à (1375 − 580) / (2412 − 580) = 43,4 % de la montée.
    const [bas, , motivon] = points;
    const haut = points[points.length - 1];
    const part = ((bas?.y ?? 0) - (motivon?.y ?? 0)) / ((bas?.y ?? 0) - (haut?.y ?? 1));
    expect(part).toBeCloseTo((1375 - 580) / (2412 - 580), 2);
  });

  it('le dessin tient dans sa boîte, marges comprises', () => {
    for (const p of points) {
      expect(p.y).toBeGreaterThanOrEqual(BOITE_PROFIL.margeHaut);
      expect(p.y).toBeLessThanOrEqual(BOITE_PROFIL.hauteur - BOITE_PROFIL.margeBas);
    }
  });

  it('aucune gare, aucun point — et aucune division par zéro à altitude égale', () => {
    expect(pointsProfil([])).toEqual([]);
    const plat = pointsProfil([
      { id: 'le-fayet', nom: 'A', altitude_m: 500 },
      { id: 'saint-gervais', nom: 'B', altitude_m: 500 },
    ]);
    expect(plat.every((p) => Number.isFinite(p.y))).toBe(true);
  });
});

describe('pointsProfil — la ligne DU JOUR : rien au-dessus du sommet', () => {
  const hiver = pointsProfil(GARES, 'bellevue');

  it('en hiver, le Nid d’Aigle n’est PAS dessiné : le profil va du Fayet à Bellevue', () => {
    expect(hiver.map((p) => p.id)).toEqual([
      'le-fayet',
      'saint-gervais',
      'motivon',
      'col-de-voza',
      'bellevue',
    ]);
  });

  it('le profil d’hiver occupe TOUTE la boîte : Bellevue est en haut à droite', () => {
    const sommet = hiver[hiver.length - 1];
    expect(sommet?.x).toBe(BOITE_PROFIL.largeur - BOITE_PROFIL.margeX);
    expect(sommet?.y).toBe(BOITE_PROFIL.margeHaut);
    expect(hiver[0]?.y).toBe(BOITE_PROFIL.hauteur - BOITE_PROFIL.margeBas);
  });

  it('sommet inconnu, ou absent des gares : la ligne entière — on ne retire rien à tort', () => {
    expect(pointsProfil(GARES, null)).toHaveLength(6);
    expect(pointsProfil(GARES.slice(0, 3), 'bellevue')).toHaveLength(3);
  });

  it('le dessin d’hiver ne porte ni le point, ni le sigle, ni l’altitude du Nid d’Aigle', () => {
    const svg = profilSvg({ gares: GARES, sommet: 'bellevue' });
    expect(svg).not.toContain('Nid d');
    expect(svg).not.toContain('>NDA<');
    expect(svg).not.toContain('2 412');
    expect(svg).toContain('>BLV<');
    expect(svg).toContain('1 794 m');
    expect(svg.match(/class="profil-gare/g)).toHaveLength(5);
    expect(svg.match(/<polyline/g)).toHaveLength(1);
  });
});

describe('sigles des gares', () => {
  it('ceux de l’exploitant, gare par gare', () => {
    expect(GARES.map((g) => sigleGare(g))).toEqual(['FAY', 'STG', 'MOT', 'CDV', 'BLV', 'NDA']);
    expect(Object.keys(SIGLES_GARES)).toHaveLength(6);
  });

  it('une gare inconnue reçoit ses initiales, plutôt que rien', () => {
    const inconnue = { id: 'mont-lachat', nom: 'Mont Lachat' } as unknown as GareGrille;
    expect(sigleGare(inconnue)).toBe('ML');
    const composee = { id: 'x', nom: "Pont de l'Arve-Nord" } as unknown as GareGrille;
    expect(sigleGare(composee)).toBe('PDLAN');
  });

  it('chaque gare dessinée porte son sigle, au-dessus de son point', () => {
    const svg = profilSvg({ gares: GARES });
    const points = pointsProfil(GARES);
    for (const p of points) {
      const y = Number(
        new RegExp(`class="profil-sigle" x="${p.x}" y="([\\d.-]+)"[^>]*>${sigleGare(p)}<`).exec(
          svg,
        )?.[1],
      );
      expect(y, `sigle de ${p.id}`).toBeLessThan(p.y);
    }
  });

  it('le sigle de la gare du poste passe AU-DESSUS de l’anneau (rayon 14)', () => {
    const svg = profilSvg({ gares: GARES, ici: 'motivon' });
    const motivon = pointsProfil(GARES)[2];
    const y = Number(/class="profil-sigle ici" x="[\d.]+" y="([\d.-]+)"/.exec(svg)?.[1]);
    expect(y).toBeLessThan((motivon?.y ?? 0) - 14);
    expect(svg.match(/class="profil-sigle ici"/g)).toHaveLength(1);
  });
});

describe('pointSurVoie et capSurVoie — suivre le tracé', () => {
  const points = pointsProfil(GARES);

  it('un rang entier est une gare ; un demi-rang, le milieu du tronçon', () => {
    expect(pointSurVoie(points, 2)).toEqual({ x: points[2]?.x, y: points[2]?.y });
    const milieu = pointSurVoie(points, 2.5);
    expect(milieu?.x).toBeCloseTo(((points[2]?.x ?? 0) + (points[3]?.x ?? 0)) / 2, 5);
    expect(milieu?.y).toBeCloseTo(((points[2]?.y ?? 0) + (points[3]?.y ?? 0)) / 2, 5);
  });

  it('hors de la ligne, le point est ramené au bout — jamais au-delà', () => {
    expect(pointSurVoie(points, -3)).toEqual({ x: points[0]?.x, y: points[0]?.y });
    expect(pointSurVoie(points, 99)).toEqual({ x: points[5]?.x, y: points[5]?.y });
    expect(pointSurVoie([], 1)).toBeNull();
  });

  it('en montée la machine regarde vers le haut à droite, en descente à l’opposé', () => {
    const montee = capSurVoie(points, 2.5, 'montee');
    const descente = capSurVoie(points, 2.5, 'descente');
    expect(montee).toBeLessThan(0); // vers le haut (ordonnées vers le bas)
    expect(montee).toBeGreaterThan(-90); // et vers la droite
    expect(descente).toBeCloseTo(montee + 180, 1);
  });

  it('à quai, le cap est celui du tronçon qu’elle s’apprête à prendre', () => {
    // À Motivon (rang 2) : en montée, la pente Motivon → Col de Voza ; en
    // descente, la pente Saint-Gervais → Motivon, retournée.
    expect(capSurVoie(points, 2, 'montee')).toBe(capSurVoie(points, 2.5, 'montee'));
    expect(capSurVoie(points, 2, 'descente')).toBe(capSurVoie(points, 1.5, 'descente'));
  });

  it('au bout de la ligne, le cap reste celui du tronçon d’arrivée — pas un cap inventé', () => {
    expect(capSurVoie(points, 5, 'montee')).toBe(capSurVoie(points, 4.5, 'montee'));
    expect(capSurVoie(points, 0, 'descente')).toBe(capSurVoie(points, 0.5, 'descente'));
  });
});

describe('trainsSurProfil — où poser une machine', () => {
  const points = pointsProfil(GARES);
  const avancement = (
    gare: PositionTrain['gare'],
    vers: PositionTrain['vers'],
    part: number,
    sens: PositionTrain['sens'] = 'montee',
  ): AvancementTrain => ({ numero: 9, sens, rame: 'Marie', gare, vers, part });

  it('à quai : SUR la gare', () => {
    const [t] = trainsSurProfil(points, [avancement('motivon', null, 0)]);
    expect(t).toMatchObject({ x: points[2]?.x, y: points[2]?.y, enRoute: false });
  });

  it('en route : le long du tronçon, à la part de trajet donnée', () => {
    const [a, b] = [points[2], points[3]];
    const [quart] = trainsSurProfil(points, [avancement('motivon', 'col-de-voza', 0.25)]);
    expect(quart?.x).toBeCloseTo((a?.x ?? 0) + ((b?.x ?? 0) - (a?.x ?? 0)) * 0.25, 0);
    expect(quart?.y).toBeCloseTo((a?.y ?? 0) + ((b?.y ?? 0) - (a?.y ?? 0)) * 0.25, 0);
    expect(quart?.enRoute).toBe(true);
    // Plus de trajet fait = plus loin vers la gare suivante.
    const [troisQuarts] = trainsSurProfil(points, [avancement('motivon', 'col-de-voza', 0.75)]);
    expect(troisQuarts?.x).toBeGreaterThan(quart?.x ?? 0);
  });

  it('en descente, la machine avance vers la GAUCHE et regarde vers le bas', () => {
    const [t] = trainsSurProfil(points, [avancement('bellevue', 'col-de-voza', 0.5, 'descente')]);
    expect(t?.x).toBeLessThan(points[4]?.x ?? 0);
    expect(t?.x).toBeGreaterThan(points[3]?.x ?? 0);
    expect(t?.cap).toBeGreaterThan(90);
  });

  it('un express SUIT le tracé : à mi-trajet Motivon → Nid d’Aigle, il est sur la voie', () => {
    // Rang 2 + 0,5 × 3 = 3,5 : au milieu du tronçon Col de Voza → Bellevue,
    // pas au milieu de la corde qui couperait droit.
    const [t] = trainsSurProfil(points, [avancement('motivon', 'nid-daigle', 0.5)]);
    const surVoie = pointSurVoie(points, 3.5);
    expect(t?.x).toBeCloseTo(surVoie?.x ?? 0, 0);
    expect(t?.y).toBeCloseTo(surVoie?.y ?? 0, 0);
  });

  it('une part hors de [0, 1] est ramenée entre les deux gares', () => {
    const [avant] = trainsSurProfil(points, [avancement('motivon', 'col-de-voza', -4)]);
    const [apres] = trainsSurProfil(points, [avancement('motivon', 'col-de-voza', 7)]);
    expect(avant?.x).toBe(points[2]?.x);
    expect(apres?.x).toBe(points[3]?.x);
  });

  it('une position SANS part (celle de la grille) est posée à mi-chemin', () => {
    const position: PositionTrain = {
      numero: 9,
      sens: 'montee',
      rame: 'Marie',
      gare: 'motivon',
      vers: 'col-de-voza',
    };
    const [t] = trainsSurProfil(points, [position]);
    expect(t?.x).toBeCloseTo(((points[2]?.x ?? 0) + (points[3]?.x ?? 0)) / 2, 0);
  });

  it('la position est arrondie au demi-point : le dessin ne change pas à chaque seconde', () => {
    const [t] = trainsSurProfil(points, [avancement('motivon', 'col-de-voza', 0.3333)]);
    expect((t?.x ?? 0) * 2).toBe(Math.round((t?.x ?? 0) * 2));
    expect((t?.y ?? 0) * 2).toBe(Math.round((t?.y ?? 0) * 2));
  });

  it('un croisement en gare : les deux machines s’écartent, nez à nez de part et d’autre du point', () => {
    const voza = points[3];
    const [monte, descend] = trainsSurProfil(points, [
      avancement('col-de-voza', null, 0, 'montee'),
      { ...avancement('col-de-voza', null, 0, 'descente'), numero: 6, rame: 'Jeanne' },
    ]);
    // Celle qui monte reste AVANT la gare (à gauche), celle qui descend après.
    expect(monte?.x).toBeLessThan(voza?.x ?? 0);
    expect(descend?.x).toBeGreaterThan(voza?.x ?? 0);
    // Elles ne se recouvrent plus : une longueur de machine chacune, nez à nez.
    expect(
      Math.hypot((monte?.x ?? 0) - (descend?.x ?? 0), (monte?.y ?? 0) - (descend?.y ?? 0)),
    ).toBeGreaterThan(30);
    // …et leur cap n'a pas bougé : elles se font face.
    expect(monte?.cap).toBeLessThan(0);
    expect(descend?.cap).toBeGreaterThan(90);
  });

  it('l’écart est PROGRESSIF : une machine qui approche d’une autre ne saute jamais', () => {
    // Une machine à quai au Col de Voza (descente), une autre qui y monte : la
    // position dessinée de celle qui monte ne recule JAMAIS d'un pas à l'autre
    // de plus que ce qu'elle a avancé de trop — pas de saut de 16 unités.
    const aQuai = { ...avancement('col-de-voza', null, 0, 'descente'), numero: 6, rame: 'Jeanne' };
    let precedent = Number.NEGATIVE_INFINITY;
    let plusGrandPas = 0;
    for (let part = 0.5; part <= 1.0001; part += 0.005) {
      const [monte] = trainsSurProfil(points, [avancement('motivon', 'col-de-voza', part), aQuai]);
      const x = monte?.x ?? 0;
      if (precedent !== Number.NEGATIVE_INFINITY) {
        plusGrandPas = Math.max(plusGrandPas, Math.abs(x - precedent));
      }
      precedent = x;
    }
    // 0,5 % d'un tronçon de 68 unités = 0,34 unité de marche par pas ; avec le
    // recul progressif et l'arrondi au demi-point, jamais plus de 1,5.
    expect(plusGrandPas).toBeLessThanOrEqual(1.5);
  });

  it('une machine seule en gare ne bouge pas : l’écart ne vaut que pour un croisement', () => {
    const [seule] = trainsSurProfil(points, [avancement('col-de-voza', null, 0)]);
    expect(seule).toMatchObject({ x: points[3]?.x, y: points[3]?.y });
    // Deux machines sur des gares voisines (68 unités) ne sont pas un croisement.
    const [a, b] = trainsSurProfil(points, [
      avancement('col-de-voza', null, 0),
      { ...avancement('bellevue', null, 0, 'descente'), numero: 6 },
    ]);
    expect(a?.x).toBe(points[3]?.x);
    expect(b?.x).toBe(points[4]?.x);
  });

  it('une gare absente du profil : la machine n’est PAS dessinée, on n’invente rien', () => {
    const hiver = pointsProfil(GARES, 'bellevue');
    expect(trainsSurProfil(hiver, [avancement('nid-daigle', null, 0)])).toEqual([]);
    expect(trainsSurProfil(hiver, [avancement('bellevue', 'nid-daigle', 0.5)])).toEqual([]);
  });
});

describe('profilSvg — le dessin', () => {
  it('moins de deux gares : rien, plutôt qu’un point seul', () => {
    expect(profilSvg({ gares: GARES.slice(0, 1) })).toBe('');
  });

  it('la gare du poste est cerclée, et une seule', () => {
    const svg = profilSvg({ gares: GARES, ici: 'col-de-voza' });
    expect(svg.match(/class="profil-ici"/g)).toHaveLength(1);
    expect(svg.match(/class="profil-gare ici"/g)).toHaveLength(1);
    expect(profilSvg({ gares: GARES })).not.toContain('profil-ici');
  });

  it('l’anneau « vous êtes ici » passe SOUS les machines : une machine à quai reste visible', () => {
    const svg = profilSvg({
      gares: GARES,
      ici: 'motivon',
      positions: [{ numero: 9, sens: 'montee', rame: 'Marie', gare: 'motivon', vers: null }],
      machines: MACHINES,
    });
    expect(svg.indexOf('profil-ici')).toBeLessThan(svg.indexOf('profil-train'));
  });

  it('les altitudes des deux bouts de la ligne sont écrites, à la française, SOUS leur point', () => {
    const svg = profilSvg({ gares: GARES });
    const points = pointsProfil(GARES);
    const y = (texte: string): number =>
      Number(
        new RegExp(`class="profil-alt" x="[\\d.]+" y="([\\d.-]+)"[^>]*>${texte}<`).exec(svg)?.[1],
      );
    expect(y('580 m')).toBeGreaterThan(points[0]?.y ?? 0);
    expect(y('2 412 m')).toBeGreaterThan(points[5]?.y ?? 0);
    expect(profilSvg({ gares: GARES, altitudes: 'aucune' })).not.toContain('profil-alt');
  });

  it('pas d’altitude sur la gare du poste : l’anneau la recouvrirait, et le bandeau la dit déjà', () => {
    const sommet = profilSvg({ gares: GARES, ici: 'nid-daigle' });
    expect(sommet).not.toContain('>2 412 m</text>');
    expect(sommet).toContain('>580 m</text>');
    const pied = profilSvg({ gares: GARES, ici: 'le-fayet' });
    expect(pied).not.toContain('>580 m</text>');
    expect(pied).toContain('>2 412 m</text>');
    const milieu = profilSvg({ gares: GARES, ici: 'motivon' });
    expect(milieu.match(/class="profil-alt"/g)).toHaveLength(2);
  });

  it('une machine porte la couleur de sa rame, Marguerite son anneau rouge, et un cap', () => {
    const svg = profilSvg({
      gares: GARES,
      positions: [
        { numero: 9, sens: 'montee', rame: 'Marie', gare: 'motivon', vers: null },
        {
          numero: 8,
          sens: 'descente',
          rame: 'Marguerite',
          gare: 'bellevue',
          vers: 'col-de-voza',
          part: 0.4,
        },
      ],
      machines: MACHINES,
    });
    expect(svg).toContain('fill="#2E74B5" stroke="#ffffff"');
    expect(svg).toContain('fill="#FFFFFF" stroke="#E52A23"');
    expect(svg).toContain('class="profil-train en-route"');
    // Deux machines, deux caps opposés (montée / descente).
    const caps = [...svg.matchAll(/rotate\(([\d.-]+)\)/g)].map((m) => Number(m[1]));
    expect(caps).toHaveLength(2);
    expect(caps[0]).toBeLessThan(0);
    expect(caps[1]).toBeGreaterThan(90);
  });

  it('une couleur mal formée ne sort JAMAIS telle quelle dans un attribut', () => {
    const svg = profilSvg({
      gares: GARES,
      positions: [{ numero: 9, sens: 'montee', rame: 'Pirate', gare: 'motivon', vers: null }],
      machines: [
        {
          nom: 'Pirate',
          couleur: '"/><script>x</script>',
          cercle: 'red" onload="x',
          en_service: true,
        },
      ],
    });
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('onload');
    expect(svg).toContain('fill="#708DA4" stroke="#ffffff"');
  });

  it('un nom de gare ou de rame est échappé', () => {
    const svg = profilSvg({
      gares: [
        { id: 'le-fayet', nom: '<b>Fayet</b>', altitude_m: 580 },
        { id: 'saint-gervais', nom: 'Saint-Gervais', altitude_m: 786 },
      ],
      positions: [{ numero: 1, sens: 'montee', rame: '<i>X</i>', gare: 'le-fayet', vers: null }],
    });
    expect(svg).not.toContain('<b>');
    expect(svg).not.toContain('<i>');
  });
});
