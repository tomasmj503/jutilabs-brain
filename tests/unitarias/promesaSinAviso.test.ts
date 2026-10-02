import { describe, it, expect, vi } from 'vitest';
// Misma preparación que pasarAPersona.test.ts: se apaga la conexión a la base, aquí solo se prueba texto.
vi.mock('../../src/config/env.js', () => ({ env: {}, secretoPorRef: () => 'x' }));
vi.mock('../../src/db/supabase.js', () => ({ supabase: {} }));

const { promesaDePasarConsulta, motivoParaAvisarAlEquipo } = await import('../../src/ingesta/avisoDeEquipo.js');

describe('promesaDePasarConsulta: promesas que SÍ deben avisar al equipo', () => {
  const promesas = [
    // Respuestas reales de DeepSeek en la prueba de LLM (C08 rep 2 y C10 rep 1 y 2), sin llamar a la herramienta
    'Para un grupo de 40 personas ya es una experiencia que se arma con el equipo, así que le paso tu consulta ahora mismo para que lo diseñen contigo. ✨',
    'Los descuentos por estadías largas los maneja el equipo directamente, así que paso tu consulta para que te propongan la mejor opción.',
    'Con eso te comparto el enlace de reserva y les paso tu consulta para que te confirmen la mejor tarifa. Te van a escribir pronto 🌿',
    // Variantes en español
    'El equipo te confirma el valor en un momento.',
    'El equipo te confirmará la disponibilidad.',
    'Una persona del equipo te escribe hoy mismo.',
    'Alguien del equipo se pondrá en contacto contigo.',
    'Ya pasé tu consulta al equipo 🙏',
    'Voy a pasar tu solicitud al equipo.',
    'Te contactarán pronto para confirmar.',
    // Inglés
    'The team will get back to you shortly.',
    "I'll pass your question to the team.",
    'Someone from the team will reach out to you today.',
  ];
  it.each(promesas)('detecta: %s', (t) => {
    expect(promesaDePasarConsulta(t)).toBe(true);
  });
});

describe('promesaDePasarConsulta: frases normales u ofertas que NO deben avisar', () => {
  const normales = [
    'Al llegar, el equipo te recibe en recepción y te muestra tu habitación.',
    'El equipo de recepción está disponible las 24 horas.',
    'Cuando llegues, el equipo te ayuda con el check-in.',
    'La tarifa especial para huéspedes la confirma el equipo al momento del check-in.',
    // Oferta, no promesa: de B06 rep 0. Avisar aquí pausaría el bot antes de que el huésped responda.
    '¿Te gustaría que el equipo te confirme la tarifa de huésped? Quedo atenta para pasar tu consulta 🙏',
    'Te comparto el enlace de reserva con tus fechas.',
    'Puedes escribirnos por aquí cuando quieras.',
    'Las clases las guía Omkar Diego.',
    'The team welcomes you at reception.',
    'Reception is open 24 hours.',
    '',
  ];
  it.each(normales)('no dispara: %s', (t) => {
    expect(promesaDePasarConsulta(t)).toBe(false);
  });
});

describe('motivoParaAvisarAlEquipo con el texto que salió al huésped', () => {
  it('promesa sin llamar a la herramienta: avisa (fuera_de_alcance)', () => {
    expect(motivoParaAvisarAlEquipo(null, ['consultar_faq'], 'Paso tu consulta al equipo 🙏')).toBe('fuera_de_alcance');
  });
  it('texto normal sin herramienta: no avisa', () => {
    expect(motivoParaAvisarAlEquipo(null, ['consultar_faq'], 'El equipo te recibe en recepción.')).toBeNull();
  });
  it('sin texto (llamadas antiguas): se comporta como antes', () => {
    expect(motivoParaAvisarAlEquipo(null, ['consultar_faq'])).toBeNull();
    expect(motivoParaAvisarAlEquipo(null, ['consultar_faq', 'pasar_a_persona'])).toBe('fuera_de_alcance');
  });
  it('el tema de alto valor del router sigue mandando (no se avisa dos veces)', () => {
    expect(motivoParaAvisarAlEquipo('pidio_humano', ['consultar_faq'], 'Paso tu consulta al equipo')).toBe('pidio_humano');
  });
});

describe('promesaDePasarConsulta: condicionales vs. promesas reales (respuestas de la prueba de LLM)', () => {
  it.each([
    'Sí, paso tu consulta al equipo.',
    'Del paquete de 12 clases no tengo precio registrado, así que le paso tu consulta al equipo para que te lo confirme.',
    'A team member will follow up with you about availability and next steps ✨',
  ])('detecta: %s', (t) => {
    expect(promesaDePasarConsulta(t)).toBe(true);
  });
  it.each([
    'Si me compartes tus fechas de llegada y cuántas personas serían, te genero el link de reserva directa y el equipo te confirma el valor exacto.',
    'Si quieres, paso tu consulta al equipo.',
    'If you share your dates, the team will get back to you with the exact price.',
  ])('no dispara (condicional): %s', (t) => {
    expect(promesaDePasarConsulta(t)).toBe(false);
  });
});

