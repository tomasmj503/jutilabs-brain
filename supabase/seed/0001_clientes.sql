-- ============================================================================
-- Seed inicial: tenant "pruebas" + Mandala Yoga Hostel (datos del documento de Diego, sep-2026).
-- Lo NO confirmado va con activo=false (§11.3). El Sheet de Andrea + n8n hará upsert sobre estas
-- filas usando (cliente_id, clave). El prompt_base lo redacta Claude en semana 2.
-- ============================================================================

insert into public.clientes (slug, nombre, chatwoot_token_ref, nombre_bot, llm_modelo, llm_modelo_respaldo, openrouter_key_ref, temas_en_alcance, temas_que_escalan, tono, mensaje_escalamiento, mensaje_no_se_el_dato)
values
('pruebas', 'Tenant de pruebas JUTILABS', 'CHATWOOT_TOKEN_PRUEBAS', 'Asistente', 'qwen/qwen3-next-80b-a3b-instruct', 'deepseek/deepseek-v3.2', 'OPENROUTER_KEY_PRUEBAS', '{}', '{}', '{}', '{"es":"Te conecto con alguien del equipo.","en":"Let me connect you with the team."}', '{"es":"Déjame confirmar ese dato con el equipo.","en":"Let me confirm that with the team."}'),
('mandala', 'Mandala Yoga Hostel', 'CHATWOOT_TOKEN_MANDALA', 'Mandala AI', 'qwen/qwen3-next-80b-a3b-instruct', 'deepseek/deepseek-v3.2', 'OPENROUTER_KEY_MANDALA',
 '{hospedaje,habitaciones,check-in,check-out,desayuno,servicios,cancelacion,yoga,clases,eventos,cafe,tienda,ubicacion,faq}',
 '{india,voluntariado,retiros,formaciones,experiencias privadas,eventos corporativos,alquiler de espacios,grupos grandes,negociacion de precio,devoluciones,excepciones,reclamaciones}',
 '{"adjetivos":["cálida","cercana","clara","breve","espiritual sin exagerar","comercial sin presionar"],"principio":"Ayudar primero y vender naturalmente después.","saludo_es":"¡Hola! 🙏 Bienvenid@ a Mandala Yoga Hostel. Somos un espacio de hospedaje, yoga, bienestar y comunidad cerca del Aeropuerto El Dorado, en Bogotá. ¿Te puedo ayudar con hospedaje, clases de yoga, eventos o alguna de nuestras experiencias?"}',
 '{"es":"Claro 🙏 Para esto prefiero conectarte con una persona de nuestro equipo, así podemos orientarte de manera más personalizada. En un momento te escriben.","en":"Of course 🙏 For this I''d rather connect you with someone from our team so we can help you personally. They''ll write to you shortly."}',
 '{"es":"Quiero darte la información correcta 🙏 Déjame pasar esta consulta a nuestro equipo para confirmarla.","en":"I want to give you the right information 🙏 Let me pass this on to our team to confirm."}');
-- NOTA: los modelos de arriba son placeholders. Se fijan tras la prueba de 40 preguntas (semana 2). Verificar slugs vigentes en openrouter.ai/models.
-- PENDIENTES en clientes.mandala: chatwoot_account_id (al crear la cuenta), link_reserva_base (FDM producción), contactos_escalamiento (números de Diego y Andrea, §11.9).

