// Non-régression du reliquat d'audit (26/08/2026) : l'édition d'un message
// ne doit jamais altérer sa cible ni son expiration, et les identifiants
// d'écran doivent distinguer l'écran des départs de l'écran grille.
import { describe, expect, it } from 'vitest';

import type { GareId, Message } from '../core/types';
import { ORDRE_GARES } from '../core/types';
import {
  datetimeLocalVersIso,
  identifiantEcran,
  isoVersDatetimeLocal,
  messageDepuisFormulaire,
  traductionLocale,
  valeursFormulaireMessage,
  initiales,
  libelleUtilisateur,
  recapCycle,
  ajusteSection,
  bandeauSection,
  bornesSectionPossibles,
  decisionBandeauApplication,
  type EtatBandeauApplication,
} from './supervision-logique';

/** Message ciblé « Motivon », expirant ce soir à 21:00 (heure locale). */
function messageCible(): Message {
  const soir = new Date();
  soir.setHours(21, 0, 0, 0);
  return {
    id: 'm-1',
    texte_fr: 'Travaux sur le quai de Motivon : accès par l’escalier nord.',
    texte_en: 'Works on Motivon platform: access via the north staircase.',
    cible_type: 'gares',
    gares: ['motivon'],
    train_numero: null,
    priorite: 'normale',
    actif: true,
    expire_at: soir.toISOString(),
  };
}

describe('Édition d’un message : cible et expiration préservées', () => {
  it('une simple correction de texte ne change ni la cible ni l’expiration', () => {
    const origine = messageCible();
    // Ouverture de « Modifier » : le formulaire est rempli depuis le message
    const formulaire = valeursFormulaireMessage(origine);
    expect(formulaire.cible_type).toBe('gares');
    expect(formulaire.gares).toEqual(['motivon']);
    expect(formulaire.expire_local).not.toBe(''); // expiration restituée

    // L'agent corrige uniquement le texte français
    formulaire.texte_fr = 'Travaux sur le quai de Motivon : accès par l’escalier SUD.';
    const enregistre = messageDepuisFormulaire(formulaire, origine.id);

    expect(enregistre.cible_type).toBe('gares');
    expect(enregistre.gares).toEqual(['motivon']);
    expect(enregistre.train_numero).toBeNull();
    expect(enregistre.expire_at).not.toBeNull();
    // Même instant à la minute près (le champ datetime-local n'a pas les secondes)
    expect(new Date(enregistre.expire_at ?? 0).getTime()).toBe(
      new Date(origine.expire_at ?? 0).setSeconds(0, 0),
    );
    expect(enregistre.texte_fr).toContain('SUD');
    expect(enregistre.id).toBe('m-1');
  });

  it('un message ciblé « train » conserve son numéro de train', () => {
    const origine: Message = {
      ...messageCible(),
      cible_type: 'train',
      gares: null,
      train_numero: 9,
    };
    const enregistre = messageDepuisFormulaire(valeursFormulaireMessage(origine), origine.id);
    expect(enregistre.cible_type).toBe('train');
    expect(enregistre.train_numero).toBe(9);
    expect(enregistre.gares).toBeNull();
  });

  it('l’expiration peut être RETIRÉE volontairement (choix « jamais »)', () => {
    const formulaire = valeursFormulaireMessage(messageCible());
    formulaire.expire_local = '';
    expect(messageDepuisFormulaire(formulaire, 'm-1').expire_at).toBeNull();
  });

  it('changer la cible pour « toutes » efface gares et train', () => {
    const formulaire = valeursFormulaireMessage(messageCible());
    formulaire.cible_type = 'toutes';
    const enregistre = messageDepuisFormulaire(formulaire, 'm-1');
    expect(enregistre.gares).toBeNull();
    expect(enregistre.train_numero).toBeNull();
  });

  it('conversion aller-retour ISO ↔ datetime-local, à la minute', () => {
    const local = '2026-08-28T21:00';
    const iso = datetimeLocalVersIso(local);
    expect(iso).not.toBeNull();
    expect(isoVersDatetimeLocal(iso)).toBe(local);
    expect(datetimeLocalVersIso('')).toBeNull();
    expect(isoVersDatetimeLocal(null)).toBe('');
  });
});

