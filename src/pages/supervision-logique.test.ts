// Non-régression du reliquat d'audit (26/08/2026) : l'édition d'un message
// ne doit jamais altérer sa cible ni son expiration, et les identifiants
// d'écran doivent distinguer l'écran des départs de l'écran grille.
import { describe, expect, it } from 'vitest';

import type { GareId, Message } from '../core/types';
import { ORDRE_GARES } from '../core/types';
import { ONGLETS, ROLES, ROLES_QUI_ROUVRENT, plafondOnglets } from '../core/roles';
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
  barrePublication,
  heureCourte,
  grilleOngletsHtml,
  groupesNavigation,
  estOngletAdministration,
  etatVisibiliteOnglets,
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

// ---------------------------------------------------------------------------
// Carte « Onglets visibles par rôle ». Ce qu'on vérifie ici, c'est que la
// grille NE MENT PAS : une case cochable doit correspondre à un geste que la
// base acceptera, une case grisée à un geste qu'elle refuserait.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Barre de publication — les trois états (canevas 1d).
//
// Ce qui se joue ici n'est pas cosmétique : la barre répond à « ce que je vois
// est-il en gare ? ». Elle a longtemps prétendu que les modifications
// s'appliquaient immédiatement, ce qui est faux depuis le brouillon.
// ---------------------------------------------------------------------------