-- ------------------------------------------------------------ habitaciones (Mandala)
with c as (select id from public.clientes where slug = 'mandala')
insert into public.habitaciones (cliente_id, clave, nombre, tipo, descripcion, capacidad, incluye, ideal_para, respuesta_modelo, orden) select c.id, v.* from c, (values
 ('shiva',   'Habitación Shiva',   'privada', 'Habitación privada doble con altar y detalles inspirados en India, ventanas redondas, ambiente tranquilo.', 2, '{cama doble,baño privado amplio}', 'parejas, practicantes de yoga, viajeros que buscan privacidad', '{"es":"La habitación Shiva es una de nuestras habitaciones privadas 🌿 Tiene cama doble, baño privado amplio y una atmósfera tranquila inspirada en India. Es ideal para parejas o para quien busca mayor privacidad. Si me dices tus fechas, puedo ayudarte a consultar disponibilidad."}', 1),
 ('buda',    'Habitación Buda',    'privada', 'Habitación privada pensada para descanso y trabajo.', 2, '{cama doble,baño privado,escritorio,Wi-Fi}', 'nómadas digitales, viajes de trabajo, estadías largas', '{"es":"La habitación Buda tiene cama doble, baño privado y escritorio, así que funciona muy bien si quieres descansar y también trabajar durante tu estancia 💻🌿."}', 2),
 ('lakshmi', 'Habitación Lakshmi', 'privada', 'Habitación privada de dos niveles, cama doble elevada, zona de estar, luz natural. Baño privado justo afuera de la habitación.', 2, '{cama doble elevada,zona de estar,baño privado (afuera)}', 'parejas y estadías prolongadas', '{"es":"Lakshmi es nuestra habitación privada más amplia ✨ Tiene dos niveles, cama doble elevada y una pequeña zona de estar. Su baño es privado y está ubicado justo al lado de la habitación."}', 3),
 ('krishna', 'Cápsulas Krishna',   'compartida', '13 cápsulas individuales dentro de una habitación compartida. Cada cápsula se cierra. Baño compartido.', 13, '{luz personal,tomacorriente,locker,cápsula con cierre}', 'viajeros solos, nómadas digitales', '{"es":"Las cápsulas Krishna son una de nuestras opciones más especiales 🙏 Son 13 espacios individuales que pueden cerrarse y cada uno tiene luz, tomacorriente y locker. Estás dentro de una habitación compartida, pero conservas bastante privacidad. El baño es compartido."}', 4),
 ('tara',    'Dormitorio Tara',    'compartida', 'Dormitorio compartido de 6 camas. Baño compartido.', 6, '{cortina de privacidad,luz personal,tomacorriente,locker}', 'mochileros, viajeros solos, opción económica y social', '{"es":"Tara es nuestro dormitorio compartido de 6 camas 🌎 Cada cama tiene cortina, luz, tomacorriente y locker. Es una opción cómoda para viajeros y mochileros que quieren compartir y conocer otras personas."}', 5)
) as v(clave, nombre, tipo, descripcion, capacidad, incluye, ideal_para, respuesta_modelo, orden);

-- ------------------------------------------------------------------ clases (Mandala)
with c as (select id from public.clientes where slug = 'mandala')
insert into public.clases (cliente_id, clave, nombre, dia_semana, hora, frecuencia, descripcion, respuesta_modelo) select c.id, v.* from c, (values
 ('libera',  'Mandala Yoga Libera',           4, '19:30'::time, 'semanal',   'Movimiento consciente, movilidad, respiración, estiramiento y liberación de tensiones.', '{"es":"Mandala Yoga Libera es los jueves a las 7:30 p. m. 🌿 Es una práctica para respirar, movilizar el cuerpo, liberar tensiones y regresar al centro."}'),
 ('canta',   'Mandala Yoga Canta',            5, '19:00'::time, 'quincenal', 'Mantras, música en vivo, kirtan, meditación. Llegar 6:45 p. m. No hace falta saber cantar.', '{"es":"Mandala Yoga Canta es nuestro círculo de canto y kirtan 🎶 Nos encontramos dos viernes al mes. Puedes llegar desde las 6:45 p. m. y comenzamos alrededor de las 7:00 p. m. No necesitas saber cantar; solo venir con disposición para compartir."}'),
 ('renueva', 'Mandala Yoga Renueva / Activa', 6, '08:00'::time, 'semanal',   'Hatha Yoga, respiración, fuerza, movilidad y energía para comenzar el fin de semana.', '{"es":"Los sábados a las 8:00 a. m. practicamos Mandala Yoga Renueva ☀️ Una práctica de Hatha Yoga para respirar, activar el cuerpo y comenzar el día con presencia."}')
) as v(clave, nombre, dia_semana, hora, frecuencia, descripcion, respuesta_modelo);
-- PENDIENTE §11.9: qué viernes es Yoga Canta → se cargará en eventos por fecha, no aquí.

-- --------------------------------------------------------------- productos (Mandala)
with c as (select id from public.clientes where slug = 'mandala')
insert into public.productos (cliente_id, clave, categoria, nombre, precio, moneda, unidad, activo, notas) select c.id, v.* from c, (values
 ('clase-individual', 'clase',   'Clase individual de yoga', 66000,  'COP', '1 clase',   true,  null),
 ('paquete-4',        'paquete', 'Paquete 4 clases',         160000, 'COP', '4 clases',  true,  null),
 ('paquete-8',        'paquete', 'Paquete 8 clases',         323000, 'COP', '8 clases',  false, 'INACTIVO: la web muestra "precio por confirmar". Unificar con Diego antes de activar (§11.3).'),
 ('paquete-12',       'paquete', 'Paquete 12 clases',        460000, 'COP', '12 clases', false, 'INACTIVO: sin unificar con la web (§11.3).'),
 ('tarifa-huesped',   'clase',   'Tarifa especial de yoga para huéspedes', null, 'COP', null, false, 'INACTIVO: monto sin definir (§11.9). El bot solo dice que existe una tarifa especial.')
) as v(clave, categoria, nombre, precio, moneda, unidad, activo, notas);