describe('Traduction de repli : jamais de faux anglais', () => {
  it('rend une chaîne VIDE quand le dictionnaire ne connaît pas la phrase', () => {
    expect(traductionLocale('Quai glissant, soyez prudents.')).toBe('');
    expect(traductionLocale('Phrase totalement inédite du chef de gare.')).toBe('');
  });

  it('ne préfixe JAMAIS le français par « [EN] »', () => {
    for (const phrase of [
      'Quai glissant, soyez prudents.',
      'Réservation obligatoire pour tous les trajets.',
      'Le train de 11 h est retardé de 10 minutes.',
      '',
      '   ',
    ]) {
      expect(traductionLocale(phrase)).not.toContain('[EN]');
    }
  });

  it('traduit les phrases types connues, appariées sur la phrase entière', () => {
    expect(traductionLocale('Réservation obligatoire pour tous les trajets.')).toBe(
      'Booking is compulsory for all journeys.',
    );
    expect(traductionLocale('forte affluence attendue')).toBe('High demand expected.');
  });

  it('ne produit pas de franglais mot à mot (« chef de station »)', () => {
    // « gare » ou « train » figurant dans une phrase inconnue ne doivent
    // déclencher aucune substitution partielle.
    expect(traductionLocale('Le chef de gare vous accueille au train de 9 h.')).toBe('');
    expect(traductionLocale('Panne technique en gare.')).toBe('');
  });

  it('rend vide sur une entrée vide ou blanche', () => {
    expect(traductionLocale('')).toBe('');
    expect(traductionLocale('   ')).toBe('');
  });

  it('un message enregistré sans anglais garde texte_en vide (pas de faux anglais)', () => {
    const f = {
      texte_fr: 'Quai glissant, soyez prudents.',
      texte_en: traductionLocale('Quai glissant, soyez prudents.'),
      cible_type: 'toutes' as const,
      gares: [],
      train_numero: null,
      priorite: 'normale' as const,
      expire_local: '',
    };
    expect(messageDepuisFormulaire(f, '').texte_en).toBe('');
  });
});

describe('Identifiant d’écran : le type de page en fait partie', () => {
  it('l’écran des départs et l’écran grille d’une même gare sont distincts', () => {
    expect(identifiantEcran('ecran', 'le-fayet', null)).toBe('le-fayet-ecran-1');
    expect(identifiantEcran('grille', 'le-fayet', null)).toBe('le-fayet-grille-1');
    expect(identifiantEcran('ecran', 'le-fayet', null)).not.toBe(
      identifiantEcran('grille', 'le-fayet', null),
    );
  });

  it('le paramètre ?ecran= reste prioritaire', () => {
    expect(identifiantEcran('ecran', 'le-fayet', 'fayet-quai-nord')).toBe('fayet-quai-nord');
  });
});

describe('Identité de l’agent connecté dans l’en-tête', () => {
  const profil = (nom: string, email = ''): { nom: string; email: string } => ({ nom, email });

  it('affiche le nom du profil quand il existe', () => {
    expect(libelleUtilisateur(profil('Thomas Musset', 'thomas@tmb.fr'))).toBe('Thomas Musset');
    expect(initiales(profil('Thomas Musset', 'thomas@tmb.fr'))).toBe('TM');
  });

  it('un nom d’un seul mot donne ses deux premières lettres', () => {
    expect(libelleUtilisateur(profil('Marie'))).toBe('Marie');
    expect(initiales(profil('Marie'))).toBe('MA');
  });

  it('sans nom, l’e-mail sert de libellé et d’initiales', () => {
    const p = profil('', 'caisse@exemple.fr');
    expect(libelleUtilisateur(p)).toBe('caisse@exemple.fr');
    expect(initiales(p)).toBe('CA');
  });

  it('ni nom ni e-mail : mention neutre plutôt qu’une chaîne vide', () => {
    expect(libelleUtilisateur(profil('', ''))).toBe('Agent connecté');
    expect(initiales(profil('', ''))).toBe('AG');
    expect(libelleUtilisateur(null)).toBe('Agent connecté');
    expect(initiales(null)).toBe('AG');
  });

  it('les accents sont conservés à la mise en majuscules', () => {
    expect(initiales(profil('Élodie Perrin'))).toBe('ÉP');
    expect(initiales(profil('Éric'))).toBe('ÉR');
  });

  it('les espaces superflus ne trompent ni le libellé ni les initiales', () => {
    expect(libelleUtilisateur(profil('   ', 'agent@tmb.fr'))).toBe('agent@tmb.fr');
    expect(initiales(profil('  Thomas   Musset  '))).toBe('TM');
  });
});

