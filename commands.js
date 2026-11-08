import 'dotenv/config';
import { InstallGlobalCommands } from './utils.js';

const SCRAPE_COMMAND = {
  name: 'scrape',
  description: 'Muestra las pasantias disponibles',
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

const SETCHANNEL_COMMAND = {
  name: 'setchannel',
  description: 'Establece el canal donde se enviarán las alertas automáticas de pasantías',
  options: [
    {
      type: 7, // Tipo 7 = Channel (Canal de texto)
      name: 'canal',
      description: 'Selecciona el canal de texto para las notificaciones',
      required: true,
    },
  ],
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

const LATEST_COMMAND = {
  name: 'latest',
  description: 'Muestra las últimas pasantías registradas, opcionalmente filtradas por ingeniería',
  options: [
    {
      type: 3, // Tipo 3 = STRING (Texto)
      name: 'keyword',
      description: 'Filtrar por ingeniería (ej. sistemas, industrial, programacion)',
      required: false, // Opcional: si no se escribe nada, muestra las últimas generales
    },
  ],
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

const ALL_COMMANDS = [SETCHANNEL_COMMAND, SCRAPE_COMMAND, LATEST_COMMAND];

async function main() {
  try {
    console.log('Registrando comandos globales...');
    await InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);
    console.log('¡Comandos registrados exitosamente!');
  } catch (error) {
    console.error('Error al registrar los comandos:', error);
  }
}

main();