-- --------------------------------------------------------------- politicas (Mandala)
with c as (select id from public.clientes where slug = 'mandala')
insert into public.politicas (cliente_id, tipo, titulo, texto_es, escala_si, activo) select c.id, v.* from c, (values
 ('checkin',     'Check-in',  'Check-in desde la 1:00 p. m. Ingreso anticipado sujeto a disponibilidad. Recepción 24 horas: se reciben llegadas de madrugada con reserva.', 'costo de early check-in (sin definir §11.9)', true),
 ('checkout',    'Check-out', 'Check-out a las 11:00 a. m. Después puede quedarse en zonas comunes y dejar equipaje en custodia.', 'costo de late check-out (sin definir §11.9)', true),
 ('cancelacion', 'Cancelaciones', 'Reservas directas: cancelación mínimo 24 horas antes de la llegada; condiciones y cargos según tarifa. Booking/Hostelworld: aplican las condiciones de la plataforma y la tarifa.', 'devolución de dinero, excepción a la política, cancelación fuera de plazo, modificación compleja', true),
 ('incluye',     'Qué incluye el hospedaje', 'Desayuno, recepción 24 h, Wi-Fi de alta velocidad, espacios para trabajar, custodia de equipaje, zonas comunes, cercanía al aeropuerto. Yoga NO incluido: huéspedes tienen tarifa especial.', null, true),
 ('ubicacion',   'Ubicación', 'Carrera 77A #63-21, Villa Luz, Bogotá. ~10 min en taxi del Aeropuerto El Dorado según tráfico. Taxi, app de movilidad, SITP, TransMilenio.', null, true),
 ('cafe',        'Café vegetariano', 'Café vegetariano dentro del hostal, acceso por recepción. Desayuno Mandala, arepas, fruta y granola, empanadas, bowls, almuerzo del día, café, cacao, chai, infusiones, jugos.', 'horario del café (8am-8pm SIN confirmar, no comunicarlo como definitivo §11.3)', true),
 ('pagos',       'Formas de pago', 'PENDIENTE §11.9', 'cualquier pregunta de pago hasta definir', false)
) as v(tipo, titulo, texto_es, escala_si, activo);

-- --------------------------------------------------------------------- faq (Mandala) — las 10 del documento
with c as (select id from public.clientes where slug = 'mandala')
insert into public.faq (cliente_id, clave, categoria, pregunta_es, respuesta_es, palabras_clave, orden) select c.id, v.* from c, (values
 ('faq-01', 'hospedaje',  '¿Cuánto cuesta hospedarse?', 'Las tarifas cambian según las fechas, disponibilidad y tipo de habitación 😊 ¿Para qué fechas necesitas hospedaje y para cuántas personas? Así puedo ayudarte a consultar las mejores opciones.', '{precio,cuesta,tarifa,valor,cuánto}', 1),
 ('faq-02', 'ubicacion',  '¿Qué tan cerca están del aeropuerto?', 'Estamos en Villa Luz, aproximadamente a 10 minutos en taxi del Aeropuerto Internacional El Dorado, dependiendo del tráfico ✈️.', '{aeropuerto,cerca,distancia,dorado}', 2),
 ('faq-03', 'hospedaje',  '¿Puedo llegar tarde en la noche?', 'Sí 🙏 Nuestra recepción está disponible las 24 horas. Si ya tienes reserva, puedes llegar incluso si tu vuelo aterriza tarde.', '{tarde,noche,madrugada,recepción,24 horas}', 3),
 ('faq-04', 'hospedaje',  '¿A qué hora son el check-in y check-out?', 'El check-in comienza a la 1:00 p. m. y el check-out es a las 11:00 a. m. Si llegas temprano podemos revisar si tu espacio ya está disponible.', '{check-in,check-out,checkin,checkout,hora}', 4),
 ('faq-05', 'hospedaje',  '¿El desayuno está incluido?', 'Sí 🥣 El desayuno está incluido con tu hospedaje.', '{desayuno,incluido}', 5),
 ('faq-06', 'yoga',       '¿Las clases de yoga están incluidas?', 'Las clases de yoga tienen un valor adicional, pero nuestros huéspedes reciben una tarifa especial 🧘.', '{yoga,incluido,clases,huésped}', 6),
 ('faq-07', 'hospedaje',  '¿Qué habitación me recomiendan?', 'Depende de cómo quieras vivir Mandala 😊 Si buscas privacidad, tenemos Shiva, Buda y Lakshmi. Si viajas solo y quieres ahorrar manteniendo bastante privacidad, las cápsulas Krishna son una excelente opción. Si prefieres una experiencia más social y económica, está el dormitorio Tara.', '{recomiendan,habitación,cuál,mejor}', 7),
 ('faq-08', 'politicas',  '¿Cómo funcionan las cancelaciones?', 'En reservas directas puedes solicitar cancelación con mínimo 24 horas de anticipación. Si reservaste mediante una plataforma externa, también aplican las condiciones de esa plataforma.', '{cancelar,cancelación,cancelaciones}', 8),
 ('faq-09', 'yoga',       '¿Cuándo hay clases de yoga?', 'Nuestra programación regular es: Yoga Libera los jueves a las 7:30 p. m., Yoga Canta dos viernes al mes alrededor de las 7:00 p. m. y Yoga Renueva los sábados a las 8:00 a. m. También tenemos eventos especiales durante el mes.', '{horario,clases,cuándo,yoga}', 9),
 ('faq-10', 'ubicacion',  '¿Cómo llego a Mandala?', 'Estamos en Carrera 77A #63-21, Villa Luz, Bogotá 📍 Puedes llegar en taxi, aplicación de movilidad o transporte público. Desde el aeropuerto son aproximadamente 10 minutos en taxi, según el tráfico.', '{llegar,dirección,cómo llego,ubicación}', 10)
) as v(clave, categoria, pregunta_es, respuesta_es, palabras_clave, orden);
-- PENDIENTE §11.9: versiones EN (Diego autoriza traducción o entrega respuestas modelo en inglés).

