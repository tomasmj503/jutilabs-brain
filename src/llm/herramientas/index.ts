import type { HerramientaLLM } from '../../types/index.js';
import { consultarFaq } from './consultarFaq.js';
import { consultarClases } from './consultarClases.js';
import { consultarEventos } from './consultarEventos.js';
import { consultarHabitaciones } from './consultarHabitaciones.js';
import { generarLinkReserva } from './generarLinkReserva.js';

/** Nombres genéricos a propósito (principio de reutilización, §10). */
export const herramientas: HerramientaLLM[] = [
  consultarFaq,
  consultarClases,
  consultarEventos,
  consultarHabitaciones,
  generarLinkReserva,
];
