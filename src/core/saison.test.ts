// Hors saison : l'écran annonce la FERMETURE, ou n'affirme rien — lot du 28/09/2026.
//
// LE DÉFAUT CONSTATÉ. Le 28/09/2026, l'écran de Saint-Gervais montrait des
// en-têtes de colonnes sans une seule ligne : la saison était finie, aucune
// grille active ne couvrait la date, et la page sortait sur `!grille` AVANT
// le bloc qui l'aurait dit.
//
// LE RISQUE QUE CES TESTS TIENNENT. Le déclenchement est automatique (aucune
// grille active = fermé) : une faute de saisie des périodes en pleine saison
// produirait exactement le même état qu'une fin de saison, et six écrans
// annonceraient la fermeture du Tramway un matin d'août. Un écran qui annonce
// une fermeture fausse est PIRE qu'un écran vide, parce qu'on le croit.
// D'où trois états, et non deux : `incertaine` est la place de la faute de
// saisie, et l'écran y reste neutre (« informations momentanément
// indisponibles »), ce qui est vrai.
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import petitServiceJson from '../../docs/grilles-historique/2026-ete-petit-service.json';
import { etatSaison, TROU_SAISIE_MAX_JOURS, vueJournee } from './horaires';
import type { Grille, Jour, Periode } from './types';

const GRAND = grandServiceJson as unknown as Grille;
const PETIT = petitServiceJson as unknown as Grille;
/** Été 2026 tel qu'en base : petit 13/06–03/07 et 31/08–27/09, grand 04/07–30/08. */
const ETE = [GRAND, PETIT];

function avec(g: Grille, periodes: Periode[], extra: Partial<Grille> = {}): Grille {
  return { ...g, periodes, ...extra };
}

/** Grille d'hiver fictive : seules ses périodes comptent ici. */
const HIVER = avec(PETIT, [{ du: '2026-12-19', au: '2027-04-12' }], { version: 'hiver-2026' });

function jourHorsSaison(date: string): Jour {
  return {
    date,
    grille_version: '',
    terminus_bellevue: false,
    gare_debut: 'le-fayet',
    gare_fin: 'nid-daigle',
    circulations: [],
    enregistre: false,
    hors_saison: true,
  };
}

describe('etatSaison — une date couverte est en service', () => {
  it('en pleine saison, et aux deux bornes (incluses) de chaque période', () => {
    for (const date of ['2026-06-13', '2026-07-03', '2026-07-04', '2026-08-15', '2026-09-27']) {
      expect(etatSaison(ETE, date), date).toBe('service');
    }
  });
});

describe('etatSaison — la fin de saison est une FERMETURE', () => {
  it('le 28/09/2026, lendemain de la dernière période : fermé', () => {
    // Le cas mesuré en production.
    expect(etatSaison(ETE, '2026-09-28')).toBe('fermee');
  });

  it('des semaines après la dernière période : toujours fermé', () => {
    expect(etatSaison(ETE, '2026-11-15')).toBe('fermee');
    expect(etatSaison(ETE, '2027-03-01')).toBe('fermee');
  });

  it('avant la première période connue (avant-saison) : fermé', () => {
    expect(etatSaison(ETE, '2026-06-12')).toBe('fermee');
    expect(etatSaison(ETE, '2026-05-01')).toBe('fermee');
  });

  it('une intersaison entre deux grilles déjà chargées reste une fermeture', () => {
    // La grille d'hiver est souvent importée d'avance : « postérieure à toutes
    // les périodes connues » ne suffirait pas, l'automne entier passerait en
    // « incertain » alors que la ligne est bel et bien fermée.
    expect(etatSaison([...ETE, HIVER], '2026-09-28')).toBe('fermee');
    expect(etatSaison([...ETE, HIVER], '2026-12-18')).toBe('fermee');
    expect(etatSaison([...ETE, HIVER], '2026-12-19')).toBe('service');
  });
});