-- ------------------------------------------------------------- formularios (Mandala) — 5 del documento
with c as (select id from public.clientes where slug = 'mandala')
insert into public.formularios (cliente_id, intencion, nombre, disparadores, mensaje_intro, campos, mensaje_cierre, prioridad) select c.id, v.* from c, (values
 ('india', 'India · El Camino del Alma 2027', '{india,camino del alma,peregrinaje,rishikesh,varanasi}',
  '{"es":"Si sientes el llamado de India, puedo pedirte unos datos y conectarte con nuestro equipo para enviarte el itinerario completo y acompañarte personalmente."}',
  '[{"clave":"nombre","pregunta":{"es":"¿Cuál es tu nombre completo?"},"tipo":"texto","obligatorio":true},{"clave":"ciudad","pregunta":{"es":"¿Desde qué país y ciudad nos escribes?"},"tipo":"texto","obligatorio":true},{"clave":"whatsapp","pregunta":{"es":"¿Cuál es tu WhatsApp?"},"tipo":"telefono","obligatorio":true},{"clave":"correo","pregunta":{"es":"¿Y tu correo?"},"tipo":"email","obligatorio":true},{"clave":"viajo_india","pregunta":{"es":"¿Has viajado antes a India?"},"tipo":"si_no","obligatorio":false},{"clave":"acompanado","pregunta":{"es":"¿Viajarías solo/a o acompañado/a?"},"tipo":"texto","obligatorio":false},{"clave":"motivacion","pregunta":{"es":"¿Cuál es tu principal motivación para este viaje?"},"tipo":"texto","obligatorio":true},{"clave":"interes","pregunta":{"es":"Del 1 al 5, ¿qué tan decidido/a estás?"},"tipo":"numero","obligatorio":false}]',
  '{"es":"¡Gracias! 🙏 Ya tengo tus datos. Alguien del equipo te escribirá con el itinerario completo de India · El Camino del Alma."}', 100),
 ('voluntariado', 'Programa Karmi Yogi', '{voluntariado,voluntario,karmi,karma yoga,work exchange,workaway}',
  '{"es":"Si quieres postularte, puedo pedirte unos datos básicos y pasar tu solicitud al equipo de Mandala."}',
  '[{"clave":"nombre","pregunta":{"es":"¿Cuál es tu nombre completo?"},"tipo":"texto","obligatorio":true},{"clave":"edad","pregunta":{"es":"¿Qué edad tienes?"},"tipo":"numero","obligatorio":true},{"clave":"nacionalidad","pregunta":{"es":"¿Cuál es tu nacionalidad?"},"tipo":"texto","obligatorio":true},{"clave":"fechas","pregunta":{"es":"¿En qué fechas estarías disponible?"},"tipo":"texto","obligatorio":true},{"clave":"duracion","pregunta":{"es":"¿Cuánto tiempo te gustaría quedarte?"},"tipo":"texto","obligatorio":true},{"clave":"idiomas","pregunta":{"es":"¿Hablas español, inglés o ambos?"},"tipo":"texto","obligatorio":true},{"clave":"habilidades","pregunta":{"es":"¿Qué habilidades podrías aportar (recepción, cocina, jardín, redes, etc.)?"},"tipo":"texto","obligatorio":true},{"clave":"experiencia","pregunta":{"es":"¿Tienes experiencia previa en voluntariado?"},"tipo":"texto","obligatorio":false},{"clave":"motivacion","pregunta":{"es":"¿Por qué quieres participar en Karmi Yogi?"},"tipo":"texto","obligatorio":true}]',
  '{"es":"¡Gracias por tu interés! 🌿 El equipo revisará tu solicitud y te contactará pronto."}', 80),
 ('formacion', 'Formación en Yoga 100 h', '{formación,formacion,teacher training,ttc,certificación,100 horas}',
  '{"es":"Las próximas fechas todavía están por anunciarse. Si quieres, puedo registrar tu interés para que el equipo te envíe información cuando abra la siguiente formación."}',
  '[{"clave":"nombre","pregunta":{"es":"¿Cuál es tu nombre?"},"tipo":"texto","obligatorio":true},{"clave":"whatsapp","pregunta":{"es":"¿Tu WhatsApp?"},"tipo":"telefono","obligatorio":true},{"clave":"correo","pregunta":{"es":"¿Tu correo?"},"tipo":"email","obligatorio":true},{"clave":"experiencia","pregunta":{"es":"¿Cuánto tiempo llevas practicando yoga?"},"tipo":"texto","obligatorio":false},{"clave":"perfil","pregunta":{"es":"¿Eres profesor/a o practicante?"},"tipo":"opcion","obligatorio":true,"opciones":["profesor/a","practicante"]},{"clave":"busca","pregunta":{"es":"¿Qué te gustaría aprender o profundizar?"},"tipo":"texto","obligatorio":false}]',
  '{"es":"Listo 🧘 Quedaste en nuestra lista de interesados. Te avisaremos cuando abramos la próxima formación."}', 60),
 ('retiros', 'Retiros y experiencias', '{retiro,retiros,ceremonia,cacao,sound healing,taller,experiencia privada,empresa,corporativo,tantra}',
  '{"es":"Si me cuentas qué estás buscando y para cuántas personas, puedo orientarte antes de conectarte con el equipo."}',
  '[{"clave":"nombre","pregunta":{"es":"¿Cuál es tu nombre?"},"tipo":"texto","obligatorio":true},{"clave":"tipo","pregunta":{"es":"¿Qué tipo de experiencia buscas?"},"tipo":"texto","obligatorio":true},{"clave":"personas","pregunta":{"es":"¿Para cuántas personas?"},"tipo":"numero","obligatorio":true},{"clave":"fecha","pregunta":{"es":"¿Tienes una fecha aproximada?"},"tipo":"texto","obligatorio":false},{"clave":"whatsapp","pregunta":{"es":"¿A qué WhatsApp te contactamos?"},"tipo":"telefono","obligatorio":true}]',
  '{"es":"Perfecto ✨ Ya le paso tu solicitud al equipo para que te contacten con una propuesta."}', 70),
 ('facilitadores', 'Facilitadores — uso de espacios', '{facilitador,facilitadora,alquiler,alquilar,templo,espacio para mi taller,dictar,dar un taller}',
  '{"es":"Si eres profesor, terapeuta o facilitador también puedes realizar tu taller, ceremonia o retiro urbano en nuestros espacios. Cuéntame qué actividad quieres realizar, fecha aproximada y número de personas, y te ponemos en contacto con el equipo."}',
  '[{"clave":"nombre","pregunta":{"es":"¿Cuál es tu nombre?"},"tipo":"texto","obligatorio":true},{"clave":"actividad","pregunta":{"es":"¿Qué actividad quieres realizar?"},"tipo":"texto","obligatorio":true},{"clave":"fecha","pregunta":{"es":"¿Fecha aproximada?"},"tipo":"texto","obligatorio":true},{"clave":"personas","pregunta":{"es":"¿Para cuántas personas?"},"tipo":"numero","obligatorio":true},{"clave":"whatsapp","pregunta":{"es":"¿A qué WhatsApp te contactamos?"},"tipo":"telefono","obligatorio":true}]',
  '{"es":"Gracias 🙏 El equipo te contactará para revisar disponibilidad de los espacios."}', 50)
) as v(intencion, nombre, disparadores, mensaje_intro, campos, mensaje_cierre, prioridad);
-- PENDIENTE §11.9: destinatario de cada formulario (a quién llega el lead) y versiones EN.
