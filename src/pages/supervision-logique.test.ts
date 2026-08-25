// Non-régression du reliquat d'audit (26/08/2026) : l'édition d'un message
// ne doit jamais altérer sa cible ni son expiration, et les identifiants
// d'écran doivent distinguer l'écran des départs de l'écran grille.
import { describe, expect, it } from 'vitest';

import type { Message } from '../core/types';
import {
  datetimeLocalVersIso,
  identifiantEcran,
  isoVersDatetimeLocal,
  messageDepuisFormulaire,
  valeursFormulaireMessage,
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