describe('Récapitulatif du cycle des médias', () => {
  const m = (duree_s: number) => ({ duree_s });

  it('mode série : horaires, puis les médias à la suite, puis horaires', () => {
    expect(recapCycle([m(8), m(8), m(12)], 'serie', 20)).toBe(
      'Cycle actuel : horaires 20 s → média 1 (8 s) → média 2 (8 s) → média 3 (12 s) → horaires — 48 s au total',
    );
  });

  it('mode alterné : un retour aux horaires entre chaque média', () => {
    expect(recapCycle([m(8), m(12)], 'alterne', 20)).toBe(
      'Cycle actuel : horaires 20 s → média 1 (8 s) → horaires 20 s → média 2 (12 s) → horaires — 60 s au total',
    );
  });

  it('un seul média : les deux modes décrivent le même cycle', () => {
    expect(recapCycle([m(8)], 'serie', 20)).toBe(recapCycle([m(8)], 'alterne', 20));
  });

  it('aucun média actif : on le dit, plutôt qu’un cycle vide', () => {
    expect(recapCycle([], 'serie', 20)).toBe(
      'Cycle actuel : horaires en continu — aucun média actif.',
    );
  });
});

// Bug du 31/08/2026 : le bandeau « Appliqué sur X/X écrans » apparaissait et
// disparaissait en boucle. Chaque rafraîchissement le réaffichait, le minuteur
// de 6 s le remasquait aussitôt, et ainsi de suite. La décision est désormais
// prise ici, à partir d'une mémoire explicite.
describe('decisionBandeauApplication (bandeau de publication)', () => {
  const MAINTENANT = new Date('2026-08-31T10:00:00Z').getTime();
  const ilYA = (ms: number): string => new Date(MAINTENANT - ms).toISOString();
  const PUBLICATION = MAINTENANT - 60_000;
  const NEUF: EtatBandeauApplication = { derniereReferenceAffichee: null, resumeResorbe: false };

  const aJour = { gare: 'le-fayet', derniere_vue: ilYA(5000), donnees_maj: ilYA(5000) };
  const enRetard = { gare: 'bellevue', derniere_vue: ilYA(5000), donnees_maj: ilYA(30 * 60_000) };

  it('rien n’a été modifié : aucun bandeau', () => {
    const d = decisionBandeauApplication([aJour], null, MAINTENANT, NEUF);
    expect(d.afficher).toBe(false);
  });

  it('un écran en retard : affichage CONTINU, sans minuteur', () => {
    const d = decisionBandeauApplication([aJour, enRetard], PUBLICATION, MAINTENANT, NEUF);
    expect(d.afficher).toBe(true);
    expect(d.classe).toBe('attente');
    expect(d.minuteurMs).toBeNull(); // la situation dure : l'information reste
    expect(d.libelle).toContain('en attente sur');
  });

  it('tant que l’écran reste en retard, le bandeau ne se résorbe pas', () => {
    let etat = NEUF;
    for (let i = 0; i < 5; i++) {
      const d = decisionBandeauApplication(
        [aJour, enRetard],
        PUBLICATION,
        MAINTENANT + i * 10_000,
        etat,
      );
      expect(d.afficher).toBe(true);
      etat = d.etat;
    }
  });

  it('tout à jour : bandeau vert, puis minuteur de résorption', () => {
    const d = decisionBandeauApplication([aJour], PUBLICATION, MAINTENANT, NEUF);
    expect(d.afficher).toBe(true);
    expect(d.classe).toBe('ok');
    expect(d.minuteurMs).toBe(6000);
    expect(d.etat.derniereReferenceAffichee).toBe(PUBLICATION);
  });

  it('une fois résorbé, les rafraîchissements suivants ne le rallument plus', () => {
    const premier = decisionBandeauApplication([aJour], PUBLICATION, MAINTENANT, NEUF);
    // Le minuteur est arrivé à échéance : le contrôleur note la résorption.
    const resorbe: EtatBandeauApplication = { ...premier.etat, resumeResorbe: true };
    for (const dt of [6001, 10_000, 60_000]) {
      const d = decisionBandeauApplication([aJour], PUBLICATION, MAINTENANT + dt, resorbe);
      expect(d.afficher).toBe(false);
      expect(d.etat.resumeResorbe).toBe(true); // et la mémoire tient
    }
  });

  it('une NOUVELLE modification réaffiche le bandeau', () => {
    const resorbe: EtatBandeauApplication = {
      derniereReferenceAffichee: PUBLICATION,
      resumeResorbe: true,
    };
    const publicationSuivante = MAINTENANT + 120_000;
    const d = decisionBandeauApplication(
      [aJour],
      publicationSuivante,
      publicationSuivante + 1000,
      resorbe,
    );
    expect(d.afficher).toBe(true);
    expect(d.etat.derniereReferenceAffichee).toBe(publicationSuivante);
    expect(d.etat.resumeResorbe).toBe(false);
  });
});

