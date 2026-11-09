import 'dotenv/config';
import express from 'express';

import * as cheerio from 'cheerio';
import cron from 'node-cron';

import fs from 'fs';
import path from 'path';

import {
  InteractionResponseType,
  InteractionType,
  verifyKeyMiddleware,
} from 'discord-interactions';

// Create an express app
const app = express();
// Get port, or default to 3000
const PORT = process.env.PORT || 3000;

const configPath = path.join(process.cwd(), 'config.json');
const filePath = path.join(process.cwd(), 'pasantias.json');
const targetUrl = "https://www.frc.utn.edu.ar/seu/pasantias/";

function generateEmbeds(items) {
  return items.slice(0, 10).map(item => {
    const embed = {
      title: `📌 ${item.puesto || 'Pasantía'} (${item.referencia})`,
      color: 0x5865F2, // Color azul/morado estilo Discord Blurple
      fields: [
        { name: '🏢 Empresa', value: item.empresa || 'No especificada', inline: true },
        { name: '🎓 Ingeniería', value: item.ingenieria || 'No especificada', inline: true },
        { name: '💻 Modalidad', value: item.modalidad || 'No especificada', inline: true },
        { name: '⏰ Horario', value: item.horario || 'No especificado', inline: true }
      ],
      timestamp: new Date().toISOString()
    };

    // Solo añadimos la propiedad url si el item tiene un enlace único real
    if (item.link && item.link !== targetUrl) {
      embed.url = item.link;
    }

    return embed;
  });
}

// Función para enviar mensajes con embeds a Discord mediante la API REST
async function sendDiscordEmbedMessage(content, embeds) {
  if (!fs.existsSync(configPath)) {
    console.error('No hay un canal configurado. Usa el comando /setchannel primero.');
    return;
  }

  const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const channelId = configData.channelId;
  const token = process.env.DISCORD_TOKEN;

  if (!channelId || !token) return;

  const url = `https://discord.com/api/v10/channels/${channelId}/messages`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content, embeds }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Error al enviar mensaje automático a Discord:', errorText);
  }
}

// Función para editar la respuesta diferida utilizando la variable APP_ID de Render
async function editOriginalResponse(interactionToken, content, embeds) {
  const appId = process.env.APP_ID;
  if (!appId) {
    console.error('Falta la variable de entorno APP_ID en Render.');
    return;
  }

  const url = `https://discord.com/api/v10/webhooks/${appId}/${interactionToken}/messages/@original`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, embeds }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Error al editar respuesta diferida en Discord:', errorText);
  }
}

// Función centralizada para hacer scraping, extraer el enlace y detectar nuevas pasantías
async function processInternships(isAutomatic = false) {
  try {
    const scrapeResponse = await fetch(targetUrl);
    const html = await scrapeResponse.text();
    const $ = cheerio.load(html);

    const currentListings = [];

    $('.elementor-grid-item, .jet-listing-grid__item').each((index, element) => {
      const referencia = $(element).find('.elementor-element-96339e8 .jet-listing-dynamic-field__content').text().trim();
      const puesto = $(element).find('.elementor-element-b0ed3e7').text().trim();
      const empresa = $(element).find('.elementor-element-15b7e41 strong').text().trim();
      const ingenieria = $(element).find('.elementor-element-62579bb strong').text().trim();
      const modalidad = $(element).find('.elementor-element-49f60d6 strong').text().trim();
      const horario = $(element).find('.elementor-element-a44033f strong').text().trim();

      // Buscamos el enlace (href) de la tarjeta
      let rawLink = $(element).find('a').attr('href') || $(element).closest('a').attr('href');
      let link = rawLink ? (rawLink.startsWith('http') ? rawLink : new URL(rawLink, targetUrl).href) : targetUrl;

      if (referencia && empresa) {
        currentListings.push({ referencia, puesto, empresa, ingenieria, modalidad, horario, link });
      }
    });

    if (currentListings.length === 0) {
      return { success: false, content: 'No se encontraron pasantías en la página.' };
    }

    let savedListings = [];
    if (fs.existsSync(filePath)) {
      const fileData = fs.readFileSync(filePath, 'utf-8').trim();
      if (fileData) {
        try {
          savedListings = JSON.parse(fileData);
        } catch (e) {
          savedListings = []; // Si el JSON está dañado o vacío, empieza con un array limpio
        }
      }
    }

    const savedReferences = new Set(savedListings.map(item => item.referencia));
    const newItems = currentListings.filter(item => !savedReferences.has(item.referencia));

    if (newItems.length === 0) {
      return { success: true, newCount: 0, content: 'No hay pasantías nuevas publicadas desde la última revisión.' };
    }

    // Actualizamos el archivo JSON uniendo las nuevas con las guardadas
    const updatedListings = [...newItems, ...savedListings];
    fs.writeFileSync(filePath, JSON.stringify(updatedListings, null, 2), 'utf-8');

    // Generamos los embeds que incluirán el enlace en el título
    const embeds = generateEmbeds(newItems);
    const textContent = `🚨 **¡Se encontraron ${newItems.length} nueva(s) pasantía(s)!**`;

    if (isAutomatic) {
      await sendDiscordEmbedMessage(textContent, embeds);
    }

    return { success: true, newCount: newItems.length, content: textContent, embeds: embeds };

  } catch (error) {
    return { success: false, content: `Error al procesar el scraping: ${error.message}` };
  }
}