describe('etatSaison — un TROU court entre deux périodes est une faute de saisie', () => {
  it('un jour oublié entre deux grilles (fin au 29 au lieu du 30) : incertain', () => {
    const grandRogne = avec(GRAND, [{ du: '2026-07-04', au: '2026-08-29' }]);
    expect(etatSaison([grandRogne, PETIT], '2026-08-30')).toBe('incertaine');
    // Les jours voisins, eux, restent couverts : seul le trou est neutre.
    expect(etatSaison([grandRogne, PETIT], '2026-08-29')).toBe('service');
    expect(etatSaison([grandRogne, PETIT], '2026-08-31')).toBe('service');
  });

  it('un mois décalé (07 au lieu de 08) laisse un trou de ~30 jours : incertain', () => {
    // Petit service saisi « du 31/07 » au lieu du 31/08 : pas de trou ici ;
    // grand service saisi « au 30/07 » au lieu du 30/08 : trou du 31/07 au 30/08.
    const grandMoisFaux = avec(GRAND, [{ du: '2026-07-04', au: '2026-07-30' }]);
    expect(etatSaison([grandMoisFaux, PETIT], '2026-08-15')).toBe('incertaine');
    expect(etatSaison([grandMoisFaux, PETIT], '2026-07-31')).toBe('incertaine');
    expect(etatSaison([grandMoisFaux, PETIT], '2026-08-30')).toBe('incertaine');
  });

  it('le trou est mesuré entre deux périodes de la MÊME grille aussi', () => {
    const seule = avec(PETIT, [
      { du: '2026-06-13', au: '2026-07-03' },
      { du: '2026-07-06', au: '2026-09-27' },
    ]);
    expect(etatSaison([seule], '2026-07-04')).toBe('incertaine');
    expect(etatSaison([seule], '2026-07-05')).toBe('incertaine');
  });

  it(`borne exacte : ${TROU_SAISIE_MAX_JOURS} jours sans grille = incertain, un de plus = fermé`, () => {
    expect(TROU_SAISIE_MAX_JOURS).toBe(31);
    // Trou du 01/08 au 31/08 : 31 jours.
    const trente1 = [
      avec(PETIT, [{ du: '2026-06-01', au: '2026-07-31' }], { version: 'a' }),
      avec(PETIT, [{ du: '2026-09-01', au: '2026-09-30' }], { version: 'b' }),
    ];
    expect(etatSaison(trente1, '2026-08-01')).toBe('incertaine');
    expect(etatSaison(trente1, '2026-08-31')).toBe('incertaine');
    // Trou du 01/08 au 01/09 : 32 jours.
    const trente2 = [
      avec(PETIT, [{ du: '2026-06-01', au: '2026-07-31' }], { version: 'a' }),
      avec(PETIT, [{ du: '2026-09-02', au: '2026-09-30' }], { version: 'b' }),
    ];
    expect(etatSaison(trente2, '2026-08-01')).toBe('fermee');
    expect(etatSaison(trente2, '2026-09-01')).toBe('fermee');
  });

  it('le trou le plus PROCHE compte, pas la première ni la dernière période', () => {
    // Périodes dans le désordre et éloignées : seules les deux qui encadrent
    // la date au plus près décident.
    const grilles = [
      avec(PETIT, [{ du: '2027-06-01', au: '2027-09-30' }], { version: 'loin-apres' }),
      avec(PETIT, [{ du: '2026-08-20', au: '2026-09-30' }], { version: 'proche-apres' }),
      avec(PETIT, [{ du: '2025-06-01', au: '2025-09-30' }], { version: 'loin-avant' }),
      avec(PETIT, [{ du: '2026-06-01', au: '2026-08-10' }], { version: 'proche-avant' }),
    ];
    expect(etatSaison(grilles, '2026-08-15')).toBe('incertaine');
    expect(etatSaison([...grilles].reverse(), '2026-08-15')).toBe('incertaine');
  });
});