describe('barrePublication : les trois états et leur vocabulaire', () => {
  const PUBLIE_A = '2026-09-06T08:12:00.000Z'; // 10:12 à Paris

  it('ÉTAT 1 — rien à publier : bouton inerte, et ce que les gares affichent', () => {
    const v = barrePublication({ modifs: 0, echecs: 0, derniereISO: PUBLIE_A });
    expect(v.etat).toBe('publie');
    expect(v.titre).toBe('Tout est publié');
    expect(v.compteur).toBeNull();
    expect(v.boutonActif).toBe(false);
    // La ligne grise ne raconte plus une règle fausse : elle date l'état vu
    // en gare.
    expect(v.detail).toContain('10:12');
    expect(v.detail).toContain('Les 6 gares');
  });

  it('ÉTAT 2 — le compteur parle des ÉCRANS, pas du brouillon', () => {
    // « en attente de publication » décrivait le brouillon ; « pas encore sur
    // les écrans » décrit ce que voient les voyageurs. Même fait, point de vue
    // du guichet — et c'est celui qui compte.
    const v = barrePublication({ modifs: 2, echecs: 0, derniereISO: PUBLIE_A });
    expect(v.etat).toBe('en-cours');
    expect(v.titre).toBe('2 modifications pas encore sur les écrans');
    expect(v.titre).not.toContain('en attente de publication');
    expect(v.compteur).toBe(2);
    expect(v.boutonActif).toBe(true);
    // …et la ligne grise dit que les gares n'ont pas bougé.
    expect(v.detail).toContain('toujours');
    expect(v.detail).toContain('10:12');
  });

  it('ÉTAT 2 au singulier : « 1 modification », sans « s »', () => {
    const v = barrePublication({ modifs: 1, echecs: 0, derniereISO: PUBLIE_A });
    expect(v.titre).toBe('1 modification pas encore sur les écrans');
  });

  it('ÉTAT 3 — échec partiel : il PRIME sur le compteur ordinaire', () => {
    // Un échec laisse des voyageurs devant un horaire faux : il passe devant.
    const v = barrePublication({
      modifs: 3,
      echecs: 1,
      derniereISO: PUBLIE_A,
      echecISO: '2026-09-06T08:21:00.000Z',
    });
    expect(v.etat).toBe('echec');
    expect(v.titre).toContain('Publication incomplète');
    expect(v.titre).toContain('10:21');
    expect(v.titre).toContain('n’est pas en gare');
    expect(v.libelleBouton).toBe('Réessayer la publication');
    expect(v.boutonActif).toBe(true);
  });

  it('ÉTAT 3 au pluriel : l’accord suit le nombre resté en attente', () => {
    const v = barrePublication({ modifs: 5, echecs: 2, derniereISO: PUBLIE_A });
    expect(v.titre).toContain('2 modifications ne sont pas en gare');
  });

  it('l’état 3 garde la DATE de la dernière publication réussie', () => {
    // Ce qui est en gare reste l'état d'avant : la ligne grise ne doit pas
    // laisser croire que la tentative ratée a changé quelque chose.
    const v = barrePublication({
      modifs: 3,
      echecs: 1,
      derniereISO: PUBLIE_A,
      echecISO: '2026-09-06T08:21:00.000Z',
    });
    expect(v.detail).toContain('10:12');
    expect(v.detail).not.toContain('10:21');
  });

  it('AUCUNE publication encore faite : pas d’heure inventée', () => {
    // Une base neuve, ou un poste ouvert avant la première publication du
    // jour. Afficher « publié à 00:00 » serait un mensonge.
    const v = barrePublication({ modifs: 0, echecs: 0, derniereISO: null });
    expect(v.detail).not.toMatch(/\d{2}:\d{2}/);
    expect(v.detail).toContain('dernier état publié');
  });

  it('un horodatage ILLISIBLE ne casse pas la barre', () => {
    const v = barrePublication({ modifs: 1, echecs: 0, derniereISO: 'pas une date' });
    expect(v.etat).toBe('en-cours');
    expect(v.detail).not.toContain('Invalid');
    expect(v.detail).not.toMatch(/NaN/);
  });

  it('les trois états sont bien DISTINCTS — aucun libellé partagé', () => {
    const etats = [
      barrePublication({ modifs: 0, echecs: 0, derniereISO: PUBLIE_A }),
      barrePublication({ modifs: 2, echecs: 0, derniereISO: PUBLIE_A }),
      barrePublication({ modifs: 2, echecs: 1, derniereISO: PUBLIE_A }),
    ];
    expect(new Set(etats.map((e) => e.etat)).size).toBe(3);
    expect(new Set(etats.map((e) => e.titre)).size).toBe(3);
  });

  it('heureCourte : Europe/Paris, et null plutôt qu’une date bancale', () => {
    expect(heureCourte('2026-09-06T08:12:00.000Z')).toBe('10:12'); // été
    expect(heureCourte('2026-01-06T08:12:00.000Z')).toBe('09:12'); // hiver
    expect(heureCourte(null)).toBeNull();
    expect(heureCourte('n’importe quoi')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Barre de navigation à deux groupes (canevas 1b).
//
// La contrainte qui a fait retenir cette forme plutôt que les deux rangs :
// la liste d'onglets est RÉGLABLE en exploitation, la barre doit donc rester
// juste pour n'importe quel sous-ensemble — de huit entrées à une seule.
// ---------------------------------------------------------------------------

describe('groupesNavigation : la barre tient pour n’importe quel sous-ensemble', () => {
  it('huit onglets : cinq d’exploitation à gauche, trois d’administration à droite', () => {
    const g = groupesNavigation([...ONGLETS]);
    expect(g.exploitation).toEqual(['circulations', 'horaires', 'bandeau', 'medias', 'ecrans']);
    expect(g.administration).toEqual(['parametres', 'utilisateurs', 'journal']);
  });

  it('la configuration par défaut de la CAISSE : quatre onglets, deux groupes', () => {
    const g = groupesNavigation(['bandeau', 'medias', 'ecrans', 'journal']);
    expect(g.exploitation).toEqual(['bandeau', 'medias', 'ecrans']);
    expect(g.administration).toEqual(['journal']);
  });

  it('cas dégradé à DEUX onglets d’exploitation : le groupe droit est VIDE', () => {
    // L'appelant doit alors ne pas le rendre du tout — ni intitulé, ni filet.
    const g = groupesNavigation(['bandeau', 'medias']);
    expect(g.administration).toEqual([]);
    expect(g.exploitation).toHaveLength(2);
  });

  it('cas dégradé à UN onglet d’administration : le groupe gauche est VIDE', () => {
    // Constaté à l'écran : sans traitement, le groupe partait se coller tout à
    // droite d'une barre par ailleurs vide, avec un intitulé qui ne
    // distinguait plus rien de rien.
    const g = groupesNavigation(['journal']);
    expect(g.exploitation).toEqual([]);
    expect(g.administration).toEqual(['journal']);
  });

  it('aucun onglet : deux groupes vides, aucune barre à rendre', () => {
    const g = groupesNavigation([]);
    expect(g.exploitation).toEqual([]);
    expect(g.administration).toEqual([]);
  });

  it('AUCUN onglet n’est perdu ni dupliqué, quel que soit le sous-ensemble', () => {
    // Balayage exhaustif des 256 sous-ensembles possibles : la barre étant
    // réglable, ils sont tous atteignables en exploitation.
    for (let masque = 0; masque < 1 << ONGLETS.length; masque += 1) {
      const sousEnsemble = ONGLETS.filter((_, i) => (masque >> i) & 1);
      const g = groupesNavigation(sousEnsemble);
      expect([...g.exploitation, ...g.administration].sort()).toEqual([...sousEnsemble].sort());
    }
  });

  it('l’ORDRE de la barre est conservé dans chaque groupe', () => {
    const g = groupesNavigation([...ONGLETS]);
    for (const groupe of [g.exploitation, g.administration]) {
      const rangs = groupe.map((o) => ONGLETS.indexOf(o));
      expect(rangs).toEqual([...rangs].sort((a, b) => a - b));
    }
  });

  it('le groupe d’un onglet ne dépend PAS de sa visibilité', () => {
    // L'appartenance est fixe dans le code ; la visibilité est une donnée.
    // Masquer « Journal » à un rôle ne le fait pas changer de groupe.
    expect(estOngletAdministration('journal')).toBe(true);
    expect(groupesNavigation(['journal']).administration).toEqual(['journal']);
    expect(groupesNavigation([...ONGLETS]).administration).toContain('journal');
  });

  it('les trois onglets d’administration sont ceux qui ne servent pas en journée', () => {
    // Règle de placement du canevas : « exploitation » = ce qui sert en cours
    // de journée ; « administration » = ce qui se règle une fois, ou se
    // consulte après coup.
    for (const onglet of ['parametres', 'utilisateurs', 'journal'] as const) {
      expect(estOngletAdministration(onglet)).toBe(true);
    }
    for (const onglet of ['circulations', 'horaires', 'bandeau', 'medias', 'ecrans'] as const) {
      expect(estOngletAdministration(onglet)).toBe(false);
    }
  });

  it('le groupement ne crée ni ne retire AUCUN droit', () => {
    // C'est de la mise en page. Un onglet d'administration reste ouvert par
    // ses droits, exactement comme avant.
    for (const role of ROLES) {
      const g = groupesNavigation(plafondOnglets(role));
      expect([...g.exploitation, ...g.administration].sort()).toEqual(
        [...plafondOnglets(role)].sort(),
      );
    }
  });
});

describe('grilleOngletsHtml', () => {
  /** État d'une case, lu dans le HTML rendu. */
  function boite(html: string, role: string, onglet: string): string | null {
    const motif = new RegExp(`<input[^>]*data-role="${role}"[^>]*data-onglet="${onglet}"[^>]*>`);
    return motif.exec(html)?.[0] ?? null;
  }
  const cochee = (h: string, r: string, o: string): boolean =>
    (boite(h, r, o) ?? '').includes('checked');
  const grisee = (h: string, r: string, o: string): boolean =>
    (boite(h, r, o) ?? '').includes('disabled');

  it('rend une case par rôle et par onglet — la grille est complète', () => {
    const html = grilleOngletsHtml(null);
    for (const role of ROLES) {
      for (const onglet of ONGLETS) {
        expect(boite(html, role, onglet), `${role} × ${onglet} manquante`).not.toBeNull();
      }
    }
  });

  it('une case HORS PLAFOND est grisée, jamais cochée', () => {
    const html = grilleOngletsHtml(null);
    for (const role of ROLES) {
      for (const onglet of ONGLETS) {
        if (plafondOnglets(role).includes(onglet)) continue;
        expect(grisee(html, role, onglet), `${role} × ${onglet} devrait être grisée`).toBe(true);
        expect(cochee(html, role, onglet)).toBe(false);
      }
    }
  });

  it('elle porte son motif au survol : « aucun droit », et non un silence', () => {
    const html = grilleOngletsHtml(null);
    const b = boite(html, 'caisse', 'circulations') ?? '';
    expect(b).toContain('title=');
    expect(b).toContain('aucun droit');
  });

  it('la DERNIÈRE case qui rouvre la porte est cochée mais non décochable', () => {
    const html = grilleOngletsHtml(null);
    for (const role of ROLES_QUI_ROUVRENT) {
      expect(cochee(html, role, 'utilisateurs')).toBe(true);
      expect(grisee(html, role, 'utilisateurs'), `${role} pourrait s’enfermer dehors`).toBe(true);
    }
  });

  it('un onglet MASQUÉ reste recochable : le réglage est réversible', () => {
    // Le lot 2 vit ici : Horaires masqué à la caisse doit pouvoir revenir en
    // un clic, sans livraison de code.
    const html = grilleOngletsHtml({ caisse: ['bandeau', 'medias', 'ecrans', 'journal'] });
    expect(cochee(html, 'caisse', 'horaires')).toBe(false);
    expect(grisee(html, 'caisse', 'horaires')).toBe(false);
  });

  it('un rôle sans réglage s’affiche TOUT COCHÉ, comme il s’affiche à l’écran', () => {
    // La grille doit montrer l'état EFFECTIF, pas les lignes stockées : sinon
    // le technique croirait avoir tout masqué pour un rôle non réglé.
    const html = grilleOngletsHtml({ caisse: ['bandeau'] });
    for (const onglet of plafondOnglets('supervision')) {
      expect(cochee(html, 'supervision', onglet)).toBe(true);
    }
  });

  it('échappe ce qu’elle affiche', () => {
    // Les libellés sont des constantes aujourd'hui, mais la fonction passe
    // par `echapper()` : le jour où un motif viendra d'ailleurs, c'est déjà
    // fait. Le rendu ne doit contenir aucune balise non voulue.
    const html = grilleOngletsHtml(null);
    expect(html).not.toMatch(/<script/i);
    expect(html.match(/<input/g)?.length).toBe(ROLES.length * ONGLETS.length);
  });
});

describe('etatVisibiliteOnglets : le repli se DIT, il ne se devine pas', () => {
  it('réglage indisponible : la phrase l’annonce franchement', () => {
    const texte = etatVisibiliteOnglets(null);
    expect(texte).toContain('indisponible');
    expect(texte).toContain('repli');
  });

  it('rôles sans réglage : ils sont nommés', () => {
    const texte = etatVisibiliteOnglets({ caisse: ['bandeau'] });
    expect(texte).toContain('Technique');
    expect(texte).toContain('Supervision');
    expect(texte).not.toContain('Caisse');
  });

  it('tout est réglé : pas de bruit inutile', () => {
    const complet = Object.fromEntries(ROLES.map((r) => [r, plafondOnglets(r)]));
    expect(etatVisibiliteOnglets(complet)).toBe('');
  });
});