/**
 * Interactions endpoint URL donde Discord envía las solicitudes HTTP
 */
app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async function (req, res) {
  console.log("📥 ¡Petición de Discord recibida en /interactions!");
    next();
  }, verifyKeyMiddleware(process.env.PUBLIC_KEY), async function (req, res) {
    const { type, data, token } = req.body;
    console.log("⚙️ Tipo de interacción procesada:", type);

  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;

  if (name === 'setchannel') {
      const channelOption = data.options?.find(opt => opt.name === 'canal');
      
      if (!channelOption) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: 'Por favor, selecciona un canal válido.' },
        });
      }

      const selectedChannelId = channelOption.value;
      
      try {
        fs.writeFileSync(configPath, JSON.stringify({ channelId: selectedChannelId }, null, 2), 'utf-8');
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: `✅ ¡Canal configurado exitosamente! Las alertas automáticas se enviarán a <#${selectedChannelId}>.` },
        });
      } catch (error) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: `❌ Error al guardar la configuración: ${error.message}` },
        });
      }
    }

    if (name === 'scrape') {
      const result = await processInternships(false);

      if (!result.embeds) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: result.content },
        });
      }

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: result.content,
          embeds: result.embeds,
        },
      });
    }

    if (name === 'latest') {
      if (!fs.existsSync(filePath)) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: 'Todavía no hay pasantías guardadas en el sistema.' },
        });
      }

      const fileData = fs.readFileSync(filePath, 'utf-8').trim();
      let savedListings = [];
      if (fileData) {
        try {
          savedListings = JSON.parse(fileData);
        } catch (e) {
          savedListings = [];
        }
      }

      if (savedListings.length === 0) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: 'El registro de pasantías está vacío.' },
        });
      }

      // Obtenemos la keyword ingresada por el usuario (si existe)
      const keywordOption = data.options?.find(opt => opt.name === 'keyword');
      const keyword = keywordOption ? keywordOption.value.toLowerCase().trim() : null;

      let filteredListings = savedListings;

      // Si el usuario escribió una palabra clave, filtramos el campo ingenieria
      if (keyword) {
        filteredListings = savedListings.filter(item => 
          item.ingenieria && item.ingenieria.toLowerCase().includes(keyword)
        );
      }

      if (filteredListings.length === 0) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: `🔍 No se encontraron pasantías que coincidan con la palabra clave: "**${keyword}**".` },
        });
      }

      const latestItems = filteredListings.slice(0, 5);
      const embeds = generateEmbeds(latestItems);

      const responseText = keyword
        ? `📋 **Mostrando ${latestItems.length} pasantía(s) para "${keyword}" (de ${filteredListings.length} encontradas):**`
        : `📋 **Mostrando las últimas ${latestItems.length} pasantías registradas:**`;

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: responseText,
          embeds: embeds,
        },
      });
    }

    console.error(`unknown command: ${name}`);
    return res.status(400).json({ error: 'unknown command' });
  }

  console.error('unknown interaction type', type);
  return res.status(400).json({ error: 'unknown interaction type' });
});

// Programa la tarea automática todos los días a las 12:00 PM
cron.schedule('0 12 * * *', async () => {
  console.log('Ejecutando revisión automática de pasantías (12:00 PM)...');
  const result = await processInternships(true);
  if (result.success && result.newCount > 0) {
    console.log(`¡Notificadas ${result.newCount} nuevas pasantías en Discord automáticamente!`);
  } else {
    console.log('Revisión automática completada: No hay novedades.');
  }
}, {
  timezone: "America/Argentina/Cordoba"
});

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});

// Endpoint externo para activar mediante cron-job.org
app.get('/trigger-check', async (req, res) => {
  console.log('Ejecutando revisión manual/externa de pasantías...');
  const result = await processInternships(true);
  res.status(200).json(result);
});

app.get('/ping', (req, res) => {
  res.status(200).send('Pong! 🚀');
});

