// Source d'heure des écrans : heure réelle Europe/Paris, ou heure simulée
// `?simule=HH:MM` (elle démarre à HH:MM au chargement puis avance en temps
// réel). Le moteur src/core/ reste pur : il ne reçoit que des secondes.

export interface SourceHeure {
  /** Secondes depuis minuit (Europe/Paris), heure simulée comprise. */
  maintenantS(): number;
  /** Horodatage absolu (ms epoch) décalé par l'heure simulée — pour comparer les `expire_at`. */
  maintenantMs(): number;
  /** « YYYY-MM-DD » du jour d'exploitation (Europe/Paris). */
  dateISO(): string;
  /** « Lundi 24 août » (première lettre capitalisée). */
  dateLongue(): string;
  simulee: boolean;
}

const FORMAT_HMS = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const FORMAT_DATE_ISO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const FORMAT_DATE_LONGUE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

function secondesParis(): number {
  const [h = 0, m = 0, s = 0] = FORMAT_HMS.format(new Date()).split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

export function creeSourceHeure(simule: string | null): SourceHeure {
  let decalage = 0;
  let simulee = false;
  // Les secondes sont acceptées : les états « À QUAI » / « DÉPART IMMINENT »
  // se jouent sur une fenêtre de 30 s, impossible à viser à la minute près.
  if (simule && /^\d{1,2}:\d{2}(:\d{2})?$/.test(simule)) {
    const [h = 0, m = 0, s = 0] = simule.split(':').map(Number);
    decalage = h * 3600 + m * 60 + s - secondesParis();
    simulee = true;
  }
  return {
    simulee,
    maintenantS: () => (((secondesParis() + decalage) % 86400) + 86400) % 86400,
    maintenantMs: () => Date.now() + decalage * 1000,
    dateISO: () => FORMAT_DATE_ISO.format(new Date()),
    dateLongue: () => {
      const d = FORMAT_DATE_LONGUE.format(new Date());
      return d.charAt(0).toUpperCase() + d.slice(1);
    },
  };
}