describe('etatSaison — sans aucune période connue, rien ne dit que la ligne est fermée', () => {
  it('aucune grille : incertain', () => {
    // Base vide, lecture incomplète : annoncer la fermeture serait inventer.
    expect(etatSaison([], '2026-08-15')).toBe('incertaine');
  });

  it('des grilles sans période : incertain', () => {
    expect(etatSaison([avec(GRAND, []), avec(PETIT, [])], '2026-08-15')).toBe('incertaine');
  });

  it('des grilles toutes désactivées : incertain', () => {
    const inactives = ETE.map((g) => ({ ...g, actif: false }));
    expect(etatSaison(inactives, '2026-08-15')).toBe('incertaine');
  });
});

describe('etatSaison — une grille DÉSACTIVÉE ne compte pas, comme dans serviceActif()', () => {
  it('elle ne couvre pas la date', () => {
    const grandInactif = { ...GRAND, actif: false };
    expect(etatSaison([grandInactif, PETIT], '2026-08-15')).not.toBe('service');
  });

  it('elle ne borne pas un trou non plus', () => {
    // Seule la grille inactive, toute proche, rendrait le trou « court ».
    const fin = avec(PETIT, [{ du: '2026-06-01', au: '2026-08-30' }], { version: 'a' });
    const inactive = avec(PETIT, [{ du: '2026-09-05', au: '2026-09-20' }], {
      version: 'b',
      actif: false,
    });
    expect(etatSaison([fin, inactive], '2026-09-01')).toBe('fermee');
  });

  it('LIMITE ASSUMÉE : désactiver le grand service par erreur en août annonce la fermeture', () => {
    // Trou du 04/07 au 30/08 = 58 jours : indiscernable d'une intersaison
    // par les seules périodes. Le garde-fou est en amont — la supervision
    // annonce « plus aucun service ne sera affiché » avant de confirmer.
    // Ce test documente le coût ; il ne le justifie pas.
    const grandInactif = { ...GRAND, actif: false };
    expect(etatSaison([grandInactif, PETIT], '2026-08-15')).toBe('fermee');
  });
});

describe('vueJournee — ce que montre un écran une fois les données jugées fraîches', () => {
  it('une date sans grille active produit « fermée », pas un retour anticipé', () => {
    // LE test qui échouait avant ce lot : c'est `grille === null` qui
    // définit le hors-saison, et c'est précisément le cas qui sortait avant.
    expect(vueJournee(ETE, jourHorsSaison('2026-09-28'), null)).toBe('fermee');
  });

  it('une date DANS une période active affiche les horaires', () => {
    const jour: Jour = { ...jourHorsSaison('2026-08-15'), grille_version: GRAND.version };
    delete jour.hors_saison;
    expect(vueJournee(ETE, jour, GRAND)).toBe('horaires');
  });

  it('un trou de saisie ne produit JAMAIS « fermée » : écran indisponible', () => {
    const grandRogne = avec(GRAND, [{ du: '2026-07-04', au: '2026-08-29' }]);
    expect(vueJournee([grandRogne, PETIT], jourHorsSaison('2026-08-30'), null)).toBe(
      'indisponible',
    );
  });

  it('sans journée chargée : indisponible', () => {
    expect(vueJournee(ETE, null, null)).toBe('indisponible');
    expect(vueJournee(ETE, null, GRAND)).toBe('indisponible');
  });

  it('données CONTRADICTOIRES (grille trouvée mais journée hors saison) : indisponible', () => {
    // La couche données dit « aucun service », les grilles disent le
    // contraire : l'écran ne tranche pas à sa place.
    expect(vueJournee(ETE, jourHorsSaison('2026-08-15'), GRAND)).toBe('indisponible');
    expect(vueJournee(ETE, jourHorsSaison('2026-08-15'), null)).toBe('indisponible');
  });

  it('une journée hors saison sans drapeau mais sans grille : jugée sur les périodes', () => {
    const jour: Jour = { ...jourHorsSaison('2026-09-28') };
    delete jour.hors_saison;
    expect(vueJournee(ETE, jour, null)).toBe('fermee');
  });
});