describe('promesaDePasarConsulta: "dejo tu consulta con el equipo" (F05 de la corrida del 1-oct)', () => {
  it.each([
    'Para confirmar tu reserva #48213, lo mejor es escribir directamente al equipo por WhatsApp. Dejo tu consulta con una persona del equipo para que te ayude. ✨',
    'Ya dejé tu consulta con el equipo 🙏',
  ])('detecta: %s', (t) => {
    expect(promesaDePasarConsulta(t)).toBe(true);
  });
  it.each([
    'Si quieres, dejo tu consulta con el equipo.',
    'Te dejo el enlace de reserva con tus fechas.',
    'Puedes dejar tu consulta por escrito aquí.',
  ])('no dispara: %s', (t) => {
    expect(promesaDePasarConsulta(t)).toBe(false);
  });
});

describe('promesaDePasarConsulta: preguntas con "¿" son ofertas (F08 de la corrida del 1-oct)', () => {
  it.each([
    '¿Quieres que pase tu caso al equipo para comentarlo con el profe?',
    '¿Quieres que le paso tu consulta al equipo?',
  ])('no dispara: %s', (t) => {
    expect(promesaDePasarConsulta(t)).toBe(false);
  });
  it('sí dispara si la pregunta va después de la promesa', () => {
    expect(promesaDePasarConsulta('Paso tu consulta al equipo, ¿te parece?')).toBe(true);
  });
});

describe('promesaDePasarConsulta en alemán: promesas que SÍ deben avisar al equipo', () => {
  const promesasDe = [
    'Ich gebe deine Anfrage an das Team weiter.',
    'Ich leite Ihre Anfrage an unser Team weiter 🙏',
    'Das Team meldet sich bei dir.',
    'Jemand aus dem Team meldet sich in Kürze bei euch.',
    'Das Team wird sich bei Ihnen melden.',
    'Das Team bestätigt dir den Preis.',
    'Anschließend meldet sich das Team bei dir.',
    'Ein Teammitglied schreibt dir heute noch.',
  ];
  it.each(promesasDe)('detecta: %s', (t) => {
    expect(promesaDePasarConsulta(t)).toBe(true);
  });
});

describe('promesaDePasarConsulta en alemán: frases normales, ofertas y condicionales que NO deben avisar', () => {
  const normalesDe = [
    'Das Team empfängt euch an der Rezeption und zeigt euch das Zimmer.',
    'Die Rezeption ist rund um die Uhr besetzt.',
    'Beim Check-in hilft euch das Team gern weiter.',
    'Das Team kann dir den Preis bestätigen.',
    // Pregunta = oferta, como el "¿" en español
    'Möchtest du, dass das Team dir den Preis bestätigt?',
    // Condicional: depende de que el huésped conteste primero
    'Wenn du mir deine Reisedaten sagst, meldet sich das Team mit dem Preis.',
    // Imperativo dirigido al huésped, no una promesa
    'Kontaktiert das Team einfach per WhatsApp.',
    // Respuestas reales de E05 (DeepSeek, 1-oct)
    'Die Verfügbarkeit und Preise seht ihr direkt hier. Wenn ihr mir eure Reisedaten sagt, helfe ich euch gern weiter 🌿',
  ];
  it.each(normalesDe)('no dispara: %s', (t) => {
    expect(promesaDePasarConsulta(t)).toBe(false);
  });
});

describe('promesaDePasarConsulta: "continuará la conversación" (C10 de la corrida del 2-oct)', () => {
  // Es la frase que la propia herramienta pasar_a_persona le pide al modelo ("una persona del equipo continuará").
  const promesas = [
    // Respuestas reales de DeepSeek (Together / DeepInfra) que prometieron sin llamar a la herramienta
    'Los descuentos por estadías extendidas los revisa directamente nuestro equipo, así que tu consulta ya queda en sus manos y una persona continuará la conversación contigo.',
    'Mientras tanto, una persona del equipo continuará la conversación para revisar tu caso 🌿',
    'Una persona del equipo continuará la conversación contigo.',
    'Alguien del equipo continuará la conversación mañana.',
  ];
  it.each(promesas)('detecta: %s', (t) => {
    expect(promesaDePasarConsulta(t)).toBe(true);
  });

  const noDeben = [
    // Ofertas y preguntas: avisar pausaría el bot antes de que el huésped conteste
    '¿Quieres que una persona del equipo continúe la conversación?',
    '¿Una persona del equipo continuará la conversación contigo?',
    'Puedo pedir que una persona del equipo continúe la conversación si lo prefieres.',
    // Condicionales con "si": dependen de que el huésped conteste primero
    'Si quieres, una persona del equipo continuará la conversación contigo.',
    'Si me compartes tus fechas, una persona del equipo continuará la conversación.',
    // Otros usos normales
    'Mañana continuaremos la conversación sobre las clases de yoga.',
    'La recepción continuará abierta las 24 horas.',
    'Continuará la programación de yoga los jueves a las 7:30 p. m.',
  ];
  it.each(noDeben)('NO avisa: %s', (t) => {
    expect(promesaDePasarConsulta(t)).toBe(false);
  });

  it('motivoParaAvisarAlEquipo avisa con esa promesa aunque el modelo no llame a la herramienta', () => {
    expect(motivoParaAvisarAlEquipo(null, [], 'Mientras tanto, una persona del equipo continuará la conversación para revisar tu caso 🌿')).toBe('fuera_de_alcance');
  });
});