// Section exploitée : la CONTRAINTE gare_debut < gare_fin doit vivre dans
// l'interface, pas seulement en base. Une section inversée viderait tous les
// écrans, et un message d'erreur après coup ne rattrape pas un affichage
// voyageurs déjà faux.
describe('bornesSectionPossibles : les listes déroulantes interdisent l’incohérent', () => {
  it('le début ne propose jamais la fin ni au-delà', () => {
    expect(bornesSectionPossibles('debut', 'nid-daigle')).toEqual([
      'le-fayet',
      'saint-gervais',
      'motivon',
      'col-de-voza',
      'bellevue',
    ]);
    expect(bornesSectionPossibles('debut', 'motivon')).toEqual(['le-fayet', 'saint-gervais']);
  });

  it('la fin ne propose jamais le début ni en dessous', () => {
    expect(bornesSectionPossibles('fin', 'le-fayet')).toEqual([
      'saint-gervais',
      'motivon',
      'col-de-voza',
      'bellevue',
      'nid-daigle',
    ]);
    expect(bornesSectionPossibles('fin', 'bellevue')).toEqual(['nid-daigle']);
  });

  it('aucune liste n’est jamais vide : il reste toujours une section valide', () => {
    for (const g of ORDRE_GARES) {
      expect(
        bornesSectionPossibles('debut', g).length + bornesSectionPossibles('fin', g).length,
      ).toBeGreaterThan(0);
    }
    // Le Fayet en fin serait absurde : la liste des débuts garde au moins Le Fayet.
    expect(bornesSectionPossibles('debut', 'le-fayet')).toEqual(['le-fayet']);
  });
});

describe('ajusteSection : la borne déplacée est respectée, l’autre suit', () => {
  it('une section déjà cohérente n’est pas touchée', () => {
    expect(ajusteSection('le-fayet', 'nid-daigle', 'debut')).toEqual({
      debut: 'le-fayet',
      fin: 'nid-daigle',
    });
  });

  it('début poussé au-delà de la fin : la fin se décale juste après', () => {
    // L'exploitant choisit « de Bellevue » alors que la fin est à Motivon :
    // on respecte son choix et on remonte la fin au minimum nécessaire.
    expect(ajusteSection('bellevue', 'motivon', 'debut')).toEqual({
      debut: 'bellevue',
      fin: 'nid-daigle',
    });
  });

  it('fin ramenée avant le début : le début se décale juste avant', () => {
    expect(ajusteSection('col-de-voza', 'saint-gervais', 'fin')).toEqual({
      debut: 'le-fayet',
      fin: 'saint-gervais',
    });
  });

  it('début et fin identiques : la section reste non vide', () => {
    const r = ajusteSection('motivon', 'motivon', 'debut');
    expect(ORDRE_GARES.indexOf(r.debut)).toBeLessThan(ORDRE_GARES.indexOf(r.fin));
  });
});

describe('bandeauSection : signalé seulement quand la ligne est restreinte', () => {
  const nom = (g: GareId): string =>
    ({
      'le-fayet': 'Le Fayet',
      'saint-gervais': 'Saint-Gervais',
      motivon: 'Motivon',
      'col-de-voza': 'Col de Voza',
      bellevue: 'Bellevue',
      'nid-daigle': "Nid d'Aigle",
    })[g] ?? g;

  it('ligne entière : aucun bandeau', () => {
    expect(bandeauSection({ gare_debut: 'le-fayet', gare_fin: 'nid-daigle' }, nom)).toBeNull();
  });

  it('il nomme les gares fermées et annonce le report', () => {
    const texte = bandeauSection({ gare_debut: 'col-de-voza', gare_fin: 'nid-daigle' }, nom);
    expect(texte).toContain("de Col de Voza à Nid d'Aigle");
    expect(texte).toContain('gares fermées : Le Fayet, Saint-Gervais, Motivon');
    // Le report est LA garantie contre une journée oubliée : il doit être dit.
    expect(texte).toContain('reportée sur les journées suivantes');
  });

  it('une seule gare fermée : le singulier', () => {
    const texte = bandeauSection({ gare_debut: 'saint-gervais', gare_fin: 'nid-daigle' }, nom);
    expect(texte).toContain('gare fermée : Le Fayet');
    expect(texte).not.toContain('gares fermées');
  });

  it('les deux bouts peuvent être fermés en même temps', () => {
    const texte = bandeauSection({ gare_debut: 'saint-gervais', gare_fin: 'col-de-voza' }, nom);
    expect(texte).toContain("Le Fayet, Bellevue, Nid d'Aigle");
  });
});
