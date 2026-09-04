// Le lien reçu par e-mail décide de l'écran d'accueil de la supervision :
// formulaire de mot de passe (invitation, réinitialisation), message
// d'erreur (lien mort) ou connexion ordinaire.
import { describe, expect, it } from 'vitest';

import {
  analyseLienAuth,
  LONGUEUR_MIN_MOT_DE_PASSE,
  texteFormulaireMotDePasse,
  verifieMotDePasse,
} from './lien-auth';

const JETONS = 'access_token=eyJhbGci.xxx.yyy&expires_in=3600&refresh_token=abc&token_type=bearer';

describe('analyseLienAuth', () => {
  it('ouverture ordinaire : pas de lien', () => {
    expect(analyseLienAuth('', '')).toBeNull();
    expect(analyseLienAuth('#', '?gare=saint-gervais')).toBeNull();
    expect(analyseLienAuth('#onglet-ecrans', '')).toBeNull();
  });

  it("reconnaît un lien d'invitation", () => {
    expect(analyseLienAuth(`#${JETONS}&type=invite`)).toEqual({ type: 'invite' });
  });

  it('reconnaît un lien de réinitialisation de mot de passe', () => {
    expect(analyseLienAuth(`#${JETONS}&type=recovery`)).toEqual({ type: 'recovery' });
  });

  it('une session ouverte sans demande de mot de passe (lien magique) est « autre »', () => {
    expect(analyseLienAuth(`#${JETONS}&type=magiclink`)).toEqual({ type: 'autre' });
    expect(analyseLienAuth(`#${JETONS}`)).toEqual({ type: 'autre' });
  });

  it('un lien expiré ou déjà consommé donne un message explicite', () => {
    const lien = analyseLienAuth(
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );
    expect(lien).not.toBeNull();
    expect(lien && 'erreur' in lien).toBe(true);
    if (lien && 'erreur' in lien) {
      expect(lien.erreur).toMatch(/expiré ou a déjà été utilisé/);
      expect(lien.erreur).toMatch(/nouvel envoi/);
    }
  });

  it("lit aussi l'erreur passée en requête (variante PKCE de Supabase)", () => {
    const lien = analyseLienAuth('', '?error=access_denied&error_code=otp_expired');
    expect(lien && 'erreur' in lien && lien.erreur).toMatch(/expiré/);
  });

  it('une erreur inconnue reprend la description fournie', () => {
    const lien = analyseLienAuth(
      '#error=server_error&error_description=Database+error+saving+new+user',
    );
    expect(lien && 'erreur' in lien && lien.erreur).toBe(
      'Lien refusé : Database error saving new user',
    );
  });

  it("l'erreur prime sur des jetons éventuellement présents", () => {
    const lien = analyseLienAuth(`#${JETONS}&type=invite&error_code=otp_expired`);
    expect(lien && 'erreur' in lien).toBe(true);
  });
});

describe('verifieMotDePasse', () => {
  it('refuse un mot de passe trop court', () => {
    const court = 'a'.repeat(LONGUEUR_MIN_MOT_DE_PASSE - 1);
    expect(verifieMotDePasse(court, court)).toMatch(
      new RegExp(`${LONGUEUR_MIN_MOT_DE_PASSE} caractères`),
    );
  });

  it('refuse deux saisies différentes', () => {
    expect(verifieMotDePasse('tramway-2026', 'tramway-2027')).toMatch(/ne correspondent pas/);
  });

  it('accepte un mot de passe conforme et confirmé', () => {
    expect(verifieMotDePasse('tramway-2026', 'tramway-2026')).toBeNull();
  });
});

describe('texteFormulaireMotDePasse', () => {
  it("distingue l'accueil d'un nouvel agent de la réinitialisation", () => {
    expect(texteFormulaireMotDePasse('invite').titre).toMatch(/Bienvenue/);
    expect(texteFormulaireMotDePasse('recovery').titre).toMatch(/Nouveau mot de passe/);
  });
});
