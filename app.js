import 'dotenv/config';
import express from 'express';

import * as cheerio from 'cheerio';
import cron from 'node-cron';

import fs from 'fs';
import path from 'path';

import {
  ButtonStyleTypes,
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  MessageComponentTypes,
  verifyKeyMiddleware,
} from 'discord-interactions';
import { getRandomEmoji, DiscordRequest } from './utils.js';
import { getShuffledOptions, getResult } from './game.js';

// Create an express app
const app = express();
// Get port, or default to 3000
const PORT = process.env.PORT || 3000;

const configPath = path.join(process.cwd(), 'config.json');
const filePath = path.join(process.cwd(), 'pasantias.json');
const targetUrl = "https://www.frc.utn.edu.ar/seu/pasantias/";

// Función auxiliar para generar un arreglo de Embeds a partir de una lista de pasantías
function generateEmbeds(items) {
  // Discord permite un máximo de 10 embeds por mensaje
  return items.slice(0, 10).map(item => ({
    title: `📌 ${item.puesto || 'Pasantía'} (${item.referencia})`,
    color: 0x5865F2, // Color azul/morado estilo Discord Blurple
    fields: [
      { name: '🏢 Empresa', value: item.empresa || 'No especificada', inline: true },
      { name: '🎓 Ingeniería', value: item.ingenieria || 'No especificada', inline: true },
      { name: '💻 Modalidad', value: item.modalidad || 'No especificada', inline: true },
      { name: '⏰ Horario', value: item.horario || 'No especificado', inline: true }
    ],
    timestamp: new Date().toISOString()
  }));
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

// Función centralizada para hacer scraping y detectar nuevas pasantías
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

      if (referencia && empresa) {
        currentListings.push({ referencia, puesto, empresa, ingenieria, modalidad, horario });
      }
    });

    if (currentListings.length === 0) {
      return { success: false, content: 'No se encontraron pasantías en la página.' };
    }

    let savedListings = [];
    if (fs.existsSync(filePath)) {
      const fileData = fs.readFileSync(filePath, 'utf-8');
      savedListings = JSON.parse(fileData);
    }

    const savedReferences = new Set(savedListings.map(item => item.referencia));
    const newItems = currentListings.filter(item => !savedReferences.has(item.referencia));

    if (newItems.length === 0) {
      return { success: true, newCount: 0, content: 'No hay pasantías nuevas publicadas desde la última revisión.' };
    }

    // Actualizamos el archivo JSON uniendo las nuevas con las guardadas
    const updatedListings = [...newItems, ...savedListings];
    fs.writeFileSync(filePath, JSON.stringify(updatedListings, null, 2), 'utf-8');

    // Generamos los embeds para las nuevas pasantías
    const embeds = generateEmbeds(newItems);
    const textContent = `🚨 **¡Se encontraron ${newItems.length} nueva(s) pasantía(s)!**`;

    // Si es automático, enviamos los embeds directamente al canal configurado por REST
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
  const { id, type, data } = req.body;

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
      fs.writeFileSync(configPath, JSON.stringify({ channelId: selectedChannelId }, null, 2), 'utf-8');

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: `✅ ¡Canal configurado exitosamente! Las alertas automáticas se enviarán a <#${selectedChannelId}>.` },
      });
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

    // Nuevo comando /latest para ver las últimas 5 pasantías guardadas
    if (name === 'latest') {
      if (!fs.existsSync(filePath)) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: 'Todavía no hay pasantías guardadas en el sistema.' },
        });
      }

      const savedListings = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (savedListings.length === 0) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: 'El registro de pasantías está vacío.' },
        });
      }

      const latestItems = savedListings.slice(0, 5);
      const embeds = generateEmbeds(latestItems);

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `📋 **Mostrando las últimas ${latestItems.length} pasantías registradas:**`,
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

// Endpoint externo para activar mediante cron-job.org u otros servicios 24/7
app.get('/trigger-check', async (req, res) => {
  console.log('Ejecutando revisión manual/externa de pasantías...');
  const result = await processInternships(true);
  res.status(200).json(result);
});